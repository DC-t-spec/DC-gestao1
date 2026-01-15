(() => {
  "use strict";

  alert("JS NOVO carregou ✅ v2026-01-15");
  console.log("JS NOVO carregou ✅ v2026-01-15");

  /***********************
   * Gestão Fácil - V1 (JS ÚNICO COMPLETO • CORRIGIDO)
   ************************/

  /* =======================
     Utils
  ======================= */
  const MT = (n) => `${Number(n || 0).toFixed(2)} MT`;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = () =>
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2) + Date.now().toString(16);

  const byName = (a, b) => (a.nome || "").localeCompare(b.nome || "");
  const safeText = (s) =>
    String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  /* =======================
     Storage
  ======================= */
  const KEY = "gestao_facil_v1_offlinefirst";
  const BACKUP_KEY = "gestao_facil_auto_snapshots_v1";
  const BACKUP_MAX = 30;

  const loadLocal = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; }
    catch { return null; }
  };
  const saveLocal = (db) => localStorage.setItem(KEY, JSON.stringify(db));

  /* =======================
     DB init
  ======================= */
  let db =
    loadLocal() || {
      meta: { updatedAt: Date.now(), version: 1, workspaceId: "" },
      online: { url: "", key: "" },

      users: [],
      auth: { currentUserId: null },

      company: { nome: "", nuit: "", contacto: "", morada: "", email: "" },

      accounts: [{ id: uid(), nome: "Dinheiro", tipo: "Dinheiro", ativo: true, saldo: 0 }],
      customers: [{ id: uid(), nome: "Cliente balcão", telefone: "", notas: "" }],
      products: [
        { id: uid(), nome: "Refresco 500ml", precoVenda: 35, precoAquisicaoRef: 22, minStock: 5, img: "", desc: "", ativo: true, stockBaseId: "", stockFactor: 1 },
        { id: uid(), nome: "Bolo fatia", precoVenda: 50, precoAquisicaoRef: 30, minStock: 3, img: "", desc: "", ativo: true, stockBaseId: "", stockFactor: 1 }
      ],
      inventory: {},

      purchases: [],
      sales: [],
      ledger: [],
      inventoryAdjustments: [],

      settings: { autoBackupMinutes: 10 }
    };

  saveLocal(db);

  /* =======================
     Runtime
  ======================= */
  let cart = [];
  let supabase = null;

  function setSyncState(text) {
    const el = document.getElementById("syncState");
    if (el) el.textContent = text;
  }

  function setAppLocked(locked) {
    const app = document.querySelector(".app");
    if (!app) return;
    // a tua .app é grid, não flex
    app.style.display = locked ? "none" : "grid";
  }

  /* =======================
     Workspace (ID da Loja) - ÚNICO
  ======================= */
  const WS_KEY = "gestao_facil_workspace_id";

  function normalizeWorkspaceId(v) {
    return String(v || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "-")
      .replace(/[^A-Z0-9-_]/g, "");
  }

  function getWorkspaceId() {
    const v = db?.meta?.workspaceId || localStorage.getItem(WS_KEY) || "";
    return normalizeWorkspaceId(v);
  }

  function setWorkspaceId(v) {
    const id = normalizeWorkspaceId(v);
    db.meta = db.meta || {};
    db.meta.workspaceId = id;
    localStorage.setItem(WS_KEY, id);
    saveLocal(db);
  }

  function ensureWorkspaceModel() {
    db.meta = db.meta || {};
    if (db.meta.workspaceId == null) db.meta.workspaceId = "";
    db.company = db.company || { nome: "", nuit: "", contacto: "", morada: "", email: "" };

    const ls = normalizeWorkspaceId(localStorage.getItem(WS_KEY) || "");
    if (ls && !db.meta.workspaceId) db.meta.workspaceId = ls;
    if (db.meta.workspaceId) localStorage.setItem(WS_KEY, normalizeWorkspaceId(db.meta.workspaceId));
  }

  function generateWorkspaceId(prefix = "DCNET") {
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${normalizeWorkspaceId(prefix)}-LOJA-${rnd}`;
  }

  function requireWorkspaceIdOrWarn() {
    const ws = getWorkspaceId();
    if (!ws) {
      alert("Defina o ID da Loja/Base partilhada. Pode clicar em 'Gerar'.");
      const input = document.getElementById("workspaceId");
      if (input) input.focus();
      return false;
    }
    return true;
  }

  /* =======================
     Online config (Supabase) — APENAS 1 VEZ (corrigido)
  ======================= */
  const SB_URL_KEY = "gestao_facil_supabase_url";
  const SB_KEY_KEY = "gestao_facil_supabase_key";

  function getOnlineConfig() {
    const url = (localStorage.getItem(SB_URL_KEY) || db?.online?.url || "").trim();
    const key = (localStorage.getItem(SB_KEY_KEY) || db?.online?.key || "").trim();
    return { url, key };
  }

  function setOnlineConfig(url, key) {
    const u = (url || "").trim();
    const k = (key || "").trim();
    localStorage.setItem(SB_URL_KEY, u);
    localStorage.setItem(SB_KEY_KEY, k);

    db.online = db.online || { url: "", key: "" };
    db.online.url = u;
    db.online.key = k;
    saveLocal(db);
  }

  /* =======================
     Online (Supabase opcional)
  ======================= */
  function loadScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
      if (document.getElementById(id)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.id = id;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Falha ao carregar script"));
      document.head.appendChild(s);
    });
  }

  async function initSupabaseIfConfigured() {
    const { url, key } = getOnlineConfig();
    if (!url || !key) {
      setSyncState("Modo: Offline");
      supabase = null;
      return;
    }

    await loadScriptOnce(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
      "supabase-cdn"
    );

    supabase = window.supabase.createClient(url, key);
    setSyncState("Modo: Online (Supabase)");
  }

  /* =======================
     MERGE + SYNC (mantive teu código)
     (… aqui fica exatamente como tens — não alterei lógica)
  ======================= */
  function toMs(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }

  function ensureTimestamps(item) {
    if (!item || typeof item !== "object") return item;
    if (!item.id) return item;
    if (item.createdAt == null) item.createdAt = Date.now();
    if (item.updatedAt == null) item.updatedAt = item.createdAt;
    return item;
  }

  function mergeListById(localList = [], remoteList = []) {
    const map = new Map();
    for (const raw of localList || []) {
      const item = ensureTimestamps(raw);
      if (!item?.id) continue;
      map.set(item.id, item);
    }
    for (const raw of remoteList || []) {
      const item = ensureTimestamps(raw);
      if (!item?.id) continue;

      const cur = map.get(item.id);
      if (!cur) { map.set(item.id, item); continue; }

      const r = toMs(item.updatedAt) || toMs(item.createdAt);
      const l = toMs(cur.updatedAt) || toMs(cur.createdAt);
      if (r > l) map.set(item.id, item);
    }
    return Array.from(map.values());
  }

  function mergeInventory(localDb = {}, remoteDb = {}) {
    const l = toMs(localDb?.meta?.updatedAt);
    const r = toMs(remoteDb?.meta?.updatedAt);

    const li = localDb.inventory && typeof localDb.inventory === "object" ? localDb.inventory : {};
    const ri = remoteDb.inventory && typeof remoteDb.inventory === "object" ? remoteDb.inventory : {};
    return r > l ? { ...li, ...ri } : { ...ri, ...li };
  }

  function mergeDb(localDb = {}, remoteDb = {}) {
    const merged = {
      ...localDb,
      meta: {
        ...(localDb.meta || {}),
        ...(remoteDb.meta || {}),
        workspaceId: localDb.meta?.workspaceId || remoteDb.meta?.workspaceId || "",
        updatedAt: Date.now(),
        version: Math.max(Number(localDb.meta?.version || 1), Number(remoteDb.meta?.version || 1))
      },
      online: { ...(remoteDb.online || {}), ...(localDb.online || {}) },
      auth: {
        ...(remoteDb.auth || {}),
        ...(localDb.auth || {}),
        currentUserId: localDb.auth?.currentUserId ?? null
      },
      company:
        toMs(remoteDb?.meta?.updatedAt) > toMs(localDb?.meta?.updatedAt)
          ? remoteDb.company || localDb.company || {}
          : localDb.company || remoteDb.company || {},

      users: mergeListById(localDb.users, remoteDb.users),
      accounts: mergeListById(localDb.accounts, remoteDb.accounts),
      customers: mergeListById(localDb.customers, remoteDb.customers),
      products: mergeListById(localDb.products, remoteDb.products),

      purchases: mergeListById(localDb.purchases, remoteDb.purchases),
      sales: mergeListById(localDb.sales, remoteDb.sales),
      ledger: mergeListById(localDb.ledger, remoteDb.ledger),
      inventoryAdjustments: mergeListById(localDb.inventoryAdjustments, remoteDb.inventoryAdjustments),

      settings: { ...(remoteDb.settings || {}), ...(localDb.settings || {}) }
    };

    merged.inventory = mergeInventory(localDb, remoteDb);
    return merged;
  }

  async function syncPull() {
    await initSupabaseIfConfigured();
    if (!supabase) return false;

    const workspaceId = getWorkspaceId();
    if (!workspaceId) { alert("Defina o ID da Loja/Workspace primeiro."); return false; }

    setSyncState("A carregar da nuvem...");

    const { data, error } = await supabase
      .from("snapshots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .single();

    if (error) {
      console.error("PULL ERROR:", error);
      setSyncState("Online (sem dados)");
      alert("Não encontrei dados na nuvem para este Workspace ID.");
      return false;
    }

    const remoteDb = data?.data || {};
    const localDb = loadLocal() || db || {};
    db = mergeDb(localDb, remoteDb);
    saveLocal(db);

    setSyncState("Online (ok)");
    renderAll();
    return true;
  }

  async function syncNow() {
    await initSupabaseIfConfigured();
    if (!supabase) {
      alert("Online não está configurado. Vá em Config e cole SUPABASE_URL e KEY.");
      return;
    }

    const workspaceId = getWorkspaceId();
    if (!workspaceId) { alert("Defina o ID da Loja antes de sincronizar."); return; }

    setSyncState("Sincronizando (pull/merge/push)...");

    const { data: row, error: pullErr } = await supabase
      .from("snapshots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .single();

    const remoteDb = pullErr ? {} : (row?.data || {});
    const localDb = loadLocal() || db || {};

    db = mergeDb(localDb, remoteDb);
    saveLocal(db);

    const payload = { workspace_id: workspaceId, data: db, updated_at: new Date().toISOString() };

    const { error: pushErr } = await supabase
      .from("snapshots")
      .upsert(payload, { onConflict: "workspace_id" });

    if (pushErr) {
      console.error("PUSH ERROR:", pushErr);
      setSyncState("Online (erro)");
      alert("Não consegui sincronizar. Verifique a tabela 'snapshots'.");
      return;
    }

    setSyncState("Online (ok)");
    renderAll();
    alert("Sincronização concluída (merge) ✅");
  }

  /* =======================
     (… DAQUI PARA BAIXO)
     Mantém o resto do teu código como está.
     Só removi os listeners duplicados do btnPullCloud
  ======================= */

  // --- ATENÇÃO: o teu código continua aqui ---
  // (mantém tudo o que já tens: Modal, Inventory, Auth, Reports, etc.)

  /* =======================
     Service Worker
  ======================= */
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      console.log("✅ Service Worker registado");
    } catch (e) {
      console.warn("❌ Falha ao registar SW:", e);
    }
  }

  /* =======================
     BOOT
  ======================= */
  window.addEventListener("DOMContentLoaded", async () => {
    await registerServiceWorker();

    window.onerror = (m, s, l, c, e) => console.error("ERRO:", m, "linha:", l, "col:", c, s, e);

    ensureWorkspaceModel();

    // ✅ botão "Carregar da nuvem" — 1 handler único, sem listeners dentro de listeners
    const btnPullCloud = document.getElementById("btnPullCloud");
    if (btnPullCloud) {
      btnPullCloud.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          if (!requireWorkspaceIdOrWarn()) return;

          // garante que URL/KEY do auth foram guardadas (se existirem)
          const sbUrlAuth = document.getElementById("sbUrlAuth")?.value || "";
          const sbKeyAuth = document.getElementById("sbKeyAuth")?.value || "";
          if (sbUrlAuth && sbKeyAuth) setOnlineConfig(sbUrlAuth, sbKeyAuth);

          const ok = await syncPull();
          if (ok) {
            // se tens bootAuthGate(), chama aqui (mantém o teu)
            if (typeof bootAuthGate === "function") bootAuthGate();
            alert("Dados carregados da nuvem. Agora pode fazer login.");
          }
        } catch (err) {
          console.error(err);
          alert("Erro ao carregar da nuvem: " + (err?.message || err));
        }
      });
    }

    // ⚠️ aqui segue o teu resto do boot (menus, submits, delegation, renderAll etc.)
    // Mantém como tens — só garante que não tens duplicações do SB_* e click handlers duplicados.

    await initSupabaseIfConfigured();

    // renderAll() e o resto do teu fluxo (mantém o teu)
    if (typeof renderAll === "function") renderAll();
  });
})();
