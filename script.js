(() => {
  "use strict";

  // TODO: cola TODO teu script aqui dentro
/***********************
 * Gestão Fácil - V1 (CODEPEN • JS ÚNICO COMPLETO • CORRIGIDO)
 * Offline-first + Online (Supabase opcional)
 * Auto-backup snapshots
 * Auth (PIN + roles) + recuperação por pergunta
 * Permissões (admin / manager / staff)
 * Stock base (pacotes) usando stockBaseId + stockFactor
 * Inventário/Correção com histórico
 * Relatórios visuais (12) com filtros + SVG
 *
 * ✅ Correções aplicadas (do teu script):
 * - Removido: funções/consts duplicadas (Workspace)
 * - Corrigido: syncNow duplicado/aninhado
 * - Corrigido: modalCompanySetup com HTML/JS misturado
 * - Corrigido: wsInput declarado 2x no DOMContentLoaded
 * - Corrigido: código solto que usava "e" fora do submit listener
 * - Corrigido: btnAddUser não declarado
 * - Corrigido: requireWorkspaceIdOrWarn estava fora do click (parava o boot)
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
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
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
      {
        id: uid(),
        nome: "Refresco 500ml",
        precoVenda: 35,
        precoAquisicaoRef: 22,
        minStock: 5,
        img: "",
        desc: "",
        ativo: true,
        stockBaseId: "",
        stockFactor: 1,
      },
      {
        id: uid(),
        nome: "Bolo fatia",
        precoVenda: 50,
        precoAquisicaoRef: 30,
        minStock: 3,
        img: "",
        desc: "",
        ativo: true,
        stockBaseId: "",
        stockFactor: 1,
      },
    ],
    inventory: {},

    purchases: [],
    sales: [],
    ledger: [],
    inventoryAdjustments: [],

    settings: { autoBackupMinutes: 10 },
  };

saveLocal(db);

/* =======================
   Runtime state
======================= */
let cart = [];
let supabase = null;

/* =======================
   DOM helpers
======================= */
function setSyncState(text) {
  const el = document.getElementById("syncState");
  if (el) el.textContent = text;
}
function setAppLocked(locked) {
  const app = document.querySelector(".app");
  if (app) app.style.display = locked ? "none" : "flex";
}

/* =======================
   Workspace (ID da Loja) - ÚNICO (sem duplicação)
======================= */
const WS_KEY = "gestao_facil_workspace_id";

function normalizeWorkspaceId(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9\-]/g, "");
}

function ensureWorkspaceModel() {
  db.meta = db.meta || {};
  if (db.meta.workspaceId == null) db.meta.workspaceId = "";
  db.company = db.company || { nome: "", nuit: "", contacto: "", morada: "", email: "" };

  // sincroniza localStorage <-> db.meta.workspaceId
  const ls = normalizeWorkspaceId(localStorage.getItem(WS_KEY) || "");
  if (ls && !db.meta.workspaceId) db.meta.workspaceId = ls;
  if (db.meta.workspaceId) localStorage.setItem(WS_KEY, normalizeWorkspaceId(db.meta.workspaceId));
}

function getWorkspaceId() {
  ensureWorkspaceModel();
  const v = normalizeWorkspaceId(db.meta.workspaceId || localStorage.getItem(WS_KEY) || "");
  return v;
}

function setWorkspaceId(v) {
  ensureWorkspaceModel();
  const id = normalizeWorkspaceId(v);
  db.meta.workspaceId = id;
  localStorage.setItem(WS_KEY, id);
  touch();
  return id;
}

function generateWorkspaceId(prefix = "DCNET") {
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${normalizeWorkspaceId(prefix)}-LOJA-${rnd}`;
}
function copyWorkspaceId(){
  const ws = getWorkspaceId();
  if (!ws) return alert("Sem workspace definido.");
  navigator.clipboard.writeText(ws).then(() => alert("ID copiado!"));
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
  const { url, key } = db.online || {};
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

async function syncNow() {
  if (!supabase) {
    alert("Online não está configurado. Vá em Config e cole SUPABASE_URL e KEY (ou use offline).");
    return;
  }

  const workspaceId = getWorkspaceId();
  if (!workspaceId) {
    alert("Defina o ID da Loja antes de sincronizar.");
    return;
  }

  setSyncState("Sincronizando...");

  const payload = {
    workspace_id: workspaceId,
    data: db,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("snapshots").upsert(payload, { onConflict: "workspace_id" });

  if (error) {
    console.error(error);
    setSyncState("Online (erro)");
    alert("Não consegui sincronizar. Verifique a tabela 'snapshots' no Supabase.");
    return;
  }

  const { data, error: e2 } = await supabase
    .from("snapshots")
    .select("*")
    .eq("workspace_id", workspaceId)
    .single();

  if (e2) {
    console.error(e2);
    setSyncState("Online (erro)");
    alert("Sincronizei, mas não consegui ler de volta.");
    return;
  }

  db = data.data;
  saveLocal(db);
  setSyncState("Online (ok)");
  renderAll();
}

/* =======================
   Modal
======================= */
function openModal(title, html) {
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  if (modalTitle) modalTitle.textContent = title;
  if (modalBody) modalBody.innerHTML = html;
  if (modal) modal.style.display = "flex";
}
function closeModal() {
  const modal = document.getElementById("modal");
  const modalBody = document.getElementById("modalBody");
  if (modal) modal.style.display = "none";
  if (modalBody) modalBody.innerHTML = "";
}

/* =======================
   Core helpers (DB)
======================= */
function invQty(productId) {
  return Number(db.inventory?.[productId] || 0);
}
function setInv(productId, qty) {
  if (!db.inventory) db.inventory = {};
  db.inventory[productId] = Number(qty || 0);
}
function accountName(id) {
  return db.accounts.find((a) => a.id === id)?.nome || "—";
}
function customerName(id) {
  return db.customers.find((c) => c.id === id)?.nome || "—";
}
function productById(id) {
  return db.products.find((p) => p.id === id);
}
function ensureInventoryAdjustmentsModel() {
  if (!db.inventoryAdjustments) db.inventoryAdjustments = [];
}

/* =======================
   Stock Base (Pacotes)
======================= */
function baseIdForProduct(productId) {
  const p = productById(productId);
  if (!p) return null;
  const base = p.stockBaseId && String(p.stockBaseId).trim() ? p.stockBaseId : p.id;
  return base;
}

function factorForProduct(productId) {
  const p = productById(productId);
  if (!p) return 1;
  const f = Number(p.stockFactor || 1);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

function stockForProduct(productId) {
  const baseId = baseIdForProduct(productId);
  if (!baseId) return 0;
  const baseStock = invQty(baseId);
  const factor = factorForProduct(productId);
  return factor > 0 ? Math.floor(baseStock / factor) : 0;
}

function consumeStockForSaleItem(productId, qtyUnits) {
  const baseId = baseIdForProduct(productId);
  if (!baseId) throw new Error("Stock base não encontrado.");
  const factor = factorForProduct(productId);
  const need = Number(qtyUnits || 0) * factor;

  const current = invQty(baseId);
  if (need > current) throw new Error("Stock insuficiente (base).");

  setInv(baseId, current - need);
}

function costUnitFor(productId) {
  const p = productById(productId);
  if (!p) return 0;

  const baseId = baseIdForProduct(productId);
  if (!baseId) return Number(p.precoAquisicaoRef || 0);

  if (baseId !== p.id) {
    const base = productById(baseId);
    const baseCost = Number(base?.precoAquisicaoRef || 0);
    return factorForProduct(productId) * baseCost;
  }

  return Number(p.precoAquisicaoRef || 0);
}

/* =======================
   Inventário / Correção
======================= */
function modalInventoryAdjust(productId) {
  const p = productById(productId);
  if (!p) return;

  ensureInventoryAdjustmentsModel();

  const baseId = baseIdForProduct(productId);
  const baseP = productById(baseId);
  const isPkg = baseId !== productId;
  const currentBase = invQty(baseId);

  openModal(
    "Ajuste de stock (Inventário / Correção)",
    `
      <form id="invAdjustForm" class="form2" data-pid="${productId}">
        <div class="field full">
          <label>Produto</label>
          <input class="input" disabled value="${safeText(p.nome || "—")}" />
        </div>

        <div class="field full">
          <label>Onde vai ajustar</label>
          <input class="input" disabled value="${
            isPkg
              ? `Stock base: ${(baseP?.nome || "—")} (porque este produto consome base)`
              : `Stock do próprio produto`
          }" />
          <small class="muted">${
            isPkg ? `Stock atual do base (${baseP?.nome || "—"}): ${currentBase}` : `Stock atual: ${invQty(productId)}`
          }</small>
        </div>

        <div class="field">
          <label>Tipo</label>
          <select class="input" id="invAdjType">
            <option value="in">Entrada (+)</option>
            <option value="out">Saída (-)</option>
          </select>
        </div>

        <div class="field">
          <label>Quantidade</label>
          <input class="input" id="invAdjQty" type="number" min="0" step="1" value="1" required />
        </div>

        <div class="field full">
          <label>Motivo</label>
          <input class="input" id="invAdjReason" placeholder="Ex: Perdi 2GB / devolução / contagem física" />
        </div>

        <div class="field">
          <label>Data</label>
          <input class="input" id="invAdjDate" type="date" value="${todayISO()}" />
        </div>

        <div class="field">
          <label>Observação (opcional)</label>
          <input class="input" id="invAdjNote" placeholder="Ex: contagem feita por Deny" />
        </div>

        <button class="btn big full" type="submit">Aplicar ajuste</button>
      </form>
    `
  );
}

function applyInventoryAdjustment(productId, type, qty, reason, date, note) {
  ensureInventoryAdjustmentsModel();

  const p = productById(productId);
  if (!p) throw new Error("Produto não encontrado.");

  const baseId = baseIdForProduct(productId);
  const targetId = baseId;
  const current = invQty(targetId);

  const q = Math.max(0, Number(qty || 0));
  if (q <= 0) throw new Error("Quantidade inválida.");

  const delta = type === "out" ? -q : +q;
  const next = current + delta;

  if (next < 0) throw new Error("Não é possível ficar com stock negativo.");

  setInv(targetId, next);

  db.inventoryAdjustments.push({
    id: uid(),
    date: date || todayISO(),
    createdAt: Date.now(),
    productId,
    targetId,
    type: type === "out" ? "out" : "in",
    qty: q,
    delta,
    reason: (reason || "").trim(),
    note: (note || "").trim(),
    userId: currentUser()?.id || null,
  });

  touch();
}

/* =======================
   Ledger / contas
======================= */
function addLedger({ date, type, accountId, amount, refType, refId, note }) {
  db.ledger.push({
    id: uid(),
    date,
    type,
    accountId,
    amount: Number(amount || 0),
    refType,
    refId,
    note: note || "",
  });
}

function calcAccountBalance(accountId) {
  const base = Number(db.accounts.find((a) => a.id === accountId)?.saldo || 0);
  const ins = db.ledger
    .filter((x) => x.accountId === accountId && x.type === "in")
    .reduce((s, x) => s + Number(x.amount), 0);
  const outs = db.ledger
    .filter((x) => x.accountId === accountId && x.type === "out")
    .reduce((s, x) => s + Number(x.amount), 0);
  return base + ins - outs;
}

/* =======================
   Auto-backup
======================= */
function saveAutoSnapshot() {
  try {
    const list = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    list.push({ at: Date.now(), db: JSON.parse(JSON.stringify(db)) });
    while (list.length > BACKUP_MAX) list.shift();
    localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn("Auto-backup falhou:", err);
  }
}
function getAutoSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
  } catch {
    return [];
  }
}
function restoreAutoSnapshotByIndexFromEnd(indexFromEnd = 0) {
  const list = getAutoSnapshots();
  const snap = list[list.length - 1 - indexFromEnd];
  if (!snap) return alert("Sem snapshots disponíveis.");
  if (!confirm("Restaurar este snapshot automático?")) return;
  db = snap.db;
  saveLocal(db);
  renderAll();
  alert("Snapshot restaurado!");
}
function updateBackupStatusUI() {
  const el = document.getElementById("autoBackupStatus");
  if (!el) return;
  const snaps = getAutoSnapshots();
  const last = snaps.length ? new Date(snaps[snaps.length - 1].at).toLocaleString() : "—";
  el.textContent = `Auto-backup ativo • último: ${last} • guardados: ${snaps.length}/${BACKUP_MAX}`;
}

/* =======================
   touch() (única fonte de gravação)
======================= */
function touch() {
  db.meta = db.meta || {};
  db.meta.updatedAt = Date.now();
  saveLocal(db);
  saveAutoSnapshot();
  updateBackupStatusUI();
}

/* =======================
   AUTH (PIN + roles)
======================= */
function ensureAuthModel() {
  db.users = db.users || [];
  db.auth = db.auth || { currentUserId: null };
  saveLocal(db);
}
function currentUser() {
  const id = db.auth?.currentUserId;
  return db.users.find((u) => u.id === id) || null;
}
function isLoggedIn() {
  const u = currentUser();
  return !!u && u.ativo !== false;
}
function isAdmin() {
  const u = currentUser();
  return !!u && u.role === "admin";
}
function setLoggedInUser(userId) {
  db.auth.currentUserId = userId;
  touch();
}
function createUser({ nome, pin, role }) {
  const cleanName = (nome || "").trim();
  const cleanPin = (pin || "").trim();

  if (!cleanName) throw new Error("Nome obrigatório");
  if (!/^\d{4,8}$/.test(cleanPin)) throw new Error("PIN deve ter 4–8 dígitos");

  const exists = db.users.some((u) => u.nome.toLowerCase() === cleanName.toLowerCase());
  if (exists) throw new Error("Já existe um utilizador com esse nome");

  const user = {
    id: uid(),
    nome: cleanName,
    pin: cleanPin,
    role,
    ativo: true,
    createdAt: Date.now(),
    securityQuestion: "",
    securityAnswerHash: "",
    mustChangePin: false,
  };

  db.users.push(user);
  touch();
  return user;
}
function login(nome, pin) {
  const cleanName = (nome || "").trim();
  const cleanPin = (pin || "").trim();
  const u = db.users.find((x) => x.ativo !== false && x.nome === cleanName && x.pin === cleanPin);
  if (!u) return { ok: false };
  setLoggedInUser(u.id);
  return { ok: true, mustChangePin: !!u.mustChangePin };
}

/* =======================
   Recuperação PIN
======================= */
function normalizeAnswer(s) {
  return (s || "").trim().toLowerCase();
}
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function setSecurityQA(userId, question, answerPlain) {
  ensureAuthModel();
  const q = (question || "").trim();
  const a = normalizeAnswer(answerPlain);

  if (!q) throw new Error("Pergunta obrigatória");
  if (a.length < 2) throw new Error("Resposta muito curta");

  const hash = await sha256(a);

  db.users = db.users.map((u) => (u.id !== userId ? u : { ...u, securityQuestion: q, securityAnswerHash: hash }));

  touch();
}
async function verifySecurityAnswer(userId, answerPlain) {
  const u = db.users.find((x) => x.id === userId);
  if (!u || !u.securityAnswerHash) return false;
  const hash = await sha256(normalizeAnswer(answerPlain));
  return hash === u.securityAnswerHash;
}
function adminResetPin(userId, tempPin) {
  if (!isAdmin()) return alert("Só ADMIN pode resetar PIN.");
  if (!/^\d{4,8}$/.test(String(tempPin || "").trim()))
    return alert("PIN temporário deve ter 4–8 dígitos.");

  const me = currentUser();
  if (me && me.id === userId) return alert("Use 'Alterar meu PIN' para você mesmo.");

  db.users = db.users.map((u) =>
    u.id !== userId ? u : { ...u, pin: String(tempPin).trim(), mustChangePin: true, ativo: true }
  );

  touch();
}
function changeMyPin(oldPin, newPin) {
  const u = currentUser();
  if (!u) return alert("Sem sessão.");
  if (String(oldPin || "").trim() !== u.pin) return alert("PIN atual incorreto.");
  if (!/^\d{4,8}$/.test(String(newPin || "").trim()))
    return alert("Novo PIN deve ter 4–8 dígitos.");

  db.users = db.users.map((x) => (x.id !== u.id ? x : { ...x, pin: String(newPin).trim(), mustChangePin: false }));

  setLoggedInUser(u.id);
  touch();
  alert("PIN alterado!");
}
async function recoverPinByQuestion(userId, answerPlain, newPin) {
  ensureAuthModel();
  const u = db.users.find((x) => x.id === userId);
  if (!u) return alert("Utilizador não encontrado.");
  if (u.ativo === false) return alert("Utilizador inativo.");
  if (!u.securityQuestion || !u.securityAnswerHash)
    return alert("Este utilizador não tem pergunta de segurança definida.");

  const ok = await verifySecurityAnswer(userId, answerPlain);
  if (!ok) return alert("Resposta incorreta.");

  if (!/^\d{4,8}$/.test(String(newPin || "").trim()))
    return alert("Novo PIN deve ter 4–8 dígitos.");

  db.users = db.users.map((x) => (x.id !== userId ? x : { ...x, pin: String(newPin).trim(), mustChangePin: false }));

  touch();
  alert("PIN atualizado! Agora já pode iniciar sessão.");
}

/* =======================
   Permissões
======================= */
function role() {
  return currentUser()?.role || null;
}
function can(action) {
  const r = role();
  if (!r) return false;

  const rules = {
    "users.manage": ["admin"],
    "system.reset": ["admin"],
    "accounts.delete": ["admin"],
    "products.delete": ["admin"],

    "accounts.create_edit": ["admin", "manager"],
    "products.create": ["admin", "manager"],
    "sales.create": ["admin", "manager", "staff"],
    "purchases.create": ["admin", "manager", "staff"],
  };

  const allowed = rules[action] || ["admin"];
  return allowed.includes(r);
}
function guard(action, msg) {
  if (can(action)) return true;
  alert(msg || "Sem permissão para esta ação.");
  return false;
}

/* =======================
   Auth UI gate
======================= */
function showAuthScreen(mode) {
  const auth = document.getElementById("authScreen");
  const loginBox = document.getElementById("authModeLogin");
  const regBox = document.getElementById("authModeRegister");
  if (!auth || !loginBox || !regBox) return;

  auth.style.display = "flex";
  loginBox.style.display = mode === "login" ? "block" : "none";
  regBox.style.display = mode === "register" ? "block" : "none";
}
function hideAuthScreen() {
  const auth = document.getElementById("authScreen");
  if (auth) auth.style.display = "none";
}
function refreshLoginUsers() {
  const sel = document.getElementById("loginUser");
  const hint = document.getElementById("loginHint");
  if (!sel) return;

  const active = db.users.filter((u) => u.ativo !== false);
  sel.innerHTML = active
    .map((u) => `<option value="${safeText(u.nome)}">${safeText(u.nome)} (${safeText(u.role)})</option>`)
    .join("");
  if (hint) hint.textContent = active.length ? "" : "Sem utilizadores. Crie o primeiro Admin.";
}
function setRegisterCopy() {
  const title = document.getElementById("registerTitle");
  const roleWrap = document.getElementById("roleWrap");
  const hasUsers = db.users.length > 0;

  if (!hasUsers) {
    if (title) title.textContent = "Primeiro acesso: crie o utilizador Admin.";
    if (roleWrap) roleWrap.style.display = "none";
  } else {
    if (title) title.textContent = "Criar novo utilizador (Admin necessário para ações críticas).";
    if (roleWrap) roleWrap.style.display = "block";
  }
}
function bootAuthGate() {
  ensureAuthModel();

  if (db.users.length === 0) {
    setAppLocked(true);
    setRegisterCopy();
    showAuthScreen("register");
    return;
  }

  if (isLoggedIn()) {
    setAppLocked(false);
    hideAuthScreen();
    return;
  }

  setAppLocked(true);
  refreshLoginUsers();
  showAuthScreen("login");
}
function doLogout() {
  ensureAuthModel();
  db.auth.currentUserId = null;
  touch();
  setAppLocked(true);
  refreshLoginUsers();
  showAuthScreen("login");
}

/* =======================
   Empresa UI
======================= */
function modalCompanySetup() {
  ensureWorkspaceModel();

  openModal(
    "Dados da empresa",
    `
      <form id="companyForm" class="form2">
        <div class="field full">
          <label>Nome da empresa</label>
          <input class="input" id="cmpNome" value="${safeText(db.company?.nome || "")}" placeholder="Ex: DC NET" required />
        </div>

        <div class="grid two">
          <div class="field">
            <label>NUIT</label>
            <input class="input" id="cmpNuit" value="${safeText(db.company?.nuit || "")}" placeholder="Ex: 123456789" />
          </div>
          <div class="field">
            <label>Contacto</label>
            <input class="input" id="cmpContacto" value="${safeText(db.company?.contacto || "")}" placeholder="Ex: 84xxxxxxx" />
          </div>
        </div>

        <div class="grid two">
          <div class="field">
            <label>Email</label>
            <input class="input" id="cmpEmail" value="${safeText(db.company?.email || "")}" placeholder="ex: geral@empresa.com" />
          </div>
          <div class="field">
            <label>Morada</label>
            <input class="input" id="cmpMorada" value="${safeText(db.company?.morada || "")}" placeholder="Ex: Maputo, ..." />
          </div>
        </div>

        <button class="btn big full" type="submit">Guardar</button>
      </form>
    `
  );
}

/* =======================
   Navigation
======================= */
const pages = {
  home: { title: "Home", desc: "Dashboard geral + contas de pagamento" },
  vendas: { title: "Vendas", desc: "Catálogo + carrinho + cliente + conta" },
  compras: { title: "Compras", desc: "Compras a fornecedores (entra no armazém)" },
  clientes: { title: "Clientes", desc: "Cadastro de clientes" },
  produtos: { title: "Produtos", desc: "Cadastro de produtos + lucro esperado" },
  armazem: { title: "Armazém", desc: "Stock em tempo real + alertas" },
  relatorios: { title: "Relatórios", desc: "Relatórios visuais (12) + filtros" },
  fiscal: { title: "Fiscal", desc: "Página em desenvolvimento" },
  config: { title: "Config", desc: "Backup + Online (Supabase)" },
  suporte: { title: "Suporte", desc: "FAQ + reportar problemas" },
};

function go(page) {
  document.querySelectorAll(".mitem").forEach((b) =>
    b.classList.toggle("active", b.dataset.page === page)
  );
  document.querySelectorAll(".page").forEach((p) =>
    p.classList.toggle("active", p.id === page)
  );

  const t = document.getElementById("pageTitle");
  const d = document.getElementById("pageDesc");
  if (t) t.textContent = pages[page]?.title || page;
  if (d) d.textContent = pages[page]?.desc || "";

  const quick = document.getElementById("btnQuickSale");
  if (quick) quick.style.display = page === "vendas" ? "none" : "inline-flex";

  renderAll();
}

/* =======================
   HOME
======================= */
function renderHome() {
  const d = todayISO();
  const salesToday = db.sales.filter((s) => s.data === d);
  const buysToday = db.purchases.filter((p) => p.data === d);

  const totalSales = salesToday.reduce((s, x) => s + Number(x.total), 0);
  const totalBuys = buysToday.reduce((s, x) => s + Number(x.total), 0);
  const totalProfit = salesToday.reduce((s, x) => s + Number(x.profit), 0);

  const k1 = document.getElementById("kpiSalesToday");
  const k2 = document.getElementById("kpiSalesTodayCount");
  const k3 = document.getElementById("kpiBuysToday");
  const k4 = document.getElementById("kpiBuysTodayCount");
  const k5 = document.getElementById("kpiProfitToday");

  if (k1) k1.textContent = MT(totalSales);
  if (k2) k2.textContent = `${salesToday.length} vendas`;
  if (k3) k3.textContent = MT(totalBuys);
  if (k4) k4.textContent = `${buysToday.length} compras`;
  if (k5) k5.textContent = MT(totalProfit);

  const elAcc = document.getElementById("accountsList");
  if (elAcc) {
    const accs = [...db.accounts].sort(byName);
    elAcc.innerHTML = accs.length
      ? accs
          .map((a) => {
            const saldo = calcAccountBalance(a.id);
            return `
              <div class="item">
                <h4>${safeText(a.nome)} <span class="badge">${safeText(a.tipo)}</span></h4>
                <div class="meta">
                  <span>Saldo: <strong>${MT(saldo)}</strong></span>
                  <span>${a.ativo ? "Ativa" : "Inativa"}</span>
                </div>
                <div class="actions">
                  <button class="btn ghost" data-edit-acc="${a.id}">Editar</button>
                  <button class="btn danger" data-del-acc="${a.id}">Apagar</button>
                </div>
              </div>`;
          })
          .join("")
      : `<div class="muted">Sem contas.</div>`;
  }

  const elLow = document.getElementById("lowStockList");
  if (elLow) {
    const lows = db.products
      .filter((p) => p.ativo)
      .map((p) => ({ p, qty: stockForProduct(p.id) }))
      .filter((x) => x.p.minStock > 0 && x.qty <= x.p.minStock)
      .sort((a, b) => a.qty - b.qty);

    elLow.innerHTML = lows.length
      ? lows
          .map(
            (x) => `
            <div class="item">
              <h4>${safeText(x.p.nome)}</h4>
              <div class="meta">
                <span>Stock: <strong>${x.qty}</strong></span>
                <span>Mínimo: ${x.p.minStock}</span>
              </div>
            </div>`
          )
          .join("")
      : `<div class="muted">Sem alertas de stock mínimo.</div>`;
  }

  const elLast = document.getElementById("lastSales");
  if (elLast) {
    const last = [...db.sales].slice(-5).reverse();
    elLast.innerHTML = last.length
      ? last
          .map(
            (s) => `
            <div class="item">
              <h4>${MT(s.total)} <span class="badge">${safeText(s.data)}</span></h4>
              <div class="meta">
                <span>Cliente: ${safeText(customerName(s.customerId))}</span>
                <span>Conta: ${safeText(accountName(s.accountId))}</span>
                <span>${(s.items || []).length} itens</span>
              </div>
            </div>`
          )
          .join("")
      : `<div class="muted">Ainda sem vendas.</div>`;
  }
}

/* =======================
   Accounts
======================= */
function modalAccount(id = null) {
  if (!guard("accounts.create_edit", "Apenas Admin/Gestão podem criar/editar contas.")) return;

  const a = id ? db.accounts.find((x) => x.id === id) : null;

  openModal(
    id ? "Editar conta" : "Nova conta",
    `
      <form id="accForm" class="form2" ${id ? `data-edit-id="${id}"` : ""}>
        <div class="field full">
          <label>Nome</label>
          <input class="input" id="accName" required value="${safeText(a?.nome || "")}" placeholder="Ex: M-Pesa"/>
        </div>

        <div class="field">
          <label>Tipo</label>
          <select class="input" id="accType">
            ${["Mobile money", "Banco", "Dinheiro"]
              .map((t) => `<option ${a?.tipo === t ? "selected" : ""}>${t}</option>`)
              .join("")}
          </select>
        </div>

        <div class="field">
          <label>Saldo inicial (opcional)</label>
          <input class="input" type="number" step="0.01" min="0" id="accSaldo" value="${a?.saldo ?? 0}"/>
        </div>

        <div class="field">
          <label>Ativa?</label>
          <select class="input" id="accActive">
            <option value="true" ${a?.ativo !== false ? "selected" : ""}>Sim</option>
            <option value="false" ${a?.ativo === false ? "selected" : ""}>Não</option>
          </select>
        </div>

        <button class="btn big full" type="submit">${id ? "Guardar" : "Criar"}</button>
      </form>
    `
  );
}
function deleteAccount(id) {
  if (!guard("accounts.delete", "Só ADMIN pode apagar contas/formas de pagamento.")) return;
  if (!confirm("Apagar esta conta?")) return;

  db.accounts = db.accounts.filter((a) => a.id !== id);
  touch();
  renderAll();
}

/* =======================
   Produtos
======================= */
function updateProfitNote() {
  const p = Number(document.getElementById("prodPrice")?.value || 0);
  const c = Number(document.getElementById("prodCost")?.value || 0);
  const note = document.getElementById("profitNote");
  if (note) note.textContent = `Lucro esperado: ${MT(p - c)}`;
}

function renderProductsList() {
  const q = (document.getElementById("productSearch")?.value || "").toLowerCase();
  const items = [...db.products].filter((p) => p.nome.toLowerCase().includes(q)).sort(byName);
  const el = document.getElementById("productsList");
  if (!el) return;

  el.innerHTML = items.length
    ? items
        .map((p) => {
          const lucro = Number(p.precoVenda) - Number(p.precoAquisicaoRef);
          return `
            <div class="item">
              <h4>${safeText(p.nome)} <span class="badge">${p.ativo ? "Ativo" : "Inativo"}</span></h4>
              <div class="meta">
                <span>Venda: ${MT(p.precoVenda)}</span>
                <span>Aquisição: ${MT(p.precoAquisicaoRef)}</span>
                <span>Lucro esp.: <strong>${MT(lucro)}</strong></span>
                <span>Stock mín.: ${p.minStock}</span>
              </div>
              <div class="actions">
                <button class="btn ghost" data-toggle-prod="${p.id}">${p.ativo ? "Desativar" : "Ativar"}</button>
                <button class="btn danger" data-del-prod="${p.id}">Apagar</button>
              </div>
            </div>`;
        })
        .join("")
    : `<div class="muted">Sem produtos.</div>`;
}

function renderProductStockBaseSelect() {
  const sel = document.getElementById("prodStockBase");
  if (!sel) return;

  const current = sel.value || "";
  const items = (db.products || [])
    .filter((p) => p && p.ativo !== false)
    .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

  sel.innerHTML = `
    <option value="">— Não (produto normal) —</option>
    ${items.map((p) => `<option value="${p.id}">${safeText(p.nome)}</option>`).join("")}
  `;

  sel.value = current;
}

/* =======================
   Clientes
======================= */
function renderCustomersList() {
  const el = document.getElementById("customersList");
  if (!el) return;

  const items = [...db.customers].sort(byName);
  el.innerHTML = items.length
    ? items
        .map(
          (c) => `
          <div class="item">
            <h4>${safeText(c.nome)}</h4>
            <div class="meta">
              <span>Tel: ${safeText(c.telefone || "—")}</span>
              <span>${safeText(c.notas || "")}</span>
            </div>
            <div class="actions">
              <button class="btn danger" data-del-cust="${c.id}">Apagar</button>
            </div>
          </div>`
        )
        .join("")
    : `<div class="muted">Sem clientes.</div>`;
}

/* =======================
   Armazém
======================= */
function renderWarehouse() {
  const el = document.getElementById("warehouseList");
  if (!el) return;

  const items = db.products
    .filter((p) => p.ativo)
    .map((p) => {
      const baseId = baseIdForProduct(p.id);
      const baseStock = baseId ? invQty(baseId) : 0;
      const baseName = baseId ? productById(baseId)?.nome || "—" : "—";
      const factor = factorForProduct(p.id);

      const isPackage = baseId && baseId !== p.id;
      const vendavel = stockForProduct(p.id);
      const real = invQty(p.id);

      const checkQty = isPackage ? vendavel : real;
      const low = p.minStock > 0 && checkQty <= p.minStock;

      return { p, real, isPackage, vendavel, baseName, baseStock, factor, low };
    })
    .sort((a, b) => (a.p.nome || "").localeCompare(b.p.nome || ""));

  el.innerHTML = items.length
    ? items
        .map((x) => {
          const badge = x.low ? `<span class="badge">Baixo</span>` : "";
          if (x.isPackage) {
            return `
              <div class="item">
                <h4>${safeText(x.p.nome)} ${badge} <span class="badge">Pacote</span></h4>
                <div class="meta">
                  <span>Vendável: <strong>${x.vendavel}</strong> un</span>
                  <span>Base: <strong>${safeText(x.baseName)}</strong> (${x.baseStock} em stock)</span>
                  <span>Consome: <strong>${x.factor}</strong> por unidade</span>
                  <span>Stock mín.: ${x.p.minStock}</span>
                </div>
                <div class="actions">
                  <button class="btn ghost" data-inv-adjust="${x.p.id}">Ajustar</button>
                </div>
              </div>`;
          }

          return `
            <div class="item">
              <h4>${safeText(x.p.nome)} ${badge}</h4>
              <div class="meta">
                <span>Disponível: <strong>${x.real}</strong></span>
                <span>Stock mín.: ${x.p.minStock}</span>
              </div>
              <div class="actions">
                <button class="btn ghost" data-inv-adjust="${x.p.id}">Ajustar</button>
              </div>
            </div>`;
        })
        .join("")
    : `<div class="muted">Sem produtos ativos.</div>`;
}

/* =======================
   Compras
======================= */
function renderBuysList() {
  const el = document.getElementById("buysList");
  if (!el) return;

  const f = document.getElementById("buysFilterDate")?.value;
  const items = [...db.purchases].filter((p) => !f || p.data === f).reverse();

  el.innerHTML = items.length
    ? items
        .map((p) => {
          const prod = productById(p.productId);
          return `
            <div class="item">
              <h4>${MT(p.total)} <span class="badge">${safeText(p.data)}</span></h4>
              <div class="meta">
                <span>Fornecedor: ${safeText(p.supplier)}</span>
                <span>Produto: ${safeText(prod?.nome || "—")}</span>
                <span>${p.qty} x ${MT(p.costUnit)}</span>
                <span>Conta: ${safeText(accountName(p.accountId))}</span>
              </div>
            </div>`;
        })
        .join("")
    : `<div class="muted">Sem compras.</div>`;
}

/* =======================
   Vendas
======================= */
function renderCatalog() {
  const q = (document.getElementById("catalogSearch")?.value || "").toLowerCase();
  const items = db.products
    .filter((p) => p.ativo)
    .filter((p) => p.nome.toLowerCase().includes(q))
    .sort(byName);

  const el = document.getElementById("catalogList");
  if (!el) return;

  el.innerHTML = items.length
    ? items
        .map((p) => {
          const qty = stockForProduct(p.id);
          const disabled = qty <= 0;
          const img = p.img ? `<img src="${p.img}" alt="">` : "";
          return `
            <div class="pcard">
              <div class="pimg">${img}</div>
              <div class="pinfo">
                <div class="pname">${safeText(p.nome)}</div>
                <div class="pmuted">
                  <span>Preço: <strong>${MT(p.precoVenda)}</strong></span>
                  <span>Stock: <strong>${qty}</strong></span>
                </div>
                <button class="btn padd ${disabled ? "ghost" : ""}" data-add="${p.id}" ${disabled ? "disabled" : ""}>
                  ${disabled ? "Sem stock" : "Adicionar"}
                </button>
              </div>
            </div>`;
        })
        .join("")
    : `<div class="muted">Sem produtos no catálogo.</div>`;
}

function addToCart(productId) {
  const p = productById(productId);
  if (!p) return;

  if (stockForProduct(productId) < 1) return alert("Sem stock (base).");

  const found = cart.find((i) => i.productId === productId);
  if (found) {
    if (found.qty + 1 > stockForProduct(productId)) return alert("Stock insuficiente (base).");
    found.qty += 1;
  } else {
    cart.push({ productId, qty: 1 });
  }
  renderCart();
}

function renderCart() {
  const el = document.getElementById("cartList");
  if (!el) return;

  if (!cart.length) {
    el.innerHTML = `<div class="muted">Carrinho vazio.</div>`;
    const totalEl = document.getElementById("cartTotal");
    if (totalEl) totalEl.textContent = MT(0);
    return;
  }

  const rows = cart.map((i) => {
    const p = productById(i.productId);
    const stock = stockForProduct(i.productId);
    const total = i.qty * Number(p?.precoVenda || 0);
    return { i, p, stock, total };
  });

  const grand = rows.reduce((s, r) => s + r.total, 0);
  const totalEl = document.getElementById("cartTotal");
  if (totalEl) totalEl.textContent = MT(grand);

  el.innerHTML = rows
    .map(
      (r) => `
        <div class="item">
          <h4>${safeText(r.p?.nome || "—")}</h4>
          <div class="meta">
            <span>${r.i.qty} x ${MT(r.p?.precoVenda)}</span>
            <span>Total: <strong>${MT(r.total)}</strong></span>
            <span>Stock: ${r.stock}</span>
          </div>
          <div class="actions">
            <button class="btn ghost" data-dec="${r.i.productId}">-</button>
            <button class="btn ghost" data-inc="${r.i.productId}">+</button>
            <button class="btn danger" data-rem="${r.i.productId}">Remover</button>
          </div>
        </div>`
    )
    .join("");
}

function changeQty(productId, delta) {
  const item = cart.find((x) => x.productId === productId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty <= 0) return removeFromCart(productId);

  if (newQty > stockForProduct(productId)) return alert("Stock insuficiente (base).");

  item.qty = newQty;
  renderCart();
}
function removeFromCart(productId) {
  cart = cart.filter((x) => x.productId !== productId);
  renderCart();
}
function canCancelSales() {
  const r = role();
  return r === "admin" || r === "manager";
}
function cancelSale(saleId) {
  if (!canCancelSales()) return alert("Sem permissão para cancelar vendas.");

  const s = db.sales.find((x) => x.id === saleId);
  if (!s) return alert("Venda não encontrada.");
  if (s.status === "CANCELLED") return alert("Esta venda já foi cancelada.");

  const reason = prompt("Motivo do cancelamento (obrigatório):") || "";
  if (!reason.trim()) return alert("Cancelamento precisa de motivo.");

  try {
    (s.items || []).forEach((it) => {
      const baseId = baseIdForProduct(it.productId);
      const factor = factorForProduct(it.productId);
      const giveBack = Number(it.qty || 0) * factor;
      setInv(baseId, invQty(baseId) + giveBack);
    });
  } catch (err) {
    console.error(err);
    return alert("Erro ao devolver stock.");
  }

  addLedger({
    date: todayISO(),
    type: "out",
    accountId: s.accountId,
    amount: Number(s.total || 0),
    refType: "sale_cancel",
    refId: s.id,
    note: `Cancelamento venda (${customerName(s.customerId)}): ${reason.trim()}`,
  });

  const u = currentUser();
  s.status = "CANCELLED";
  s.cancelledAt = Date.now();
  s.cancelledBy = u ? u.id : null;
  s.cancelReason = reason.trim();

  touch();
  renderAll();
  alert("Venda cancelada e revertida com sucesso.");
}

function finalizeSale() {
  if (!guard("sales.create", "Sem permissão para registrar vendas.")) return;
  if (!cart.length) return alert("Carrinho vazio.");

  const customerId = document.getElementById("saleCustomer")?.value;
  const accountId = document.getElementById("saleAccount")?.value;
  const date = document.getElementById("saleDate")?.value || todayISO();

  if (!customerId) return alert("Selecione o cliente.");
  if (!accountId) return alert("Selecione a conta.");

  for (const i of cart) {
    const baseId = baseIdForProduct(i.productId);
    const need = i.qty * factorForProduct(i.productId);
    if (need > invQty(baseId)) {
      const baseName = productById(baseId)?.nome || "Stock base";
      return alert(`Stock insuficiente em: ${baseName}`);
    }
  }

  const items = cart.map((i) => {
    const p = productById(i.productId);
    const costUnit = costUnitFor(i.productId);
    return { productId: i.productId, qty: i.qty, priceUnit: Number(p?.precoVenda || 0), costUnit };
  });

  const total = items.reduce((s, it) => s + it.qty * it.priceUnit, 0);
  const totalCost = items.reduce((s, it) => s + it.qty * it.costUnit, 0);
  const profit = total - totalCost;

  const sale = {
    id: uid(),
    data: date,
    customerId,
    accountId,
    items,
    total,
    totalCost,
    profit,
    status: "OK",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: "",
  };

  db.sales.push(sale);

  try {
    items.forEach((it) => consumeStockForSaleItem(it.productId, it.qty));
  } catch (err) {
    return alert(err?.message || "Erro ao baixar stock.");
  }

  addLedger({
    date,
    type: "in",
    accountId,
    amount: total,
    refType: "sale",
    refId: sale.id,
    note: `Venda ${customerName(customerId)}`,
  });

  cart = [];
  touch();
  renderAll();
  alert("Venda registrada com sucesso!");
}

function renderSalesList() {
  const el = document.getElementById("salesList");
  if (!el) return;

  const f = document.getElementById("salesFilterDate")?.value;
  const items = [...db.sales].filter((s) => !f || s.data === f).reverse();

  el.innerHTML = items.length
    ? items
        .map((s) => {
          const cancelled = s.status === "CANCELLED";
          return `
            <div class="item">
              <h4>
                ${MT(s.total)} 
                <span class="badge">${safeText(s.data)}</span>
                ${
                  cancelled
                    ? `<span class="badge" style="border-color: rgba(251,113,133,.55)">CANCELADA</span>`
                    : ""
                }
              </h4>
              <div class="meta">
                <span>Cliente: ${safeText(customerName(s.customerId))}</span>
                <span>Conta: ${safeText(accountName(s.accountId))}</span>
                <span>Lucro (estim.): <strong>${MT(s.profit)}</strong></span>
                <span>${(s.items || []).length} itens</span>
                ${cancelled ? `<span>Motivo: ${safeText(s.cancelReason || "—")}</span>` : ""}
              </div>

              <div class="actions">
                ${
                  !cancelled && canCancelSales()
                    ? `<button class="btn danger" data-cancel-sale="${s.id}">Cancelar</button>`
                    : ``
                }
              </div>
            </div>`;
        })
        .join("")
    : `<div class="muted">Sem vendas.</div>`;
}

/* =======================
   Selects
======================= */
function renderSelects() {
  const accActive = db.accounts.filter((a) => a.ativo).sort(byName);
  const custs = [...db.customers].sort(byName);
  const prods = db.products.filter((p) => p.ativo).sort(byName);

  const saleAcc = document.getElementById("saleAccount");
  if (saleAcc) saleAcc.innerHTML = accActive.map((a) => `<option value="${a.id}">${safeText(a.nome)}</option>`).join("");

  const buyAcc = document.getElementById("buyAccount");
  if (buyAcc) buyAcc.innerHTML = accActive.map((a) => `<option value="${a.id}">${safeText(a.nome)}</option>`).join("");

  const saleCust = document.getElementById("saleCustomer");
  if (saleCust) saleCust.innerHTML = custs.map((c) => `<option value="${c.id}">${safeText(c.nome)}</option>`).join("");

  const buyProd = document.getElementById("buyProduct");
  if (buyProd) buyProd.innerHTML = prods.map((p) => `<option value="${p.id}">${safeText(p.nome)}</option>`).join("");
}

/* =======================
   Users badge
======================= */
function renderUserBadge() {
  const el = document.getElementById("userBadge");
  if (!el) return;
  const u = currentUser();
  el.textContent = u ? `👤 ${u.nome} (${u.role})` : "👤 —";
}

/* =======================
   CONFIG -> Utilizadores
======================= */
function renderUsersSection() {
  ensureAuthModel();
  const card = document.getElementById("usersCard");
  const list = document.getElementById("usersList");
  if (!card || !list) return;

  if (!isAdmin()) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";

  const users = [...db.users].sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  const me = currentUser();

  list.innerHTML = users.length
    ? users
        .map((u) => {
          const isMe = me && me.id === u.id;
          const hasQA = !!u.securityQuestion && !!u.securityAnswerHash;

          return `
            <div class="item">
              <h4>${safeText(u.nome)} <span class="badge">${safeText(u.role)}</span></h4>
              <div class="meta">
                <span>Status: <strong>${u.ativo === false ? "Inativo" : "Ativo"}</strong></span>
                <span>Recuperação PIN: <strong>${hasQA ? "Definida" : "Não definida"}</strong></span>
                <span>Criado: ${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</span>
                ${isMe ? `<span class="badge">Você</span>` : ``}
              </div>
              <div class="actions">
                <button class="btn ghost" data-user-pin="${u.id}">Reset PIN</button>
                <button class="btn ghost" data-user-qa="${u.id}">Pergunta</button>
                <button class="btn ${u.ativo === false ? "ghost" : "danger"}" data-user-toggle="${u.id}">
                  ${u.ativo === false ? "Ativar" : "Desativar"}
                </button>
              </div>
            </div>`;
        })
        .join("")
    : `<div class="muted">Sem utilizadores.</div>`;
}

/* =======================
   RELATÓRIOS VISUAIS (12) - UI ÚNICA
   (Mantive a tua implementação igual, apenas sem mexer aqui)
======================= */
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
function isoToTime(iso) {
  return new Date(iso + "T00:00:00").getTime();
}
function inRange(dateISO, startISO, endISO) {
  const t = isoToTime(dateISO);
  return t >= isoToTime(startISO) && t <= isoToTime(endISO);
}
function daysBetween(startISO, endISO) {
  const out = [];
  let t = isoToTime(startISO);
  const end = isoToTime(endISO);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}
function svgBarChart({ labels, values, height = 180 }) {
  const max = Math.max(1, ...values.map((v) => Number(v || 0)));
  const w = 620;
  const padL = 34, padR = 10, padT = 10, padB = 34;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const n = labels.length || 1;
  const barW = innerW / n;
  const gap = Math.min(8, barW * 0.18);
  const bw = Math.max(6, barW - gap);

  const bars = labels
    .map((lab, i) => {
      const v = Number(values[i] || 0);
      const h = (v / max) * innerH;
      const x = padL + i * barW + gap / 2;
      const y = padT + (innerH - h);
      return `
      <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" ry="6" fill="rgba(94,234,212,.55)"></rect>
      <text x="${x + bw / 2}" y="${height - 12}" text-anchor="middle" font-size="11" fill="rgba(169,182,214,.95)">${escapeHtml(String(lab))}</text>
    `;
    })
    .join("");

  const axis = `<line x1="${padL}" y1="${padT + innerH}" x2="${w - padR}" y2="${padT + innerH}" stroke="rgba(255,255,255,.12)"/>`;

  return `
    <svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}">
      ${axis}
      ${bars}
    </svg>
  `;
}
function svgLineChart({ labels, values, height = 180 }) {
  const max = Math.max(1, ...values.map((v) => Number(v || 0)));
  const w = 620;
  const padL = 34, padR = 10, padT = 10, padB = 34;
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const n = labels.length || 1;
  const step = innerW / Math.max(1, n - 1);

  const pts = values.map((v, i) => {
    const vv = Number(v || 0);
    const x = padL + i * step;
    const y = padT + (innerH - (vv / max) * innerH);
    return { x, y };
  });

  const d = pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="rgba(94,234,212,.75)"></circle>`).join("");

  const xLabels = labels
    .map((lab, i) => {
      if (n > 12 && i % Math.ceil(n / 12) !== 0) return "";
      const x = padL + i * step;
      return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="11" fill="rgba(169,182,214,.95)">${escapeHtml(String(lab))}</text>`;
    })
    .join("");

  const axis = `<line x1="${padL}" y1="${padT + innerH}" x2="${w - padR}" y2="${padT + innerH}" stroke="rgba(255,255,255,.12)"/>`;

  return `
    <svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}">
      ${axis}
      <path d="${d}" fill="none" stroke="rgba(94,234,212,.85)" stroke-width="3" stroke-linecap="round"/>
      ${dots}
      ${xLabels}
    </svg>
  `;
}
function getReportRange() {
  const preset = document.getElementById("repPreset")?.value || "today";
  const today = todayISO();
  const toISO = (d) => new Date(d).toISOString().slice(0, 10);

  function firstDayOfMonth(dateISO) {
    const d = new Date(dateISO + "T00:00:00");
    d.setDate(1);
    return toISO(d);
  }
  function lastDayOfMonth(dateISO) {
    const d = new Date(dateISO + "T00:00:00");
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return toISO(d);
  }
  function addDays(dateISO, n) {
    const d = new Date(dateISO + "T00:00:00");
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  if (preset === "custom") {
    const start = document.getElementById("repStart")?.value || today;
    const end = document.getElementById("repEnd")?.value || today;
    return { start, end, preset };
  }
  if (preset === "today") return { start: today, end: today, preset };
  if (preset === "last7") return { start: addDays(today, -6), end: today, preset };
  if (preset === "last30") return { start: addDays(today, -29), end: today, preset };
  if (preset === "thisMonth") return { start: firstDayOfMonth(today), end: lastDayOfMonth(today), preset };
  if (preset === "lastMonth") {
    const d = new Date(today + "T00:00:00");
    d.setMonth(d.getMonth() - 1);
    const ref = toISO(d);
    return { start: firstDayOfMonth(ref), end: lastDayOfMonth(ref), preset };
  }
  return { start: today, end: today, preset };
}
function salesInRange(start, end) {
  return (db.sales || []).filter((s) => s?.data && inRange(s.data, start, end));
}
function buysInRange(start, end) {
  return (db.purchases || []).filter((p) => p?.data && inRange(p.data, start, end));
}
function sumBy(arr, keyFn, valFn) {
  const m = new Map();
  arr.forEach((x) => {
    const k = keyFn(x);
    const v = Number(valFn(x) || 0);
    m.set(k, (m.get(k) || 0) + v);
  });
  return m;
}
function topNFromMap(map, n = 10) {
  return [...map.entries()].sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, n);
}
function vendableStockForPackage(p) {
  const baseId = p?.stockBaseId;
  const factor = Number(p?.stockFactor || 1);
  if (baseId && factor > 0) {
    const baseQty = invQty(baseId);
    return Math.floor(baseQty / factor);
  }
  return stockForProduct(p?.id);
}

const REPORTS = [
  { id: "r1", title: "Resumo do período" },
  { id: "r2", title: "Vendas por dia" },
  { id: "r3", title: "Lucro por dia" },
  { id: "r4", title: "Top 10 • Vendas por produto" },
  { id: "r5", title: "Top 10 • Lucro por produto" },
  { id: "r6", title: "Top 10 • Vendas por cliente" },
  { id: "r7", title: "Vendas por conta" },
  { id: "r8", title: "Top 10 • Compras por fornecedor" },
  { id: "r9", title: "Top 10 • Compras por produto" },
  { id: "r10", title: "Armazém • Real + Vendável (pacotes)" },
  { id: "r11", title: "Alertas • Stock mínimo" },
  { id: "r12", title: "Ticket médio + tendência" },
];
let reportActiveId = "r1";

function ensureReportsUI() {
  const page = document.getElementById("relatorios");
  if (!page) return;
  if (page.querySelector("#reportsHub")) return;

  const d = todayISO();
  const wrap = document.createElement("div");
  wrap.id = "reportsHub";
  wrap.innerHTML = `
    <div class="card">
      <div class="row between gap">
        <div class="row gap" style="flex-wrap:wrap">
          <div style="min-width:180px">
            <div class="label">Período</div>
            <select class="input" id="repPreset">
              <option value="today">Hoje</option>
              <option value="last7">Últimos 7 dias</option>
              <option value="last30">Últimos 30 dias</option>
              <option value="thisMonth">Este mês</option>
              <option value="lastMonth">Mês passado</option>
              <option value="custom">Personalizado</option>
            </select>
          </div>

          <div id="repCustomDates" class="row gap" style="display:none">
            <div style="min-width:150px">
              <div class="label">Início</div>
              <input class="input" type="date" id="repStart" value="${d}">
            </div>
            <div style="min-width:150px">
              <div class="label">Fim</div>
              <input class="input" type="date" id="repEnd" value="${d}">
            </div>
          </div>

          <div style="align-self:flex-end">
            <button class="btn" id="repApply" type="button">Aplicar</button>
          </div>
        </div>

        <div class="muted" id="repHint">Relatórios visuais (12)</div>
      </div>
    </div>

    <div class="grid two">
      <div class="card inner">
        <div class="reports-menu" id="repMenu"></div>
      </div>

      <div class="card inner">
        <div class="row between gap" style="margin-bottom:8px">
          <h3 id="repTitle" style="margin:0;font-size:16px">—</h3>
          <button class="btn ghost" id="repExport" type="button">Exportar (JSON)</button>
        </div>
        <div id="repBody"></div>
      </div>
    </div>
  `;
  page.prepend(wrap);

  function toggleCustomDates() {
    const preset = wrap.querySelector("#repPreset")?.value || "today";
    const box = wrap.querySelector("#repCustomDates");
    if (!box) return;
    box.style.display = preset === "custom" ? "flex" : "none";
  }

  wrap.querySelector("#repPreset")?.addEventListener("change", () => {
    toggleCustomDates();
    renderReportsVisual();
  });

  wrap.querySelector("#repApply")?.addEventListener("click", () => renderReportsVisual());
  wrap.querySelector("#repExport")?.addEventListener("click", () => exportReportJSON());
  wrap.querySelector("#repStart")?.addEventListener("change", () => renderReportsVisual());
  wrap.querySelector("#repEnd")?.addEventListener("change", () => renderReportsVisual());

  wrap.querySelector("#repMenu")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rep]");
    if (!btn) return;
    reportActiveId = btn.dataset.rep;
    renderReportsVisual();
  });

  toggleCustomDates();
}

function exportReportJSON() {
  const { start, end } = getReportRange();
  const payload = buildReportPayload(reportActiveId, start, end);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `relatorio-${reportActiveId}-${start}_a_${end}.json`;
  a.click();
}

function renderReportsMenu() {
  const menu = document.getElementById("repMenu");
  if (!menu) return;

  menu.innerHTML = REPORTS.map(
    (r) => `
    <button class="btn ghost repbtn ${r.id === reportActiveId ? "active" : ""}" data-rep="${r.id}">
      ${escapeHtml(r.title)}
    </button>
  `
  ).join("");
}

function buildReportPayload(repId, start, end) {
  const sales = salesInRange(start, end);
  const buys = buysInRange(start, end);
  return { repId, start, end, sales, buys, dbMeta: db.meta };
}

function renderReportsVisual() {
  ensureReportsUI();
  renderReportsMenu();

  const { start, end } = getReportRange();
  const titleEl = document.getElementById("repTitle");
  const body = document.getElementById("repBody");
  if (!body) return;

  const rep = REPORTS.find((r) => r.id === reportActiveId) || REPORTS[0];
  if (titleEl) titleEl.textContent = rep.title;

  const sales = salesInRange(start, end);
  const buys = buysInRange(start, end);
  const days = daysBetween(start, end);

  const totalSales = sales.reduce((s, x) => s + Number(x.total || 0), 0);
  const totalBuys = buys.reduce((s, x) => s + Number(x.total || 0), 0);
  const totalProfit = sales.reduce((s, x) => s + Number(x.profit || 0), 0);
  const saleCount = sales.length;

  const salesByDay = days.map((d) => sales.filter((s) => s.data === d).reduce((t, s) => t + Number(s.total || 0), 0));
  const profitByDay = days.map((d) => sales.filter((s) => s.data === d).reduce((t, s) => t + Number(s.profit || 0), 0));

  const prodSalesMap = new Map();
  const prodProfitMap = new Map();
  sales.forEach((s) => {
    (s.items || []).forEach((it) => {
      const pid = it.productId;
      const v = Number(it.qty || 0) * Number(it.priceUnit || 0);
      const c = Number(it.qty || 0) * Number(it.costUnit || 0);
      prodSalesMap.set(pid, (prodSalesMap.get(pid) || 0) + v);
      prodProfitMap.set(pid, (prodProfitMap.get(pid) || 0) + (v - c));
    });
  });

  const custMap = sumBy(sales, (s) => s.customerId || "—", (s) => s.total);
  const accMap = sumBy(sales, (s) => s.accountId || "—", (s) => s.total);
  const supMap = sumBy(buys, (b) => b.supplier || "—", (b) => b.total);
  const buyProdMap = sumBy(buys, (b) => b.productId || "—", (b) => b.total);

  if (reportActiveId === "r1") {
    body.innerHTML = `
      <div class="grid kpis">
        <div class="card">
          <div class="label">Vendas</div>
          <div class="kpi">${MT(totalSales)}</div>
          <div class="muted">${saleCount} vendas</div>
        </div>
        <div class="card">
          <div class="label">Compras</div>
          <div class="kpi">${MT(totalBuys)}</div>
          <div class="muted">no período</div>
        </div>
        <div class="card">
          <div class="label">Lucro (estim.)</div>
          <div class="kpi">${MT(totalProfit)}</div>
          <div class="muted">no período</div>
        </div>
      </div>
      <div class="card">
        <div class="label">Tendência (Vendas/dia)</div>
        ${svgLineChart({ labels: days.map((d) => d.slice(5)), values: salesByDay })}
      </div>
    `;
    return;
  }

  if (reportActiveId === "r2") {
    body.innerHTML = `
      <div class="card">
        <div class="label">Vendas por dia</div>
        ${svgBarChart({ labels: days.map((d) => d.slice(5)), values: salesByDay })}
      </div>
    `;
    return;
  }

  if (reportActiveId === "r3") {
    body.innerHTML = `
      <div class="card">
        <div class="label">Lucro por dia (estim.)</div>
        ${svgLineChart({ labels: days.map((d) => d.slice(5)), values: profitByDay })}
      </div>
    `;
    return;
  }

  if (reportActiveId === "r4") {
    const top = topNFromMap(prodSalesMap, 10).map(([pid, val]) => ({ name: productById(pid)?.nome || "—", val }));
    body.innerHTML = `
      <div class="card">
        <div class="label">Top 10 • Vendas por produto</div>
        ${svgBarChart({ labels: top.map((x) => x.name.slice(0, 10)), values: top.map((x) => x.val) })}
        <div class="list">
          ${
            top
              .map(
                (x) => `
            <div class="item">
              <h4>${escapeHtml(x.name)}</h4>
              <div class="meta"><span>Vendas: <strong>${MT(x.val)}</strong></span></div>
            </div>
          `
              )
              .join("") || `<div class="muted">Sem dados.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r5") {
    const top = topNFromMap(prodProfitMap, 10).map(([pid, val]) => ({ name: productById(pid)?.nome || "—", val }));
    body.innerHTML = `
      <div class="card">
        <div class="label">Top 10 • Lucro por produto</div>
        ${svgBarChart({ labels: top.map((x) => x.name.slice(0, 10)), values: top.map((x) => x.val) })}
        <div class="list">
          ${
            top
              .map(
                (x) => `
            <div class="item">
              <h4>${escapeHtml(x.name)}</h4>
              <div class="meta"><span>Lucro: <strong>${MT(x.val)}</strong></span></div>
            </div>
          `
              )
              .join("") || `<div class="muted">Sem dados.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r6") {
    const top = topNFromMap(custMap, 10).map(([cid, val]) => ({ name: customerName(cid), val }));
    body.innerHTML = `
      <div class="card">
        <div class="label">Top 10 • Vendas por cliente</div>
        ${svgBarChart({ labels: top.map((x) => x.name.slice(0, 10)), values: top.map((x) => x.val) })}
        <div class="list">
          ${
            top
              .map(
                (x) => `
            <div class="item">
              <h4>${escapeHtml(x.name)}</h4>
              <div class="meta"><span>Total: <strong>${MT(x.val)}</strong></span></div>
            </div>
          `
              )
              .join("") || `<div class="muted">Sem dados.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r7") {
    const top = topNFromMap(accMap, 10).map(([aid, val]) => ({ name: accountName(aid), val }));
    body.innerHTML = `
      <div class="card">
        <div class="label">Vendas por conta</div>
        ${svgBarChart({ labels: top.map((x) => x.name.slice(0, 10)), values: top.map((x) => x.val) })}
        <div class="list">
          ${
            top
              .map(
                (x) => `
            <div class="item">
              <h4>${escapeHtml(x.name)}</h4>
              <div class="meta"><span>Total: <strong>${MT(x.val)}</strong></span></div>
            </div>
          `
              )
              .join("") || `<div class="muted">Sem dados.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r8") {
    const top = topNFromMap(supMap, 10).map(([name, val]) => ({ name, val }));
    body.innerHTML = `
      <div class="card">
        <div class="label">Top 10 • Compras por fornecedor</div>
        ${svgBarChart({ labels: top.map((x) => x.name.slice(0, 10)), values: top.map((x) => x.val) })}
        <div class="list">
          ${
            top
              .map(
                (x) => `
            <div class="item">
              <h4>${escapeHtml(x.name)}</h4>
              <div class="meta"><span>Total: <strong>${MT(x.val)}</strong></span></div>
            </div>
          `
              )
              .join("") || `<div class="muted">Sem dados.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r9") {
    const top = topNFromMap(buyProdMap, 10).map(([pid, val]) => ({ name: productById(pid)?.nome || "—", val }));
    body.innerHTML = `
      <div class="card">
        <div class="label">Top 10 • Compras por produto</div>
        ${svgBarChart({ labels: top.map((x) => x.name.slice(0, 10)), values: top.map((x) => x.val) })}
        <div class="list">
          ${
            top
              .map(
                (x) => `
            <div class="item">
              <h4>${escapeHtml(x.name)}</h4>
              <div class="meta"><span>Total: <strong>${MT(x.val)}</strong></span></div>
            </div>
          `
              )
              .join("") || `<div class="muted">Sem dados.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r10") {
    const prods = (db.products || []).filter((p) => p?.ativo);
    const rows = prods
      .map((p) => {
        const real = invQty(p.id);
        const isPack = !!p.stockBaseId;
        const vend = isPack ? vendableStockForPackage(p) : null;
        const baseName = isPack ? productById(p.stockBaseId)?.nome || "—" : "";
        return { p, real, vend, baseName, isPack };
      })
      .sort((a, b) => (a.p.nome || "").localeCompare(b.p.nome || ""));

    body.innerHTML = `
      <div class="card">
        <div class="label">Armazém: stock real + vendável</div>
        <div class="list">
          ${rows
            .map(
              (r) => `
            <div class="item">
              <h4>${escapeHtml(r.p.nome)} ${r.isPack ? `<span class="badge">Pacote</span>` : ``}</h4>
              <div class="meta">
                <span>Stock real (ID): <strong>${r.real}</strong></span>
                ${r.isPack ? `<span>Base: <strong>${escapeHtml(r.baseName)}</strong></span>` : ``}
                ${r.isPack ? `<span>Factor: <strong>${Number(r.p.stockFactor || 1)}</strong></span>` : ``}
                ${r.isPack ? `<span>Vendável: <strong>${r.vend}</strong></span>` : ``}
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r11") {
    const prods = (db.products || []).filter((p) => p?.ativo);
    const lows = prods
      .map((p) => {
        const isPack = !!p.stockBaseId;
        const qty = isPack ? vendableStockForPackage(p) : invQty(p.id);
        const min = Number(p.minStock || 0);
        return { p, qty, min, isPack };
      })
      .filter((x) => x.min > 0 && x.qty <= x.min)
      .sort((a, b) => a.qty - b.qty);

    body.innerHTML = `
      <div class="card">
        <div class="label">Alertas de stock mínimo</div>
        <div class="list">
          ${
            lows.length
              ? lows
                  .map(
                    (x) => `
            <div class="item">
              <h4>${escapeHtml(x.p.nome)} ${x.isPack ? `<span class="badge">Pacote</span>` : ``} <span class="badge">Baixo</span></h4>
              <div class="meta">
                <span>Disponível: <strong>${x.qty}</strong></span>
                <span>Mínimo: ${x.min}</span>
              </div>
            </div>
          `
                  )
                  .join("")
              : `<div class="muted">Sem alertas no período atual.</div>`
          }
        </div>
      </div>
    `;
    return;
  }

  if (reportActiveId === "r12") {
    const ticket = saleCount ? totalSales / saleCount : 0;
    body.innerHTML = `
      <div class="grid two">
        <div class="card">
          <div class="label">Ticket médio</div>
          <div class="kpi">${MT(ticket)}</div>
          <div class="muted">${saleCount} vendas no período</div>
        </div>
        <div class="card">
          <div class="label">Tendência (Vendas/dia)</div>
          ${svgLineChart({ labels: days.map((d) => d.slice(5)), values: salesByDay })}
        </div>
      </div>
    `;
    return;
  }

  body.innerHTML = `<div class="muted">Relatório não encontrado.</div>`;
}
function renderWorkspaceBadge() {
  const el = document.getElementById("workspaceBadge");
  if (!el) return;

  const ws = getWorkspaceId ? getWorkspaceId() : "";
  const nome = db?.company?.nome || "";

  if (!ws) {
    el.textContent = "🏪 Workspace não definido";
    return;
  }

  el.textContent = nome
    ? `🏪 ${nome} • ${ws}`
    : `🏪 Workspace: ${ws}`;
}

/* =======================
   Render all
======================= */
function renderAll() {
  renderSelects();
  renderHome();
  renderProductsList();
  renderCustomersList();
  renderWarehouse();
  renderCatalog();
  renderCart();
  renderSalesList();
  renderBuysList();
  renderUsersSection();
  renderUserBadge();
  renderProductStockBaseSelect();
  renderReportsVisual();
  renderWorkspaceBadge()
}

/* =======================
   Mobile helpers
======================= */
function applyMobileClass() {
  const isMobile = window.innerWidth <= 900 || window.matchMedia("(pointer: coarse)").matches;
  document.body.classList.toggle("is-mobile", isMobile);
}

/* =======================
   BOOT
======================= */
window.addEventListener("DOMContentLoaded", async () => {
  window.onerror = (m, s, l, c, e) => console.error("ERRO:", m, "linha:", l, "col:", c, s, e);

  bootAuthGate();

  // ===== Workspace (ID da Loja) =====
  ensureWorkspaceModel();

  const wsInput = document.getElementById("workspaceId");
  const btnGenWs = document.getElementById("btnGenWorkspace");
  const btnCmp = document.getElementById("btnCompanySetup");

  if (wsInput) {
    wsInput.value = getWorkspaceId();

    wsInput.addEventListener("input", () => {
      setWorkspaceId(wsInput.value);
      wsInput.value = getWorkspaceId();
    });

    wsInput.addEventListener("blur", () => {
      setWorkspaceId(wsInput.value);
      wsInput.value = getWorkspaceId();
    });
  }

  if (btnGenWs) {
    btnGenWs.addEventListener("click", () => {
      const id = generateWorkspaceId("DCNET");
      setWorkspaceId(id);
      if (wsInput) wsInput.value = getWorkspaceId();
      alert(`ID da Loja criado: ${getWorkspaceId()}\nUse este mesmo ID em todos os dispositivos.`);
    });
  }

  if (btnCmp) {
    btnCmp.addEventListener("click", () => modalCompanySetup());
  }

  const modalClose = document.getElementById("modalClose");
  if (modalClose) modalClose.addEventListener("click", closeModal);
  const modal = document.getElementById("modal");
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  document.querySelectorAll(".mitem").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.page)));
  document.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.nav)));

  const sidebarToggle = document.getElementById("sidebarToggle");
  const overlay = document.getElementById("overlay");

  const saved = localStorage.getItem("sidebarCollapsed");
  if (saved === "1") document.body.classList.add("sidebar-collapsed");

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 860px)").matches) {
        document.body.classList.toggle("menu-open");
      } else {
        document.body.classList.toggle("sidebar-collapsed");
        localStorage.setItem(
          "sidebarCollapsed",
          document.body.classList.contains("sidebar-collapsed") ? "1" : "0"
        );
      }
    });
  }
  if (overlay) overlay.addEventListener("click", () => document.body.classList.remove("menu-open"));

  applyMobileClass();
  window.addEventListener("resize", applyMobileClass);

  const btnLogoutTop = document.getElementById("btnLogoutTop");
  if (btnLogoutTop) btnLogoutTop.addEventListener("click", (e) => { e.preventDefault(); doLogout(); });

  const btnQuickSale = document.getElementById("btnQuickSale");
  if (btnQuickSale) btnQuickSale.addEventListener("click", () => go("vendas"));

  const prodPrice = document.getElementById("prodPrice");
  const prodCost = document.getElementById("prodCost");
  if (prodPrice) prodPrice.addEventListener("input", updateProfitNote);
  if (prodCost) prodCost.addEventListener("input", updateProfitNote);

  const btnClearCart = document.getElementById("btnClearCart");
  if (btnClearCart) btnClearCart.addEventListener("click", () => { cart = []; renderCart(); });

  const btnCheckout = document.getElementById("btnCheckout");
  if (btnCheckout) btnCheckout.addEventListener("click", finalizeSale);

  const productSearch = document.getElementById("productSearch");
  if (productSearch) productSearch.addEventListener("input", renderProductsList);

  const catalogSearch = document.getElementById("catalogSearch");
  if (catalogSearch) catalogSearch.addEventListener("input", renderCatalog);

  const buysFilterDate = document.getElementById("buysFilterDate");
  if (buysFilterDate) buysFilterDate.addEventListener("input", renderBuysList);

  const btnClearBuysFilter = document.getElementById("btnClearBuysFilter");
  if (btnClearBuysFilter) btnClearBuysFilter.addEventListener("click", () => {
    const el = document.getElementById("buysFilterDate");
    if (el) el.value = "";
    renderBuysList();
  });

  const salesFilterDate = document.getElementById("salesFilterDate");
  if (salesFilterDate) salesFilterDate.addEventListener("input", renderSalesList);

  const btnClearSalesFilter = document.getElementById("btnClearSalesFilter");
  if (btnClearSalesFilter) btnClearSalesFilter.addEventListener("click", () => {
    const el = document.getElementById("salesFilterDate");
    if (el) el.value = "";
    renderSalesList();
  });

  // Export/Import/Reset
  const btnExport = document.getElementById("btnExport");
  if (btnExport) {
    btnExport.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `gestao-facil-backup-${todayISO()}.json`;
      a.click();
    });
  }

  const importFile = document.getElementById("importFile");
  if (importFile) {
    importFile.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        db = data;
        saveLocal(db);
        alert("Importado com sucesso!");
        await initSupabaseIfConfigured();
        renderAll();
      } catch {
        alert("Backup inválido.");
      } finally {
        e.target.value = "";
      }
    });
  }

  const btnReset = document.getElementById("btnReset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (!guard("system.reset", "Só ADMIN pode apagar tudo.")) return;
      if (confirm("Apagar tudo?")) {
        localStorage.removeItem(KEY);
        localStorage.removeItem(BACKUP_KEY);
        localStorage.removeItem(WS_KEY);
        location.reload();
      }
    });
  }

  // Supabase config
  const sbUrl = document.getElementById("sbUrl");
  const sbKey = document.getElementById("sbKey");
  if (sbUrl) sbUrl.value = db.online?.url || "";
  if (sbKey) sbKey.value = db.online?.key || "";

  const btnSaveOnline = document.getElementById("btnSaveOnline");
  if (btnSaveOnline) {
    btnSaveOnline.addEventListener("click", async () => {
      db.online.url = document.getElementById("sbUrl")?.value?.trim() || "";
      db.online.key = document.getElementById("sbKey")?.value?.trim() || "";
      touch();
      await initSupabaseIfConfigured();
      alert(supabase ? "Online ativado! Agora pode sincronizar." : "Offline (chaves vazias).");
    });
  }

  const btnSync = document.getElementById("btnSync");
  if (btnSync) btnSync.addEventListener("click", syncNow);

  // Auto-backup interval
  const autoMin = document.getElementById("autoBackupMinutes");
  if (autoMin) {
    db.settings = db.settings || {};
    if (!db.settings.autoBackupMinutes) db.settings.autoBackupMinutes = 10;
    autoMin.value = db.settings.autoBackupMinutes;

    autoMin.addEventListener("change", () => {
      db.settings.autoBackupMinutes = Math.max(5, Number(autoMin.value || 10));
      touch();
      alert("Auto-backup atualizado!");
    });
  }

  const btnRestoreSnap = document.getElementById("btnRestoreAutoSnapshot");
  if (btnRestoreSnap) btnRestoreSnap.addEventListener("click", () => restoreAutoSnapshotByIndexFromEnd(0));

  updateBackupStatusUI();

  // Auth buttons
  const btnAddUser = document.getElementById("btnAddUser"); // ✅ estava faltando
  const btnGoRegister = document.getElementById("btnGoRegister");
  const btnBackLogin = document.getElementById("btnBackLogin");
  const btnLogin = document.getElementById("btnLogin");
  const btnRegister = document.getElementById("btnRegister");
  const btnForgotPin = document.getElementById("btnForgotPin");

  if (btnAddUser) {
    btnAddUser.addEventListener("click", () => {
      if (!isAdmin()) return alert("Só ADMIN pode criar novos utilizadores.");
      setRegisterCopy();
      showAuthScreen("register");

      const rn = document.getElementById("regName");
      const rp = document.getElementById("regPin");
      const rr = document.getElementById("regRole");

      if (rn) rn.value = "";
      if (rp) rp.value = "";
      if (rr) rr.value = "staff";
    });
  }

  if (btnGoRegister) btnGoRegister.addEventListener("click", () => { setRegisterCopy(); showAuthScreen("register"); });
  if (btnBackLogin) btnBackLogin.addEventListener("click", () => { refreshLoginUsers(); showAuthScreen("login"); });

  if (btnForgotPin) {
    btnForgotPin.addEventListener("click", () => {
      const selName = document.getElementById("loginUser")?.value || "";
      const u = db.users.find((x) => x.nome === selName);
      if (!u) return alert("Selecione o utilizador.");

      if (!u.securityQuestion || !u.securityAnswerHash) {
        return alert("Este utilizador ainda não tem pergunta de segurança definida. Peça ao Admin para definir.");
      }

      openModal(
        "Recuperar PIN",
        `
        <form id="recoverForm" class="form2" data-user-id="${u.id}">
          <div class="field full">
            <label>Utilizador</label>
            <input class="input" value="${safeText(u.nome)}" disabled />
          </div>

          <div class="field full">
            <label>Pergunta</label>
            <input class="input" value="${safeText(u.securityQuestion)}" disabled />
          </div>

          <div class="field full">
            <label>Resposta</label>
            <input class="input" id="recoverAnswer" required placeholder="Digite a resposta..." />
          </div>

          <div class="field full">
            <label>Novo PIN (4–8 dígitos)</label>
            <input class="input" id="recoverNewPin" type="password" inputmode="numeric" required placeholder="ex: 1234" />
          </div>

          <button class="btn big full" type="submit">Atualizar PIN</button>
        </form>
        `
      );
    });
  }

  if (btnLogin) {
    btnLogin.addEventListener("click", () => {
      // ✅ valida workspace DENTRO do click (não trava o boot)
      if (!requireWorkspaceIdOrWarn()) return;

      const nome = document.getElementById("loginUser")?.value || "";
      const pin = document.getElementById("loginPin")?.value || "";
      const res = login(nome, pin);
      if (!res.ok) return alert("PIN ou utilizador incorreto.");

      const lp = document.getElementById("loginPin");
      if (lp) lp.value = "";

      hideAuthScreen();
      setAppLocked(false);
      renderAll();
    });
  }

  if (btnRegister) {
    btnRegister.addEventListener("click", () => {
      // ✅ valida workspace DENTRO do click
      if (!requireWorkspaceIdOrWarn()) return;

      try {
        const nome = document.getElementById("regName")?.value || "";
        const pin = document.getElementById("regPin")?.value || "";

        const first = db.users.length === 0;
        const roleVal = first ? "admin" : (document.getElementById("regRole")?.value || "staff");
        if (!first && !isAdmin()) return alert("Só ADMIN pode criar novos utilizadores.");

        const u = createUser({ nome, pin, role: roleVal });
        setLoggedInUser(u.id);

        hideAuthScreen();
        setAppLocked(false);
        refreshLoginUsers();
        renderAll();
      } catch (err) {
        alert(err?.message || "Erro ao criar utilizador.");
      }
    });
  }

  // Click delegation
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-add]");
    if (addBtn) { addToCart(addBtn.dataset.add); return; }

    const cancelBtn = e.target.closest("[data-cancel-sale]");
    if (cancelBtn) { cancelSale(cancelBtn.dataset.cancelSale); return; }

    const dec = e.target.closest("[data-dec]");
    if (dec) { changeQty(dec.dataset.dec, -1); return; }
    const inc = e.target.closest("[data-inc]");
    if (inc) { changeQty(inc.dataset.inc, +1); return; }
    const rem = e.target.closest("[data-rem]");
    if (rem) { removeFromCart(rem.dataset.rem); return; }

    const editAcc = e.target.closest("[data-edit-acc]");
    if (editAcc) { modalAccount(editAcc.dataset.editAcc); return; }
    const delAcc = e.target.closest("[data-del-acc]");
    if (delAcc) { deleteAccount(delAcc.dataset.delAcc); return; }

    const invAdj = e.target.closest("[data-inv-adjust]");
    if (invAdj) { modalInventoryAdjust(invAdj.dataset.invAdjust); return; }

    const togProd = e.target.closest("[data-toggle-prod]");
    if (togProd) {
      const id = togProd.dataset.toggleProd;
      db.products = db.products.map((p) => (p.id === id ? { ...p, ativo: !p.ativo } : p));
      touch();
      renderAll();
      return;
    }

    const delProd = e.target.closest("[data-del-prod]");
    if (delProd) {
      if (!guard("products.delete", "Só ADMIN pode apagar produtos.")) return;
      const id = delProd.dataset.delProd;
      if (!confirm("Apagar este produto?")) return;
      db.products = db.products.filter((p) => p.id !== id);
      if (db.inventory?.[id] != null) delete db.inventory[id];
      touch();
      renderAll();
      return;
    }

    const delCust = e.target.closest("[data-del-cust]");
    if (delCust) {
      const id = delCust.dataset.delCust;
      if (!confirm("Apagar cliente?")) return;
      const base = db.customers[0]?.id;
      if (id === base) return alert("Não pode apagar o cliente balcão.");
      db.customers = db.customers.filter((c) => c.id !== id);
      touch();
      renderAll();
      return;
    }

    const uPin = e.target.closest("[data-user-pin]");
    if (uPin) {
      if (!isAdmin()) return alert("Só ADMIN pode resetar PIN.");
      const id = uPin.dataset.userPin;
      const u = db.users.find((x) => x.id === id);
      if (!u) return;

      openModal(
        "Reset PIN (Admin)",
        `
          <form id="pinForm" class="form2" data-pin-id="${id}">
            <div class="field full">
              <label>Utilizador</label>
              <input class="input" value="${safeText(u.nome)}" disabled />
            </div>
            <div class="field full">
              <label>PIN temporário (4–8 dígitos)</label>
              <input class="input" id="newPin" type="password" inputmode="numeric" placeholder="ex: 1234" required />
            </div>
            <button class="btn big full" type="submit">Guardar PIN</button>
          </form>
          <p class="muted" style="margin-top:8px">O utilizador será obrigado a alterar ao entrar.</p>
        `
      );
      return;
    }

    const uQA = e.target.closest("[data-user-qa]");
    if (uQA) {
      if (!isAdmin()) return alert("Só ADMIN pode definir pergunta/recuperação.");
      const userId = uQA.dataset.userQa;
      const u = db.users.find((x) => x.id === userId);
      if (!u) return;

      openModal(
        "Definir recuperação de PIN",
        `
          <form id="qaForm" class="form2" data-qa-id="${userId}">
            <div class="field full">
              <label>Utilizador</label>
              <input class="input" value="${safeText(u.nome)}" disabled />
            </div>

            <div class="field full">
              <label>Pergunta de segurança</label>
              <input class="input" id="qaQuestion" required value="${safeText(u.securityQuestion || "")}" placeholder="Ex: Qual é o nome da sua mãe?"/>
            </div>

            <div class="field full">
              <label>Resposta</label>
              <input class="input" id="qaAnswer" required placeholder="Digite a resposta..." />
            </div>

            <button class="btn big full" type="submit">Guardar</button>
          </form>
        `
      );
      return;
    }

    const uToggle = e.target.closest("[data-user-toggle]");
    if (uToggle) {
      if (!isAdmin()) return alert("Só ADMIN pode ativar/desativar.");
      const id = uToggle.dataset.userToggle;
      const me = currentUser();
      if (me && me.id === id) return alert("Você não pode desativar o seu próprio utilizador.");
      db.users = db.users.map((u) => (u.id === id ? { ...u, ativo: u.ativo === false ? true : false } : u));
      touch();
      renderAll();
      return;
    }
  });

  // Submit handler (✅ tudo dentro do listener, sem "e" solto)
  document.addEventListener("submit", (e) => {
    // Empresa
    const companyForm = e.target.closest("#companyForm");
    if (companyForm) {
      e.preventDefault();
      ensureWorkspaceModel();

      db.company = {
        nome: (document.getElementById("cmpNome")?.value || "").trim(),
        nuit: (document.getElementById("cmpNuit")?.value || "").trim(),
        contacto: (document.getElementById("cmpContacto")?.value || "").trim(),
        morada: (document.getElementById("cmpMorada")?.value || "").trim(),
        email: (document.getElementById("cmpEmail")?.value || "").trim(),
      };

      touch();
      closeModal();
      alert("Empresa guardada!");
      return;
    }

    // Inventário
    const invAdjustForm = e.target.closest("#invAdjustForm");
    if (invAdjustForm) {
      e.preventDefault();

      const pid = invAdjustForm.getAttribute("data-pid");
      const type = document.getElementById("invAdjType")?.value || "in";
      const qty = Number(document.getElementById("invAdjQty")?.value || 0);
      const reason = document.getElementById("invAdjReason")?.value || "";
      const date = document.getElementById("invAdjDate")?.value || todayISO();
      const note = document.getElementById("invAdjNote")?.value || "";

      try {
        applyInventoryAdjustment(pid, type, qty, reason, date, note);
        closeModal();
        renderAll();
        alert("Ajuste aplicado!");
      } catch (err) {
        alert(err?.message || "Erro ao aplicar ajuste.");
      }
      return;
    }

    // Reset PIN
    const pinForm = e.target.closest("#pinForm");
    if (pinForm) {
      e.preventDefault();
      if (!isAdmin()) return alert("Só ADMIN pode resetar PIN.");

      const id = pinForm.getAttribute("data-pin-id");
      const newPin = (document.getElementById("newPin")?.value || "").trim();
      if (!/^\d{4,8}$/.test(newPin)) return alert("PIN deve ter 4–8 dígitos.");

      adminResetPin(id, newPin);
      closeModal();
      renderAll();
      alert("PIN temporário definido!");
      return;
    }

    // QA
    const qaForm = e.target.closest("#qaForm");
    if (qaForm) {
      e.preventDefault();
      const id = qaForm.getAttribute("data-qa-id");
      const q = document.getElementById("qaQuestion")?.value || "";
      const a = document.getElementById("qaAnswer")?.value || "";
      setSecurityQA(id, q, a)
        .then(() => {
          closeModal();
          renderAll();
          alert("Recuperação definida!");
        })
        .catch((err) => alert(err?.message || "Erro ao guardar pergunta."));
      return;
    }

    // Recover
    const recoverForm = e.target.closest("#recoverForm");
    if (recoverForm) {
      e.preventDefault();
      const userId = recoverForm.getAttribute("data-user-id");
      const ans = document.getElementById("recoverAnswer")?.value || "";
      const newPin = document.getElementById("recoverNewPin")?.value || "";
      recoverPinByQuestion(userId, ans, newPin).then(() => {
        closeModal();
        refreshLoginUsers();
      });
      return;
    }

    // Accounts form
    const accForm = e.target.closest("#accForm");
    if (accForm) {
      e.preventDefault();
      if (!guard("accounts.create_edit", "Apenas Admin/Gestão podem criar/editar contas.")) return;

      const editId = accForm.getAttribute("data-edit-id");
      const nome = (document.getElementById("accName")?.value || "").trim();
      if (!nome) return alert("Escreva o nome da conta.");

      const obj = {
        id: editId || uid(),
        nome,
        tipo: document.getElementById("accType")?.value || "Dinheiro",
        saldo: Number(document.getElementById("accSaldo")?.value || 0),
        ativo: (document.getElementById("accActive")?.value || "true") === "true",
      };

      if (editId) db.accounts = db.accounts.map((x) => (x.id === editId ? obj : x));
      else db.accounts.push(obj);

      touch();
      closeModal();
      renderAll();
      return;
    }

    // Produto
    const productForm = e.target.closest("#productForm");
    if (productForm) {
      e.preventDefault();
      if (!guard("products.create", "Apenas Admin/Gestão podem criar produtos.")) return;

      const nome = (document.getElementById("prodName")?.value || "").trim();
      if (!nome) return alert("Nome do produto é obrigatório.");

      const p = {
        id: uid(),
        nome,
        precoVenda: Number(document.getElementById("prodPrice")?.value || 0),
        precoAquisicaoRef: Number(document.getElementById("prodCost")?.value || 0),
        minStock: Number(document.getElementById("prodMinStock")?.value || 0),
        img: (document.getElementById("prodImg")?.value || "").trim(),
        desc: (document.getElementById("prodDesc")?.value || "").trim(),
        ativo: true,
        stockBaseId: document.getElementById("prodStockBase")?.value || "",
        stockFactor: Math.max(1, Number(document.getElementById("prodStockFactor")?.value || 1)),
      };

      db.products.push(p);
      touch();
      productForm.reset();
      updateProfitNote();
      renderAll();
      return;
    }

    // Cliente
    const customerForm = e.target.closest("#customerForm");
    if (customerForm) {
      e.preventDefault();
      const nome = (document.getElementById("custName")?.value || "").trim();
      if (!nome) return alert("Nome do cliente é obrigatório.");

      const c = {
        id: uid(),
        nome,
        telefone: (document.getElementById("custPhone")?.value || "").trim(),
        notas: (document.getElementById("custNotes")?.value || "").trim(),
      };
      db.customers.push(c);
      touch();
      customerForm.reset();
      renderAll();
      return;
    }

    // Compra
    const buyForm = e.target.closest("#buyForm");
    if (buyForm) {
      e.preventDefault();
      if (!guard("purchases.create", "Sem permissão para registrar compras.")) return;

      const supplier = (document.getElementById("buySupplier")?.value || "").trim();
      const productId = document.getElementById("buyProduct")?.value;
      const qty = Number(document.getElementById("buyQty")?.value || 0);
      const costUnit = Number(document.getElementById("buyCost")?.value || 0);
      const accountId = document.getElementById("buyAccount")?.value;
      const date = document.getElementById("buyDate")?.value || todayISO();

      if (!supplier) return alert("Informe o fornecedor.");
      if (!productId) return alert("Selecione o produto.");
      if (qty <= 0) return alert("Quantidade inválida.");
      if (costUnit < 0) return alert("Preço inválido.");
      if (!accountId) return alert("Selecione a conta.");

      const total = qty * costUnit;
      const purchase = { id: uid(), data: date, supplier, productId, qty, costUnit, total, accountId };
      db.purchases.push(purchase);

      setInv(productId, invQty(productId) + qty);
      addLedger({ date, type: "out", accountId, amount: total, refType: "purchase", refId: purchase.id, note: `Compra ${supplier}` });

      db.products = db.products.map((p) => (p.id === productId ? { ...p, precoAquisicaoRef: costUnit } : p));

      touch();
      buyForm.reset();
      renderAll();
      return;
    }
  });

  // defaults
  const bd = document.getElementById("buyDate");
  if (bd && !bd.value) bd.value = todayISO();
  const sd = document.getElementById("saleDate");
  if (sd && !sd.value) sd.value = todayISO();

  await initSupabaseIfConfigured();

  try {
    const mins = Math.max(5, Number(db.settings?.autoBackupMinutes || 10));
    setInterval(() => saveAutoSnapshot(), mins * 60 * 1000);
    window.addEventListener("beforeunload", () => saveAutoSnapshot());
  } catch {}

  
  renderAll();
});

})();