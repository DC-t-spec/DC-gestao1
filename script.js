alert("JS carregado ✅ Gestão Fácil - V1 (BASE + Sales + Inventory + Audit + Snapshots)");

(() => {
  "use strict";



  /***********************
   * Offline-first (localStorage)
   * Workspace + Login (PIN)
   * Produtos + Clientes + Contas/Ledger + Compras
   * POS ligado ao Financeiro (ledger IN)
   * Stock: Inventário (ajustes + histórico)
   * Stock: Vendas (histórico + cancelar/estornar)
   * Auditoria append-only
   * Supabase snapshots (restore + manual backup + auto)
   * Export/Import JSON
   ***********************/

  /* =======================
     Keys + Utils
  ======================= */var _db$online10, _db$settings5;
  const WS_KEY = "gf_ws";
  const DB_KEY = "gf_db";
  const SESSION_KEY = "gf_session";

  const uid = () =>
  window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

  const nowISO = () => new Date().toISOString();
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const MT = n => `${Number(n || 0).toFixed(2)} MT`;

  const load = (k, fallback) => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  const el = id => document.getElementById(id);
  // ===== Auditoria UI =====
  const auditFrom = el("auditFrom");
  const auditTo = el("auditTo");
  const auditAction = el("auditAction");
  const auditUser = el("auditUser");
  const btnAuditFilter = el("btnAuditFilter");
  const btnAuditRefresh = el("btnAuditRefresh");
  const auditTable = el("auditTable");
  const auditCount = el("auditCount");
  const auditMsg = el("auditMsg");

  function nnum(v, def = 0) {
    const x = Number(String(v !== null && v !== void 0 ? v : "").replace(",", "."));
    return Number.isFinite(x) ? x : def;
  }

  /* =======================
     DB
  ======================= */
  const emptyDB = () => ({
    meta: { version: "1.2", createdAt: nowISO(), updatedAt: nowISO() },
    users: [],
    products: [],
    clients: [],
    accounts: [],
    sales: [],
    purchases: [],
    ledger: [],
    inventory: [],
    audit: [],
    settings: {
      autoSnapshots: true,
      snapshotRetention: 30 },

    online: { enabled: false, url: "", key: "" } });


  let db = load(DB_KEY, emptyDB());
  db.users = db.users || [];
  db.products = db.products || [];
  db.clients = db.clients || [];
  db.accounts = db.accounts || [];
  db.sales = db.sales || [];
  db.purchases = db.purchases || [];
  db.ledger = db.ledger || [];
  db.inventory = db.inventory || [];
  db.audit = db.audit || [];
  db.settings = db.settings || { autoSnapshots: true, snapshotRetention: 30 };
  db.online = db.online || { enabled: false, url: "", key: "" };

  let session = load(SESSION_KEY, null);
  let workspaceId = localStorage.getItem(WS_KEY) || "";

  function saveDBTouch() {
    db.meta.updatedAt = nowISO();
    save(DB_KEY, db);
  }

  function canManage() {
    return session && (session.role === "admin" || session.role === "manager");
  }

  function getSessionUser() {var _session;
    if (!((_session = session) !== null && _session !== void 0 && _session.userId)) return null;
    return (db.users || []).find(u => u.id === session.userId) || null;
  }

  /* =======================
     Auditoria (append-only)
  ======================= */
  function safeMeta(meta) {
    const blocked = ["pin", "sbKey", "supabaseKey", "password", "key"];
    const m = JSON.parse(JSON.stringify(meta || {}));
    blocked.forEach(k => {
      if (k in m) delete m[k];
    });
    return m;
  }

  function logAction(action, entityType = "", entityId = "", meta = {}) {
    try {var _session2, _session3;
      const u = getSessionUser();
      db.audit.push({
        id: uid(),
        ts: nowISO(),
        workspaceId: workspaceId || "",
        actorId: u ? u.id : ((_session2 = session) === null || _session2 === void 0 ? void 0 : _session2.userId) || "",
        actorName: u ? u.name : "",
        role: u ? u.role : ((_session3 = session) === null || _session3 === void 0 ? void 0 : _session3.role) || "",
        action,
        entityType,
        entityId,
        meta: safeMeta(meta) });

      saveDBTouch();
    } catch {
      // nunca bloquear
    }
  }

  /* =======================
     Debounce simples
  ======================= */
  const _deb = {};
  function debounce(key, ms, fn) {
    clearTimeout(_deb[key]);
    _deb[key] = setTimeout(fn, ms);
  }

  /* =======================
     Stock helpers
  ======================= */
  function applyStockDelta(productId, delta) {
    const p = (db.products || []).find(x => x.id === productId);
    if (!p) return;
    p.stock = Number(p.stock || 0) + Number(delta || 0);
    if (p.stock < 0) p.stock = 0;
    p.updatedAt = nowISO();
  }

  // inventário manual
  function inventoryAdjust({ productId, mode, qty, newStock, note }) {
    const p = (db.products || []).find(x => x.id === productId && x.active !== false);
    if (!p) throw new Error("Produto inválido.");

    let delta = 0;
    if (mode === "in") delta = Math.abs(Number(qty || 0));
    if (mode === "out") delta = -Math.abs(Number(qty || 0));
    if (mode === "adjust") delta = Number(newStock || 0) - Number(p.stock || 0);

    if (!Number.isFinite(delta) || delta === 0) throw new Error("Ajuste inválido.");

    applyStockDelta(p.id, delta);

    db.inventory.push({
      id: uid(),
      date: todayISO(),
      createdAt: nowISO(),
      type: delta >= 0 ? "in" : "out",
      productId: p.id,
      qty: Math.abs(delta),
      note: note || "Ajuste manual",
      refType: "manual",
      refId: "" });


    saveDBTouch();
    logAction("inventory.adjust", "product", p.id, { delta, note: note || "" });
    autoSnapshot("inventory.adjust");
  }

  /* =======================
     Elements (Auth + Top)
  ======================= */
  const screenAuth = el("screenAuth");
  const screenMain = el("screenMain");

  const wsInput = el("workspaceId");
  const wsBadge = el("wsBadge");

  const userSelect = el("userSelect");
  const pinInput = el("pinInput");
  const authMsg = el("authMsg");

  const btnLogin = el("btnLogin");
  const btnCreateFirstAdmin = el("btnCreateFirstAdmin");
  const btnLogout = el("btnLogout");

  const btnSync = el("btnSync");
  const btnBackup = el("btnBackup");

  // Supabase login
  const sbUrlLogin = el("sbUrlLogin");
  const sbKeyLogin = el("sbKeyLogin");
  const btnLoadFromCloud = el("btnLoadFromCloud");
  const cloudMsg = el("cloudMsg");

  function setAuthMsg(m) {
    if (authMsg) authMsg.textContent = m || "";
  }
  function setCloudMsg(m) {
    if (cloudMsg) cloudMsg.textContent = m || "";
  }

  if (wsInput) wsInput.value = workspaceId;
  if (wsBadge) wsBadge.textContent = `Workspace: ${workspaceId || "—"}`;

  function refreshUsersDropdown() {
    if (!userSelect) return;
    userSelect.innerHTML = "";
    const users = (db.users || []).filter(u => u.active !== false);

    if (!users.length) {
      const o = document.createElement("option");
      o.textContent = "— Sem utilizadores —";
      o.value = "";
      userSelect.appendChild(o);
      return;
    }

    users.forEach(u => {
      const o = document.createElement("option");
      o.value = u.id;
      o.textContent = `${u.name} (${u.role})`;
      userSelect.appendChild(o);
    });
  }

  function showAuth() {
    if (screenAuth) screenAuth.style.display = "grid";
    if (screenMain) screenMain.style.display = "none";
    refreshUsersDropdown();
  }

  function showMain() {
    if (screenAuth) screenAuth.style.display = "none";
    if (screenMain) screenMain.style.display = "grid";
    if (wsBadge) wsBadge.textContent = `Workspace: ${workspaceId || "—"}`;
  }

  // Workspace
  if (wsInput) {
    wsInput.addEventListener("change", () => {
      workspaceId = (wsInput.value || "").trim();
      localStorage.setItem(WS_KEY, workspaceId);
      if (wsBadge) wsBadge.textContent = `Workspace: ${workspaceId || "—"}`;
    });
  }

  // Criar primeiro Admin + conta Caixa
  if (btnCreateFirstAdmin) {
    btnCreateFirstAdmin.addEventListener("click", () => {
      const ws = (wsInput ? wsInput.value : "").trim();
      if (!ws) return setAuthMsg("Digite o Workspace ID.");
      if ((db.users || []).length) return setAuthMsg("Já existem utilizadores.");

      const admin = {
        id: uid(),
        name: "Admin",
        role: "admin",
        pin: "1234",
        active: true,
        createdAt: nowISO(),
        updatedAt: nowISO() };

      db.users.push(admin);

      db.accounts.push({
        id: uid(),
        active: true,
        name: "Caixa",
        initialBalance: 0,
        balance: 0,
        createdAt: nowISO(),
        updatedAt: nowISO() });


      saveDBTouch();
      refreshUsersDropdown();
      setAuthMsg("Admin criado. PIN: 1234");
      logAction("user.create_first_admin", "user", admin.id, {});
      autoSnapshot("user.create_first_admin");
    });
  }

  // Login / Logout
  if (btnLogin) {
    btnLogin.addEventListener("click", () => {
      const ws = (wsInput ? wsInput.value : "").trim();
      if (!ws) return setAuthMsg("Workspace obrigatório.");

      const userId = userSelect ? userSelect.value : "";
      const pin = (pinInput ? pinInput.value : "").trim();

      const user = (db.users || []).find(u => u.id === userId && u.active !== false);
      if (!user) return setAuthMsg("Utilizador inválido.");
      if (pin !== user.pin) return setAuthMsg("PIN incorreto.");

      workspaceId = ws;
      localStorage.setItem(WS_KEY, ws);

      session = { userId: user.id, role: user.role, loginAt: nowISO() };
      save(SESSION_KEY, session);

      if (pinInput) pinInput.value = "";
      setAuthMsg("");

      showMain();
      initNav();
      openView("pos");

      logAction("auth.login", "user", user.id, { role: user.role });
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      const u = getSessionUser();
      logAction("auth.logout", "user", u ? u.id : "", {});
      session = null;
      save(SESSION_KEY, null);
      showAuth();
    });
  }

  /* =======================
     Navigation
  ======================= */
  function openView(viewKey) {
    const views = document.querySelectorAll(".view");
    for (let i = 0; i < views.length; i++) views[i].style.display = "none";

    const target = el(`view-${viewKey}`);
    if (target) target.style.display = "block";

    try {
      if (viewKey === "pos") renderPOS();
      if (viewKey === "products") renderProducts();
      if (viewKey === "clients") renderClients();
      if (viewKey === "accounts") {
        renderAccounts();
        renderLedger();
      }
      if (viewKey === "purchases") {
        resetPurchaseForm();
        renderPurchases();
      }
      if (viewKey === "stock") renderStockView();
      if (viewKey === "audit") renderAudit();
      if (viewKey === "settings") renderSettings();

    } catch (e) {
      console.error(e);
      alert(e.message || e);
    }
  }

  function initNav() {
    const navs = document.querySelectorAll(".nav");
    for (let i = 0; i < navs.length; i++) {
      navs[i].onclick = () => {
        for (let j = 0; j < navs.length; j++) navs[j].classList.remove("active");
        navs[i].classList.add("active");
        openView(navs[i].dataset.view);
      };
    }
    // ===== Mobile bottom nav =====
    const mnav = document.getElementById("mnav");
    if (mnav) {
      const btns = mnav.querySelectorAll(".mnav-btn[data-view]");
      btns.forEach(b => {
        b.onclick = () => {
          btns.forEach(x => x.classList.remove("active"));
          b.classList.add("active");
          openView(b.dataset.view);
        };
      });
    }

    // ===== Sheet “Mais” =====
    const btnMore = document.getElementById("btnMore");
    const moreSheet = document.getElementById("moreSheet");
    const btnCloseMore = document.getElementById("btnCloseMore");

    if (btnMore && moreSheet) btnMore.onclick = () => moreSheet.style.display = "block";
    if (btnCloseMore && moreSheet) btnCloseMore.onclick = () => moreSheet.style.display = "none";

    if (moreSheet) {
      moreSheet.addEventListener("click", e => {
        if (e.target === moreSheet) moreSheet.style.display = "none";
      });

      moreSheet.querySelectorAll(".sheet-item[data-view]").forEach(b => {
        b.onclick = () => {
          moreSheet.style.display = "none";
          openView(b.dataset.view);
        };
      });
    }

  }

  /* =======================
     Ledger + Accounts
  ======================= */
  const btnNewAccount = el("btnNewAccount");
  const btnRefreshLedger = el("btnRefreshLedger");

  const accFormTitle = el("accFormTitle");
  const accName = el("accName");
  const accBalance = el("accBalance");
  const btnSaveAccount = el("btnSaveAccount");
  const btnCancelAccEdit = el("btnCancelAccEdit");
  const accMsg = el("accMsg");
  const accTable = el("accTable");
  const accCount = el("accCount");

  const ledgerTable = el("ledgerTable");
  const ledgerCount = el("ledgerCount");
  const ledgFrom = el("ledgFrom");
  const ledgTo = el("ledgTo");
  const ledgAccountFilter = el("ledgAccountFilter");
  const ledgTypeFilter = el("ledgTypeFilter");
  const btnApplyLedgerFilters = el("btnApplyLedgerFilters");

  let editingAccId = null;

  function setAccMsg(m) {
    if (accMsg) accMsg.textContent = m || "";
  }

  function resetAccForm() {
    editingAccId = null;
    if (accFormTitle) accFormTitle.textContent = "Nova Conta";
    if (accName) accName.value = "";
    if (accBalance) accBalance.value = "";
    if (btnCancelAccEdit) btnCancelAccEdit.style.display = "none";
    setAccMsg("");
  }

  function recalcAccountBalancesFromLedger() {
    const accs = db.accounts || [];
    accs.forEach(a => {
      if (a.active === false) return;
      if (a.initialBalance == null) a.initialBalance = Number(a.balance || 0);
      a.balance = Number(a.initialBalance || 0);
    });

    (db.ledger || []).forEach(m => {
      const acc = accs.find(a => a.id === m.accountId && a.active !== false);
      if (!acc) return;
      const amt = Number(m.amount || 0);
      if (m.type === "in") acc.balance += amt;
      if (m.type === "out") acc.balance -= amt;
    });

    saveDBTouch();
  }

  function addLedger(opts) {
    const entry = {
      id: uid(),
      date: opts.date || todayISO(),
      type: opts.type, // "in" | "out"
      accountId: opts.accountId,
      amount: Number(opts.amount || 0),
      refType: opts.refType || "",
      refId: opts.refId || "",
      note: opts.note || "",
      createdAt: nowISO(),
      updatedAt: nowISO() };


    db.ledger.push(entry);
    saveDBTouch();
    recalcAccountBalancesFromLedger();
    return entry;
  }

  function fillLedgerAccountFilter() {
    if (!ledgAccountFilter) return;
    ledgAccountFilter.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "Todas as contas";
    ledgAccountFilter.appendChild(o0);

    (db.accounts || []).
    filter(a => a.active !== false).
    forEach(a => {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.name;
      ledgAccountFilter.appendChild(o);
    });
  }

  function renderAccounts() {
    if (!accTable) return;

    if (!db.accounts.some(a => a.active !== false)) {
      db.accounts.push({
        id: uid(),
        active: true,
        name: "Caixa",
        initialBalance: 0,
        balance: 0,
        createdAt: nowISO(),
        updatedAt: nowISO() });

      saveDBTouch();
    }

    recalcAccountBalancesFromLedger();
    fillLedgerAccountFilter();
    fillPosAccounts();
    fillPurchaseAccounts();
    fillSalesAccountFilter();

    const list = db.accounts.
    filter(a => a.active !== false).
    sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    accTable.innerHTML = "";

    list.forEach(a => {
      const row = document.createElement("div");
      row.className = "rowitem";
      row.innerHTML = `
        <div>
          <div><b>${a.name}</b></div>
          <div class="muted">Saldo: <span class="mono">${MT(a.balance || 0)}</span></div>
        </div>
        <div class="muted">Inicial: ${MT(a.initialBalance || 0)}</div>
        <div class="muted">—</div>
        <div><span class="badge">Ativa</span></div>
        <div class="actions">
          <button class="btn iconbtn" data-act="edit">Editar</button>
          <button class="btn danger iconbtn" data-act="del">Apagar</button>
        </div>
      `;

      row.querySelector('[data-act="edit"]').onclick = () => {var _ref, _a$initialBalance;
        if (!canManage()) return alert("Sem permissão.");
        editingAccId = a.id;
        if (accFormTitle) accFormTitle.textContent = "Editar Conta";
        if (accName) accName.value = a.name || "";
        if (accBalance) accBalance.value = String((_ref = (_a$initialBalance = a.initialBalance) !== null && _a$initialBalance !== void 0 ? _a$initialBalance : a.balance) !== null && _ref !== void 0 ? _ref : 0);
        if (btnCancelAccEdit) btnCancelAccEdit.style.display = "block";
        setAccMsg("");
      };

      row.querySelector('[data-act="del"]').onclick = () => {
        if (!canManage()) return alert("Sem permissão.");
        if (!confirm("Apagar conta? (será desativada)")) return;
        a.active = false;
        a.updatedAt = nowISO();
        saveDBTouch();
        if (editingAccId === a.id) resetAccForm();
        renderAccounts();
        renderLedger();
        logAction("account.deactivate", "account", a.id, { name: a.name });
        autoSnapshot("account.deactivate");
      };

      accTable.appendChild(row);
    });

    if (accCount) accCount.textContent = `${list.length} conta(s)`;
  }

  if (btnNewAccount) btnNewAccount.onclick = () => {
    if (!canManage()) return alert("Sem permissão.");
    resetAccForm();
  };
  if (btnCancelAccEdit) btnCancelAccEdit.onclick = resetAccForm;

  if (btnSaveAccount) {
    btnSaveAccount.onclick = () => {
      if (!canManage()) return alert("Sem permissão.");

      const name = (accName ? accName.value : "").trim();
      if (!name) return setAccMsg("Nome da conta é obrigatório.");

      const initial = nnum(accBalance ? accBalance.value : "", 0);
      if (!Number.isFinite(initial)) return setAccMsg("Saldo inválido.");

      if (!editingAccId) {
        const a = {
          id: uid(),
          active: true,
          name,
          initialBalance: initial,
          balance: initial,
          createdAt: nowISO(),
          updatedAt: nowISO() };

        db.accounts.push(a);
        logAction("account.create", "account", a.id, { name: a.name });
        autoSnapshot("account.create");
      } else {
        const a = db.accounts.find(x => x.id === editingAccId);
        if (!a) return setAccMsg("Conta não encontrada.");
        a.name = name;
        a.initialBalance = initial;
        a.updatedAt = nowISO();
        logAction("account.update", "account", a.id, { name: a.name });
        autoSnapshot("account.update");
      }

      saveDBTouch();
      resetAccForm();
      renderAccounts();
      renderLedger();
    };
  }

  function renderLedger() {
    if (!ledgerTable) return;

    fillLedgerAccountFilter();

    const from = ledgFrom ? ledgFrom.value : "";
    const to = ledgTo ? ledgTo.value : "";
    const accId = ledgAccountFilter ? ledgAccountFilter.value : "";
    const type = ledgTypeFilter ? ledgTypeFilter.value : "";

    const rows = db.ledger.
    filter(m => !from || m.date >= from).
    filter(m => !to || m.date <= to).
    filter(m => !accId || m.accountId === accId).
    filter(m => !type || m.type === type).
    sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    ledgerTable.innerHTML = "";

    rows.forEach(m => {
      const acc = (db.accounts || []).find(a => a.id === m.accountId) || { name: "—" };
      const row = document.createElement("div");
      row.className = "rowitem ledger";
      row.innerHTML = `
        <div>
          <div><b>${m.date || "—"}</b> <span class="badge">${m.type === "in" ? "Entrada" : "Saída"}</span></div>
          <div class="muted">${m.note || ""}</div>
        </div>
        <div class="mono">${MT(m.amount || 0)}</div>
        <div class="muted">${acc.name}</div>
        <div class="muted">${m.refType ? `${m.refType}#${String(m.refId || "").slice(0, 6)}` : "—"}</div>
      `;
      ledgerTable.appendChild(row);
    });

    if (ledgerCount) ledgerCount.textContent = `${rows.length} movimento(s)`;
  }

  if (btnApplyLedgerFilters) btnApplyLedgerFilters.onclick = renderLedger;
  if (btnRefreshLedger) btnRefreshLedger.onclick = () => {renderAccounts();renderLedger();};

  /* =======================
     Products (CRUD + Stock Base)
  ======================= */
  let editingProductId = null;

  const prodSearch = el("prodSearch");
  const btnNewProduct = el("btnNewProduct");
  const prodTable = el("prodTable");
  const prodCount = el("prodCount");

  const prodFormTitle = el("prodFormTitle");
  const prodName = el("prodName");
  const prodPrice = el("prodPrice");
  const prodCost = el("prodCost");
  const prodStock = el("prodStock");
  const prodStockMin = el("prodStockMin");
  const prodDesc = el("prodDesc");

  const prodStockBase = el("prodStockBase");
  const prodStockFactor = el("prodStockFactor");

  const btnSaveProduct = el("btnSaveProduct");
  const btnCancelEdit = el("btnCancelEdit");
  const prodMsg = el("prodMsg");

  function setProdMsg(m) {if (prodMsg) prodMsg.textContent = m || "";}

  function fillStockBaseOptions() {
    if (!prodStockBase) return;
    prodStockBase.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— Nenhum —";
    prodStockBase.appendChild(opt0);

    (db.products || []).
    filter(p => p.active !== false).
    forEach(p => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      prodStockBase.appendChild(o);
    });
  }

  function resetProductForm() {
    editingProductId = null;
    if (prodFormTitle) prodFormTitle.textContent = "Novo Produto";
    if (prodName) prodName.value = "";
    if (prodPrice) prodPrice.value = "";
    if (prodCost) prodCost.value = "";
    if (prodStock) prodStock.value = "";
    if (prodStockMin) prodStockMin.value = "";
    if (prodDesc) prodDesc.value = "";
    if (prodStockBase) prodStockBase.value = "";
    if (prodStockFactor) prodStockFactor.value = "";
    if (btnCancelEdit) btnCancelEdit.style.display = "none";
    setProdMsg("");
  }

  function loadProductToForm(p) {var _p$price, _p$cost, _p$stock, _p$stockMin, _p$stockFactor;
    editingProductId = p.id;
    if (prodFormTitle) prodFormTitle.textContent = "Editar Produto";
    if (prodName) prodName.value = p.name || "";
    if (prodPrice) prodPrice.value = String((_p$price = p.price) !== null && _p$price !== void 0 ? _p$price : "");
    if (prodCost) prodCost.value = String((_p$cost = p.cost) !== null && _p$cost !== void 0 ? _p$cost : "");
    if (prodStock) prodStock.value = String((_p$stock = p.stock) !== null && _p$stock !== void 0 ? _p$stock : 0);
    if (prodStockMin) prodStockMin.value = String((_p$stockMin = p.stockMin) !== null && _p$stockMin !== void 0 ? _p$stockMin : 0);
    if (prodDesc) prodDesc.value = p.desc || "";
    if (prodStockBase) prodStockBase.value = p.stockBaseId || "";
    if (prodStockFactor) prodStockFactor.value = String((_p$stockFactor = p.stockFactor) !== null && _p$stockFactor !== void 0 ? _p$stockFactor : "");
    if (btnCancelEdit) btnCancelEdit.style.display = "block";
    setProdMsg("");
  }

  function renderProducts() {
    if (!prodTable) return;

    fillStockBaseOptions();

    const q = (prodSearch ? prodSearch.value : "").toLowerCase().trim();
    const list = (db.products || []).
    filter(p => p.active !== false).
    filter(p => !q || (p.name || "").toLowerCase().includes(q)).
    sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    prodTable.innerHTML = "";

    list.forEach(p => {
      const base = p.stockBaseId ? (db.products || []).find(x => x.id === p.stockBaseId) : null;
      const low = Number(p.stock || 0) <= Number(p.stockMin || 0) && !p.stockBaseId;

      const row = document.createElement("div");
      row.className = "rowitem";
      row.innerHTML = `
        <div>
          <div><b>${p.name || "-"}</b> ${low ? `<span class="badge low" style="margin-left:6px">Baixo stock</span>` : ""}</div>
          <div class="muted">
            ${base ? `Consome: <span class="badge">${base.name}</span> × <b>${p.stockFactor || 0}</b>` : "Stock próprio"}
          </div>
        </div>
        <div>${MT(p.price || 0)}</div>
        <div class="muted">${MT(p.cost || 0)}</div>
        <div><span class="badge">Stock: <b>${Number(p.stock || 0)}</b></span></div>
        <div class="actions">
          <button class="btn iconbtn" data-act="edit">Editar</button>
          <button class="btn danger iconbtn" data-act="del">Apagar</button>
        </div>
      `;

      row.querySelector('[data-act="edit"]').onclick = () => {
        if (!canManage()) return alert("Sem permissão.");
        fillStockBaseOptions();
        loadProductToForm(p);
      };

      row.querySelector('[data-act="del"]').onclick = () => {
        if (!canManage()) return alert("Sem permissão.");
        if (!confirm("Apagar produto? (ele será desativado)")) return;
        p.active = false;
        p.updatedAt = nowISO();
        saveDBTouch();
        if (editingProductId === p.id) resetProductForm();
        renderProducts();
        renderPOS();
        logAction("product.deactivate", "product", p.id, { name: p.name });
        autoSnapshot("product.deactivate");
      };

      prodTable.appendChild(row);
    });

    if (prodCount) prodCount.textContent = `${list.length} produto(s)`;
  }

  if (btnNewProduct) btnNewProduct.onclick = () => {
    if (!canManage()) return alert("Sem permissão.");
    resetProductForm();
  };
  if (btnCancelEdit) btnCancelEdit.onclick = resetProductForm;
  if (prodSearch) prodSearch.oninput = renderProducts;

  if (btnSaveProduct) {
    btnSaveProduct.onclick = () => {
      if (!canManage()) return alert("Sem permissão.");

      const name = (prodName ? prodName.value : "").trim();
      if (!name) return setProdMsg("Nome é obrigatório.");

      const price = nnum(prodPrice ? prodPrice.value : "", 0);
      const cost = nnum(prodCost ? prodCost.value : "", 0);
      const stock = Math.max(0, Math.floor(nnum(prodStock ? prodStock.value : "", 0)));
      const stockMin = Math.max(0, Math.floor(nnum(prodStockMin ? prodStockMin.value : "", 0)));
      const desc = (prodDesc ? prodDesc.value : "").trim();

      const stockBaseId = (prodStockBase ? prodStockBase.value : "").trim();
      const stockFactor = nnum(prodStockFactor ? prodStockFactor.value : "", 0);

      if (stockBaseId && (!stockFactor || stockFactor <= 0)) {
        return setProdMsg("Se escolher Stock Base, o Fator deve ser > 0.");
      }
      if (stockBaseId && editingProductId === stockBaseId) {
        return setProdMsg("Um produto não pode consumir stock de si mesmo.");
      }

      if (!editingProductId) {
        const p = {
          id: uid(),
          active: true,
          name,
          price,
          cost,
          stock,
          stockMin,
          desc,
          stockBaseId: stockBaseId || "",
          stockFactor: stockBaseId ? stockFactor : 0,
          createdAt: nowISO(),
          updatedAt: nowISO() };

        db.products.push(p);
        logAction("product.create", "product", p.id, { name: p.name });
        autoSnapshot("product.create");
      } else {
        const p = db.products.find(x => x.id === editingProductId);
        if (!p) return setProdMsg("Produto não encontrado.");
        p.name = name;
        p.price = price;
        p.cost = cost;
        p.stock = stock;
        p.stockMin = stockMin;
        p.desc = desc;
        p.stockBaseId = stockBaseId || "";
        p.stockFactor = stockBaseId ? stockFactor : 0;
        p.updatedAt = nowISO();
        logAction("product.update", "product", p.id, { name: p.name });
        autoSnapshot("product.update");
      }

      saveDBTouch();
      setProdMsg("Guardado ✅");
      resetProductForm();
      renderProducts();
      renderPOS();
      fillInvProducts();
    };
  }

  /* =======================
     Clients (CRUD + histórico)
  ======================= */
  let editingClientId = null;
  let selectedClientId = null;

  const cliSearch = el("cliSearch");
  const btnNewClient = el("btnNewClient");
  const cliTable = el("cliTable");
  const cliCount = el("cliCount");

  const cliFormTitle = el("cliFormTitle");
  const cliName = el("cliName");
  const cliPhone = el("cliPhone");
  const cliNotes = el("cliNotes");

  const btnSaveClient = el("btnSaveClient");
  const btnCancelClientEdit = el("btnCancelClientEdit");
  const cliMsg = el("cliMsg");

  const cliHistory = el("cliHistory");
  const cliHistoryHint = el("cliHistoryHint");

  function setCliMsg(m) {if (cliMsg) cliMsg.textContent = m || "";}

  function resetClientForm() {
    editingClientId = null;
    if (cliFormTitle) cliFormTitle.textContent = "Novo Cliente";
    if (cliName) cliName.value = "";
    if (cliPhone) cliPhone.value = "";
    if (cliNotes) cliNotes.value = "";
    if (btnCancelClientEdit) btnCancelClientEdit.style.display = "none";
    setCliMsg("");
  }

  function loadClientToForm(c) {
    editingClientId = c.id;
    if (cliFormTitle) cliFormTitle.textContent = "Editar Cliente";
    if (cliName) cliName.value = c.name || "";
    if (cliPhone) cliPhone.value = c.phone || "";
    if (cliNotes) cliNotes.value = c.notes || "";
    if (btnCancelClientEdit) btnCancelClientEdit.style.display = "block";
    setCliMsg("");
  }

  function renderClientHistory(clientId) {
    if (!cliHistory) return;
    cliHistory.innerHTML = "";
    if (!clientId) {
      if (cliHistoryHint) cliHistoryHint.style.display = "block";
      return;
    }
    if (cliHistoryHint) cliHistoryHint.style.display = "none";

    const sales = (db.sales || []).
    filter(s => s.clientId === clientId).
    sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    if (!sales.length) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Sem vendas para este cliente.";
      cliHistory.appendChild(d);
      return;
    }

    sales.forEach(s => {
      const row = document.createElement("div");
      row.className = "rowitem small";
      const date = s.date || (s.createdAt || "").slice(0, 10) || "—";
      row.innerHTML = `
        <div>
          <b>${date}</b>
          <div class="muted">${(s.items || []).length} item(s) • ${s.status === "cancelled" ? "CANCELADA" : "OK"}</div>
        </div>
        <div>${MT(s.total || 0)}</div>
        <div class="actions">
          <button class="btn iconbtn" data-act="view">Ver</button>
          ${s.status !== "cancelled" ? `<button class="btn danger iconbtn" data-act="cancel">Cancelar</button>` : ""}
        </div>
      `;

      row.querySelector('[data-act="view"]').onclick = () => showSaleAlert(s);

      const btnCancel = row.querySelector('[data-act="cancel"]');
      if (btnCancel) {
        btnCancel.onclick = () => {
          if (!canManage()) return alert("Sem permissão.");
          const reason = prompt("Motivo do cancelamento?") || "";
          if (!confirm("Confirmar cancelamento desta venda?")) return;
          cancelSale(s.id, reason);
          renderClientHistory(clientId);
        };
      }

      cliHistory.appendChild(row);
    });
  }

  function renderClients() {
    if (!cliTable) return;

    const q = (cliSearch ? cliSearch.value : "").toLowerCase().trim();
    const list = (db.clients || []).
    filter(c => c.active !== false).
    filter(
    (c) =>
    !q ||
    (c.name || "").toLowerCase().includes(q) ||
    (c.phone || "").toLowerCase().includes(q)).

    sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    cliTable.innerHTML = "";

    list.forEach(c => {
      const row = document.createElement("div");
      row.className = "rowitem";
      row.innerHTML = `
        <div>
          <div><b>${c.name || "-"}</b></div>
          <div class="muted">${c.phone || "—"}</div>
        </div>
        <div class="muted">${c.notes ? c.notes.slice(0, 22) + (c.notes.length > 22 ? "…" : "") : "—"}</div>
        <div class="muted">Vendas</div>
        <div><span class="badge">Selecionar</span></div>
        <div class="actions">
          <button class="btn iconbtn" data-act="edit">Editar</button>
          <button class="btn danger iconbtn" data-act="del">Apagar</button>
        </div>
      `;

      row.querySelector(".badge").onclick = () => {
        selectedClientId = c.id;
        renderClientHistory(selectedClientId);
      };

      row.querySelector('[data-act="edit"]').onclick = () => {
        if (!canManage()) return alert("Sem permissão.");
        loadClientToForm(c);
      };

      row.querySelector('[data-act="del"]').onclick = () => {
        if (!canManage()) return alert("Sem permissão.");
        if (!confirm("Apagar cliente? (será desativado)")) return;
        c.active = false;
        c.updatedAt = nowISO();
        saveDBTouch();
        if (editingClientId === c.id) resetClientForm();
        if (selectedClientId === c.id) {
          selectedClientId = null;
          renderClientHistory(null);
        }
        renderClients();
        logAction("client.deactivate", "client", c.id, { name: c.name });
        autoSnapshot("client.deactivate");
      };

      cliTable.appendChild(row);
    });

    if (cliCount) cliCount.textContent = `${list.length} cliente(s)`;
  }

  if (btnNewClient) btnNewClient.onclick = () => {
    if (!canManage()) return alert("Sem permissão.");
    resetClientForm();
  };
  if (btnCancelClientEdit) btnCancelClientEdit.onclick = resetClientForm;
  if (cliSearch) cliSearch.oninput = renderClients;

  if (btnSaveClient) {
    btnSaveClient.onclick = () => {
      if (!canManage()) return alert("Sem permissão.");

      const name = (cliName ? cliName.value : "").trim();
      if (!name) return setCliMsg("Nome é obrigatório.");

      const phone = (cliPhone ? cliPhone.value : "").trim();
      const notes = (cliNotes ? cliNotes.value : "").trim();

      if (!editingClientId) {
        const c = {
          id: uid(),
          active: true,
          name,
          phone,
          notes,
          createdAt: nowISO(),
          updatedAt: nowISO() };

        db.clients.push(c);
        logAction("client.create", "client", c.id, { name: c.name });
        autoSnapshot("client.create");
      } else {
        const c = db.clients.find(x => x.id === editingClientId);
        if (!c) return setCliMsg("Cliente não encontrado.");
        c.name = name;
        c.phone = phone;
        c.notes = notes;
        c.updatedAt = nowISO();
        logAction("client.update", "client", c.id, { name: c.name });
        autoSnapshot("client.update");
      }

      saveDBTouch();
      setCliMsg("Guardado ✅");
      resetClientForm();
      renderClients();
      fillPosClients();
      fillSalesClientFilter();
    };
  }

  /* =======================
     Purchases (Stock IN + Ledger OUT)
  ======================= */
  const purSupplier = el("purSupplier");
  const purDate = el("purDate");
  const purAccount = el("purAccount");
  const purItems = el("purItems");
  const purTotal = el("purTotal");
  const purMsg = el("purMsg");

  const btnAddPurItem = el("btnAddPurItem");
  const btnSavePurchase = el("btnSavePurchase");

  const purFrom = el("purFrom");
  const purTo = el("purTo");
  const btnFilterPurchases = el("btnFilterPurchases");
  const purTable = el("purTable");
  const purCount = el("purCount");

  let purchaseDraftItems = [];

  function setPurMsg(m) {if (purMsg) purMsg.textContent = m || "";}

  function fillPurchaseAccounts() {
    if (!purAccount) return;
    purAccount.innerHTML = "";
    (db.accounts || []).
    filter(a => a.active !== false).
    forEach(a => {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = `${a.name} (${MT(a.balance || 0)})`;
      purAccount.appendChild(o);
    });
  }

  function fillProductOptions(selectEl) {
    selectEl.innerHTML = "";
    (db.products || []).
    filter(p => p.active !== false).
    sort((a, b) => (a.name || "").localeCompare(b.name || "")).
    forEach(p => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      selectEl.appendChild(o);
    });
  }

  function calcPurchaseTotal() {
    const total = purchaseDraftItems.reduce(
    (s, it) => s + Number(it.qty || 0) * Number(it.unitCost || 0),
    0);

    if (purTotal) purTotal.textContent = MT(total);
    return total;
  }

  function renderPurchaseItems() {
    if (!purItems) return;
    purItems.innerHTML = "";

    purchaseDraftItems.forEach((it, idx) => {var _it$qty, _it$unitCost;
      const row = document.createElement("div");
      row.className = "rowitem";
      row.innerHTML = `
        <div>
          <div><b>Produto</b></div>
          <select class="input" data-k="prod"></select>
        </div>
        <div>
          <div class="muted">Qtd</div>
          <input class="input" data-k="qty" inputmode="numeric" />
        </div>
        <div>
          <div class="muted">Custo unit (MT)</div>
          <input class="input" data-k="cost" inputmode="decimal" />
        </div>
        <div class="muted">Subtotal: <span class="mono" data-k="sub"></span></div>
        <div class="actions">
          <button class="btn danger iconbtn" data-k="rm">X</button>
        </div>
      `;

      const sel = row.querySelector('select[data-k="prod"]');
      const inpQty = row.querySelector('input[data-k="qty"]');
      const inpCost = row.querySelector('input[data-k="cost"]');
      const sub = row.querySelector('span[data-k="sub"]');

      fillProductOptions(sel);
      sel.value = it.productId;

      inpQty.value = String((_it$qty = it.qty) !== null && _it$qty !== void 0 ? _it$qty : 1);
      inpCost.value = String((_it$unitCost = it.unitCost) !== null && _it$unitCost !== void 0 ? _it$unitCost : 0);

      const update = () => {
        it.productId = sel.value;
        it.qty = Math.max(1, Math.floor(Number(inpQty.value || 1)));
        it.unitCost = nnum(inpCost.value, 0);
        const st = Number(it.qty || 0) * Number(it.unitCost || 0);
        sub.textContent = MT(st);
        calcPurchaseTotal();
      };

      sel.onchange = update;
      inpQty.oninput = update;
      inpCost.oninput = update;

      row.querySelector('button[data-k="rm"]').onclick = () => {
        purchaseDraftItems.splice(idx, 1);
        renderPurchaseItems();
      };

      update();
      purItems.appendChild(row);
    });

    calcPurchaseTotal();
  }

  function resetPurchaseForm() {
    if (purSupplier) purSupplier.value = "";
    if (purDate) purDate.value = todayISO();
    purchaseDraftItems = [];
    setPurMsg("");
    fillPurchaseAccounts();
    renderPurchaseItems();
  }

  if (btnAddPurItem) {
    btnAddPurItem.onclick = () => {
      if (!canManage()) return alert("Sem permissão.");
      if (!(db.products || []).some(p => p.active !== false)) return setPurMsg("Crie produtos primeiro.");
      const first = (db.products || []).find(p => p.active !== false);
      purchaseDraftItems.push({ productId: first ? first.id : "", qty: 1, unitCost: 0 });
      renderPurchaseItems();
    };
  }

  if (btnSavePurchase) {
    btnSavePurchase.onclick = () => {
      try {
        if (!canManage()) return alert("Sem permissão.");

        const supplier = (purSupplier ? purSupplier.value : "").trim();
        if (!supplier) return setPurMsg("Fornecedor é obrigatório.");

        const date = purDate ? purDate.value || todayISO() : todayISO();
        const accountId = purAccount ? purAccount.value : "";
        if (!accountId) return setPurMsg("Selecione uma conta.");

        if (!purchaseDraftItems.length) return setPurMsg("Adicione pelo menos 1 item.");

        for (let i = 0; i < purchaseDraftItems.length; i++) {
          const it = purchaseDraftItems[i];
          const p = (db.products || []).find(x => x.id === it.productId && x.active !== false);
          if (!p) throw new Error("Produto inválido na compra.");
          if (Number(it.qty || 0) <= 0) throw new Error("Quantidade inválida.");
          if (!Number.isFinite(Number(it.unitCost || 0)) || Number(it.unitCost || 0) < 0)
          throw new Error("Custo unit inválido.");
        }

        const total = calcPurchaseTotal();

        purchaseDraftItems.forEach(it => {
          const p = (db.products || []).find(x => x.id === it.productId);
          p.stock = Number(p.stock || 0) + Number(it.qty || 0);
          p.cost = Number(it.unitCost || p.cost || 0);
          p.updatedAt = nowISO();
        });

        const purchase = {
          id: uid(),
          supplier,
          date,
          accountId,
          total,
          items: purchaseDraftItems.map(it => ({
            productId: it.productId,
            qty: Number(it.qty || 0),
            unitCost: Number(it.unitCost || 0) })),

          createdAt: nowISO(),
          updatedAt: nowISO() };

        db.purchases.push(purchase);

        saveDBTouch();

        addLedger({
          date,
          type: "out",
          accountId,
          amount: total,
          refType: "purchase",
          refId: purchase.id,
          note: `Compra ${supplier}` });


        logAction("purchase.create", "purchase", purchase.id, { total, supplier });
        autoSnapshot("purchase.create");

        setPurMsg("Compra guardada ✅");
        resetPurchaseForm();
        renderProducts();
        renderAccounts();
        renderLedger();
        renderPurchases();
        renderPOS();
        fillInvProducts();
      } catch (e) {
        alert(e.message || e);
      }
    };
  }

  function renderPurchases() {
    if (!purTable) return;

    const from = purFrom ? purFrom.value : "";
    const to = purTo ? purTo.value : "";

    const rows = (db.purchases || []).
    filter(p => !from || p.date >= from).
    filter(p => !to || p.date <= to).
    sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    purTable.innerHTML = "";

    rows.forEach(p => {
      const row = document.createElement("div");
      row.className = "rowitem small";
      row.innerHTML = `
        <div>
          <div><b>${p.date}</b></div>
          <div class="muted">${p.supplier} • ${(p.items || []).length} item(s)</div>
        </div>
        <div class="mono">${MT(p.total || 0)}</div>
        <div class="actions"><button class="btn iconbtn">Ver</button></div>
      `;
      row.querySelector("button").onclick = () => {
        const lines = (p.items || []).
        map(it => {
          const pr = (db.products || []).find(x => x.id === it.productId) || { name: "—" };
          return `${it.qty}x ${pr.name} @ ${MT(it.unitCost)}`;
        }).
        join("\n");
        alert(`Compra ${p.id}\nFornecedor: ${p.supplier}\nData: ${p.date}\nTotal: ${MT(p.total)}\n\n${lines}`);
      };
      purTable.appendChild(row);
    });

    if (purCount) purCount.textContent = `${rows.length} compra(s)`;
  }

  if (btnFilterPurchases) btnFilterPurchases.onclick = renderPurchases;

  /* =======================
     POS (Sales + stock base)
  ======================= */
  const posSearch = el("posSearch");
  const posCatalog = el("posCatalog");
  const posCart = el("posCart");
  const posTotal = el("posTotal");
  const btnCheckout = el("btnCheckout");
  // Mobile cart UI
  const mcartbar = el("mcartbar");
  const mcartTotal = el("mcartTotal");
  const btnOpenCart = el("btnOpenCart");
  const btnCheckoutMobile = el("btnCheckoutMobile");
  const posCartCard = el("posCartCard");


  const posClient = el("posClient");
  const posAccount = el("posAccount");
  const posMsg = el("posMsg");
  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  }

  function setCartDrawer(open) {
    if (!posCartCard) return;
    if (open) posCartCard.classList.add("open");else
    posCartCard.classList.remove("open");
  }

  if (btnOpenCart) {
    btnOpenCart.onclick = () => {
      // toggle drawer
      if (!posCartCard) return;
      const open = !posCartCard.classList.contains("open");
      setCartDrawer(open);
    };
  }

  // fechar drawer ao clicar fora (opcional e seguro)
  document.addEventListener("click", e => {
    if (!isMobile()) return;
    if (!posCartCard) return;
    if (!posCartCard.classList.contains("open")) return;
    const t = e.target;
    const clickedInside = posCartCard.contains(t) || mcartbar && mcartbar.contains(t);
    if (!clickedInside) setCartDrawer(false);
  });

  // botão finalizar do mobile usa o mesmo checkout
  if (btnCheckoutMobile && btnCheckout) {
    btnCheckoutMobile.onclick = () => btnCheckout.click();
  }


  function setPosMsg(m) {if (posMsg) posMsg.textContent = m || "";}

  let cart = [];

  function fillPosClients() {
    if (!posClient) return;
    posClient.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "— Sem cliente —";
    posClient.appendChild(o0);

    (db.clients || []).
    filter(c => c.active !== false).
    sort((a, b) => (a.name || "").localeCompare(b.name || "")).
    forEach(c => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = `${c.name}${c.phone ? " • " + c.phone : ""}`;
      posClient.appendChild(o);
    });

    fillSalesClientFilter();
  }

  function fillPosAccounts() {
    if (!posAccount) return;
    posAccount.innerHTML = "";
    (db.accounts || []).
    filter(a => a.active !== false).
    sort((a, b) => (a.name || "").localeCompare(b.name || "")).
    forEach(a => {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = `${a.name} (${MT(a.balance || 0)})`;
      posAccount.appendChild(o);
    });

    fillSalesAccountFilter();
  }

  function renderPOS() {
    setPosMsg("");
    fillPosClients();
    renderAccounts(); // garante saldos
    fillPosAccounts();

    if (!posCatalog) return;

    const q = (posSearch ? posSearch.value : "").toLowerCase().trim();
    const list = (db.products || []).
    filter(p => p.active !== false).
    filter(p => !q || (p.name || "").toLowerCase().includes(q)).
    sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    posCatalog.innerHTML = "";

    list.forEach(p => {
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = `${p.name} — ${MT(p.price || 0)}`;
      b.onclick = () => {
        const found = cart.find(x => x.productId === p.id);
        if (found) found.qty += 1;else
        cart.push({ productId: p.id, name: p.name, price: Number(p.price || 0), qty: 1 });
        renderCart();
      };
      posCatalog.appendChild(b);
    });

    renderCart();
  }

  function renderCart() {
    if (!posCart) return;
    posCart.innerHTML = "";

    let total = 0;
    cart.forEach((c, i) => {
      total += Number(c.price || 0) * Number(c.qty || 1);

      const row = document.createElement("div");
      row.className = "row between";
      row.innerHTML = `
        <div class="row gap">
          <span class="badge">${c.qty}x</span>
          <div>${c.name}</div>
        </div>
        <button class="btn danger">X</button>
      `;
      row.querySelector("button").onclick = () => {
        cart.splice(i, 1);
        renderCart();
      };
      posCart.appendChild(row);
    });

    if (posTotal) posTotal.textContent = MT(total);
    // atualiza barra mobile
    if (mcartTotal) mcartTotal.textContent = MT(total);
    if (mcartbar) mcartbar.style.display = isMobile() ? "block" : "none";

  }

  function validateAndApplyStockForSale(enrichedItems) {
    // valida
    enrichedItems.forEach(it => {
      const p = (db.products || []).find(x => x.id === it.productId && x.active !== false);
      if (!p) throw new Error(`Produto inválido: ${it.name}`);

      const qty = Math.max(1, Number(it.qty || 1));

      if (it.stockBaseId) {
        const base = (db.products || []).find(x => x.id === it.stockBaseId && x.active !== false);
        if (!base) throw new Error(`Stock base não encontrado para ${it.name}`);
        const need = qty * Number(it.stockFactor || 0);
        if (need <= 0) throw new Error(`Fator inválido em ${it.name}`);
        if (Number(base.stock || 0) < need) throw new Error(`Stock insuficiente em ${base.name}`);
      } else {
        if (Number(p.stock || 0) < qty) throw new Error(`Stock insuficiente em ${it.name}`);
      }
    });

    // aplica
    enrichedItems.forEach(it => {
      const qty = Math.max(1, Number(it.qty || 1));
      if (it.stockBaseId) {
        applyStockDelta(it.stockBaseId, -(qty * Number(it.stockFactor || 0)));
      } else {
        applyStockDelta(it.productId, -qty);
      }
    });

    saveDBTouch();
  }

  if (posSearch) posSearch.oninput = renderPOS;

  if (btnCheckout) {
    btnCheckout.onclick = () => {
      try {
        if (!cart.length) return setPosMsg("Carrinho vazio.");

        const accountId = (posAccount ? posAccount.value : "").trim();
        if (!accountId) return setPosMsg("Selecione a conta de recebimento.");

        const clientId = (posClient ? posClient.value : "").trim() || "";

        // captura base/factor para estorno perfeito
        const enrichedItems = cart.map(i => {
          const p = (db.products || []).find(x => x.id === i.productId) || {};
          return {
            productId: i.productId,
            name: i.name,
            price: Number(i.price || 0),
            qty: Number(i.qty || 1),
            stockBaseId: p.stockBaseId || "",
            stockFactor: Number(p.stockFactor || 0) };

        });

        validateAndApplyStockForSale(enrichedItems);

        const total = enrichedItems.reduce((s, c) => s + Number(c.price || 0) * Number(c.qty || 1), 0);

        const sale = {
          id: uid(),
          date: todayISO(),
          clientId,
          accountId,
          total,
          items: enrichedItems,
          status: "ok",
          cancelledAt: "",
          cancelReason: "",
          cancelRef: null,
          ledgerId: "",
          createdAt: nowISO(),
          updatedAt: nowISO() };


        db.sales.push(sale);
        saveDBTouch();

        const note = (() => {
          if (!clientId) return "Venda";
          const c = (db.clients || []).find(x => x.id === clientId);
          return c ? `Venda: ${c.name}` : "Venda (cliente)";
        })();

        const led = addLedger({
          date: sale.date,
          type: "in",
          accountId,
          amount: total,
          refType: "sale",
          refId: sale.id,
          note });


        sale.ledgerId = (led === null || led === void 0 ? void 0 : led.id) || "";
        sale.updatedAt = nowISO();
        saveDBTouch();

        logAction("sale.create", "sale", sale.id, { total, clientId, accountId });
        autoSnapshot("sale.create");

        cart = [];
        renderPOS();
        renderProducts();
        renderAccounts();
        renderLedger();
        renderSales();
        fillInvProducts();
        setCartDrawer(false);


        if (selectedClientId) renderClientHistory(selectedClientId);

        setPosMsg("Venda registada ✅");
      } catch (e) {
        alert(e.message || e);
      }
    };
  }

  /* =======================
     Stock view (tabs)
  ======================= */
  const tabStockInv = el("tabStockInv");
  const tabStockSales = el("tabStockSales");
  const panelInv = el("panelInv");
  const panelSales = el("panelSales");

  function showStockTab(which) {
    if (!panelInv || !panelSales) return;
    const invOn = which === "inv";
    panelInv.style.display = invOn ? "block" : "none";
    panelSales.style.display = invOn ? "none" : "block";

    if (tabStockInv) tabStockInv.className = invOn ? "btn" : "btn ghost";
    if (tabStockSales) tabStockSales.className = invOn ? "btn ghost" : "btn";

    if (invOn) renderInventory();else
    renderSales();
  }

  if (tabStockInv) tabStockInv.onclick = () => showStockTab("inv");
  if (tabStockSales) tabStockSales.onclick = () => showStockTab("sales");

  function renderStockView() {
    showStockTab("inv");
  }

  /* =======================
     Inventory UI
  ======================= */
  const invProduct = el("invProduct");
  const invType = el("invType");
  const invQty = el("invQty");
  const invNewStock = el("invNewStock");
  const invNote = el("invNote");
  const btnSaveInv = el("btnSaveInv");
  const invMsg = el("invMsg");

  const invFrom = el("invFrom");
  const invTo = el("invTo");
  const btnInvFilter = el("btnInvFilter");
  const invTable = el("invTable");
  const invCount = el("invCount");

  function setInvMsg(m) {if (invMsg) invMsg.textContent = m || "";}

  function fillInvProducts() {
    if (!invProduct) return;
    invProduct.innerHTML = "";
    (db.products || []).
    filter(p => p.active !== false).
    sort((a, b) => (a.name || "").localeCompare(b.name || "")).
    forEach(p => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = `${p.name} (stock: ${Number(p.stock || 0)})`;
      invProduct.appendChild(o);
    });
  }

  function renderInventory() {
    fillInvProducts();
    renderInventoryHistory();
  }

  function renderInventoryHistory() {
    if (!invTable) return;

    const from = invFrom ? invFrom.value : "";
    const to = invTo ? invTo.value : "";

    const rows = (db.inventory || []).
    filter(r => !from || (r.date || "") >= from).
    filter(r => !to || (r.date || "") <= to).
    sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    invTable.innerHTML = "";

    rows.forEach(r => {
      const p = (db.products || []).find(x => x.id === r.productId) || { name: "—" };
      const row = document.createElement("div");
      row.className = "rowitem small";
      row.innerHTML = `
        <div>
          <div><b>${r.date || (r.createdAt || "").slice(0, 10) || "—"}</b>
            <span class="badge">${r.type === "in" ? "Entrada" : "Saída"}</span>
          </div>
          <div class="muted">${p.name} • ${r.note || ""}</div>
        </div>
        <div class="mono">${Number(r.qty || 0)}</div>
      `;
      invTable.appendChild(row);
    });

    if (invCount) invCount.textContent = `${rows.length} ajuste(s)`;
  }

  if (btnInvFilter) btnInvFilter.onclick = renderInventoryHistory;

  if (btnSaveInv) {
    btnSaveInv.onclick = () => {
      try {
        if (!canManage()) return alert("Sem permissão.");

        const productId = invProduct ? invProduct.value : "";
        if (!productId) return setInvMsg("Selecione um produto.");

        const mode = invType ? invType.value : "in";
        const qty = Math.floor(nnum(invQty ? invQty.value : "", 0));
        const newStock = Math.floor(nnum(invNewStock ? invNewStock.value : "", 0));
        const note = (invNote ? invNote.value : "").trim();

        if ((mode === "in" || mode === "out") && qty <= 0) return setInvMsg("Quantidade deve ser > 0.");
        if (mode === "adjust" && newStock < 0) return setInvMsg("Novo stock inválido.");

        inventoryAdjust({ productId, mode, qty, newStock, note });

        setInvMsg("Ajuste guardado ✅");
        if (invQty) invQty.value = "";
        if (invNewStock) invNewStock.value = "";
        if (invNote) invNote.value = "";

        renderProducts();
        renderPOS();
        renderInventory();
      } catch (e) {
        setInvMsg("Erro: " + (e.message || e));
      }
    };
  }

  /* =======================
     Sales (Histórico + Cancel)
  ======================= */
  const salesFrom = el("salesFrom");
  const salesTo = el("salesTo");
  const salesClientFilter = el("salesClientFilter");
  const salesAccountFilter = el("salesAccountFilter");
  const salesStatusFilter = el("salesStatusFilter");
  const btnApplySalesFilters = el("btnApplySalesFilters");
  const salesTable = el("salesTable");
  const salesCount = el("salesCount");

  function fillSalesClientFilter() {
    if (!salesClientFilter) return;
    salesClientFilter.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "Todos os clientes";
    salesClientFilter.appendChild(o0);

    (db.clients || []).
    filter(c => c.active !== false).
    sort((a, b) => (a.name || "").localeCompare(b.name || "")).
    forEach(c => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      salesClientFilter.appendChild(o);
    });
  }

  function fillSalesAccountFilter() {
    if (!salesAccountFilter) return;
    salesAccountFilter.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "Todas as contas";
    salesAccountFilter.appendChild(o0);

    (db.accounts || []).
    filter(a => a.active !== false).
    sort((a, b) => (a.name || "").localeCompare(b.name || "")).
    forEach(a => {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.name;
      salesAccountFilter.appendChild(o);
    });
  }

  function showSaleAlert(sale) {
    const client = sale.clientId ? (db.clients || []).find(c => c.id === sale.clientId) : null;
    const acc = (db.accounts || []).find(a => a.id === sale.accountId) || null;
    const lines = (sale.items || []).map(it => `${it.qty}x ${it.name} @ ${MT(it.price)}`).join("\n");
    const st = sale.status === "cancelled" ? `CANCELADA (${sale.cancelReason || "—"})` : "OK";
    alert(
    `Venda ${sale.id}\nData: ${sale.date}\nCliente: ${client ? client.name : "—"}\nConta: ${acc ? acc.name : "—"}\nStatus: ${st}\nTotal: ${MT(sale.total || 0)}\n\n${lines}`);

  }

  function revertSaleStock(sale) {
    (sale.items || []).forEach(it => {
      const qty = Math.max(1, Number(it.qty || 1));
      if (it.stockBaseId && Number(it.stockFactor || 0) > 0) {
        const delta = qty * Number(it.stockFactor || 0);
        applyStockDelta(it.stockBaseId, +delta);
        db.inventory.push({
          id: uid(),
          date: todayISO(),
          createdAt: nowISO(),
          type: "in",
          productId: it.stockBaseId,
          qty: delta,
          note: `Estorno venda ${sale.id}`,
          refType: "sale_cancel",
          refId: sale.id });

      } else {
        applyStockDelta(it.productId, +qty);
        db.inventory.push({
          id: uid(),
          date: todayISO(),
          createdAt: nowISO(),
          type: "in",
          productId: it.productId,
          qty: qty,
          note: `Estorno venda ${sale.id}`,
          refType: "sale_cancel",
          refId: sale.id });

      }
    });
    saveDBTouch();
  }

  function cancelSale(saleId, reason) {
    const sale = (db.sales || []).find(s => s.id === saleId);
    if (!sale) return alert("Venda não encontrada.");
    if (sale.status === "cancelled") return alert("Esta venda já foi cancelada.");

    // 1) repor stock + log inventário
    revertSaleStock(sale);

    // 2) ledger inverso (OUT)
    const out = addLedger({
      date: sale.date || todayISO(),
      type: "out",
      accountId: sale.accountId,
      amount: Number(sale.total || 0),
      refType: "sale_cancel",
      refId: sale.id,
      note: `Estorno venda ${sale.id}` });


    // 3) marcar venda
    sale.status = "cancelled";
    sale.cancelReason = (reason || "").trim() || "Sem motivo";
    sale.cancelledAt = nowISO();
    sale.updatedAt = nowISO();
    sale.cancelRef = { ledgerId: (out === null || out === void 0 ? void 0 : out.id) || "" };
    saveDBTouch();

    logAction("sale.cancel", "sale", sale.id, { total: sale.total, reason: sale.cancelReason });
    autoSnapshot("sale.cancel");

    renderProducts();
    renderAccounts();
    renderLedger();
    renderSales();
    if (selectedClientId) renderClientHistory(selectedClientId);
  }

  function renderSales() {
    if (!salesTable) return;

    fillSalesClientFilter();
    fillSalesAccountFilter();

    const from = salesFrom ? salesFrom.value : "";
    const to = salesTo ? salesTo.value : "";
    const clientId = salesClientFilter ? salesClientFilter.value : "";
    const accId = salesAccountFilter ? salesAccountFilter.value : "";
    const st = salesStatusFilter ? salesStatusFilter.value : "";

    const rows = (db.sales || []).
    filter(s => !from || (s.date || "") >= from).
    filter(s => !to || (s.date || "") <= to).
    filter(s => !clientId || s.clientId === clientId).
    filter(s => !accId || s.accountId === accId).
    filter(s => !st || s.status === st).
    sort(
    (a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")));


    salesTable.innerHTML = "";

    rows.forEach(s => {
      const client = s.clientId ? (db.clients || []).find(c => c.id === s.clientId) : null;
      const acc = (db.accounts || []).find(a => a.id === s.accountId) || null;

      const row = document.createElement("div");
      row.className = "rowitem small";
      row.innerHTML = `
        <div>
          <div><b>${s.date || "—"}</b> ${
      s.status === "cancelled" ? `<span class="badge">CANCELADA</span>` : `<span class="badge">OK</span>`
      }</div>
          <div class="muted">${client ? client.name : "—"} • ${acc ? acc.name : "—"} • ${(s.items || []).length} item(s)</div>
        </div>
        <div class="mono">${MT(s.total || 0)}</div>
        <div class="actions">
          <button class="btn iconbtn" data-act="view">Ver</button>
          ${s.status !== "cancelled" ? `<button class="btn danger iconbtn" data-act="cancel">Cancelar</button>` : ""}
        </div>
      `;

      row.querySelector('[data-act="view"]').onclick = () => showSaleAlert(s);

      const bcancel = row.querySelector('[data-act="cancel"]');
      if (bcancel) {
        bcancel.onclick = () => {
          if (!canManage()) return alert("Sem permissão.");
          const reason = prompt("Motivo do cancelamento?") || "";
          if (!confirm("Confirmar cancelamento desta venda?")) return;
          cancelSale(s.id, reason);
        };
      }

      salesTable.appendChild(row);
    });

    if (salesCount) salesCount.textContent = `${rows.length} venda(s)`;
  }

  if (btnApplySalesFilters) btnApplySalesFilters.onclick = renderSales;

  /* =======================
     Supabase snapshots
  ======================= */
  async function sbFetch(url, key, path, options = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: options.headers && options.headers.Prefer ? options.headers.Prefer : "return=representation",
        ...(options.headers || {}) } });


    const t = await res.text();
    const d = t ? JSON.parse(t) : null;
    if (!res.ok) throw new Error(d && d.message ? d.message : String(res.status));
    return d;
  }

  function setOnlineConfig(url, key) {
    db.online = { enabled: true, url, key };
    saveDBTouch();
  }

  async function pushSnapshot(trigger) {var _db$online, _db$settings;
    if (!((_db$online = db.online) !== null && _db$online !== void 0 && _db$online.enabled)) throw new Error("Supabase não está ativo.");
    const url = db.online.url;
    const key = db.online.key;
    if (!url || !key) throw new Error("Config Supabase incompleta.");

    const ws = (workspaceId || "").trim();
    if (!ws) throw new Error("Workspace vazio.");

    const payload = JSON.parse(JSON.stringify(db));

    await sbFetch(url, key, `gf_snapshots`, {
      method: "POST",
      body: JSON.stringify({
        workspace_id: ws,
        created_at: nowISO(),
        trigger: trigger || "manual",
        payload }) });



    const keepN = Number(((_db$settings = db.settings) === null || _db$settings === void 0 ? void 0 : _db$settings.snapshotRetention) || 30);
    if (keepN > 0) {
      const all = await sbFetch(
      url,
      key,
      `gf_snapshots?select=id,created_at&workspace_id=eq.${ws}&order=created_at.desc`);

      if (Array.isArray(all) && all.length > keepN) {
        const toDelete = all.slice(keepN).map(r => r.id).filter(Boolean);
        for (let i = 0; i < toDelete.length; i++) {
          await sbFetch(url, key, `gf_snapshots?id=eq.${toDelete[i]}`, { method: "DELETE" });
        }
      }
    }

    logAction("backup.snapshot", "snapshot", "", { trigger });
  }

  async function pullLatestSnapshot() {var _db$online2;
    if (!((_db$online2 = db.online) !== null && _db$online2 !== void 0 && _db$online2.enabled)) throw new Error("Supabase não está ativo.");
    const url = db.online.url;
    const key = db.online.key;
    if (!url || !key) throw new Error("Config Supabase incompleta.");

    const ws = (workspaceId || "").trim();
    if (!ws) throw new Error("Workspace vazio.");

    const rows = await sbFetch(
    url,
    key,
    `gf_snapshots?select=payload,created_at&workspace_id=eq.${ws}&order=created_at.desc&limit=1`);

    if (!rows || !rows.length) throw new Error("Nenhum backup encontrado.");

    return rows[0];
  }

  function autoSnapshot(trigger) {var _db$settings2, _db$online3;
    if (!((_db$settings2 = db.settings) !== null && _db$settings2 !== void 0 && _db$settings2.autoSnapshots)) return;
    if (!((_db$online3 = db.online) !== null && _db$online3 !== void 0 && _db$online3.enabled)) return;

    debounce("autoSnap", 45000, async () => {
      try {
        await pushSnapshot(trigger || "auto");
      } catch (e) {
        logAction("backup.fail", "", "", { error: String((e === null || e === void 0 ? void 0 : e.message) || e) });
      }
    });
  }

  // Restore (login screen)
  if (btnLoadFromCloud) {
    btnLoadFromCloud.onclick = async () => {
      try {
        const ws = (wsInput ? wsInput.value : "").trim();
        if (!ws) return setCloudMsg("Digite o Workspace.");

        const url = (sbUrlLogin ? sbUrlLogin.value : "").trim();
        const key = (sbKeyLogin ? sbKeyLogin.value : "").trim();
        if (!url || !key) return setCloudMsg("Supabase URL e Key obrigatórios.");

        setOnlineConfig(url, key);
        setCloudMsg("A carregar dados da nuvem...");

        // temporariamente set workspace para puxar
        workspaceId = ws;
        localStorage.setItem(WS_KEY, ws);
        if (wsBadge) wsBadge.textContent = `Workspace: ${workspaceId || "—"}`;

        const latest = await pullLatestSnapshot();

        if (!confirm("Isto vai substituir os dados locais deste dispositivo. Continuar?")) {
          setCloudMsg("Cancelado.");
          return;
        }

        save(DB_KEY, latest.payload);

        db = load(DB_KEY, emptyDB());
        db.inventory = db.inventory || [];
        db.audit = db.audit || [];
        db.settings = db.settings || { autoSnapshots: true, snapshotRetention: 30 };
        db.online = db.online || { enabled: true, url, key };

        refreshUsersDropdown();
        setCloudMsg("Backup restaurado com sucesso.");
        logAction("backup.restore", "snapshot", "", { created_at: latest.created_at });
      } catch (e) {
        setCloudMsg("Erro: " + (e.message || e));
      }
    };
  }

  // Topbar buttons
  if (btnBackup) {
    btnBackup.onclick = async () => {
      try {var _db$online4;
        if (!session) return alert("Faça login primeiro.");
        if (!((_db$online4 = db.online) !== null && _db$online4 !== void 0 && _db$online4.enabled)) return alert("Ative o Supabase em Config.");
        await pushSnapshot("manual_topbar");
        alert("Backup guardado ✅");
      } catch (e) {
        alert("Erro Backup: " + (e.message || e));
      }
    };
  }

  if (btnSync) {
    btnSync.onclick = async () => {
      try {var _db$online5;
        if (!session) return alert("Faça login primeiro.");
        if (!((_db$online5 = db.online) !== null && _db$online5 !== void 0 && _db$online5.enabled)) return alert("Ative o Supabase em Config.");

        if (!confirm("Isto vai substituir a base local por um backup mais recente da nuvem. Continuar?")) return;

        const latest = await pullLatestSnapshot();
        save(DB_KEY, latest.payload);

        db = load(DB_KEY, emptyDB());
        db.inventory = db.inventory || [];
        db.audit = db.audit || [];
        db.settings = db.settings || { autoSnapshots: true, snapshotRetention: 30 };
        db.online = db.online || db.online;

        renderPOS();
        renderProducts();
        renderClients();
        renderAccounts();
        renderLedger();
        renderInventory();
        renderSales();
        renderAudit();
        renderSettings();

        alert("Sync (restore) concluído ✅");
        logAction("sync.restore_latest", "snapshot", "", { created_at: latest.created_at });
      } catch (e) {
        alert("Erro Sync: " + (e.message || e));
      }
    };
  }

  /* =======================
     Settings (Config view)
  ======================= */
  const sbUrl = el("sbUrl");
  const sbKey = el("sbKey");
  const btnSaveOnline = el("btnSaveOnline");
  const btnDisableOnline = el("btnDisableOnline");
  const btnBackupNow = el("btnBackupNow");
  const sbMsg = el("sbMsg");

  const autoSnapshotsToggle = el("autoSnapshotsToggle");
  const snapshotRetention = el("snapshotRetention");
  const btnSaveSettings = el("btnSaveSettings");
  const settingsMsg = el("settingsMsg");

  const btnExportJSON = el("btnExportJSON");
  const fileImportJSON = el("fileImportJSON");
  const btnImportJSON = el("btnImportJSON");
  const jsonMsg = el("jsonMsg");

  function setSbMsg(m) {if (sbMsg) sbMsg.textContent = m || "";}
  function setSettingsMsg(m) {if (settingsMsg) settingsMsg.textContent = m || "";}
  function setJsonMsg(m) {if (jsonMsg) jsonMsg.textContent = m || "";}

  function renderSettings() {var _db$online6, _db$online7, _db$settings3, _db$settings$snapshot, _db$settings4, _db$online8;
    if (sbUrl) sbUrl.value = ((_db$online6 = db.online) === null || _db$online6 === void 0 ? void 0 : _db$online6.url) || "";
    if (sbKey) sbKey.value = ((_db$online7 = db.online) === null || _db$online7 === void 0 ? void 0 : _db$online7.key) || "";
    if (autoSnapshotsToggle) autoSnapshotsToggle.checked = !!((_db$settings3 = db.settings) !== null && _db$settings3 !== void 0 && _db$settings3.autoSnapshots);
    if (snapshotRetention) snapshotRetention.value = String((_db$settings$snapshot = (_db$settings4 = db.settings) === null || _db$settings4 === void 0 ? void 0 : _db$settings4.snapshotRetention) !== null && _db$settings$snapshot !== void 0 ? _db$settings$snapshot : 30);
    setSbMsg((_db$online8 = db.online) !== null && _db$online8 !== void 0 && _db$online8.enabled ? "Supabase: ATIVO ✅" : "Supabase: desligado");
    setSettingsMsg("");
    setJsonMsg("");
  }

  if (btnSaveOnline) {
    btnSaveOnline.onclick = () => {
      try {
        if (!canManage()) return alert("Sem permissão.");
        const url = (sbUrl ? sbUrl.value : "").trim();
        const key = (sbKey ? sbKey.value : "").trim();
        if (!url || !key) return setSbMsg("URL e Key obrigatórios.");
        db.online = { enabled: true, url, key };
        saveDBTouch();
        setSbMsg("Config Supabase guardada ✅");
        logAction("online.enable", "settings", "", {});
      } catch (e) {
        setSbMsg("Erro: " + (e.message || e));
      }
    };
  }

  if (btnDisableOnline) {
    btnDisableOnline.onclick = () => {
      if (!canManage()) return alert("Sem permissão.");
      db.online = { enabled: false, url: "", key: "" };
      saveDBTouch();
      renderSettings();
      setSbMsg("Supabase desativado.");
      logAction("online.disable", "settings", "", {});
    };
  }

  if (btnBackupNow) {
    btnBackupNow.onclick = async () => {
      try {var _db$online9;
        if (!canManage()) return alert("Sem permissão.");
        if (!((_db$online9 = db.online) !== null && _db$online9 !== void 0 && _db$online9.enabled)) return setSbMsg("Ative Supabase primeiro.");
        await pushSnapshot("manual_settings");
        setSbMsg("Backup guardado ✅");
      } catch (e) {
        setSbMsg("Erro: " + (e.message || e));
      }
    };
  }

  if (btnSaveSettings) {
    btnSaveSettings.onclick = () => {
      if (!canManage()) return alert("Sem permissão.");
      db.settings.autoSnapshots = !!(autoSnapshotsToggle && autoSnapshotsToggle.checked);
      db.settings.snapshotRetention = Math.max(1, Math.floor(nnum(snapshotRetention ? snapshotRetention.value : "30", 30)));
      saveDBTouch();
      setSettingsMsg("Settings guardadas ✅");
      logAction("settings.update", "settings", "", { autoSnapshots: db.settings.autoSnapshots, retention: db.settings.snapshotRetention });
    };
  }

  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (btnExportJSON) {
    btnExportJSON.onclick = () => {
      try {
        if (!canManage()) return alert("Sem permissão.");
        const ws = (workspaceId || "workspace").replace(/[^a-z0-9_-]/gi, "_");
        downloadJSON(`gestao-facil_${ws}_${todayISO()}.json`, db);
        setJsonMsg("Exportado ✅");
        logAction("db.export_json", "db", "", {});
      } catch (e) {
        setJsonMsg("Erro ao exportar: " + (e.message || e));
      }
    };
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = reject;
      fr.readAsText(file);
    });
  }

  if (btnImportJSON) {
    btnImportJSON.onclick = async () => {
      try {
        if (!canManage()) return alert("Sem permissão.");
        if (!fileImportJSON || !fileImportJSON.files || !fileImportJSON.files[0]) {
          return setJsonMsg("Escolha um ficheiro JSON.");
        }
        const txt = await readFileAsText(fileImportJSON.files[0]);
        const incoming = JSON.parse(txt);
        if (!incoming || typeof incoming !== "object") throw new Error("JSON inválido.");

        if (!confirm("Importar vai substituir a base local deste dispositivo. Continuar?")) return;

        save(DB_KEY, incoming);
        db = load(DB_KEY, emptyDB());
        db.inventory = db.inventory || [];
        db.audit = db.audit || [];
        db.settings = db.settings || { autoSnapshots: true, snapshotRetention: 30 };
        db.online = db.online || { enabled: false, url: "", key: "" };
        saveDBTouch();

        setJsonMsg("Importado ✅");
        logAction("db.import_json", "db", "", {});
        refreshUsersDropdown();

        renderPOS();
        renderProducts();
        renderClients();
        renderAccounts();
        renderLedger();
        renderInventory();
        renderSales();
        renderAudit();
        renderSettings();
      } catch (e) {
        setJsonMsg("Erro ao importar: " + (e.message || e));
      }
    };
  }

  /* =======================
   Audit view (render + filtros)
  ======================= */
  function setAuditMsg(m) {if (auditMsg) auditMsg.textContent = m || "";}

  function renderAudit() {
    if (!db || !db.audit) return;
    if (!auditTable) return;

    const from = auditFrom ? auditFrom.value : "";
    const to = auditTo ? auditTo.value : "";
    const act = (auditAction ? auditAction.value : "").toLowerCase().trim();
    const usr = (auditUser ? auditUser.value : "").toLowerCase().trim();

    const rows = (db.audit || []).
    filter(r => !from || (r.ts || "").slice(0, 10) >= from).
    filter(r => !to || (r.ts || "").slice(0, 10) <= to).
    filter(r => !act || String(r.action || "").toLowerCase().includes(act)).
    filter(r => !usr || String(r.actorName || "").toLowerCase().includes(usr)).
    sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));

    auditTable.innerHTML = "";

    rows.forEach(r => {
      const row = document.createElement("div");
      row.className = "rowitem ledger";
      const metaStr = r.meta ? JSON.stringify(r.meta) : "";
      row.innerHTML = `
      <div>
        <div><b>${(r.ts || "").slice(0, 19).replace("T", " ")}</b> <span class="badge">${r.role || "—"}</span></div>
        <div class="muted">${r.actorName || r.actorId || "—"} • ${r.action || ""}</div>
      </div>
      <div class="mono">${r.entityType || "—"}</div>
      <div class="muted">${r.entityId ? String(r.entityId).slice(0, 10) : "—"}</div>
      <div class="muted">${metaStr ? metaStr.slice(0, 40) + (metaStr.length > 40 ? "…" : "") : "—"}</div>
    `;
      auditTable.appendChild(row);
    });

    if (auditCount) auditCount.textContent = `${rows.length} registo(s)`;
    setAuditMsg(rows.length ? "" : "Sem registos com estes filtros.");
  }

  if (btnAuditRefresh) btnAuditRefresh.onclick = renderAudit;
  if (btnAuditFilter) btnAuditFilter.onclick = renderAudit;

  /* =======================
     Boot
  ======================= */
  refreshUsersDropdown();
  renderSettings();

  // auto snapshot leve ao abrir (se online + auto)
  if ((_db$online10 = db.online) !== null && _db$online10 !== void 0 && _db$online10.enabled && (_db$settings5 = db.settings) !== null && _db$settings5 !== void 0 && _db$settings5.autoSnapshots) {
    debounce("dailySnap", 4000, () => autoSnapshot("daily_open"));
  }

  if (session) {
    showMain();
    initNav();
    openView("pos");
  } else {
    showAuth();
  }
})();