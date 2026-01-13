/***********************
 * Gestão Fácil - V1 (JS COMPLETO CORRIGIDO)
 * Offline + Online (Supabase opcional)
 * + Auto-backup (local snapshots)
 * + Auth (PIN + níveis)
 * + Permissões (admin / manager / staff)
 * + Gestão de Utilizadores (Admin) na Config
 * + Logout (top) seguro
 * + Menu responsivo (drawer mobile + colapsar sidebar desktop)
 * + Recuperação de PIN (Pergunta/Resposta) + Reset Admin + MustChangePin
 *
 * ✅ Sem funções duplicadas
 * ✅ Um único DOMContentLoaded (1 boot)
 * ✅ Event delegation onde faz sentido (listas renderizadas)
 ************************/

/* =======================
   Utils
======================= */
const MT = (n) => `${Number(n || 0).toFixed(2)} MT`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () =>
  crypto?.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(16).slice(2) + Date.now().toString(16);
const byName = (a, b) => (a.nome || "").localeCompare(b.nome || "");

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
    meta: { updatedAt: Date.now(), version: 1 },
    online: { url: "", key: "" },

    users: [],
    auth: { currentUserId: null },


    // DATA
    accounts: [{ id: uid(), nome: "Dinheiro", tipo: "Dinheiro", ativo: true, saldo: 0 }],
    customers: [{ id: uid(), nome: "Cliente balcão", telefone: "", notas: "" }],
    products: [
      { id: uid(), nome: "Refresco 500ml", precoVenda: 35, precoAquisicaoRef: 22, minStock: 5, img: "", desc: "", ativo: true },
      { id: uid(), nome: "Bolo fatia", precoVenda: 50, precoAquisicaoRef: 30, minStock: 3, img: "", desc: "", ativo: true },
    ],
    inventory: {},

    purchases: [],
    sales: [],
    ledger: [],

    // SETTINGS
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

function getDeviceId() {
  const k = "gestao_facil_device_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = uid();
    localStorage.setItem(k, v);
  }
  return v;
}

async function syncNow() {
  if (!supabase) {
    alert("Online não está configurado. Vá em Config e cole SUPABASE_URL e KEY (ou use offline).");
    return;
  }

  setSyncState("Sincronizando...");
  const deviceId = getDeviceId();
  const payload = { device_id: deviceId, data: db, updated_at: new Date().toISOString() };

  const { error } = await supabase.from("snapshots").upsert(payload, { onConflict: "device_id" });
  if (error) {
    console.error(error);
    setSyncState("Online (erro)");
    alert("Não consegui sincronizar. Verifique a tabela 'snapshots' no Supabase.");
    return;
  }

  const { data, error: e2 } = await supabase
    .from("snapshots")
    .select("*")
    .eq("device_id", deviceId)
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
   Core helpers
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
function getGbBaseProduct(){
  // procura por kind primeiro; fallback para nome "GB"
  return db.products.find(p => p?.kind === "base_gb") || db.products.find(p => (p?.nome || "").trim().toUpperCase() === "GB");
}

function isPackage(p){
  return p && p.kind === "package" && Number(p.gbQty || 0) > 0;
}

function stockForProduct(productId){
  const p = productById(productId);
  if(!p) return 0;

  // PACOTE: stock “virtual” = quantos pacotes dá para montar com o stock do GB
  if(isPackage(p)){
    const gb = getGbBaseProduct();
    if(!gb) return 0;
    const gbStock = invQty(gb.id);
    const perPack = Number(p.gbQty || 0);
    return perPack > 0 ? Math.floor(gbStock / perPack) : 0;
  }

  // NORMAL: stock próprio como sempre
  return invQty(productId);
}

function consumeStockForSaleItem(productId, qty){
  const p = productById(productId);
  if(!p) throw new Error("Produto não encontrado.");

  // PACOTE: desconta do GB
  if(isPackage(p)){
    const gb = getGbBaseProduct();
    if(!gb) throw new Error("Produto base 'GB' não está configurado.");
    const need = Number(p.gbQty || 0) * Number(qty || 0);
    const current = invQty(gb.id);
    if(need > current) throw new Error("Stock de GB insuficiente.");
    setInv(gb.id, current - need);
    return;
  }

  // NORMAL: desconta do próprio produto
  const current = invQty(productId);
  if(qty > current) throw new Error("Stock insuficiente.");
  setInv(productId, current - qty);
}

function costUnitFor(productId){
  const p = productById(productId);
  if(!p) return 0;

  // PACOTE: custo = gbQty * custoPorGB
  if(isPackage(p)){
    const gb = getGbBaseProduct();
    const gbCost = Number(gb?.precoAquisicaoRef || 0);
    return Number(p.gbQty || 0) * gbCost;
  }

  // NORMAL: custo padrão
  return Number(p.precoAquisicaoRef || 0);
}

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
    // deep copy para não apontar por referência
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

    // recuperação
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
   RECUPERAÇÃO PIN (A + B)
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

  db.users = db.users.map((u) =>
    u.id !== userId ? u : { ...u, securityQuestion: q, securityAnswerHash: hash }
  );

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

  db.users = db.users.map((x) =>
    x.id !== u.id ? x : { ...x, pin: String(newPin).trim(), mustChangePin: false }
  );

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

  db.users = db.users.map((x) =>
    x.id !== userId ? x : { ...x, pin: String(newPin).trim(), mustChangePin: false }
  );

  touch();
  alert("PIN atualizado! Agora já pode iniciar sessão.");
}

/* =======================
   Permissões (guard)
======================= */
function role() {
  return currentUser()?.role || null;
}
function can(action) {
  const r = role();
  if (!r) return false;

  const rules = {
    // críticos
    "users.manage": ["admin"],
    "system.reset": ["admin"],
    "accounts.delete": ["admin"],
    "products.delete": ["admin"],

    // normais
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
   Auth UI
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
  sel.innerHTML = active.map((u) => `<option value="${u.nome}">${u.nome} (${u.role})</option>`).join("");
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

/* ✅ Logout (único, oficial) */
function doLogout() {
  ensureAuthModel();
  db.auth.currentUserId = null;
  touch();

  setAppLocked(true);
  refreshLoginUsers();
  showAuthScreen("login");
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
  relatorios: { title: "Relatórios", desc: "Base de relatórios (V1)" },
  fiscal: { title: "Fiscal", desc: "Página em desenvolvimento" },
  config: { title: "Config", desc: "Backup + Online (Supabase)" },
  suporte: { title: "Suporte", desc: "FAQ + reportar problemas" },
};

function go(page) {
  document.querySelectorAll(".mitem").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === page));

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

  // contas
  const elAcc = document.getElementById("accountsList");
  if (elAcc) {
    const accs = [...db.accounts].sort(byName);
    elAcc.innerHTML = accs.length
      ? accs
          .map((a) => {
            const saldo = calcAccountBalance(a.id);
            return `
              <div class="item">
                <h4>${a.nome} <span class="badge">${a.tipo}</span></h4>
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

  // low stock
  const elLow = document.getElementById("lowStockList");
  if (elLow) {
    const lows = db.products
      .filter((p) => p.ativo)
      .map((p) => ({ p, qty: invQty(p.id) }))
      .filter((x) => x.p.minStock > 0 && x.qty <= x.p.minStock)
      .sort((a, b) => a.qty - b.qty);

    elLow.innerHTML = lows.length
      ? lows
          .map(
            (x) => `
            <div class="item">
              <h4>${x.p.nome}</h4>
              <div class="meta">
                <span>Stock: <strong>${x.qty}</strong></span>
                <span>Mínimo: ${x.p.minStock}</span>
              </div>
            </div>`
          )
          .join("")
      : `<div class="muted">Sem alertas de stock mínimo.</div>`;
  }

  // últimas vendas
  const elLast = document.getElementById("lastSales");
  if (elLast) {
    const last = [...db.sales].slice(-5).reverse();
    elLast.innerHTML = last.length
      ? last
          .map(
            (s) => `
            <div class="item">
              <h4>${MT(s.total)} <span class="badge">${s.data}</span></h4>
              <div class="meta">
                <span>Cliente: ${customerName(s.customerId)}</span>
                <span>Conta: ${accountName(s.accountId)}</span>
                <span>${s.items.length} itens</span>
              </div>
            </div>`
          )
          .join("")
      : `<div class="muted">Ainda sem vendas.</div>`;
  }
}

/* =======================
   Accounts (modal + delete)
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
          <input class="input" id="accName" required value="${a?.nome || ""}" placeholder="Ex: M-Pesa"/>
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
              <h4>${p.nome} <span class="badge">${p.ativo ? "Ativo" : "Inativo"}</span></h4>
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
/* =======================
   Produtos – Pacotes (stock base)
======================= */
function renderProductStockBaseSelect() {
  const sel = document.getElementById("prodStockBase");
  if (!sel) return;

  const current = sel.value || "";

  const items = (db.products || [])
    .filter(p => p && p.ativo !== false)
    .sort((a,b)=> (a.nome||"").localeCompare(b.nome||""));

  sel.innerHTML = `
    <option value="">— Não (produto normal) —</option>
    ${items.map(p => `<option value="${p.id}">${p.nome}</option>`).join("")}
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
            <h4>${c.nome}</h4>
            <div class="meta">
              <span>Tel: ${c.telefone || "—"}</span>
              <span>${c.notas || ""}</span>
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
   .filter((p) => p.ativo) // mantém
    .map((p) => ({ p, qty: invQty(p.id) }))
    .sort((a, b) => a.p.nome.localeCompare(b.p.nome));

  el.innerHTML = items.length
    ? items
        .map((x) => {
          const low = x.p.minStock > 0 && x.qty <= x.p.minStock;
          return `
            <div class="item">
              <h4>${x.p.nome} ${low ? `<span class="badge">Baixo</span>` : ""}</h4>
              <div class="meta">
                <span>Disponível: <strong>${x.qty}</strong></span>
                <span>Stock mín.: ${x.p.minStock}</span>
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
              <h4>${MT(p.total)} <span class="badge">${p.data}</span></h4>
              <div class="meta">
                <span>Fornecedor: ${p.supplier}</span>
                <span>Produto: ${prod?.nome || "—"}</span>
                <span>${p.qty} x ${MT(p.costUnit)}</span>
                <span>Conta: ${accountName(p.accountId)}</span>
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
   .filter((p) => p.ativo && p.kind !== "base_gb")

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
                <div class="pname">${p.nome}</div>
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

  // stock base necessário por 1 unidade do produto
  const needOne = consumptionQty(productId);
  if (stockForProduct(productId) < needOne) {
    return alert("Sem stock (base).");
  }

  // ✅ agora sim: procurar item no carrinho
  const found = cart.find((i) => i.productId === productId);

  if (found) {
    // se já existe no carrinho, validar se ainda há stock base para +1
    const needTotal = (found.qty + 1) * consumptionQty(productId);
    if (needTotal > stockForProduct(productId)) {
      return alert("Stock base insuficiente.");
    }
    found.qty += 1;
  } else {
    // novo item
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
    const stock = invQty(i.productId);
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
          <h4>${r.p?.nome || "—"}</h4>
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
  if (newQty > invQty(productId)) return alert("Stock insuficiente.");
  item.qty = newQty;
  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter((x) => x.productId !== productId);
  renderCart();
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
  const baseId = stockBaseIdForProduct(i.productId);
  const need = i.qty * consumptionQty(i.productId);
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

  const sale = { id: uid(), data: date, customerId, accountId, items, total, totalCost, profit };
  db.sales.push(sale);

try{
  items.forEach((it) => consumeStockForSaleItem(it.productId, it.qty));
}catch(err){
  return alert(err?.message || "Erro ao baixar stock.");
}

  addLedger({ date, type: "in", accountId, amount: total, refType: "sale", refId: sale.id, note: `Venda ${customerName(customerId)}` });

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
        .map(
          (s) => `
          <div class="item">
            <h4>${MT(s.total)} <span class="badge">${s.data}</span></h4>
            <div class="meta">
              <span>Cliente: ${customerName(s.customerId)}</span>
              <span>Conta: ${accountName(s.accountId)}</span>
              <span>Lucro (estim.): <strong>${MT(s.profit)}</strong></span>
              <span>${s.items.length} itens</span>
            </div>
          </div>`
        )
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
function renderProductStockBaseSelect() {
  const sel = document.getElementById("prodStockBase");
  if (!sel) return;

  const current = sel.value || "";
  const items = db.products.filter(p => p.ativo).sort(byName);

  sel.innerHTML = `
    <option value="">— Não (produto normal) —</option>
    ${items.map(p => `<option value="${p.id}">${p.nome}</option>`).join("")}
  `;

  // tenta manter seleção atual
  sel.value = current;
}

  const saleAcc = document.getElementById("saleAccount");
  if (saleAcc) saleAcc.innerHTML = accActive.map((a) => `<option value="${a.id}">${a.nome}</option>`).join("");

  const buyAcc = document.getElementById("buyAccount");
  if (buyAcc) buyAcc.innerHTML = accActive.map((a) => `<option value="${a.id}">${a.nome}</option>`).join("");

  const saleCust = document.getElementById("saleCustomer");
  if (saleCust) saleCust.innerHTML = custs.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("");

  const buyProd = document.getElementById("buyProduct");
  if (buyProd) buyProd.innerHTML = prods.map((p) => `<option value="${p.id}">${p.nome}</option>`).join("");
}

/* =======================
   Reports (base)
======================= */
function renderReportsBase() {
  const elQuick = document.getElementById("reportQuick");
  const elStock = document.getElementById("reportStock");
  if (!elQuick || !elStock) return;

  const d = todayISO();
  const sales = db.sales.filter((s) => s.data === d);
  const buys = db.purchases.filter((p) => p.data === d);
  const totalSales = sales.reduce((s, x) => s + x.total, 0);
  const totalBuys = buys.reduce((s, x) => s + x.total, 0);
  const profit = sales.reduce((s, x) => s + x.profit, 0);

  elQuick.innerHTML = `
    <div class="item">
      <h4>Hoje (${d})</h4>
      <div class="meta">
        <span>Vendas: <strong>${MT(totalSales)}</strong></span>
        <span>Compras: <strong>${MT(totalBuys)}</strong></span>
        <span>Lucro (estim.): <strong>${MT(profit)}</strong></span>
      </div>
    </div>
  `;

  const lows = db.products
    .filter((p) => p.ativo)
    .map((p) => ({ p, qty: invQty(p.id) }))
    .filter((x) => x.p.minStock > 0 && x.qty <= x.p.minStock);

  elStock.innerHTML = lows.length
    ? lows
        .map(
          (x) => `
          <div class="item">
            <h4>${x.p.nome}</h4>
            <div class="meta">
              <span>Stock: <strong>${x.qty}</strong></span>
              <span>Mínimo: ${x.p.minStock}</span>
            </div>
          </div>`
        )
        .join("")
    : `<div class="muted">Sem stock baixo agora.</div>`;
}

/* =======================
   User badge (top)
======================= */
function renderUserBadge() {
  const el = document.getElementById("userBadge");
  if (!el) return;
  const u = currentUser();
  el.textContent = u ? `👤 ${u.nome} (${u.role})` : "👤 —";
}

/* =======================
   CONFIG -> UTILIZADORES (Admin)
======================= */
function safeText(s) {
  return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}

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
                <button class="btn ghost" data-user-edit="${u.id}">Editar</button>
                <button class="btn ghost" data-user-pin="${u.id}">Reset PIN (Admin)</button>
                <button class="btn ghost" data-user-qa="${u.id}">Pergunta/PIN</button>
                <button class="btn ${u.ativo === false ? "ghost" : "danger"}" data-user-toggle="${u.id}">
                  ${u.ativo === false ? "Ativar" : "Desativar"}
                </button>
              </div>
            </div>`;
        })
        .join("")
    : `<div class="muted">Sem utilizadores.</div>`;
}

function modalUser(id = null) {
  if (!isAdmin()) return alert("Só ADMIN pode gerir utilizadores.");

  const first = db.users.length === 0;
  const u = id ? db.users.find((x) => x.id === id) : null;

  openModal(
    id ? "Editar utilizador" : "Novo utilizador",
    `
      <form id="userForm" class="form2" ${id ? `data-edit-id="${id}"` : ""}>
        <div class="field full">
          <label>Nome</label>
          <input class="input" id="uName" required value="${safeText(u?.nome || "")}" placeholder="Ex: Caixa 1"/>
        </div>

        <div class="field">
          <label>Nível</label>
          <select class="input" id="uRole" ${first ? "disabled" : ""}>
            <option value="admin" ${u?.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="manager" ${u?.role === "manager" ? "selected" : ""}>Gestão</option>
            <option value="staff" ${u?.role === "staff" ? "selected" : ""}>Caixa</option>
          </select>
          ${first ? `<small class="muted">Primeiro utilizador tem de ser Admin.</small>` : ``}
        </div>

        <div class="field">
          <label>${id ? "Novo PIN (deixe vazio para manter)" : "PIN (4–8 dígitos)"}</label>
          <input class="input" id="uPin" type="password" inputmode="numeric" placeholder="ex: 1234"/>
        </div>

        <button class="btn big full" type="submit">${id ? "Guardar" : "Criar"}</button>
      </form>
    `
  );
}

function modalSetQA(userId) {
  if (!isAdmin()) return alert("Só ADMIN pode definir pergunta/recuperação.");
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
          <label>Resposta (não guarda em texto; só hash)</label>
          <input class="input" id="qaAnswer" required placeholder="Digite a resposta..." />
        </div>

        <button class="btn big full" type="submit">Guardar</button>
      </form>
    `
  );
}

function modalChangePinForced() {
  const u = currentUser();
  if (!u) return;

  openModal(
    "Alterar PIN (obrigatório)",
    `
      <form id="forcePinForm" class="form2">
        <div class="field full">
          <label>Seu nome</label>
          <input class="input" value="${safeText(u.nome)}" disabled />
        </div>

        <div class="field full">
          <label>PIN atual</label>
          <input class="input" id="forceOldPin" type="password" inputmode="numeric" required />
        </div>

        <div class="field full">
          <label>Novo PIN (4–8 dígitos)</label>
          <input class="input" id="forceNewPin" type="password" inputmode="numeric" required />
        </div>

        <button class="btn big full" type="submit">Alterar</button>
      </form>
      <p class="muted" style="margin-top:8px">Como o Admin fez reset, você precisa definir um novo PIN.</p>
    `
  );
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
  renderReportsBase();
  renderUsersSection();
  renderUserBadge();
  renderProductStockBaseSelect();
}

/* =======================
   Mobile helpers
======================= */
function applyMobileClass() {
  const isMobile = window.innerWidth <= 900 || window.matchMedia("(pointer: coarse)").matches;
  document.body.classList.toggle("is-mobile", isMobile);
}
function stockBaseIdForProduct(productId){
  const p = productById(productId);
  // se for pacote -> usa stock base definido, senão usa ele próprio
  return (p && p.stockBaseId) ? p.stockBaseId : productId;
}

function stockForProduct(productId){
  const baseId = stockBaseIdForProduct(productId);
  return invQty(baseId);
}

function consumptionQty(productId){
  const p = productById(productId);
  // se for pacote, consome a qty definida; se não, consome 1 por unidade
  const q = Number(p?.stockConsumeQty || 1);
  return q > 0 ? q : 1;
}

/* =======================
   BOOT (um único DOMContentLoaded)
======================= */
window.addEventListener("DOMContentLoaded", async () => {
  // 0) Gate auth (antes de qualquer coisa)
  bootAuthGate();

  // 1) Modal close
  const modalClose = document.getElementById("modalClose");
  if (modalClose) modalClose.addEventListener("click", closeModal);
  const modal = document.getElementById("modal");
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  // 2) Menu navigation
  document.querySelectorAll(".mitem").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.page)));
  document.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.nav)));

  // 3) Sidebar toggle (desktop collapse + mobile drawer)
  const sidebarToggle = document.getElementById("sidebarToggle");
  const overlay = document.getElementById("overlay");

  // restaura estado colapsado (desktop)
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
  document.addEventListener("click", (e) => {
    const item = e.target.closest(".mitem");
    if (item && window.matchMedia("(max-width: 860px)").matches) {
      document.body.classList.remove("menu-open");
    }
  });

  applyMobileClass();
  window.addEventListener("resize", applyMobileClass);

  // 4) Top logout (único)
  const btnLogoutTop = document.getElementById("btnLogoutTop");
  if (btnLogoutTop) btnLogoutTop.addEventListener("click", (e) => { e.preventDefault(); doLogout(); });

  // 5) Quick sale
  const btnQuickSale = document.getElementById("btnQuickSale");
  if (btnQuickSale) btnQuickSale.addEventListener("click", () => go("vendas"));

  // 6) Produtos: lucro esperado
  const prodPrice = document.getElementById("prodPrice");
  const prodCost = document.getElementById("prodCost");
  if (prodPrice) prodPrice.addEventListener("input", updateProfitNote);
  if (prodCost) prodCost.addEventListener("input", updateProfitNote);

  // 7) Vendas: limpar/finalizar
  const btnClearCart = document.getElementById("btnClearCart");
  if (btnClearCart) btnClearCart.addEventListener("click", () => { cart = []; renderCart(); });

  const btnCheckout = document.getElementById("btnCheckout");
  if (btnCheckout) btnCheckout.addEventListener("click", finalizeSale);

  // 8) filtros / pesquisa
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

  // 9) Config: export/import/reset
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
        location.reload();
      }
    });
  }

  // Online keys
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

  // Auto-backup UI
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
  const btnGoRegister = document.getElementById("btnGoRegister");
  const btnBackLogin = document.getElementById("btnBackLogin");
  const btnLogin = document.getElementById("btnLogin");
  const btnRegister = document.getElementById("btnRegister");
  const btnForgotPin = document.getElementById("btnForgotPin");

  if (btnGoRegister) {
    btnGoRegister.addEventListener("click", () => {
      setRegisterCopy();
      showAuthScreen("register");
    });
  }
  if (btnBackLogin) {
    btnBackLogin.addEventListener("click", () => {
      refreshLoginUsers();
      showAuthScreen("login");
    });
  }

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
      const nome = document.getElementById("loginUser")?.value || "";
      const pin = document.getElementById("loginPin")?.value || "";
      const res = login(nome, pin);
      if (!res.ok) return alert("PIN ou utilizador incorreto.");

      const lp = document.getElementById("loginPin");
      if (lp) lp.value = "";

      hideAuthScreen();
      setAppLocked(false);
      renderAll();

      // se o admin fez reset: obriga a mudar
      if (res.mustChangePin) {
        modalChangePinForced();
      }
    });
  }

  if (btnRegister) {
    btnRegister.addEventListener("click", () => {
      try {
        const nome = document.getElementById("regName")?.value || "";
        const pin = document.getElementById("regPin")?.value || "";

        const first = db.users.length === 0;
        const role = first ? "admin" : (document.getElementById("regRole")?.value || "staff");

        if (!first && !isAdmin()) return alert("Só ADMIN pode criar novos utilizadores.");

        const u = createUser({ nome, pin, role });
        setLoggedInUser(u.id);

        const rn = document.getElementById("regName");
        const rp = document.getElementById("regPin");
        if (rn) rn.value = "";
        if (rp) rp.value = "";

        hideAuthScreen();
        setAppLocked(false);
        refreshLoginUsers();
        renderAll();

        // opcional: pedir logo a pergunta de segurança
        openModal(
          "Definir recuperação de PIN (recomendado)",
          `
          <form id="qaForm" class="form2" data-qa-id="${u.id}">
            <div class="field full">
              <label>Pergunta de segurança</label>
              <input class="input" id="qaQuestion" required placeholder="Ex: Qual é o nome da sua mãe?" />
            </div>

            <div class="field full">
              <label>Resposta</label>
              <input class="input" id="qaAnswer" required placeholder="Ex: Maria" />
            </div>

            <button class="btn big full" type="submit">Guardar</button>
            <button class="btn ghost full" type="button" id="skipQA" style="margin-top:8px">Pular</button>
          </form>
          `
        );

        document.getElementById("skipQA")?.addEventListener("click", closeModal);

      } catch (err) {
        alert(err?.message || "Erro ao criar utilizador.");
      }
    });
  }

  // Suporte
  const btnSendIssue = document.getElementById("btnSendIssue");
  if (btnSendIssue) {
    btnSendIssue.addEventListener("click", () => {
      const t = document.getElementById("issueText")?.value?.trim() || "";
      if (!t) return alert("Escreva a descrição do problema.");
      const it = document.getElementById("issueText");
      const is = document.getElementById("issueSent");
      if (it) it.value = "";
      if (is) is.textContent = "Obrigado! Problema registrado (nesta V1 fica local).";
    });
  }

  // Delegação: click geral
  document.addEventListener("click", (e) => {
    // Catalog add
    const addBtn = e.target.closest("[data-add]");
    if (addBtn) return addToCart(addBtn.dataset.add);

    // Cart qty/remove
    const dec = e.target.closest("[data-dec]");
    if (dec) return changeQty(dec.dataset.dec, -1);
    const inc = e.target.closest("[data-inc]");
    if (inc) return changeQty(inc.dataset.inc, +1);
    const rem = e.target.closest("[data-rem]");
    if (rem) return removeFromCart(rem.dataset.rem);

    // Accounts edit/delete
    const editAcc = e.target.closest("[data-edit-acc]");
    if (editAcc) return modalAccount(editAcc.dataset.editAcc);
    const delAcc = e.target.closest("[data-del-acc]");
    if (delAcc) return deleteAccount(delAcc.dataset.delAcc);

    // Products toggle/delete
    const togProd = e.target.closest("[data-toggle-prod]");
    if (togProd) {
      const id = togProd.dataset.toggleProd;
      db.products = db.products.map((p) => (p.id === id ? { ...p, ativo: !p.ativo } : p));
      touch();
      return renderAll();
    }
    const delProd = e.target.closest("[data-del-prod]");
    if (delProd) {
      if (!guard("products.delete", "Só ADMIN pode apagar produtos.")) return;
      const id = delProd.dataset.delProd;
      if (!confirm("Apagar este produto?")) return;
      db.products = db.products.filter((p) => p.id !== id);
      if (db.inventory?.[id] != null) delete db.inventory[id];
      touch();
      return renderAll();
    }

    // Customers delete
    const delCust = e.target.closest("[data-del-cust]");
    if (delCust) {
      const id = delCust.dataset.delCust;
      if (!confirm("Apagar cliente?")) return;
      const base = db.customers[0]?.id;
      if (id === base) return alert("Não pode apagar o cliente balcão.");
      db.customers = db.customers.filter((c) => c.id !== id);
      touch();
      return renderAll();
    }

    // Users section (Admin)
    const addUser = e.target.closest("#btnAddUser");
    if (addUser) return modalUser(null);

    const uEdit = e.target.closest("[data-user-edit]");
    if (uEdit) return modalUser(uEdit.dataset.userEdit);

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
    if (uQA) return modalSetQA(uQA.dataset.userQa);

    const uToggle = e.target.closest("[data-user-toggle]");
    if (uToggle) {
      if (!isAdmin()) return alert("Só ADMIN pode ativar/desativar.");
      const id = uToggle.dataset.userToggle;
      const me = currentUser();
      if (me && me.id === id) return alert("Você não pode desativar o seu próprio utilizador.");
      db.users = db.users.map((u) => (u.id === id ? { ...u, ativo: u.ativo === false ? true : false } : u));
      touch();
      return renderAll();
    }
  });

  // Delegação: submit geral (modais + forms)
  document.addEventListener("submit", (e) => {
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
      const ms = document.getElementById("prodMinStock");
      if (ms) ms.value = 0;
      updateProfitNote();
      renderAll();
      return;
    }

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

      // atualiza custo ref
      db.products = db.products.map((p) => (p.id === productId ? { ...p, precoAquisicaoRef: costUnit } : p));

      touch();
      buyForm.reset();
      const bd = document.getElementById("buyDate");
      const bq = document.getElementById("buyQty");
      if (bd) bd.value = todayISO();
      if (bq) bq.value = 1;
      renderAll();
      return;
    }

    const userForm = e.target.closest("#userForm");
    if (userForm) {
      e.preventDefault();
      if (!isAdmin()) return alert("Só ADMIN pode criar/editar.");

      const editId = userForm.getAttribute("data-edit-id");
      const nome = (document.getElementById("uName")?.value || "").trim();
      const pin = (document.getElementById("uPin")?.value || "").trim();
      const first = db.users.length === 0;
      const roleVal = first ? "admin" : (document.getElementById("uRole")?.value || "staff");

      if (!nome) return alert("Nome obrigatório.");

      if (!editId) {
        if (!/^\d{4,8}$/.test(pin)) return alert("PIN deve ter 4–8 dígitos.");
        createUser({ nome, pin, role: roleVal });
        closeModal();
        renderAll();
        alert("Utilizador criado!");
        return;
      }

      // editar (PIN opcional)
      db.users = db.users.map((u) => {
        if (u.id !== editId) return u;
        const next = { ...u, nome, role: roleVal };
        if (pin) {
          if (!/^\d{4,8}$/.test(pin)) {
            alert("PIN deve ter 4–8 dígitos.");
            return u;
          }
          next.pin = pin;
          next.mustChangePin = false;
        }
        return next;
      });

      touch();
      closeModal();
      renderAll();
      alert("Utilizador atualizado!");
      return;
    }

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

    const qaForm = e.target.closest("#qaForm");
    if (qaForm) {
      e.preventDefault();
      if (!isAdmin() && db.users.length > 1) {
        // regra simples: só admin define QA para outros
        // (primeiro user ao criar pode passar aqui porque ainda está logado como admin)
      }
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

    const forcePinForm = e.target.closest("#forcePinForm");
    if (forcePinForm) {
      e.preventDefault();
      const oldPin = document.getElementById("forceOldPin")?.value || "";
      const newPin = document.getElementById("forceNewPin")?.value || "";
      changeMyPin(oldPin, newPin);
      closeModal();
      renderAll();
      return;
    }
  });

  // 10) Datas default
  const bd = document.getElementById("buyDate");
  if (bd && !bd.value) bd.value = todayISO();
  const sd = document.getElementById("saleDate");
  if (sd && !sd.value) sd.value = todayISO();

  // 11) Supabase init
  await initSupabaseIfConfigured();

  // 12) Auto-backup timer + beforeunload
  try {
    const mins = Math.max(5, Number(db.settings?.autoBackupMinutes || 10));
    setInterval(() => saveAutoSnapshot(), mins * 60 * 1000);
    window.addEventListener("beforeunload", () => saveAutoSnapshot());
  } catch {}

  // 13) Render
  renderAll();
});