/***********************
 * V1 - Offline + Online (Supabase opcional)
 * Correção principal:
 * ✅ Todo o “hook” de eventos só acontece depois do DOM carregar
 * (evita: Cannot read properties of null (reading 'addEventListener'))
 ************************/

// ====== Utils ======
const MT = (n)=> `${Number(n||0).toFixed(2)} MT`;
const todayISO = ()=> new Date().toISOString().slice(0,10);
const uid = ()=> crypto?.randomUUID ? crypto.randomUUID() : (Math.random().toString(16).slice(2)+Date.now().toString(16));
const byName = (a,b)=> (a.nome||"").localeCompare(b.nome||"");

// ====== Storage ======
const KEY = "gestao_facil_v1_offlinefirst";
const loadLocal = ()=> {
  try{ return JSON.parse(localStorage.getItem(KEY)) || null; }catch{ return null; }
};
const saveLocal = (db)=> localStorage.setItem(KEY, JSON.stringify(db));

// ====== DB ======
let db = loadLocal() || {
  meta: { updatedAt: Date.now(), version: 1 },
  online: { url:"", key:"" },
  accounts: [
    {id: uid(), nome:"Dinheiro", tipo:"Dinheiro", ativo:true, saldo:0},
  ],
  customers: [
    {id: uid(), nome:"Cliente balcão", telefone:"", notas:""}
  ],
  products: [
    {id: uid(), nome:"Refresco 500ml", precoVenda:35, precoAquisicaoRef:22, minStock:5, img:"", desc:"", ativo:true},
    {id: uid(), nome:"Bolo fatia", precoVenda:50, precoAquisicaoRef:30, minStock:3, img:"", desc:"", ativo:true},
  ],
  inventory: {},
  purchases: [],
  sales: [],
  ledger: []
};
saveLocal(db);

// ✅ cart precisa existir cedo
let cart = [];

// ====== Online (Supabase opcional) ======
let supabase = null;

function setSyncState(text){
  const el = document.getElementById("syncState");
  if(el) el.textContent = text;
}

function loadScriptOnce(src, id){
  return new Promise((resolve, reject)=>{
    if(document.getElementById(id)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.id = id;
    s.onload = ()=> resolve();
    s.onerror = ()=> reject(new Error("Falha ao carregar script"));
    document.head.appendChild(s);
  });
}

async function initSupabaseIfConfigured(){
  const {url, key} = db.online || {};
  if(!url || !key){
    setSyncState("Modo: Offline");
    supabase = null;
    return;
  }
  await loadScriptOnce("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js", "supabase-cdn");
  supabase = window.supabase.createClient(url, key);
  setSyncState("Modo: Online (Supabase)");
}

function getDeviceId(){
  const k = "gestao_facil_device_id";
  let v = localStorage.getItem(k);
  if(!v){ v = uid(); localStorage.setItem(k, v); }
  return v;
}

async function syncNow(){
  if(!supabase){
    alert("Online não está configurado. Vá em Config e cole SUPABASE_URL e KEY (ou use offline).");
    return;
  }

  setSyncState("Sincronizando...");
  const deviceId = getDeviceId();

  const payload = {
    device_id: deviceId,
    data: db,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("snapshots")
    .upsert(payload, { onConflict: "device_id" });

  if(error){
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

  if(e2){
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

// ====== Modal (só usa quando DOM existir) ======
function openModal(title, html){
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  if(modalTitle) modalTitle.textContent = title;
  if(modalBody) modalBody.innerHTML = html;
  if(modal) modal.style.display = "flex";
}
function closeModal(){
  const modal = document.getElementById("modal");
  const modalBody = document.getElementById("modalBody");
  if(modal) modal.style.display = "none";
  if(modalBody) modalBody.innerHTML = "";
}

// ====== Core ======
function invQty(productId){ return Number(db.inventory?.[productId] || 0); }
function setInv(productId, qty){
  if(!db.inventory) db.inventory = {};
  db.inventory[productId] = Number(qty||0);
}
function accountName(id){ return db.accounts.find(a=>a.id===id)?.nome || "—"; }
function customerName(id){ return db.customers.find(c=>c.id===id)?.nome || "—"; }
function productById(id){ return db.products.find(p=>p.id===id); }

function touch(){
  db.meta.updatedAt = Date.now();
  saveLocal(db);
}

function addLedger({date, type, accountId, amount, refType, refId, note}){
  db.ledger.push({id: uid(), date, type, accountId, amount:Number(amount||0), refType, refId, note: note||""});
}

function calcAccountBalance(accountId){
  const base = Number(db.accounts.find(a=>a.id===accountId)?.saldo || 0);
  const ins = db.ledger.filter(x=>x.accountId===accountId && x.type==="in").reduce((s,x)=>s+Number(x.amount),0);
  const outs= db.ledger.filter(x=>x.accountId===accountId && x.type==="out").reduce((s,x)=>s+Number(x.amount),0);
  return base + ins - outs;
}

// ====== Navigation ======
const pages = {
  home: {title:"Home", desc:"Dashboard geral + contas de pagamento"},
  vendas: {title:"Vendas", desc:"Catálogo + carrinho + cliente + conta"},
  compras: {title:"Compras", desc:"Compras a fornecedores (entra no armazém)"},
  clientes: {title:"Clientes", desc:"Cadastro de clientes"},
  produtos: {title:"Produtos", desc:"Cadastro de produtos + lucro esperado"},
  armazem: {title:"Armazém", desc:"Stock em tempo real + alertas"},
  relatorios: {title:"Relatórios", desc:"Base de relatórios (V1)"},
  fiscal: {title:"Fiscal", desc:"Página em desenvolvimento"},
  config: {title:"Config", desc:"Backup + Online (Supabase)"},
  suporte: {title:"Suporte", desc:"FAQ + reportar problemas"}
};

function go(page){
  document.querySelectorAll(".mitem").forEach(b=>b.classList.toggle("active", b.dataset.page === page));
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active", p.id === page));

  const t = document.getElementById("pageTitle");
  const d = document.getElementById("pageDesc");
  if(t) t.textContent = pages[page]?.title || page;
  if(d) d.textContent = pages[page]?.desc || "";

  const quick = document.getElementById("btnQuickSale");
  if(quick) quick.style.display = (page==="vendas") ? "none" : "inline-flex";

  renderAll();
}

// ====== Render ======
function renderHome(){
  const d = todayISO();
  const salesToday = db.sales.filter(s=>s.data===d);
  const buysToday  = db.purchases.filter(p=>p.data===d);

  const totalSales = salesToday.reduce((s,x)=>s+Number(x.total),0);
  const totalBuys  = buysToday.reduce((s,x)=>s+Number(x.total),0);
  const totalProfit= salesToday.reduce((s,x)=>s+Number(x.profit),0);

  const k1 = document.getElementById("kpiSalesToday");
  const k2 = document.getElementById("kpiSalesTodayCount");
  const k3 = document.getElementById("kpiBuysToday");
  const k4 = document.getElementById("kpiBuysTodayCount");
  const k5 = document.getElementById("kpiProfitToday");

  if(k1) k1.textContent = MT(totalSales);
  if(k2) k2.textContent = `${salesToday.length} vendas`;
  if(k3) k3.textContent = MT(totalBuys);
  if(k4) k4.textContent = `${buysToday.length} compras`;
  if(k5) k5.textContent = MT(totalProfit);

  // contas
  const elAcc = document.getElementById("accountsList");
  if(elAcc){
    const accs = [...db.accounts].sort(byName);
    elAcc.innerHTML = accs.length ? accs.map(a=>{
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
        </div>
      `;
    }).join("") : `<div class="muted">Sem contas.</div>`;

    elAcc.querySelectorAll("[data-edit-acc]").forEach(b=> b.addEventListener("click", ()=> modalAccount(b.dataset.editAcc)));
    elAcc.querySelectorAll("[data-del-acc]").forEach(b=> b.addEventListener("click", ()=> deleteAccount(b.dataset.delAcc)));
  }

  // low stock
  const elLow = document.getElementById("lowStockList");
  if(elLow){
    const lows = db.products
      .filter(p=>p.ativo)
      .map(p=>({p, qty: invQty(p.id)}))
      .filter(x=> x.p.minStock > 0 && x.qty <= x.p.minStock)
      .sort((a,b)=> a.qty - b.qty);

    elLow.innerHTML = lows.length ? lows.map(x=>`
      <div class="item">
        <h4>${x.p.nome}</h4>
        <div class="meta">
          <span>Stock: <strong>${x.qty}</strong></span>
          <span>Mínimo: ${x.p.minStock}</span>
        </div>
      </div>
    `).join("") : `<div class="muted">Sem alertas de stock mínimo.</div>`;
  }

  // últimas vendas
  const elLast = document.getElementById("lastSales");
  if(elLast){
    const last = [...db.sales].slice(-5).reverse();
    elLast.innerHTML = last.length ? last.map(s=>`
      <div class="item">
        <h4>${MT(s.total)} <span class="badge">${s.data}</span></h4>
        <div class="meta">
          <span>Cliente: ${customerName(s.customerId)}</span>
          <span>Conta: ${accountName(s.accountId)}</span>
          <span>${s.items.length} itens</span>
        </div>
      </div>
    `).join("") : `<div class="muted">Ainda sem vendas.</div>`;
  }
}

// ====== Accounts ======
function modalAccount(id = null) {
  const a = id ? db.accounts.find(x => x.id === id) : null;

  openModal(id ? "Editar conta" : "Nova conta", `
    <form id="accForm" class="form2">
      <div class="field full">
        <label>Nome</label>
        <input class="input" id="accName" required value="${a?.nome || ""}" placeholder="Ex: M-Pesa" />
      </div>

      <div class="field">
        <label>Tipo</label>
        <select class="input" id="accType">
          ${["Mobile money","Banco","Dinheiro"].map(t => `
            <option ${a?.tipo === t ? "selected" : ""}>${t}</option>
          `).join("")}
        </select>
      </div>

      <div class="field">
        <label>Saldo inicial (opcional)</label>
        <input class="input" type="number" step="0.01" min="0" id="accSaldo" value="${a?.saldo ?? 0}" />
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
  `);

  const f = document.getElementById("accForm");
  if (!f) return;

  f.addEventListener("submit", (e) => {
    e.preventDefault();

    const nome = document.getElementById("accName").value.trim();
    if (!nome) return alert("Escreva o nome da conta.");

    const obj = {
      id: a?.id || uid(),
      nome,
      tipo: document.getElementById("accType").value,
      saldo: Number(document.getElementById("accSaldo").value || 0),
      ativo: document.getElementById("accActive").value === "true",
    };

    // ✅ Fonte única: a?.id
    if (a?.id) {
      db.accounts = db.accounts.map(x => x.id === a.id ? obj : x);
    } else {
      db.accounts.push(obj);
    }

    touch();        // salva no localStorage
    closeModal();   // fecha modal
    renderAll();    // atualiza dashboard + selects
  });
}


function deleteAccount(id){
  if(!confirm("Apagar esta conta?")) return;
  db.accounts = db.accounts.filter(a=>a.id!==id);
  touch();
  renderAll();
}

// ====== Produtos ======
function updateProfitNote(){
  const p = Number(document.getElementById("prodPrice")?.value||0);
  const c = Number(document.getElementById("prodCost")?.value||0);
  const note = document.getElementById("profitNote");
  if(note) note.textContent = `Lucro esperado: ${MT(p-c)}`;
}

function renderProductsList(){
  const q = (document.getElementById("productSearch")?.value||"").toLowerCase();
  const items = [...db.products].filter(p=>p.nome.toLowerCase().includes(q)).sort(byName);
  const el = document.getElementById("productsList");
  if(!el) return;

  el.innerHTML = items.length ? items.map(p=>{
    const lucro = Number(p.precoVenda)-Number(p.precoAquisicaoRef);
    return `
      <div class="item">
        <h4>${p.nome} <span class="badge">${p.ativo?"Ativo":"Inativo"}</span></h4>
        <div class="meta">
          <span>Venda: ${MT(p.precoVenda)}</span>
          <span>Aquisição: ${MT(p.precoAquisicaoRef)}</span>
          <span>Lucro esp.: <strong>${MT(lucro)}</strong></span>
          <span>Stock mín.: ${p.minStock}</span>
        </div>
        <div class="actions">
          <button class="btn ghost" data-toggle-prod="${p.id}">${p.ativo?"Desativar":"Ativar"}</button>
          <button class="btn danger" data-del-prod="${p.id}">Apagar</button>
        </div>
      </div>
    `;
  }).join("") : `<div class="muted">Sem produtos.</div>`;

  el.querySelectorAll("[data-toggle-prod]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.toggleProd;
      db.products = db.products.map(p=> p.id===id ? {...p, ativo: !p.ativo} : p);
      touch(); renderAll();
    });
  });

  el.querySelectorAll("[data-del-prod]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.delProd;
      if(confirm("Apagar este produto?")){
        db.products = db.products.filter(p=>p.id!==id);
        touch(); renderAll();
      }
    });
  });
}

// ====== Clientes ======
function renderCustomersList(){
  const el = document.getElementById("customersList");
  if(!el) return;

  const items = [...db.customers].sort(byName);
  el.innerHTML = items.length ? items.map(c=>`
    <div class="item">
      <h4>${c.nome}</h4>
      <div class="meta">
        <span>Tel: ${c.telefone || "—"}</span>
        <span>${c.notas || ""}</span>
      </div>
      <div class="actions">
        <button class="btn danger" data-del-cust="${c.id}">Apagar</button>
      </div>
    </div>
  `).join("") : `<div class="muted">Sem clientes.</div>`;

  el.querySelectorAll("[data-del-cust]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const id = b.dataset.delCust;
      if(confirm("Apagar cliente?")){
        const base = db.customers[0]?.id;
        if(id === base) return alert("Não pode apagar o cliente balcão.");
        db.customers = db.customers.filter(c=>c.id!==id);
        touch(); renderAll();
      }
    });
  });
}

// ====== Armazém ======
function renderWarehouse(){
  const el = document.getElementById("warehouseList");
  if(!el) return;

  const items = db.products
    .filter(p=>p.ativo)
    .map(p=>({p, qty: invQty(p.id)}))
    .sort((a,b)=> a.p.nome.localeCompare(b.p.nome));

  el.innerHTML = items.length ? items.map(x=>{
    const low = x.p.minStock>0 && x.qty <= x.p.minStock;
    return `
      <div class="item">
        <h4>${x.p.nome} ${low? `<span class="badge">Baixo</span>`:""}</h4>
        <div class="meta">
          <span>Disponível: <strong>${x.qty}</strong></span>
          <span>Stock mín.: ${x.p.minStock}</span>
        </div>
      </div>
    `;
  }).join("") : `<div class="muted">Sem produtos ativos.</div>`;
}

// ====== Compras ======
function renderBuysList(){
  const el = document.getElementById("buysList");
  if(!el) return;

  const f = document.getElementById("buysFilterDate")?.value;
  const items = [...db.purchases].filter(p=> !f || p.data===f).reverse();

  el.innerHTML = items.length ? items.map(p=>{
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
      </div>
    `;
  }).join("") : `<div class="muted">Sem compras.</div>`;
}

// ====== Vendas ======
function renderCatalog(){
  const q = (document.getElementById("catalogSearch")?.value||"").toLowerCase();
  const items = db.products
    .filter(p=>p.ativo)
    .filter(p=>p.nome.toLowerCase().includes(q))
    .sort(byName);

  const el = document.getElementById("catalogList");
  if(!el) return;

  el.innerHTML = items.length ? items.map(p=>{
    const qty = invQty(p.id);
    const disabled = qty<=0;
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
          <button class="btn padd ${disabled?"ghost":""}" data-add="${p.id}" ${disabled?"disabled":""}>
            ${disabled ? "Sem stock" : "Adicionar"}
          </button>
        </div>
      </div>
    `;
  }).join("") : `<div class="muted">Sem produtos no catálogo.</div>`;

  el.querySelectorAll("[data-add]").forEach(b=>{
    b.addEventListener("click", ()=> addToCart(b.dataset.add));
  });
}

function addToCart(productId){
  const p = productById(productId);
  if(!p) return;
  if(invQty(productId)<=0) return alert("Sem stock.");

  const found = cart.find(i=>i.productId===productId);
  if(found){
    if(found.qty+1 > invQty(productId)) return alert("Stock insuficiente.");
    found.qty += 1;
  }else{
    cart.push({productId, qty:1});
  }
  renderCart();
}

function renderCart(){
  const el = document.getElementById("cartList");
  if(!el) return;

  if(!cart.length){
    el.innerHTML = `<div class="muted">Carrinho vazio.</div>`;
    const totalEl = document.getElementById("cartTotal");
    if(totalEl) totalEl.textContent = MT(0);
    return;
  }

  const rows = cart.map(i=>{
    const p = productById(i.productId);
    const stock = invQty(i.productId);
    const total = i.qty * Number(p.precoVenda||0);
    return {i,p,stock,total};
  });

  const grand = rows.reduce((s,r)=>s+r.total,0);
  const totalEl = document.getElementById("cartTotal");
  if(totalEl) totalEl.textContent = MT(grand);

  el.innerHTML = rows.map(r=>`
    <div class="item">
      <h4>${r.p.nome}</h4>
      <div class="meta">
        <span>${r.i.qty} x ${MT(r.p.precoVenda)}</span>
        <span>Total: <strong>${MT(r.total)}</strong></span>
        <span>Stock: ${r.stock}</span>
      </div>
      <div class="actions">
        <button class="btn ghost" data-dec="${r.i.productId}">-</button>
        <button class="btn ghost" data-inc="${r.i.productId}">+</button>
        <button class="btn danger" data-rem="${r.i.productId}">Remover</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll("[data-dec]").forEach(b=> b.addEventListener("click", ()=> changeQty(b.dataset.dec, -1)));
  el.querySelectorAll("[data-inc]").forEach(b=> b.addEventListener("click", ()=> changeQty(b.dataset.inc, +1)));
  el.querySelectorAll("[data-rem]").forEach(b=> b.addEventListener("click", ()=> removeFromCart(b.dataset.rem)));
}

function changeQty(productId, delta){
  const item = cart.find(x=>x.productId===productId);
  if(!item) return;
  const newQty = item.qty + delta;
  if(newQty<=0) return removeFromCart(productId);
  if(newQty > invQty(productId)) return alert("Stock insuficiente.");
  item.qty = newQty;
  renderCart();
}

function removeFromCart(productId){
  cart = cart.filter(x=>x.productId!==productId);
  renderCart();
}

function finalizeSale(){
  if(!cart.length) return alert("Carrinho vazio.");

  const customerId = document.getElementById("saleCustomer")?.value;
  const accountId  = document.getElementById("saleAccount")?.value;
  const date       = document.getElementById("saleDate")?.value || todayISO();

  if(!customerId) return alert("Selecione o cliente.");
  if(!accountId) return alert("Selecione a conta.");

  for(const i of cart){
    if(i.qty > invQty(i.productId)) return alert("Stock insuficiente para um item do carrinho.");
  }

  const items = cart.map(i=>{
    const p = productById(i.productId);
    const costUnit = Number(p.precoAquisicaoRef||0);
    return { productId: i.productId, qty: i.qty, priceUnit: Number(p.precoVenda||0), costUnit };
  });

  const total = items.reduce((s,it)=> s + it.qty*it.priceUnit, 0);
  const totalCost = items.reduce((s,it)=> s + it.qty*it.costUnit, 0);
  const profit = total - totalCost;

  const sale = { id: uid(), data: date, customerId, accountId, items, total, totalCost, profit };
  db.sales.push(sale);

  items.forEach(it=> setInv(it.productId, invQty(it.productId) - it.qty));
  addLedger({date, type:"in", accountId, amount: total, refType:"sale", refId: sale.id, note:`Venda ${customerName(customerId)}`});

  cart = [];
  touch();
  renderAll();
  alert("Venda registrada com sucesso!");
}

function renderSalesList(){
  const el = document.getElementById("salesList");
  if(!el) return;

  const f = document.getElementById("salesFilterDate")?.value;
  const items = [...db.sales].filter(s=> !f || s.data===f).reverse();

  el.innerHTML = items.length ? items.map(s=>`
    <div class="item">
      <h4>${MT(s.total)} <span class="badge">${s.data}</span></h4>
      <div class="meta">
        <span>Cliente: ${customerName(s.customerId)}</span>
        <span>Conta: ${accountName(s.accountId)}</span>
        <span>Lucro (estim.): <strong>${MT(s.profit)}</strong></span>
        <span>${s.items.length} itens</span>
      </div>
    </div>
  `).join("") : `<div class="muted">Sem vendas.</div>`;
}

// ====== Selects ======
function renderSelects(){
  const accActive = db.accounts.filter(a=>a.ativo).sort(byName);
  const custs = [...db.customers].sort(byName);
  const prods = db.products.filter(p=>p.ativo).sort(byName);

  const saleAcc = document.getElementById("saleAccount");
  if(saleAcc) saleAcc.innerHTML = accActive.map(a=>`<option value="${a.id}">${a.nome}</option>`).join("");

  const buyAcc = document.getElementById("buyAccount");
  if(buyAcc) buyAcc.innerHTML = accActive.map(a=>`<option value="${a.id}">${a.nome}</option>`).join("");

  const saleCust = document.getElementById("saleCustomer");
  if(saleCust) saleCust.innerHTML = custs.map(c=>`<option value="${c.id}">${c.nome}</option>`).join("");

  const buyProd = document.getElementById("buyProduct");
  if(buyProd) buyProd.innerHTML = prods.map(p=>`<option value="${p.id}">${p.nome}</option>`).join("");
}

// ====== Reports base ======
function renderReportsBase(){
  const elQuick = document.getElementById("reportQuick");
  const elStock = document.getElementById("reportStock");
  if(!elQuick || !elStock) return;

  const d = todayISO();
  const sales = db.sales.filter(s=>s.data===d);
  const buys  = db.purchases.filter(p=>p.data===d);
  const totalSales = sales.reduce((s,x)=>s+x.total,0);
  const totalBuys  = buys.reduce((s,x)=>s+x.total,0);
  const profit = sales.reduce((s,x)=>s+x.profit,0);

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

  const lows = db.products.filter(p=>p.ativo).map(p=>({p, qty: invQty(p.id)}))
    .filter(x=> x.p.minStock>0 && x.qty<=x.p.minStock);

  elStock.innerHTML = lows.length ? lows.map(x=>`
    <div class="item">
      <h4>${x.p.nome}</h4>
      <div class="meta">
        <span>Stock: <strong>${x.qty}</strong></span>
        <span>Mínimo: ${x.p.minStock}</span>
      </div>
    </div>
  `).join("") : `<div class="muted">Sem stock baixo agora.</div>`;
}

// ====== Render all ======
function renderAll(){
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
}

// ====== DOM READY (AQUI está a correção) ======
window.addEventListener("DOMContentLoaded", async ()=> {

  // menu
  document.querySelectorAll(".mitem").forEach(btn=>{
    btn.addEventListener("click", ()=> go(btn.dataset.page));
  });
  document.querySelectorAll("[data-nav]").forEach(btn=>{
    btn.addEventListener("click", ()=> go(btn.dataset.nav));
  });

  // modal close
  const modalClose = document.getElementById("modalClose");
  if(modalClose) modalClose.addEventListener("click", closeModal);

  const modal = document.getElementById("modal");
  if(modal){
    modal.addEventListener("click", (e)=>{ if(e.target === modal) closeModal(); });
  }

  // home: add account
  const btnAddAccount = document.getElementById("btnAddAccount");
  if(btnAddAccount) btnAddAccount.addEventListener("click", ()=> modalAccount());

  // produtos: lucro esperado
  const prodPrice = document.getElementById("prodPrice");
  const prodCost  = document.getElementById("prodCost");
  if(prodPrice) prodPrice.addEventListener("input", updateProfitNote);
  if(prodCost)  prodCost.addEventListener("input", updateProfitNote);

  // forms
  const productForm = document.getElementById("productForm");
  if(productForm){
    productForm.addEventListener("submit", (e)=>{
      e.preventDefault();
      const p = {
        id: uid(),
        nome: document.getElementById("prodName").value.trim(),
        precoVenda: Number(document.getElementById("prodPrice").value||0),
        precoAquisicaoRef: Number(document.getElementById("prodCost").value||0),
        minStock: Number(document.getElementById("prodMinStock").value||0),
        img: document.getElementById("prodImg").value.trim(),
        desc: document.getElementById("prodDesc").value.trim(),
        ativo: true
      };
      db.products.push(p);
      touch();
      e.target.reset();
      document.getElementById("prodMinStock").value = 0;
      updateProfitNote();
      renderAll();
    });
  }

  const customerForm = document.getElementById("customerForm");
  if(customerForm){
    customerForm.addEventListener("submit", (e)=>{
      e.preventDefault();
      const c = {
        id: uid(),
        nome: document.getElementById("custName").value.trim(),
        telefone: document.getElementById("custPhone").value.trim(),
        notas: document.getElementById("custNotes").value.trim(),
      };
      db.customers.push(c);
      touch();
      e.target.reset();
      renderAll();
    });
  }

  const buyForm = document.getElementById("buyForm");
  if(buyForm){
    const buyDate = document.getElementById("buyDate");
    if(buyDate) buyDate.value = todayISO();

    buyForm.addEventListener("submit", (e)=>{
      e.preventDefault();
      const supplier = document.getElementById("buySupplier").value.trim();
      const productId= document.getElementById("buyProduct").value;
      const qty      = Number(document.getElementById("buyQty").value||0);
      const costUnit = Number(document.getElementById("buyCost").value||0);
      const accountId= document.getElementById("buyAccount").value;
      const date     = document.getElementById("buyDate").value || todayISO();

      if(!supplier) return alert("Informe o fornecedor.");
      if(!productId) return alert("Selecione o produto.");
      if(qty<=0) return alert("Quantidade inválida.");
      if(costUnit<0) return alert("Preço inválido.");
      if(!accountId) return alert("Selecione a conta.");

      const total = qty * costUnit;
      const purchase = {id: uid(), data: date, supplier, productId, qty, costUnit, total, accountId};
      db.purchases.push(purchase);

      setInv(productId, invQty(productId) + qty);
      addLedger({date, type:"out", accountId, amount: total, refType:"purchase", refId: purchase.id, note:`Compra ${supplier}`});
      db.products = db.products.map(p=> p.id===productId ? {...p, precoAquisicaoRef: costUnit} : p);

      touch();
      e.target.reset();
      document.getElementById("buyDate").value = todayISO();
      document.getElementById("buyQty").value = 1;
      renderAll();
    });
  }

  // vendas
  const saleDate = document.getElementById("saleDate");
  if(saleDate) saleDate.value = todayISO();

  const btnQuickSale = document.getElementById("btnQuickSale");
  if(btnQuickSale) btnQuickSale.addEventListener("click", ()=> go("vendas"));

  const btnClearCart = document.getElementById("btnClearCart");
  if(btnClearCart) btnClearCart.addEventListener("click", ()=>{ cart = []; renderCart(); });

  const btnCheckout = document.getElementById("btnCheckout");
  if(btnCheckout) btnCheckout.addEventListener("click", finalizeSale);

  // filtros / pesquisa
  const productSearch = document.getElementById("productSearch");
  if(productSearch) productSearch.addEventListener("input", renderProductsList);

  const catalogSearch = document.getElementById("catalogSearch");
  if(catalogSearch) catalogSearch.addEventListener("input", renderCatalog);

  const buysFilterDate = document.getElementById("buysFilterDate");
  if(buysFilterDate) buysFilterDate.addEventListener("input", renderBuysList);

  const btnClearBuysFilter = document.getElementById("btnClearBuysFilter");
  if(btnClearBuysFilter) btnClearBuysFilter.addEventListener("click", ()=>{
    const el = document.getElementById("buysFilterDate");
    if(el) el.value = "";
    renderBuysList();
  });

  const salesFilterDate = document.getElementById("salesFilterDate");
  if(salesFilterDate) salesFilterDate.addEventListener("input", renderSalesList);

  const btnClearSalesFilter = document.getElementById("btnClearSalesFilter");
  if(btnClearSalesFilter) btnClearSalesFilter.addEventListener("click", ()=>{
    const el = document.getElementById("salesFilterDate");
    if(el) el.value = "";
    renderSalesList();
  });

  // config: export/import/reset
  const btnExport = document.getElementById("btnExport");
  if(btnExport){
    btnExport.addEventListener("click", ()=>{
      const blob = new Blob([JSON.stringify(db, null, 2)], {type:"application/json"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `gestao-facil-backup-${todayISO()}.json`;
      a.click();
    });
  }

  const importFile = document.getElementById("importFile");
  if(importFile){
    importFile.addEventListener("change", async (e)=>{
      const f = e.target.files?.[0];
      if(!f) return;
      try{
        const data = JSON.parse(await f.text());
        db = data;
        saveLocal(db);
        await initSupabaseIfConfigured();
        alert("Importado com sucesso!");
        renderAll();
      }catch{
        alert("Backup inválido.");
      }finally{
        e.target.value = "";
      }
    });
  }

  const btnReset = document.getElementById("btnReset");
  if(btnReset){
    btnReset.addEventListener("click", ()=>{
      if(confirm("Apagar tudo?")){
        localStorage.removeItem(KEY);
        location.reload();
      }
    });
  }

  const sbUrl = document.getElementById("sbUrl");
  const sbKey = document.getElementById("sbKey");
  if(sbUrl) sbUrl.value = db.online.url || "";
  if(sbKey) sbKey.value = db.online.key || "";

  const btnSaveOnline = document.getElementById("btnSaveOnline");
  if(btnSaveOnline){
    btnSaveOnline.addEventListener("click", async ()=>{
      db.online.url = document.getElementById("sbUrl").value.trim();
      db.online.key = document.getElementById("sbKey").value.trim();
      touch();
      await initSupabaseIfConfigured();
      alert(supabase ? "Online ativado! Agora pode sincronizar." : "Offline (chaves vazias).");
    });
  }

  const btnSync = document.getElementById("btnSync");
  if(btnSync) btnSync.addEventListener("click", syncNow);

  // suporte
  const btnSendIssue = document.getElementById("btnSendIssue");
  if(btnSendIssue){
    btnSendIssue.addEventListener("click", ()=>{
      const t = document.getElementById("issueText").value.trim();
      if(!t) return alert("Escreva a descrição do problema.");
      document.getElementById("issueText").value = "";
      document.getElementById("issueSent").textContent = "Obrigado! Problema registrado (nesta V1 fica local).";
    });
  }

  // iniciar supabase (se tiver config) e renderizar
  await initSupabaseIfConfigured();
  renderAll();
});
// ===============================
// FIX: Formas de pagamento (event delegation)
// ===============================

window.addEventListener("DOMContentLoaded", () => {
  // 1) Botão "+ Nova conta" (Home)
  document.addEventListener("click", (e) => {
    const btnAdd = e.target.closest("#btnAddAccount");
    if (btnAdd) {
      modalAccount(); // abre modal para criar conta
      return;
    }

    // 2) Editar conta (botões gerados pelo render)
    const btnEdit = e.target.closest("[data-edit-acc]");
    if (btnEdit) {
      modalAccount(btnEdit.dataset.editAcc);
      return;
    }

    // 3) Apagar conta (botões gerados pelo render)
    const btnDel = e.target.closest("[data-del-acc]");
    if (btnDel) {
      deleteAccount(btnDel.dataset.delAcc);
      return;
    }
  });

  // 4) Submit do formulário do modal (criado dinamicamente)
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("#accForm");
    if (!form) return;

    e.preventDefault();

    // se estiver a editar, o form vem com data-id
    const editId = form.getAttribute("data-edit-id");

    const obj = {
      id: editId || uid(),
      nome: document.getElementById("accName").value.trim(),
      tipo: document.getElementById("accType").value,
      saldo: Number(document.getElementById("accSaldo").value || 0),
      ativo: document.getElementById("accActive").value === "true",
    };

    if (!obj.nome) return alert("Escreva o nome da conta.");

    if (editId) db.accounts = db.accounts.map(a => a.id === editId ? obj : a);
    else db.accounts.push(obj);

    touch();
    closeModal();
    renderAll();
  });
});


// ===============================
// Atualiza modalAccount para marcar edição
// (substitui a tua função modalAccount por esta)
// ===============================
function modalAccount(id=null){
  const a = id ? db.accounts.find(x=>x.id===id) : null;

  openModal(id ? "Editar conta" : "Nova conta", `
    <form id="accForm" class="form2" ${id ? `data-edit-id="${id}"` : ""}>
      <div class="field full">
        <label>Nome</label>
        <input class="input" id="accName" required value="${a?.nome||""}" placeholder="Ex: M-Pesa"/>
      </div>
      <div class="field">
        <label>Tipo</label>
        <select class="input" id="accType">
          ${["Mobile money","Banco","Dinheiro"].map(t=>`<option ${a?.tipo===t?"selected":""}>${t}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Saldo inicial (opcional)</label>
        <input class="input" type="number" step="0.01" min="0" id="accSaldo" value="${a?.saldo ?? 0}"/>
      </div>
      <div class="field">
        <label>Ativa?</label>
        <select class="input" id="accActive">
          <option value="true" ${a?.ativo!==false?"selected":""}>Sim</option>
          <option value="false" ${a?.ativo===false?"selected":""}>Não</option>
        </select>
      </div>
      <button class="btn big full" type="submit">${id?"Guardar":"Criar"}</button>
    </form>
  `);
}