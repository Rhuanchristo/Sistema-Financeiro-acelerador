import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { firebaseConfig, PARAMETROS_PADRAO } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const root = document.getElementById("app");

const URL_SISTEMA = "https://dashboard-financeiro-faaa2.web.app";
const ANO_ATUAL = new Date().getFullYear();
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Sugestões para o campo de categoria (o cliente também pode digitar uma nova).
const SUGESTOES = {
  receita: ["ADMICON", "ONIL", "Consultoria", "Assessoria"],
  despesa: ["Contabilidade", "Condomínio", "Advogado", "Pró-labore", "Aluguel", "Internet", "Impostos", "Comissão"],
};

const CATEGORIAS_PATRIMONIO = [
  ["imoveis", "Imóvel", "ativo"],
  ["veiculos", "Veículo", "ativo"],
  ["investimentos", "Investimento", "ativo"],
  ["empresas", "Empresa / participação", "ativo"],
  ["dividas", "Dívida", "divida"],
];

// ---------- Utilidades ----------
const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) => ((Number(v) || 0) * 100).toFixed(1).replace(".", ",") + "%";
const fmtPct = (v) => String(Math.round((Number(v) || 0) * 10000) / 100).replace(".", ",");
const emailKey = (e) => (e || "").trim().toLowerCase();
const num = (v) => {
  let s = String(v ?? "").trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return Number(s) || 0;
};
const soma = (arr) => arr.reduce((s, v) => s + v, 0);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function setView(node) {
  root.replaceChildren(node);
}

function kpi(rotulo, valor, fmt = brl) {
  return el("div", { class: "kpi" }, el("span", {}, rotulo), el("strong", {}, fmt(valor)));
}

// ---------- Meses ----------
function addMeses(ym, k) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
const mesNome = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return MESES[m - 1] + "/" + y;
};
const mesAtual = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};

// ---------- Cálculos ----------
// Cada lançamento parcelado vira N linhas mensais. O último mês absorve os centavos.
const entidadeDe = (l) => (l.entidade === "empresa" ? "empresa" : "pessoa");

function expandirLancamentos(lista) {
  const linhas = [];
  for (const l of lista) {
    const n = Math.max(1, Number(l.parcelas) || 1);
    const total = num(l.valorTotal);
    const base = Math.floor((total * 100) / n) / 100;
    for (let i = 0; i < n; i++) {
      const valor = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
      linhas.push({ tipo: l.tipo, categoria: l.categoria, mes: addMeses(l.mesInicial, i), valor });
    }
  }
  return linhas;
}

function resumoAno(lancamentos, ano, params = PARAMETROS_PADRAO) {
  const linhas = expandirLancamentos(lancamentos).filter((r) => r.mes.startsWith(ano + "-"));
  const meses = Array.from({ length: 12 }, () => ({ receitas: {}, despesas: {}, bruta: 0, despesasTotal: 0 }));

  for (const r of linhas) {
    const m = meses[Number(r.mes.slice(5, 7)) - 1];
    if (r.tipo === "receita") {
      m.receitas[r.categoria] = (m.receitas[r.categoria] || 0) + r.valor;
      m.bruta += r.valor;
    } else {
      m.despesas[r.categoria] = (m.despesas[r.categoria] || 0) + r.valor;
      m.despesasTotal += r.valor;
    }
  }

  for (const m of meses) {
    m.lucro = m.bruta - m.despesasTotal;
    m.margem = m.bruta ? m.lucro / m.bruta : 0;
  }

  const catsR = [...new Set(linhas.filter((r) => r.tipo === "receita").map((r) => r.categoria))].sort();
  const catsD = [...new Set(linhas.filter((r) => r.tipo === "despesa").map((r) => r.categoria))].sort();
  const total = (k) => soma(meses.map((m) => m[k]));
  const totais = {
    bruta: total("bruta"),
    despesas: total("despesasTotal"),
    lucro: total("lucro"),
  };
  totais.margem = totais.bruta ? totais.lucro / totais.bruta : 0;
  return { meses, catsR, catsD, totais };
}

function calcPatrimonio(itens) {
  let ativos = 0, dividas = 0;
  for (const it of itens) {
    const cat = CATEGORIAS_PATRIMONIO.find(([k]) => k === it.categoria);
    if (!cat) continue;
    if (cat[2] === "divida") dividas += num(it.valor);
    else ativos += num(it.valor);
  }
  return { ativos, dividas, liquido: ativos - dividas };
}

// ---------- Acesso a dados ----------
async function listar(caminho) {
  const snap = await getDocs(collection(db, ...caminho));
  const itens = [];
  snap.forEach((d) => itens.push({ id: d.id, ...d.data() }));
  return itens;
}

const carregarLancamentos = (email) => listar(["users", email, "lancamentos"]);
const carregarPatrimonio = (email) => listar(["users", email, "patrimonio"]);

async function carregarParametros(email) {
  const snap = await getDoc(doc(db, "users", email, "config", "parametros"));
  return snap.exists() ? { ...PARAMETROS_PADRAO, ...snap.data() } : { ...PARAMETROS_PADRAO };
}

// ---------- Ferramentas em janela própria (Home Conect) ----------
const TITULOS_FERRAMENTA = {
  "open-finance": "Open Finance",
  "metas": "Plano de metas",
  "aposentadoria": "Planejamento de aposentadoria",
};

// Seção do painel do cliente na URL: #/secao/{nome}[?cliente=email] (usada pelo menu das ferramentas).
function lerSecao() {
  const m = location.hash.match(/^#\/secao\/(dashboard|lancamento|receitas|patrimonio|home)(?:\?cliente=(.+))?$/);
  return m ? { secao: m[1], cliente: m[2] ? decodeURIComponent(m[2]) : null } : null;
}

function irPara(hash) {
  location.hash = hash;
  location.reload();
}

function lerFerramenta() {
  const m = location.hash.match(/^#\/ferramenta\/([a-z-]+)(?:\?cliente=(.+))?$/);
  return m ? { tipo: m[1], cliente: m[2] ? decodeURIComponent(m[2]) : null } : null;
}

function mesesEntre(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function abrirFerramenta(ctx, tipo) {
  const q = ctx.modo === "admin" ? "?cliente=" + encodeURIComponent(ctx.email) : "";
  window.open(window.location.origin + "/#/ferramenta/" + tipo + q, "_blank", "noopener");
}

function telaHome(ctx) {
  const cartoes = [
    ["open-finance", "Open Finance", "Conexão com contas bancárias para importar lançamentos e saldos.", "Em breve"],
    ["metas", "Plano de metas", "Defina objetivos financeiros e veja quanto poupar por mês para alcançá-los."],
    ["aposentadoria", "Planejamento de aposentadoria", "Estime o capital necessário e o aporte mensal para a renda desejada."],
  ];
  return el("div", {},
    el("p", { class: "muted" }, "Cada ferramenta abre em uma nova janela."),
    el("div", { class: "kpis" }, cartoes.map(([tipo, titulo, desc, aviso]) => el("section", { class: "card", style: "margin:0" },
      el("h2", {}, titulo),
      el("p", { class: "muted" }, desc),
      aviso ? el("p", {}, el("span", { class: "badge off" }, aviso)) : null,
      el("button", { onclick: () => abrirFerramenta(ctx, tipo) }, "Abrir em nova janela"),
    ))),
  );
}

async function abrirSecaoSegura(user, email, s) {
  try {
    const adminSnap = await getDoc(doc(db, "admins", email));
    if (adminSnap.exists()) {
      if (!s.cliente) return renderAdmin(user);
      const alvo = emailKey(s.cliente);
      const perfil = await getDoc(doc(db, "users", alvo));
      const nome = perfil.exists() ? (perfil.data().nome || alvo) : alvo;
      return renderPortal({ user, email: alvo, nome, modo: "admin", ano: ANO_ATUAL }, s.secao);
    }
    const userSnap = await getDoc(doc(db, "users", email));
    if (userSnap.exists() && userSnap.data().ativo) {
      return renderPortal({ user, email, nome: userSnap.data().nome || email, modo: "cliente", ano: ANO_ATUAL }, s.secao);
    }
    return renderNegado("Este e-mail não tem acesso ao sistema. Fale com o administrador.");
  } catch (err) {
    console.error(err);
    return renderNegado("Erro ao abrir a página. Tente novamente.");
  }
}

async function abrirFerramentaSeguro(user, email, f) {
  try {
    const adminSnap = await getDoc(doc(db, "admins", email));
    const admin = adminSnap.exists();
    let alvo = email;
    if (admin) {
      alvo = f.cliente ? emailKey(f.cliente) : null;
    } else {
      const us = await getDoc(doc(db, "users", email));
      if (!(us.exists() && us.data().ativo)) {
        return renderNegado("Este e-mail não tem acesso ao sistema. Fale com o administrador.");
      }
    }
    if (!alvo) return renderNegado("Abra esta ferramenta pelo painel de um cliente.");
    const perfil = await getDoc(doc(db, "users", alvo));
    const nome = perfil.exists() ? (perfil.data().nome || alvo) : alvo;
    return renderFerramenta({ user, email: alvo, nome, modo: admin ? "admin" : "cliente" }, f.tipo);
  } catch (err) {
    console.error(err);
    return renderNegado("Erro ao abrir a ferramenta. Tente novamente.");
  }
}

function menuFerramenta(ctx, tipo) {
  const sufixo = ctx.modo === "admin" ? "?cliente=" + encodeURIComponent(ctx.email) : "";
  const secoes = [["dashboard", "Dashboard"], ["lancamento", "Lançamento"], ["receitas", "Receitas e despesas"], ["patrimonio", "Patrimônio"]];
  const ferramentas = [["open-finance", "Open Finance"], ["metas", "Plano de metas"], ["aposentadoria", "Planejamento de aposentadoria"]];
  return [
    ctx.modo === "admin" ? el("button", { class: "menu-item", onclick: () => irPara("#/") }, "← Clientes") : null,
    secoes.map(([k, l]) => el("button", { class: "menu-item", onclick: () => irPara("#/secao/" + k + sufixo) }, l)),
    el("div", { class: "muted", style: "padding:10px 4px 4px;font-size:12px" }, "Home Conect"),
    ferramentas.map(([k, l]) => el("button", { class: "menu-item" + (k === tipo ? " ativo" : ""), onclick: () => irPara("#/ferramenta/" + k + sufixo) }, l)),
  ];
}

async function renderFerramenta(ctx, tipo) {
  const slot = el("div", {}, el("p", { class: "muted" }, "Carregando..."));
  setView(el("div", {},
    el("header", {},
      el("h1", {}, TITULOS_FERRAMENTA[tipo] || "Ferramenta"),
      el("div", { class: "row", style: "margin:0;align-items:center" },
        el("span", { class: "muted", style: "color:#dbe7f3" }, ctx.nome),
        el("button", { class: "light", onclick: () => { window.location.href = window.location.origin + "/"; } }, "← Voltar ao menu"),
        el("button", { class: "ghost", style: "color:#fff;border-color:#fff", onclick: () => window.close() }, "Fechar janela"),
      ),
    ),
    el("div", { class: "corpo" },
      el("aside", { class: "sidebar" }, ...menuFerramenta(ctx, tipo)),
      el("main", { class: "conteudo", style: "max-width:1100px;margin:0 auto" }, slot),
    ),
  ));

  if (tipo === "metas") return slot.replaceChildren(await telaMetas(ctx));
  if (tipo === "aposentadoria") {
    slot.replaceChildren(await telaAposentadoria(ctx));
    if (posRenderAposentadoria) posRenderAposentadoria();
    return;
  }
  return slot.replaceChildren(telaOpenFinance());
}

function telaOpenFinance() {
  return el("section", { class: "card" },
    el("h2", {}, "Conexão com contas bancárias"),
    el("p", {}, "Em breve: conexão via Open Finance para importar lançamentos e saldos automaticamente."),
    el("p", { class: "muted" }, "Enquanto isso, os lançamentos continuam sendo feitos manualmente na aba Lançamento."),
    el("button", { disabled: true }, "Conectar banco (em breve)"),
  );
}

async function telaMetas(ctx) {
  const metas = await listar(["users", ctx.email, "metas"]);
  const hoje = mesAtual();

  const nome = el("input", { type: "text", placeholder: "Ex.: Reserva de emergência", style: "min-width:220px" });
  const alvo = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", class: "num", style: "width:140px" });
  const atual = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", class: "num", style: "width:140px" });
  const prazo = el("input", { type: "month", value: addMeses(hoje, 12) });

  const salvar = async () => {
    if (!nome.value.trim()) return alert("Informe o nome da meta.");
    if (!(num(alvo.value) > 0)) return alert("Informe o valor da meta.");
    if (!prazo.value) return alert("Informe o prazo.");
    await addDoc(collection(db, "users", ctx.email, "metas"), {
      nome: nome.value.trim(),
      valorAlvo: num(alvo.value),
      valorAtual: num(atual.value),
      mesAlvo: prazo.value,
      criadoEm: new Date().toISOString(),
      criadoPor: ctx.user.email,
    });
    renderFerramenta(ctx, "metas");
  };

  const cartoes = metas.map((m) => {
    const restantes = Math.max(1, mesesEntre(hoje, m.mesAlvo));
    const falta = Math.max(0, num(m.valorAlvo) - num(m.valorAtual));
    const poupanca = falta / restantes;
    const progresso = m.valorAlvo ? Math.min(1, num(m.valorAtual) / num(m.valorAlvo)) : 0;
    const excluir = async () => {
      if (!confirm("Excluir esta meta?")) return;
      await deleteDoc(doc(db, "users", ctx.email, "metas", m.id));
      renderFerramenta(ctx, "metas");
    };
    return el("section", { class: "card" },
      el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
        el("h2", { style: "margin:0" }, m.nome),
        el("button", { class: "danger", onclick: excluir }, "Excluir"),
      ),
      el("p", { class: "muted" }, "Prazo: " + mesNome(m.mesAlvo) + " · " + restantes + " mês(es) restantes"),
      el("div", { style: "background:#e5e7eb;border-radius:99px;height:12px;overflow:hidden;margin:10px 0" },
        el("div", { style: "background:#15803d;height:100%;width:" + (progresso * 100).toFixed(1) + "%" }),
      ),
      el("div", { class: "kpis", style: "margin-bottom:0" },
        kpi("Valor alvo", m.valorAlvo),
        kpi("Já acumulado", m.valorAtual),
        kpi("Poupar por mês", poupanca),
      ),
    );
  });

  return el("div", {},
    el("section", { class: "card" },
      el("h2", {}, "Nova meta"),
      el("div", { class: "row" },
        el("label", {}, "Meta", nome),
        el("label", {}, "Valor alvo", alvo),
        el("label", {}, "Já tenho guardado", atual),
        el("label", {}, "Prazo (mês)", prazo),
        el("button", { onclick: salvar }, "Criar meta"),
      ),
    ),
    metas.length === 0 ? el("p", { class: "muted" }, "Nenhuma meta criada ainda.") : cartoes,
  );
}

// ---------- Planejamento de aposentadoria (simulador + projetos) ----------
const TIPOS_PROJETO = [
  ["viagem", "Viagem"], ["veiculo", "Veículo"], ["casa", "Casa"], ["familia", "Família"],
  ["eletronico", "Eletrônico"], ["educacao", "Educação"], ["hobby", "Hobby"],
  ["profissional", "Profissional"], ["saude", "Saúde"], ["outro", "Outro"],
  ["ajuste", "Ajuste da meta"], ["aporte", "Aportes financeiros"],
];
const PRIORIDADES_PROJETO = [["essencial", "Essencial"], ["desejo", "Desejo"], ["sonho", "Sonho"]];
const REPETICOES = [["unica", "Única"], ["mensal", "Mensal"], ["anual", "Anual"], ["personalizado", "A cada N anos"]];
const PARAMS_APOSENT = {
  idadeAtual: 35,
  idadeAposentadoria: 65,
  rendaDesejada: 10000,
  outrasRendas: 0,
  investimentoMensal: 0,
  rentabilidadeReal: 0.04,
};
const IDADE_FINAL = 100;
let graficoSimulacao = null;
let posRenderAposentadoria = null;

const nomeTipo = (k) => (TIPOS_PROJETO.find(([c]) => c === k) || [])[1] || k;
const nomePrioridade = (k) => (PRIORIDADES_PROJETO.find(([c]) => c === k) || [])[1] || k;

function descricaoForma(pr) {
  if (pr.aPrazo) return (pr.quantidade || 1) + "x parcelas mensais";
  if (!pr.repeticao || pr.repeticao === "unica") return "Única";
  const qtd = pr.quantidade || 1;
  if (pr.repeticao === "mensal") return qtd + "x mensal";
  if (pr.repeticao === "anual") return qtd + "x anual";
  return qtd + "x a cada " + (pr.intervaloAnos || 1) + " anos";
}

// Lista de [índice do mês relativo ao início, valor] de cada ocorrência do projeto.
function ocorrenciasProjeto(pr, mesInicio, total) {
  const out = [];
  const base = mesesEntre(mesInicio, pr.dataExecucao || mesInicio);
  const qtd = Math.max(1, Math.floor(num(pr.quantidade)) || 1);
  const v = num(pr.valorTotal);
  if (pr.aPrazo) {
    const parcela = v / qtd;
    for (let k = 0; k < qtd; k++) {
      if (base + k >= 0 && base + k < total) out.push([base + k, parcela]);
    }
    return out;
  }
  const passo =
    pr.repeticao === "mensal" ? 1 :
    pr.repeticao === "anual" ? 12 :
    pr.repeticao === "personalizado" ? Math.max(1, Math.floor(num(pr.intervaloAnos)) || 1) * 12 : 0;
  const n = passo ? qtd : 1;
  for (let k = 0; k < n; k++) {
    const idx = base + k * passo;
    if (idx >= 0 && idx < total) out.push([idx, v]);
  }
  return out;
}

// Projeção mensal em termos reais. Aportes financeiros entram; os demais projetos saem.
function projetar(p, projetos, capitalInicial, mesInicio) {
  const i = Math.pow(1 + num(p.rentabilidadeReal), 1 / 12) - 1;
  const total = Math.max(1, Math.round((IDADE_FINAL - num(p.idadeAtual)) * 12));
  const nRet = Math.min(total, Math.max(0, Math.round((num(p.idadeAposentadoria) - num(p.idadeAtual)) * 12)));
  const saque = Math.max(0, num(p.rendaDesejada) - num(p.outrasRendas));
  const aporte = Math.max(0, num(p.investimentoMensal));

  const mov = new Array(total).fill(0);
  const eventos = Array.from({ length: total }, () => []);
  for (const pr of projetos) {
    const sinal = pr.tipo === "aporte" ? 1 : -1;
    for (const [idx, v] of ocorrenciasProjeto(pr, mesInicio, total)) {
      mov[idx] += sinal * v;
      eventos[idx].push({ nome: pr.nome || nomeTipo(pr.tipo), tipo: pr.tipo, valor: sinal * v });
    }
  }

  // V[t]: capital necessário no início do mês t para cobrir saques e projetos até o fim.
  const V = new Array(total + 1).fill(0);
  for (let t = total - 1; t >= nRet; t--) {
    V[t] = (V[t + 1] + saque) / (1 + i) - mov[t];
  }
  const idealRet = Math.max(0, V[nRet]);

  // Aporte mensal necessário para o capital chegar a idealRet na aposentadoria.
  let fvAtual = capitalInicial * Math.pow(1 + i, nRet);
  for (let t = 0; t < nRet; t++) fvAtual += mov[t] * Math.pow(1 + i, nRet - t);
  const fatorAporte = nRet === 0 ? 0 : (i > 0 ? ((1 + i) * (Math.pow(1 + i, nRet) - 1)) / i : nRet);
  const aporteNecessario = nRet === 0 ? 0 : Math.max(0, (idealRet - fvAtual) / fatorAporte);

  const serie = { idade: [], mes: [], total: [], principal: [], ideal: [] };
  let cap = capitalInicial;
  let princ = capitalInicial;
  for (let t = 0; t <= total; t++) {
    serie.idade.push(num(p.idadeAtual) + t / 12);
    serie.mes.push(addMeses(mesInicio, t));
    serie.total.push(cap);
    serie.principal.push(princ);
    serie.ideal.push(t < nRet ? idealRet / Math.pow(1 + i, nRet - t) : V[t]);
    if (t === total) break;
    if (t < nRet) {
      const fluxo = aporte + mov[t];
      cap = (cap + fluxo) * (1 + i);
      princ += fluxo;
    } else {
      cap = (cap + mov[t]) * (1 + i) - saque;
      princ += mov[t] - saque;
    }
  }

  return { serie, idealRet, aporteNecessario, total, nRet, i, eventos, mov };
}

function desenharSimulacao(canvasId, res, horizonteAnos, mostrarNeg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  const H = horizonteAnos ? Math.min(res.total, horizonteAnos * 12) : res.total;
  const vis = (v) => (mostrarNeg ? v : Math.max(0, v));
  const idades = res.serie.idade.slice(0, H + 1);
  const NOME_EVENTOS = "Projetos e aportes";
  const ICONES = {
    viagem: "🏖️", veiculo: "🚗", casa: "🏠", familia: "👨‍👩‍👧", eletronico: "💻", educacao: "🎓",
    hobby: "🎨", profissional: "💼", saude: "🩺", outro: "📌", ajuste: "⚙️", aporte: "💰",
  };

  // Série em degraus: cada movimento vira um salto vertical no mês em que ocorre.
  const degraus = (valores, saltos) => {
    const pts = [];
    for (let k = 0; k <= H; k++) {
      const v = valores[k];
      const s = k < H ? (saltos[k] || 0) : 0;
      pts.push({ x: idades[k], y: vis(v) });
      if (s !== 0) pts.push({ x: idades[k], y: vis(v + s) });
    }
    return pts;
  };

  // Marcadores dos projetos e aportes, no topo de cada salto.
  const evList = [];
  for (let k = 0; k < H; k++) {
    const ev = res.eventos[k] || [];
    if (!ev.length) continue;
    const s = ev.reduce((a, e) => a + e.valor, 0);
    evList.push({ x: idades[k], y: vis(res.serie.total[k] + s), lista: ev, icone: ICONES[ev[0].tipo] || "📌" });
  }

  const iconesPlugin = {
    id: "iconesEventos",
    afterDatasetsDraw(chart) {
      const idx = chart.data.datasets.findIndex((d) => d.isEventos);
      if (idx < 0) return;
      const meta = chart.getDatasetMeta(idx);
      const c2 = chart.ctx;
      meta.data.forEach((pt, j) => {
        const ev = evList[j];
        if (!ev) return;
        c2.save();
        c2.beginPath();
        c2.arc(pt.x, pt.y - 24, 13, 0, Math.PI * 2);
        c2.fillStyle = "#e6f7f5";
        c2.fill();
        c2.lineWidth = 2;
        c2.strokeStyle = "#0f766e";
        c2.stroke();
        c2.font = "14px sans-serif";
        c2.textAlign = "center";
        c2.textBaseline = "middle";
        c2.fillStyle = "#0f172a";
        c2.fillText(ev.icone, pt.x, pt.y - 24);
        c2.beginPath();
        c2.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        c2.fillStyle = "#ffffff";
        c2.fill();
        c2.lineWidth = 2;
        c2.strokeStyle = "#0f766e";
        c2.stroke();
        c2.restore();
      });
    },
  };

  if (graficoSimulacao) graficoSimulacao.destroy();
  graficoSimulacao = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        { label: "Patrimônio total projetado", data: degraus(res.serie.total, res.mov), borderColor: "#8fb04a", backgroundColor: "rgba(163,194,91,0.35)", fill: "origin", pointRadius: 0, borderWidth: 3 },
        { label: "Patrimônio principal investido", data: degraus(res.serie.principal, res.mov), borderColor: "#5b7fb0", backgroundColor: "rgba(91,127,176,0.55)", fill: "origin", pointRadius: 0, borderWidth: 3 },
        { label: "Aposentadoria ideal", data: idades.map((x, k) => ({ x, y: vis(res.serie.ideal[k]) })), borderColor: "#e07b24", backgroundColor: "#e07b24", fill: false, pointRadius: 0, tension: 0.2 },
        { label: NOME_EVENTOS, data: evList.map((e) => ({ x: e.x, y: e.y })), borderColor: "#0f766e", backgroundColor: "#ffffff", showLine: false, pointRadius: 0, pointHoverRadius: 0, isEventos: true },
      ],
    },
    plugins: [iconesPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, filter: (item) => item.text !== NOME_EVENTOS } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items[0].parsed.x;
              const k = Math.min(Math.max(0, Math.round((x - res.serie.idade[0]) * 12)), res.serie.mes.length - 1);
              return mesNome(res.serie.mes[k]) + ": " + Math.floor(x) + " anos";
            },
            label: (c) => {
              if (c.dataset.isEventos) {
                const ev = evList[c.dataIndex];
                return ev ? ev.lista.map((e) => (e.valor >= 0 ? "+ " : "− ") + e.nome + ": " + brl(Math.abs(e.valor))) : "";
              }
              return c.dataset.label + ": " + brl(c.parsed.y);
            },
          },
        },
      },
      scales: {
        x: { type: "linear", min: idades[0], max: idades[idades.length - 1], ticks: { stepSize: 5, callback: (v) => Math.round(v) }, title: { display: true, text: "Idade" } },
        y: { min: mostrarNeg ? undefined : 0, ticks: { callback: (v) => brl(v) } },
      },
    },
  });
}

async function telaAposentadoria(ctx) {
  posRenderAposentadoria = null;
  const [cfgSnap, patrimonio, projetos] = await Promise.all([
    getDoc(doc(db, "users", ctx.email, "config", "aposentadoria")),
    carregarPatrimonio(ctx.email),
    listar(["users", ctx.email, "projetos"]),
  ]);
  const p = { ...PARAMS_APOSENT, ...(cfgSnap.exists() ? cfgSnap.data() : {}) };
  const capitalInicial = soma(patrimonio.filter((it) => it.categoria === "investimentos").map((it) => num(it.valor)));
  const mesInicio = mesAtual();
  let horizonteAnos = null;
  let mostrarNeg = false;
  const canvasId = "grafico-aposentadoria";

  const resumo = el("p", { style: "font-size:17px;line-height:1.5;margin:0 0 12px" });

  const recalc = () => {
    const res = projetar(p, projetos, capitalInicial, mesInicio);
    resumo.replaceChildren(
      "Você precisa investir ", el("strong", {}, brl(res.aporteNecessario)),
      "/mês para chegar na sua aposentadoria ideal com ", el("strong", {}, brl(res.idealRet)), " acumulados.",
    );
    desenharSimulacao(canvasId, res, horizonteAnos, mostrarNeg);
  };

  const opcoesHoriz = [["2 anos", 2], ["5 anos", 5], ["10 anos", 10], ["Máximo", null]];
  const botoesHoriz = opcoesHoriz.map(([rotulo, anos]) => {
    const b = el("button", {
      class: "ghost",
      onclick: () => { horizonteAnos = anos; atualizarBotoes(); recalc(); },
    }, rotulo);
    b.dataset.anos = anos === null ? "max" : String(anos);
    return b;
  });
  const atualizarBotoes = () => {
    botoesHoriz.forEach((b) => {
      const ativo = (b.dataset.anos === "max" && horizonteAnos === null) || b.dataset.anos === String(horizonteAnos);
      b.style.background = ativo ? "#e8f0f8" : "transparent";
    });
  };
  atualizarBotoes();

  const toggleNeg = el("input", { type: "checkbox", checked: false });
  toggleNeg.addEventListener("change", () => { mostrarNeg = toggleNeg.checked; recalc(); });

  const slider = (rotulo, chave, min, max, passo, fmt) => {
    const valorEl = el("strong", {}, fmt(num(p[chave])));
    const range = el("input", { type: "range", min: String(min), max: String(max), step: String(passo), value: String(num(p[chave])), style: "width:100%" });
    const campo = el("input", { type: "number", min: "0", step: String(passo), value: String(num(p[chave])), style: "width:130px" });
    const aplicar = (v) => {
      p[chave] = v;
      valorEl.textContent = fmt(v);
      if (document.activeElement !== range) range.value = String(Math.min(max, Math.max(min, v)));
      if (document.activeElement !== campo) campo.value = String(v);
      recalc();
    };
    range.addEventListener("input", () => aplicar(Number(range.value)));
    campo.addEventListener("input", () => aplicar(Number(campo.value) || 0));
    return el("div", { style: "margin-bottom:18px" },
      el("div", { class: "row", style: "justify-content:space-between;margin:0 0 4px" }, el("span", {}, rotulo), valorEl),
      el("div", { class: "row", style: "margin:0;gap:8px;align-items:center" }, range, campo),
    );
  };

  const inputIdade = el("input", { type: "number", min: "1", max: "99", value: String(num(p.idadeAtual)), style: "width:120px" });
  inputIdade.addEventListener("input", () => { p.idadeAtual = Number(inputIdade.value) || 0; recalc(); });

  const inputRent = el("input", { type: "number", step: "0.1", value: (num(p.rentabilidadeReal) * 100).toFixed(2), style: "width:120px" });
  inputRent.addEventListener("input", () => { p.rentabilidadeReal = (Number(inputRent.value) || 0) / 100; recalc(); });

  const salvar = async () => {
    await setDoc(doc(db, "users", ctx.email, "config", "aposentadoria"), {
      idadeAtual: num(p.idadeAtual),
      idadeAposentadoria: num(p.idadeAposentadoria),
      rendaDesejada: num(p.rendaDesejada),
      outrasRendas: num(p.outrasRendas),
      investimentoMensal: num(p.investimentoMensal),
      rentabilidadeReal: num(p.rentabilidadeReal),
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });
    alert("Simulação salva.");
  };

  const topo = el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
    el("h2", { style: "margin:0" }, "Independência financeira"),
    el("label", { style: "flex-direction:row;align-items:center;gap:6px" }, toggleNeg, "Negativos"),
    el("div", { class: "row", style: "margin:0" }, botoesHoriz),
  );

  const cardSimulacao = el("section", { class: "card", style: "margin:0" },
    topo,
    resumo,
    el("div", { style: "position:relative;height:420px" }, el("canvas", { id: canvasId })),
  );

  const cardParametros = el("section", { class: "card", style: "margin:0" },
    el("h2", {}, "Parâmetros"),
    el("div", { class: "row", style: "margin:0 0 14px" }, el("label", {}, "Idade atual", inputIdade)),
    slider("Idade de aposentadoria", "idadeAposentadoria", 40, 90, 1, (v) => v + " anos"),
    slider("Renda desejada (mensal)", "rendaDesejada", 0, 100000, 500, brl),
    slider("Outras fontes de renda", "outrasRendas", 0, 50000, 500, brl),
    slider("Investimento mensal", "investimentoMensal", 0, 50000, 100, brl),
    el("div", { class: "row", style: "margin:0 0 14px" }, el("label", {}, "Rentabilidade real (% a.a.)", inputRent)),
    el("button", { onclick: salvar }, "Salvar simulação"),
  );

  const grade = el("div", { style: "display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px;align-items:start" },
    cardSimulacao,
    cardParametros,
  );

  const totalMeses = Math.max(1, Math.round((IDADE_FINAL - num(p.idadeAtual)) * 12));
  const ocorrencias = [];
  for (const pr of projetos) {
    const sinal = pr.tipo === "aporte" ? 1 : -1;
    for (const [idx, v] of ocorrenciasProjeto(pr, mesInicio, totalMeses)) {
      ocorrencias.push({ idx, mes: addMeses(mesInicio, idx), nome: pr.nome || nomeTipo(pr.tipo), tipo: pr.tipo, valor: sinal * v });
    }
  }
  ocorrencias.sort((a, b) => a.idx - b.idx);
  const totalAportes = soma(ocorrencias.filter((o) => o.valor > 0).map((o) => o.valor));
  const totalSaidas = soma(ocorrencias.filter((o) => o.valor < 0).map((o) => -o.valor));

  const lista = projetos.slice().sort((a, b) => (a.dataExecucao || "").localeCompare(b.dataExecucao || ""));
  const tabelaProjetos = lista.length === 0
    ? el("p", { class: "muted" }, "Nenhum projeto cadastrado ainda.")
    : el("div", { class: "scroll" },
        el("table", {},
          el("thead", {}, el("tr", {},
            el("th", {}, "Projeto"), el("th", {}, "Tipo"), el("th", {}, "Prioridade"),
            el("th", {}, "Data"), el("th", { class: "num" }, "Valor"), el("th", {}, "Forma"), el("th", {}, ""),
          )),
          el("tbody", {}, lista.map((pr) => el("tr", {},
            el("td", {}, pr.nome),
            el("td", {}, nomeTipo(pr.tipo)),
            el("td", {}, nomePrioridade(pr.prioridade)),
            el("td", {}, pr.dataExecucao ? mesNome(pr.dataExecucao) : "—"),
            el("td", { class: "num" }, brl(pr.valorTotal)),
            el("td", {}, descricaoForma(pr) + " · " + ocorrenciasProjeto(pr, mesInicio, totalMeses).length + " lançamento(s)"),
            el("td", {}, el("button", {
              class: "danger",
              onclick: async () => {
                if (!confirm("Excluir este projeto?")) return;
                await deleteDoc(doc(db, "users", ctx.email, "projetos", pr.id));
                renderFerramenta(ctx, "aposentadoria");
              },
            }, "Excluir")),
          ))),
        ),
      );

  const cronograma = ocorrencias.length === 0
    ? el("p", { class: "muted" }, "Nenhum lançamento provisionado.")
    : el("div", {},
        el("h3", {}, "Lançamentos provisionados no planejamento"),
        el("p", { class: "muted" }, "Total de aportes: " + brl(totalAportes) + " · Total de saídas: " + brl(totalSaidas) + " · " + ocorrencias.length + " lançamento(s)"),
        el("div", { class: "scroll", style: "max-height:360px;overflow:auto" },
          el("table", {},
            el("thead", {}, el("tr", {}, el("th", {}, "Mês"), el("th", {}, "Projeto"), el("th", {}, "Tipo"), el("th", { class: "num" }, "Movimento"))),
            el("tbody", {}, ocorrencias.map((o) => el("tr", {},
              el("td", {}, mesNome(o.mes)),
              el("td", {}, o.nome),
              el("td", {}, nomeTipo(o.tipo)),
              el("td", { class: "num", style: o.valor > 0 ? "color:#15803d" : "color:#b42318" }, (o.valor > 0 ? "+ " : "− ") + brl(Math.abs(o.valor))),
            ))),
          ),
        ),
      );

  const cardProjetos = el("section", { class: "card" },
    el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
      el("h2", { style: "margin:0" }, "Objetivos e projetos"),
      el("button", { onclick: () => abrirModalProjeto(ctx) }, "Novo projeto"),
    ),
    el("p", { class: "muted" },
      "Projetos de outros tipos saem do patrimônio na data informada. Aportes financeiros entram no patrimônio e funcionam como salto patrimonial.",
    ),
    tabelaProjetos,
    cronograma,
  );

  posRenderAposentadoria = recalc;
  return el("div", {}, grade, cardProjetos);
}

function abrirModalProjeto(ctx) {
  const f = {
    prioridade: "essencial",
    tipo: "viagem",
    nome: "",
    dataExecucao: mesAtual(),
    valorTotal: "",
    aPrazo: false,
    repeticao: "unica",
    quantidade: "1",
    intervaloAnos: "3",
  };
  const overlay = el("div", { style: "position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px" });
  const card = el("div", { style: "background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:92vh;overflow:auto;padding:24px" });
  const fechar = () => overlay.remove();
  const botao = (ativo, rotulo, onclick) => el("button", { class: ativo ? "" : "ghost", onclick }, rotulo);

  const salvarProjeto = async () => {
    const valor = num(f.valorTotal);
    const qtd = Math.floor(num(f.quantidade)) || 1;
    const intervalo = Math.floor(num(f.intervaloAnos)) || 1;
    if (!f.nome.trim()) return alert("Informe o nome do projeto.");
    if (!(valor > 0)) return alert("Informe o valor total.");
    if (!/^\d{4}-\d{2}$/.test(f.dataExecucao) || Number(f.dataExecucao.slice(0, 4)) < 2000) return alert("Informe o mês e o ano de execução.");
    if (qtd < 1 || qtd > 360) return alert("A quantidade deve estar entre 1 e 360.");
    if (!f.aPrazo && f.repeticao === "personalizado" && (intervalo < 1 || intervalo > 50)) {
      return alert("O intervalo deve estar entre 1 e 50 anos.");
    }
    await addDoc(collection(db, "users", ctx.email, "projetos"), {
      prioridade: f.prioridade,
      tipo: f.tipo,
      nome: f.nome.trim(),
      dataExecucao: f.dataExecucao,
      valorTotal: valor,
      aPrazo: f.aPrazo,
      repeticao: f.aPrazo ? "unica" : f.repeticao,
      intervaloAnos: f.repeticao === "personalizado" ? intervalo : null,
      quantidade: qtd,
      criadoEm: new Date().toISOString(),
      criadoPor: ctx.user.email,
    });
    fechar();
    renderFerramenta(ctx, "aposentadoria");
  };

  const desenhar = () => {
    const inputNome = el("input", { type: "text", value: f.nome, placeholder: "Ex.: Viagem para a Europa", style: "min-width:260px" });
    inputNome.addEventListener("input", () => { f.nome = inputNome.value; });

    const [anoIni, mesIni] = f.dataExecucao.split("-");
    const selMes = el("select", {}, MESES.map((m, i) => {
      const v = String(i + 1).padStart(2, "0");
      return el("option", { value: v, selected: mesIni === v }, m);
    }));
    const inputAno = el("input", { type: "number", min: "2000", max: "2100", value: anoIni, style: "width:110px" });
    const atualizaData = () => { f.dataExecucao = inputAno.value + "-" + selMes.value; };
    selMes.addEventListener("change", atualizaData);
    inputAno.addEventListener("input", atualizaData);

    const inputValor = el("input", { type: "text", inputmode: "decimal", value: f.valorTotal, placeholder: "R$ 0,00", style: "min-width:200px" });
    inputValor.addEventListener("input", () => { f.valorTotal = inputValor.value; });

    const selRep = el("select", { disabled: f.aPrazo }, REPETICOES.map(([v, r]) => el("option", { value: v, selected: f.repeticao === v }, r)));
    selRep.addEventListener("change", () => { f.repeticao = selRep.value; desenhar(); });

    const inputQtd = el("input", { type: "number", min: "1", value: f.quantidade, style: "width:120px" });
    inputQtd.addEventListener("input", () => { f.quantidade = inputQtd.value; });

    const inputIntervalo = el("input", { type: "number", min: "1", max: "50", value: f.intervaloAnos, style: "width:120px" });
    inputIntervalo.addEventListener("input", () => { f.intervaloAnos = inputIntervalo.value; });

    const mostrarIntervalo = !f.aPrazo && f.repeticao === "personalizado";

    card.replaceChildren(
      el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
        el("h2", { style: "margin:0" }, "Novo projeto"),
        el("button", { class: "ghost", onclick: fechar }, "Fechar"),
      ),
      el("h3", {}, "Prioridade do projeto"),
      el("div", { class: "row", style: "margin:0 0 14px" },
        PRIORIDADES_PROJETO.map(([v, r]) => botao(f.prioridade === v, r, () => { f.prioridade = v; desenhar(); })),
      ),
      el("h3", {}, "Tipo do projeto"),
      el("div", { class: "row", style: "margin:0 0 14px" },
        TIPOS_PROJETO.map(([v, r]) => botao(f.tipo === v, r, () => { f.tipo = v; desenhar(); })),
      ),
      el("div", { class: "row" },
        el("label", {}, "Nome do projeto", inputNome),
        el("label", {}, "Mês e ano de execução", el("div", { class: "row", style: "margin:0;gap:8px" }, selMes, inputAno)),
        el("label", {}, "Valor total", inputValor),
      ),
      el("h3", {}, "Projeto a prazo (parcelado)"),
      el("div", { class: "row", style: "margin:0 0 14px" },
        botao(!f.aPrazo, "Não", () => { f.aPrazo = false; desenhar(); }),
        botao(f.aPrazo, "Sim", () => { f.aPrazo = true; desenhar(); }),
      ),
      el("div", { class: "row" },
        el("label", {}, "Repetição", selRep),
        mostrarIntervalo ? el("label", {}, "Intervalo (anos)", inputIntervalo) : null,
        el("label", {}, f.aPrazo ? "Número de parcelas mensais" : "Quantidade de repetições", inputQtd),
      ),
      el("p", { class: "muted" }, f.aPrazo
        ? "O valor total é dividido igualmente nas parcelas mensais, a partir do mês informado."
        : "O valor total é o de cada ocorrência. Repetição mensal, anual ou a cada N anos repete o valor pelo número de repetições informado."),
      el("div", { class: "row" }, el("button", { onclick: salvarProjeto }, "Salvar projeto")),
    );
  };

  overlay.append(card);
  document.body.append(overlay);
  desenhar();
}

// ---------- Login e roteamento ----------
function renderLogin() {
  setView(el("div", { class: "center" },
    el("div", { class: "login" },
      el("h1", {}, "Financeiro & Patrimônio"),
      el("p", { class: "muted" }, "Entre com sua conta Google para acessar seu painel."),
      el("button", { onclick: entrarComGoogle }, "Entrar com Google"),
      el("div", { id: "msg", class: "msg" }),
    ),
  ));
}

async function entrarComGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const msg = document.getElementById("msg");
    if (msg) msg.textContent = "Não foi possível entrar. Tente novamente.";
  }
}

function renderNegado(mensagem) {
  setView(el("div", { class: "center" },
    el("div", { class: "login" },
      el("h1", {}, "Acesso não autorizado"),
      el("p", { class: "muted" }, mensagem),
      el("button", { class: "ghost", onclick: () => signOut(auth) }, "Sair"),
    ),
  ));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return renderLogin();
  const email = emailKey(user.email);

  if (!user.emailVerified) {
    return renderNegado("Sua conta Google precisa ter o e-mail verificado.");
  }

  const ferramenta = lerFerramenta();
  if (ferramenta) return abrirFerramentaSeguro(user, email, ferramenta);

  const secaoUrl = lerSecao();
  if (secaoUrl) return abrirSecaoSegura(user, email, secaoUrl);

  try {
    const adminSnap = await getDoc(doc(db, "admins", email));
    if (adminSnap.exists()) return renderAdmin(user);

    const userSnap = await getDoc(doc(db, "users", email));
    if (userSnap.exists() && userSnap.data().ativo) return renderPortal({ user, email, nome: userSnap.data().nome || email, modo: "cliente", ano: ANO_ATUAL }, "dashboard");

    return renderNegado("Este e-mail não tem acesso ao sistema. Fale com o administrador.");
  } catch (err) {
    console.error(err);
    return renderNegado("Erro ao verificar seu acesso. Tente novamente mais tarde.");
  }
});

// ---------- Painel do administrador ----------
function adminShell(user, ativa, conteudo) {
  const itens = [["clientes", "Clientes"], ["dashboard", "Dashboard"], ["oportunidade", "Oportunidade"]];
  return el("div", {},
    el("header", {},
      el("h1", {}, "Painel do administrador"),
      el("div", { class: "row", style: "margin:0;align-items:center" },
        el("span", { class: "muted", style: "color:#dbe7f3" }, user.email),
        el("button", { class: "light", onclick: () => signOut(auth) }, "Sair"),
      ),
    ),
    el("div", { class: "corpo" },
      el("aside", { class: "sidebar" },
        itens.map(([k, l]) => el("button", {
          class: "menu-item" + (k === ativa ? " ativo" : ""),
          onclick: () => renderAdmin(user, k),
        }, l)),
      ),
      el("main", { class: "conteudo" }, conteudo),
    ),
  );
}

async function renderAdmin(user, secao = "clientes") {
  const slot = el("div", {}, el("p", { class: "muted" }, "Carregando..."));
  setView(adminShell(user, secao, slot));
  if (secao === "dashboard") return montarDashboard(user, slot);
  if (secao === "oportunidade") {
    slot.replaceChildren(el("section", { class: "card" },
      el("h2", {}, "Oportunidade"),
      el("p", { class: "muted" }, "Em breve."),
    ));
    return;
  }
  return montarClientes(user, slot);
}

async function carregarUsuarios() {
  const snap = await getDocs(collection(db, "users"));
  const usuarios = [];
  snap.forEach((d) => usuarios.push({ email: d.id, ...d.data() }));
  usuarios.sort((a, b) => a.email.localeCompare(b.email));
  return usuarios;
}

async function montarDashboard(user, conteudo) {
  const usuarios = await carregarUsuarios();
  conteudo.replaceChildren(await renderConsolidado(usuarios));
}

async function montarClientes(user, conteudo) {
  const [usuarios, adminsSnap] = await Promise.all([
    carregarUsuarios(),
    getDocs(collection(db, "admins")),
  ]);

  const admins = [];
  adminsSnap.forEach((d) => admins.push(d.id));

  const emailNovo = el("input", { type: "email", placeholder: "email@gmail.com", style: "min-width:260px" });
  const nomeNovo = el("input", { type: "text", placeholder: "Nome" });
  const emailAdmin = el("input", { type: "email", placeholder: "admin@gmail.com", style: "min-width:260px" });

  const tabelaUsuarios = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Nome"), el("th", {}, "E-mail"), el("th", {}, "Status"), el("th", {}, ""),
    )),
    el("tbody", {}, usuarios.map((u) => el("tr", {},
      el("td", {}, u.nome || "—"),
      el("td", {}, u.email),
      el("td", {}, el("span", { class: u.ativo ? "badge" : "badge off" }, u.ativo ? "Ativo" : "Inativo")),
      el("td", {}, el("div", { class: "row", style: "margin:0" },
        el("button", { class: "ghost", onclick: () => abrirEditorUsuario(user, u) }, "Abrir painel"),
        el("button", {
          class: "ghost",
          onclick: async () => {
            await updateDoc(doc(db, "users", u.email), { ativo: !u.ativo });
            renderAdmin(user);
          },
        }, u.ativo ? "Desativar" : "Ativar"),
        el("a", {
          href: linkConvite(u),
          style: "display:inline-block;padding:8px 14px;border:1px solid var(--accent);border-radius:6px;color:var(--accent);text-decoration:none;font-size:14px",
        }, "Enviar convite"),
        el("button", { class: "danger", onclick: () => excluirUsuario(user, u) }, "Excluir"),
      )),
    ))),
  );

  const formNovoUsuario = el("div", { class: "row" },
    el("label", {}, "E-mail Google", emailNovo),
    el("label", {}, "Nome", nomeNovo),
    el("button", {
      onclick: async () => {
        const key = emailKey(emailNovo.value);
        if (!key.includes("@")) return alert("Informe um e-mail válido.");
        await setDoc(doc(db, "users", key), {
          email: key,
          nome: nomeNovo.value.trim(),
          ativo: true,
          criadoEm: new Date().toISOString(),
        }, { merge: true });
        location.href = linkConvite({ email: key, nome: nomeNovo.value.trim() });
        renderAdmin(user);
      },
    }, "Cadastrar usuário"),
  );

  const listaAdmins = el("ul", {}, admins.map((a) => el("li", {},
    a, " ",
    a !== emailKey(user.email) && el("button", {
      class: "ghost",
      style: "margin-left:8px;padding:2px 8px",
      onclick: async () => {
        if (!confirm("Remover " + a + " da lista de administradores?")) return;
        await deleteDoc(doc(db, "admins", a));
        renderAdmin(user);
      },
    }, "Remover"),
  )));

  const formNovoAdmin = el("div", { class: "row" },
    el("label", {}, "E-mail do novo administrador", emailAdmin),
    el("button", {
      onclick: async () => {
        const key = emailKey(emailAdmin.value);
        if (!key.includes("@")) return alert("Informe um e-mail válido.");
        await setDoc(doc(db, "admins", key), { email: key, criadoEm: new Date().toISOString() });
        renderAdmin(user);
      },
    }, "Adicionar admin"),
  );

  conteudo.replaceChildren(
    el("section", { class: "card" },
      el("h2", {}, "Usuários"),
      formNovoUsuario,
      el("div", { class: "scroll" }, tabelaUsuarios),
      usuarios.length === 0 && el("p", { class: "muted" }, "Nenhum usuário cadastrado ainda."),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Administradores"),
      listaAdmins,
      formNovoAdmin,
    ),
  );
}

// Exclui o usuário e todos os seus dados (lançamentos, patrimônio e configuração).
async function excluirUsuario(user, u) {
  const nome = u.nome || u.email;
  if (!confirm("Excluir " + nome + "? Todos os lançamentos e o patrimônio dele serão apagados. Esta ação não pode ser desfeita.")) return;
  try {
    for (const sub of ["lancamentos", "patrimonio", "fluxo", "config"]) {
      const snap = await getDocs(collection(db, "users", u.email, sub));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }
    await deleteDoc(doc(db, "users", u.email));
    renderAdmin(user);
  } catch (err) {
    console.error(err);
    alert("Não foi possível excluir o usuário. Tente novamente.");
  }
}

// Monta um e-mail pronto (abre no app de e-mail do administrador) com o convite de acesso.
function linkConvite(usuario) {
  const assunto = encodeURIComponent("Acesso ao seu painel Financeiro & Patrimônio");
  const corpo = encodeURIComponent(
    "Olá" + (usuario.nome ? ", " + usuario.nome : "") + "!\n\n" +
    "Seu acesso ao painel financeiro e patrimonial já está liberado.\n\n" +
    "Para entrar, acesse:\n" + URL_SISTEMA + "\n\n" +
    "Use a conta Google " + usuario.email + " para fazer login.\n\n" +
    "Qualquer dúvida, é só responder este e-mail."
  );
  return "mailto:" + usuario.email + "?subject=" + assunto + "&body=" + corpo;
}

// Visão consolidada de todos os clientes (painel do administrador).
async function renderConsolidado(usuarios) {
  const hoje = mesAtual();
  const ano = Number(hoje.slice(0, 4));
  const financeiro = [];
  const aposentadoria = [];
  for (const u of usuarios) {
    const nome = u.nome || u.email;
    const [itens, lancs, cfgSnap, projetos] = await Promise.all([
      carregarPatrimonio(u.email),
      carregarLancamentos(u.email),
      getDoc(doc(db, "users", u.email, "config", "aposentadoria")),
      listar(["users", u.email, "projetos"]),
    ]);
    financeiro.push({
      nome,
      emp: resumoAno(lancs.filter((l) => entidadeDe(l) === "empresa"), ano).totais,
      pf: resumoAno(lancs.filter((l) => entidadeDe(l) === "pessoa"), ano).totais,
    });
    if (cfgSnap.exists() || projetos.length > 0) {
      const p = { ...PARAMS_APOSENT, ...(cfgSnap.exists() ? cfgSnap.data() : {}) };
      const capital = soma(itens.filter((it) => it.categoria === "investimentos").map((it) => num(it.valor)));
      const res = projetar(p, projetos, capital, hoje);
      aposentadoria.push({ nome, p, projetos: projetos.length, res });
    }
  }

  const celNum = (v) => el("td", { class: "num" }, brl(v));
  const tot = (campo, grupo) => soma(financeiro.map((f) => f[grupo][campo]));
  const linhaTotal = el("tr", { class: "total" },
    el("td", {}, "Total"),
    celNum(tot("bruta", "emp")), celNum(tot("despesas", "emp")), celNum(tot("lucro", "emp")),
    celNum(tot("bruta", "pf")), celNum(tot("despesas", "pf")), celNum(tot("lucro", "pf")),
  );
  const tabelaFin = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Cliente"),
      el("th", { class: "num" }, "Receitas (empresa)"),
      el("th", { class: "num" }, "Despesas (empresa)"),
      el("th", { class: "num" }, "Lucro (empresa)"),
      el("th", { class: "num" }, "Receitas (pessoal)"),
      el("th", { class: "num" }, "Despesas (pessoal)"),
      el("th", { class: "num" }, "Lucro (pessoal)"),
    )),
    el("tbody", {},
      financeiro.map((f) => el("tr", {},
        el("td", {}, f.nome),
        celNum(f.emp.bruta), celNum(f.emp.despesas), celNum(f.emp.lucro),
        celNum(f.pf.bruta), celNum(f.pf.despesas), celNum(f.pf.lucro),
      )),
      linhaTotal,
    ),
  );

  const tabelaAp = aposentadoria.length === 0
    ? el("p", { class: "muted" }, "Nenhum planejamento de aposentadoria salvo ou com projetos cadastrados ainda.")
    : el("div", { class: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, "Cliente"),
          el("th", { class: "num" }, "Idade atual"),
          el("th", { class: "num" }, "Aposentadoria aos"),
          el("th", { class: "num" }, "Renda desejada"),
          el("th", { class: "num" }, "Capital ideal"),
          el("th", { class: "num" }, "Aporte mensal necessário"),
          el("th", { class: "num" }, "Projetos"),
        )),
        el("tbody", {}, aposentadoria.map((a) => el("tr", {},
          el("td", {}, a.nome),
          el("td", { class: "num" }, String(a.p.idadeAtual)),
          el("td", { class: "num" }, String(a.p.idadeAposentadoria)),
          celNum(a.p.rendaDesejada),
          celNum(a.res.idealRet),
          celNum(a.res.aporteNecessario),
          el("td", { class: "num" }, String(a.projetos)),
        ))),
      ));

  return el("div", {},
    await renderPatrimonioConsolidado(usuarios),
    el("section", { class: "card" },
      el("h2", {}, "Financeiro consolidado · " + ano),
      el("p", { class: "muted" }, "Receitas, despesas e lucro de cada cliente, separados entre empresa e pessoa física."),
      el("div", { class: "scroll" }, tabelaFin),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Planejamento de aposentadoria"),
      el("p", { class: "muted" }, "Capital ideal e aporte mensal necessário, com base nos parâmetros e projetos de cada cliente."),
      tabelaAp,
    ),
  );
}

async function renderPatrimonioConsolidado(usuarios) {
  const linhas = [];
  const porInstituicao = {};
  for (const u of usuarios) {
    const itens = await carregarPatrimonio(u.email);
    const l = { nome: u.nome || u.email, imoveis: 0, veiculos: 0, empresas: 0, investimentos: 0, dividas: 0 };
    for (const it of itens) {
      const v = num(it.valor);
      if (l[it.categoria] !== undefined) l[it.categoria] += v;
      if (it.categoria === "investimentos") {
        const inst = (it.instituicao || "").trim() || "Não informada";
        porInstituicao[inst] = (porInstituicao[inst] || 0) + v;
      }
    }
    linhas.push(l);
  }

  const somaCol = (k) => soma(linhas.map((l) => l[k]));
  const imobilizado = somaCol("imoveis") + somaCol("veiculos");
  const liquido = imobilizado + somaCol("empresas") + somaCol("investimentos") - somaCol("dividas");

  const colunas = [
    ["imoveis", "Imóveis"],
    ["veiculos", "Veículos"],
    ["empresas", "Empresas"],
    ["investimentos", "Investimentos (bancos)"],
    ["dividas", "Dívidas"],
  ];

  const tabela = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Usuário"),
      colunas.map(([, rotulo]) => el("th", { class: "num" }, rotulo)),
      el("th", { class: "num" }, "Patrimônio líquido"),
    )),
    el("tbody", {},
      linhas.map((l) => el("tr", {},
        el("td", {}, l.nome),
        colunas.map(([k]) => el("td", { class: "num" }, brl(l[k]))),
        el("td", { class: "num" }, brl(l.imoveis + l.veiculos + l.empresas + l.investimentos - l.dividas)),
      )),
      el("tr", { class: "total" },
        el("td", {}, "Total"),
        colunas.map(([k]) => el("td", { class: "num" }, brl(somaCol(k)))),
        el("td", { class: "num" }, brl(liquido)),
      ),
    ),
  );

  const instituicoes = Object.entries(porInstituicao).sort((a, b) => b[1] - a[1]);
  const blocoInstituicoes = instituicoes.length === 0
    ? el("p", { class: "muted" }, "Nenhum investimento cadastrado ainda.")
    : el("div", { class: "scroll" },
        el("table", {},
          el("thead", {}, el("tr", {}, el("th", {}, "Instituição / custódia"), el("th", { class: "num" }, "Valor"))),
          el("tbody", {}, instituicoes.map(([nome, v]) => el("tr", {},
            el("td", {}, nome),
            el("td", { class: "num" }, brl(v)),
          ))),
        ),
      );

  return el("section", { class: "card" },
    el("h2", {}, "Visão consolidada"),
    el("p", { class: "muted" }, "Patrimônio imobilizado = imóveis + veículos. Empresas e participações são exibidas à parte."),
    el("div", { class: "kpis" },
      kpi("Patrimônio imobilizado", imobilizado),
      kpi("Investimentos em bancos (custódia)", somaCol("investimentos")),
      kpi("Empresas e participações", somaCol("empresas")),
      kpi("Dívidas", somaCol("dividas")),
      kpi("Patrimônio líquido total", liquido),
    ),
    el("div", { class: "scroll" }, tabela),
    el("h3", {}, "Investimentos por instituição"),
    blocoInstituicoes,
  );
}

// ---------- Painel do cliente (também usado pelo administrador ao abrir um cliente) ----------
// ctx = { user, email, nome, modo: "cliente" | "admin", ano }

function portal(ctx, secao, conteudo) {
  const itens = [
    ["dashboard", "Dashboard"],
    ["lancamento", "Lançamento"],
    ["receitas", "Receitas e despesas"],
    ["patrimonio", "Patrimônio"],
    ["home", "Home Conect"],
  ];
  const topo = ctx.modo === "admin"
    ? [el("button", { class: "menu-item", onclick: () => renderAdmin(ctx.user, "clientes") }, "← Clientes")]
    : [];
  const titulo = ctx.modo === "admin" ? "Painel de " + ctx.nome : "Olá, " + ctx.nome;
  return el("div", {},
    el("header", {},
      el("h1", {}, titulo),
      el("div", { class: "row", style: "margin:0;align-items:center" },
        el("span", { class: "muted", style: "color:#dbe7f3" }, ctx.user.email),
        el("button", { class: "light", onclick: () => signOut(auth) }, "Sair"),
      ),
    ),
    el("div", { class: "corpo" },
      el("aside", { class: "sidebar" },
        topo,
        itens.map(([k, l]) => el("button", {
          class: "menu-item" + (k === secao ? " ativo" : ""),
          onclick: () => renderPortal(ctx, k),
        }, l)),
      ),
      el("main", { class: "conteudo" }, conteudo),
    ),
  );
}

async function renderPortal(ctx, secao = "dashboard") {
  const slot = el("div", {}, el("p", { class: "muted" }, "Carregando..."));
  setView(portal(ctx, secao, slot));

  const [lancamentos, params, patrimonio] = await Promise.all([
    carregarLancamentos(ctx.email),
    carregarParametros(ctx.email),
    carregarPatrimonio(ctx.email),
  ]);
  const dados = { lancamentos, params, patrimonio };

  if (secao === "home") return slot.replaceChildren(telaHome(ctx));
  if (secao === "lancamento") return slot.replaceChildren(telaLancamento(ctx, dados));
  if (secao === "receitas") return slot.replaceChildren(telaReceitas(ctx, dados));
  if (secao === "patrimonio") return slot.replaceChildren(telaPatrimonio(ctx, dados));
  slot.replaceChildren(telaDashboard(ctx, dados));
  desenharGrafico(ctx, dados);
  return;
}

// Seletor de ano usado no Dashboard e em Receitas e despesas.
function anoSeletor(ctx, secao) {
  const sel = el("select", {},
    [ctx.ano - 1, ctx.ano, ctx.ano + 1].map((a) => el("option", { value: a, selected: a === ctx.ano }, String(a))),
  );
  sel.addEventListener("change", () => {
    ctx.ano = Number(sel.value);
    renderPortal(ctx, secao);
  });
  return el("label", {}, "Ano", sel);
}

// ----- Gráfico mensal consolidado: receitas, despesas e caixa -----
let graficoAtual = null;

function cardGrafico(ctx) {
  const ano = ctx.anoGrafico || ctx.ano;
  const sel = el("select", {},
    [ctx.ano - 1, ctx.ano, ctx.ano + 1].map((a) => el("option", { value: a, selected: a === ano }, String(a))),
  );
  sel.addEventListener("change", () => {
    ctx.anoGrafico = Number(sel.value);
    renderPortal(ctx, "dashboard");
  });
  return el("section", { class: "card" },
    el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" },
      el("h2", { style: "margin:0" }, "Receitas, despesas e caixa em " + ano),
      el("label", {}, "Ano", sel),
    ),
    el("div", { style: "position:relative;height:340px" }, el("canvas", { id: "grafico-caixa" })),
    el("p", { class: "muted" },
      "Caixa = receita líquida menos despesas de cada mês. A linha mostra o caixa acumulado no ano.",
    ),
  );
}

function desenharGrafico(ctx, dados) {
  const canvas = document.getElementById("grafico-caixa");
  if (!canvas || typeof Chart === "undefined") return;
  const ano = ctx.anoGrafico || ctx.ano;
  const r = resumoAno(dados.lancamentos, ano, dados.params);

  if (graficoAtual) graficoAtual.destroy();
  graficoAtual = new Chart(canvas, {
    data: {
      labels: MESES,
      datasets: [
        { type: "bar", label: "Receitas (bruta)", data: r.meses.map((m) => m.bruta), backgroundColor: "#1f4e79" },
        { type: "bar", label: "Despesas", data: r.meses.map((m) => m.despesasTotal), backgroundColor: "#b42318" },
        { type: "bar", label: "Caixa do mês", data: r.meses.map((m) => m.lucro), backgroundColor: "#15803d" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + brl(c.parsed.y) } },
      },
      scales: {
        y: { ticks: { callback: (v) => brl(v) } },
      },
    },
  });
}

// ----- Dashboard do cliente: um mês por vez, escolhido pelo seletor -----
function telaDashboard(ctx, dados) {
  const mesSel = ctx.mes || mesAtual();
  const ano = Number(mesSel.slice(0, 4));
  const idx = Number(mesSel.slice(5, 7)) - 1;
  const r = resumoAno(dados.lancamentos, ano, dados.params);
  const m = r.meses[idx];
  const pat = calcPatrimonio(dados.patrimonio);

  const seletor = el("input", { type: "month", value: mesSel });
  seletor.addEventListener("change", () => {
    if (!seletor.value) return;
    ctx.mes = seletor.value;
    renderPortal(ctx, "dashboard");
  });

  const detalhe = el("table", {},
    el("tbody", {},
      el("tr", {}, el("td", {}, "Receita bruta"), el("td", { class: "num" }, brl(m.bruta))),
      el("tr", {}, el("td", {}, "Total de despesas"), el("td", { class: "num" }, brl(m.despesasTotal))),
      el("tr", { class: "total" }, el("td", {}, "Lucro / prejuízo"), el("td", { class: "num" }, brl(m.lucro))),
    ),
  );

  const listaCategorias = (mapa) => {
    const lista = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
    if (lista.length === 0) return el("p", { class: "muted" }, "Sem lançamentos neste mês.");
    return el("div", { class: "scroll" }, el("table", {},
      el("tbody", {}, lista.map(([cat, v]) => el("tr", {},
        el("td", {}, cat),
        el("td", { class: "num" }, brl(v)),
      ))),
    ));
  };

  return el("div", {},
    el("div", { class: "row" },
      el("label", {}, "Mês de referência", seletor),
      el("span", { class: "muted" }, mesNome(mesSel)),
    ),
    el("div", { class: "kpis" },
      kpi("Receita bruta", m.bruta),
      kpi("Despesas", m.despesasTotal),
      kpi("Lucro / prejuízo", m.lucro),
      kpi("Margem", m.margem, pct),
      kpi("Patrimônio líquido", pat.liquido),
    ),
    cardGrafico(ctx),
    el("section", { class: "card" },
      el("h2", {}, "Detalhamento de " + mesNome(mesSel)),
      el("div", { class: "scroll" }, detalhe),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Receitas do mês"),
      listaCategorias(m.receitas),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Despesas do mês"),
      listaCategorias(m.despesas),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Patrimônio"),
      el("div", { class: "kpis", style: "margin-bottom:0" },
        kpi("Ativos", pat.ativos),
        kpi("Dívidas", pat.dividas),
        kpi("Patrimônio líquido", pat.liquido),
      ),
    ),
  );
}

// ----- Lançamento: um único campo com categoria, valor, mês, parcelas -----
async function excluirLancamento(ctx, l) {
  if (!confirm("Excluir este lançamento? Todas as parcelas dele serão removidas.")) return;
  await deleteDoc(doc(db, "users", ctx.email, "lancamentos", l.id));
  renderPortal(ctx, "lancamento");
}

function telaLancamento(ctx, dados) {
  const tipo = el("select", {},
    el("option", { value: "receita" }, "Receita"),
    el("option", { value: "despesa" }, "Despesa"),
  );
  const datalist = el("datalist", { id: "sugestoes-categoria" });
  const preencherSugestoes = () => {
    datalist.replaceChildren(...SUGESTOES[tipo.value].map((s) => el("option", { value: s })));
  };
  preencherSugestoes();
  tipo.addEventListener("change", preencherSugestoes);

  const entidade = el("select", {},
    el("option", { value: "empresa" }, "Empresa"),
    el("option", { value: "pessoa" }, "Pessoa física"),
  );
  const categoria = el("input", { type: "text", list: "sugestoes-categoria", placeholder: "Ex.: Aluguel", style: "min-width:200px" });
  const descricao = el("input", { type: "text", placeholder: "Opcional", style: "min-width:200px" });
  const valor = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", class: "num", style: "width:140px" });
  const mes = el("input", { type: "month", value: mesAtual() });
  const forma = el("select", {},
    el("option", { value: "unico" }, "Lançamento único"),
    el("option", { value: "replicar" }, "Replicar (mesmo valor em cada mês)"),
    el("option", { value: "parcelado" }, "Parcelado (divide o valor)"),
  );
  const parcelas = el("input", { type: "number", min: "2", max: "360", value: "12", style: "width:90px" });
  parcelas.disabled = true;

  const preview = el("p", { class: "muted" });
  const atualizarPreview = () => {
    const total = num(valor.value);
    const n = forma.value === "unico" ? 1 : Math.max(1, Math.floor(num(parcelas.value)));
    if (!(total > 0) || !mes.value) {
      preview.textContent = "";
      return;
    }
    if (n === 1) {
      preview.textContent = "Lançamento único de " + brl(total) + " em " + mesNome(mes.value) + ".";
      return;
    }
    const fim = mesNome(addMeses(mes.value, n - 1));
    if (forma.value === "replicar") {
      preview.textContent = n + " lançamentos de " + brl(total) + " por mês, de " + mesNome(mes.value) + " a " + fim + ". Total: " + brl(total * n) + ".";
      return;
    }
    const base = Math.floor((total * 100) / n) / 100;
    preview.textContent = n + " parcelas de aproximadamente " + brl(base) + ", de " + mesNome(mes.value) + " a " + fim + ". Total: " + brl(total) + ".";
  };
  for (const c of [tipo, valor, mes, parcelas]) {
    c.addEventListener("input", atualizarPreview);
    c.addEventListener("change", atualizarPreview);
  }
  forma.addEventListener("change", () => {
    parcelas.disabled = forma.value === "unico";
    atualizarPreview();
  });

  let salvando = false;
  const botaoLancar = el("button", { onclick: () => salvar() }, "Lançar");
  const salvar = async () => {
    if (salvando) return;
    const total = num(valor.value);
    const n = forma.value === "unico" ? 1 : Math.floor(num(parcelas.value));
    if (!categoria.value.trim()) return alert("Informe a categoria.");
    if (!(total > 0)) return alert("Informe um valor maior que zero.");
    if (!mes.value) return alert("Informe o mês do primeiro lançamento.");
    if (!(n >= 1 && n <= 360)) return alert("O número de lançamentos deve estar entre 1 e 360.");
    salvando = true;
    botaoLancar.disabled = true;
    const base = forma.value === "parcelado" ? Math.floor((total * 100) / n) / 100 : total;
    const cat = categoria.value.trim();
    const desc = descricao.value.trim();
    // Cada mês vira um lançamento próprio, para que possa ser editado separadamente.
    await Promise.all(Array.from({ length: n }, (_, i) => {
      const v = forma.value === "parcelado" && i === n - 1
        ? Math.round((total - base * (n - 1)) * 100) / 100
        : base;
      return addDoc(collection(db, "users", ctx.email, "lancamentos"), {
        tipo: tipo.value,
        categoria: cat,
        descricao: desc,
        valorTotal: v,
        mesInicial: addMeses(mes.value, i),
        parcelas: 1,
        modo: forma.value,
        entidade: entidade.value,
        criadoEm: new Date().toISOString(),
        criadoPor: ctx.user.email,
      });
    }));
    renderPortal(ctx, "lancamento");
  };

  const selecionados = new Set();
  const botaoExcluirSel = el("button", { class: "danger", style: "display:none", onclick: () => excluirSelecionados() }, "Excluir selecionados");
  const atualizarSel = () => {
    botaoExcluirSel.textContent = "Excluir selecionados (" + selecionados.size + ")";
    botaoExcluirSel.style.display = selecionados.size ? "" : "none";
  };
  const excluirSelecionados = async () => {
    const ids = [...selecionados];
    if (ids.length === 0) return;
    if (!confirm("Excluir " + ids.length + " lançamento(s) selecionado(s)? Essa ação não pode ser desfeita.")) return;
    await Promise.all(ids.map((id) => deleteDoc(doc(db, "users", ctx.email, "lancamentos", id))));
    selecionados.clear();
    renderPortal(ctx, "lancamento");
  };
  const categoriasUnicas = [...new Set(dados.lancamentos.map((l) => l.categoria))].sort();
  const filtroDe = el("input", { type: "month" });
  const filtroAte = el("input", { type: "month" });
  const filtroCat = el("select", {}, [el("option", { value: "" }, "Todas as categorias"), ...categoriasUnicas.map((c) => el("option", { value: c }, c))]);
  const filtroQuem = el("select", {},
    el("option", { value: "" }, "Empresa e Pessoa física"),
    el("option", { value: "empresa" }, "Empresa"),
    el("option", { value: "pessoa" }, "Pessoa física"),
  );
  const areaTabela = el("div", { class: "scroll" });
  const resumoFiltro = el("p", { class: "muted" });
  const montarTabela = (ordenados) => el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, el("input", { type: "checkbox", title: "Selecionar todos os visíveis", onchange: (e) => {
        ordenados.forEach((l) => (e.target.checked ? selecionados.add(l.id) : selecionados.delete(l.id)));
        desenharTabela();
      } })),
      el("th", {}, "Mês"),
      el("th", {}, "Tipo"),
      el("th", {}, "Quem"),
      el("th", {}, "Categoria"),
      el("th", {}, "Descrição"),
      el("th", { class: "num" }, "Valor"),
      el("th", { class: "num" }, "Parcelas"),
      el("th", { class: "num" }, "Por mês"),
      el("th", {}, ""),
    )),
    el("tbody", {}, ordenados.map((l) => el("tr", {},
      el("td", {}, el("input", { type: "checkbox", checked: selecionados.has(l.id), onchange: (e) => {
        if (e.target.checked) selecionados.add(l.id); else selecionados.delete(l.id);
        atualizarSel();
      } })),
      el("td", {}, mesNome(l.mesInicial)),
      el("td", {}, l.tipo === "receita" ? "Receita" : "Despesa"),
      el("td", {}, entidadeDe(l) === "empresa" ? "Empresa" : "Pessoa física"),
      el("td", {}, l.categoria),
      el("td", {}, l.descricao || "—"),
      el("td", { class: "num" }, brl(l.valorTotal)),
      el("td", { class: "num" }, String(l.parcelas || 1)),
      el("td", { class: "num" }, brl(num(l.valorTotal) / (l.parcelas || 1))),
      el("td", {},
        el("button", { class: "ghost", onclick: () => abrirEdicaoLancamento(ctx, l, dados) }, "Editar"),
        " ",
        el("button", { class: "danger", onclick: () => excluirLancamento(ctx, l) }, "Excluir"),
      ),
    ))),
  );

  const desenharTabela = () => {
    const filtrados = dados.lancamentos
      .filter((l) => (!filtroDe.value || (l.mesInicial || "") >= filtroDe.value)
        && (!filtroAte.value || (l.mesInicial || "") <= filtroAte.value)
        && (!filtroCat.value || l.categoria === filtroCat.value)
        && (!filtroQuem.value || entidadeDe(l) === filtroQuem.value))
      .sort((a, b) => (b.mesInicial || "").localeCompare(a.mesInicial || ""));
    const receitas = soma(filtrados.filter((l) => l.tipo === "receita").map((l) => num(l.valorTotal)));
    const despesas = soma(filtrados.filter((l) => l.tipo === "despesa").map((l) => num(l.valorTotal)));
    resumoFiltro.textContent = filtrados.length + " lançamento(s) · Receitas: " + brl(receitas) + " · Despesas: " + brl(despesas);
    atualizarSel();
    areaTabela.replaceChildren(filtrados.length === 0
      ? el("p", { class: "muted" }, "Nenhum lançamento encontrado com esses filtros.")
      : montarTabela(filtrados));
  };
  for (const c of [filtroDe, filtroAte, filtroCat, filtroQuem]) c.addEventListener("change", desenharTabela);
  desenharTabela();

  return el("div", {},
    el("section", { class: "card" },
      el("h2", {}, "Novo lançamento"),
      el("div", { class: "row" },
        el("label", {}, "Tipo", tipo),
        el("label", {}, "Quem", entidade),
        el("label", {}, "Categoria", categoria),
        el("label", {}, "Valor", valor),
        el("label", {}, "Mês do 1º lançamento", mes),
      ),
      el("div", { class: "row" },
        el("label", {}, "Forma", forma),
        el("label", {}, "Nº de meses", parcelas),
        el("label", {}, "Descrição", descricao),
        botaoLancar,
      ),
      preview,
      datalist,
    ),
    el("section", { class: "card" },
      el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
        el("h2", { style: "margin:0" }, "Lançamentos registrados"),
        el("button", { class: "ghost", onclick: () => removerDuplicados(ctx, dados) }, "Verificar duplicados"),
      ),
      el("div", { class: "row" },
        el("label", {}, "De (mês)", filtroDe),
        el("label", {}, "Até (mês)", filtroAte),
        el("label", {}, "Categoria", filtroCat),
        el("label", {}, "Quem", filtroQuem),
      ),
      el("div", { class: "row", style: "justify-content:space-between;align-items:center" }, resumoFiltro, botaoExcluirSel),
      areaTabela,
    ),
  );
}

// Edição: pergunta se o ajuste vale só para este lançamento ou para todos da mesma categoria.
// Encontra lançamentos idênticos (mesmo tipo, categoria, descrição, valor, mês e quem) e remove as cópias extras.
async function removerDuplicados(ctx, dados) {
  const grupos = new Map();
  for (const l of dados.lancamentos) {
    const chave = [l.tipo, l.categoria, l.descricao || "", num(l.valorTotal), l.mesInicial, entidadeDe(l), Number(l.parcelas || 1)].join("|");
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(l);
  }
  const extras = [];
  for (const lista of grupos.values()) {
    if (lista.length > 1) {
      lista.sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
      extras.push(...lista.slice(1));
    }
  }
  if (extras.length === 0) return alert("Nenhum lançamento duplicado encontrado.");
  if (!confirm("Encontrei " + extras.length + " lançamento(s) repetido(s), com mesmo tipo, categoria, mês, valor e quem. Remover as cópias e manter um de cada?")) return;
  await Promise.all(extras.map((x) => deleteDoc(doc(db, "users", ctx.email, "lancamentos", x.id))));
  renderPortal(ctx, "lancamento");
}

function abrirEdicaoLancamento(ctx, l, dados) {
  const iguais = dados.lancamentos.filter((x) => x.tipo === l.tipo && x.categoria === l.categoria && entidadeDe(x) === entidadeDe(l));
  const overlay = el("div", { style: "position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px" });
  const card = el("div", { style: "background:#fff;border-radius:12px;max-width:640px;width:100%;max-height:92vh;overflow:auto;padding:24px" });
  const fechar = () => overlay.remove();

  const mostrarForm = (escopo) => {
    const ehTodos = escopo === "todos";
    const legado = Number(l.parcelas || 1) > 1;
    const inCat = el("input", { type: "text", list: "sugestoes-edicao", value: l.categoria, style: "min-width:200px" });
    const datalistEd = el("datalist", { id: "sugestoes-edicao" }, SUGESTOES[l.tipo].map((s) => el("option", { value: s })));
    const inDesc = el("input", { type: "text", value: l.descricao || "", style: "min-width:200px" });
    const inEnt = el("select", {},
      el("option", { value: "empresa", selected: entidadeDe(l) === "empresa" }, "Empresa"),
      el("option", { value: "pessoa", selected: entidadeDe(l) === "pessoa" }, "Pessoa física"),
    );
    const inVal = el("input", { type: "text", inputmode: "decimal", value: num(l.valorTotal).toFixed(2).replace(".", ","), class: "num", style: "width:140px" });
    const inMes = el("input", { type: "month", value: l.mesInicial || mesAtual(), disabled: ehTodos || legado });
    const aviso = legado
      ? "Este é um parcelamento de cadastro antigo: a alteração vale para o total do parcelamento."
      : ehTodos
        ? "O mês de cada lançamento não muda. Categoria, descrição e valor valem para todos."
        : "";

    const salvarEd = async () => {
      const v = num(inVal.value);
      const cat = inCat.value.trim();
      const desc = inDesc.value.trim();
      if (!cat) return alert("Informe a categoria.");
      if (!(v > 0)) return alert("Informe um valor maior que zero.");
      if (!ehTodos) {
        const alteracoes = { categoria: cat, descricao: desc, valorTotal: v, entidade: inEnt.value };
        if (!legado) alteracoes.mesInicial = inMes.value;
        await updateDoc(doc(db, "users", ctx.email, "lancamentos", l.id), alteracoes);
      } else {
        await Promise.all(iguais.map((x) => {
          const alteracoes = { categoria: cat, descricao: desc, entidade: inEnt.value };
          if (Number(x.parcelas || 1) <= 1) alteracoes.valorTotal = v;
          return updateDoc(doc(db, "users", ctx.email, "lancamentos", x.id), alteracoes);
        }));
      }
      fechar();
      renderPortal(ctx, "lancamento");
    };

    card.replaceChildren(
      el("h2", {}, ehTodos ? "Editar todos da categoria" : "Editar este lançamento"),
      el("p", { class: "muted" }, ehTodos
        ? iguais.length + " lançamento(s) de «" + l.categoria + "» serão alterados."
        : "Somente este lançamento será alterado."),
      el("div", { class: "row" },
        el("label", {}, "Categoria", inCat),
        el("label", {}, ehTodos ? "Valor de cada lançamento" : "Valor", inVal),
        el("label", {}, "Mês", inMes),
      ),
      el("div", { class: "row" }, el("label", {}, "Descrição", inDesc), el("label", {}, "Quem", inEnt)),
      aviso ? el("p", { class: "muted" }, aviso) : null,
      datalistEd,
      el("div", { class: "row" },
        el("button", { onclick: salvarEd }, "Salvar alterações"),
        el("button", { class: "ghost", onclick: fechar }, "Cancelar"),
      ),
    );
  };

  card.replaceChildren(
    el("h2", {}, "Editar lançamento"),
    el("p", {}, "Você quer alterar somente este lançamento ou todos os outros da mesma categoria?"),
    el("p", { class: "muted" }, "«" + l.categoria + "»: " + iguais.length + " lançamento(s) encontrado(s)."),
    el("div", { class: "row" },
      el("button", { onclick: () => mostrarForm("somente") }, "Somente este"),
      el("button", { onclick: () => mostrarForm("todos") }, "Todos da categoria"),
      el("button", { class: "ghost", onclick: fechar }, "Cancelar"),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// ----- Receitas e despesas: mesma estrutura da planilha, calculada a partir dos lançamentos -----
function telaReceitas(ctx, dados) {
  const linha = (rotulo, valores, opts = {}) => {
    const total = opts.total !== undefined ? opts.total : soma(valores);
    const fmt = opts.fmt || brl;
    return el("tr", { class: opts.classe || "" },
      el("td", {}, rotulo),
      valores.map((v) => el("td", { class: "num" }, fmt(v))),
      el("td", { class: "num" }, fmt(total)),
    );
  };
  const cabecalhoSecao = (rotulo) => el("tr", {},
    el("td", { colspan: 14, style: "background:#f3f5f8;font-weight:600" }, rotulo),
  );

  const bloco = (titulo, lancs) => {
    const r = resumoAno(lancs, ctx.ano);
    const rows = [cabecalhoSecao("Receitas")];
    for (const c of r.catsR) rows.push(linha(c, r.meses.map((m) => m.receitas[c] || 0)));
    rows.push(linha("Receita bruta", r.meses.map((m) => m.bruta), { total: r.totais.bruta, classe: "total" }));
    rows.push(cabecalhoSecao("Despesas"));
    for (const c of r.catsD) rows.push(linha(c, r.meses.map((m) => m.despesas[c] || 0)));
    rows.push(linha("Total de despesas", r.meses.map((m) => m.despesasTotal), { total: r.totais.despesas, classe: "total" }));
    rows.push(linha("Lucro / prejuízo", r.meses.map((m) => m.lucro), { total: r.totais.lucro, classe: "total" }));
    rows.push(linha("Margem", r.meses.map((m) => m.margem), { total: r.totais.margem, fmt: pct }));
    const tabela = el("table", {},
      el("thead", {}, el("tr", {},
        el("th", {}, "Categoria"),
        MESES.map((m) => el("th", { class: "num" }, m)),
        el("th", { class: "num" }, "Total"),
      )),
      el("tbody", {}, rows),
    );
    return el("section", { class: "card" },
      el("h2", {}, titulo + " " + ctx.ano),
      el("div", { class: "scroll" }, tabela),
    );
  };

  return el("div", {},
    el("div", { class: "row" }, anoSeletor(ctx, "receitas")),
    bloco("Empresa", dados.lancamentos.filter((l) => entidadeDe(l) === "empresa")),
    bloco("Pessoa física", dados.lancamentos.filter((l) => entidadeDe(l) === "pessoa")),
  );
}


// ----- Patrimônio: o cliente também pode cadastrar e editar os próprios itens -----
function telaPatrimonio(ctx, dados) {
  const pat = calcPatrimonio(dados.patrimonio);
  const descInp = el("input", { type: "text", placeholder: "Descrição", style: "min-width:220px" });
  const instInp = el("input", { type: "text", placeholder: "Banco / corretora", style: "min-width:180px" });
  const valInp = el("input", { type: "text", placeholder: "0,00", class: "num", style: "width:140px" });
  const catSel = el("select", {}, CATEGORIAS_PATRIMONIO.map(([k, l]) => el("option", { value: k }, l)));

  const salvar = async () => {
    if (!descInp.value.trim()) return alert("Informe a descrição.");
    await addDoc(collection(db, "users", ctx.email, "patrimonio"), {
      categoria: catSel.value,
      descricao: descInp.value.trim(),
      instituicao: instInp.value.trim(),
      valor: num(valInp.value),
      atualizadoEm: new Date().toISOString(),
      criadoPor: ctx.user.email,
    });
    renderPortal(ctx, "patrimonio");
  };

  const excluir = async (it) => {
    if (!confirm("Excluir este item?")) return;
    await deleteDoc(doc(db, "users", ctx.email, "patrimonio", it.id));
    renderPortal(ctx, "patrimonio");
  };

  const tabela = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Tipo"),
      el("th", {}, "Descrição"),
      el("th", {}, "Instituição"),
      el("th", { class: "num" }, "Valor"),
      el("th", {}, ""),
    )),
    el("tbody", {}, dados.patrimonio.map((it) => el("tr", {},
      el("td", {}, (CATEGORIAS_PATRIMONIO.find(([k]) => k === it.categoria) || [])[1] || it.categoria),
      el("td", {}, it.descricao),
      el("td", {}, it.instituicao || "—"),
      el("td", { class: "num" }, brl(it.valor)),
      el("td", {}, el("button", { class: "danger", onclick: () => excluir(it) }, "Excluir")),
    ))),
  );

  return el("div", {},
    el("div", { class: "kpis" },
      kpi("Ativos", pat.ativos),
      kpi("Dívidas", pat.dividas),
      kpi("Patrimônio líquido", pat.liquido),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Itens do patrimônio"),
      dados.patrimonio.length === 0
        ? el("p", { class: "muted" }, "Nenhum item cadastrado ainda.")
        : el("div", { class: "scroll" }, tabela),
      el("h3", {}, "Adicionar item"),
      el("div", { class: "row" },
        el("label", {}, "Tipo", catSel),
        el("label", {}, "Descrição", descInp),
        el("label", {}, "Instituição (investimentos)", instInp),
        el("label", {}, "Valor", valInp),
        el("button", { onclick: salvar }, "Adicionar"),
      ),
    ),
  );
}

// ---------- Entradas usadas pelo restante do app ----------
// Administrador abre o painel de um cliente.
function abrirEditorUsuario(user, usuario) {
  return renderPortal({
    user,
    email: usuario.email,
    nome: usuario.nome || usuario.email,
    modo: "admin",
    ano: ANO_ATUAL,
  }, "dashboard");
}
