// Meu Patrimônio: bens e dívidas por bloco, resumo patrimonial e evolução do patrimônio líquido mês a mês.
// Cada item guarda o valor atual em `valor` e o histórico em `historico` ({ "AAAA-MM": valor }).
import { db, doc, addDoc, updateDoc, deleteDoc, collection } from "../firebase.js";
import { brl, num, pct, MESES } from "../format.js";
import { CATEGORIAS_PATRIMONIO } from "../calc.js";
import { el, acao, abrirModal, toast } from "../ui.js";
import { recarregar, ir, hashFerramenta } from "../router.js";

const TIPO = Object.fromEntries(CATEGORIAS_PATRIMONIO.map(([k, l, t]) => [k, { rotulo: l, tipo: t }]));
const ehDivida = (it) => (TIPO[it.categoria] || {}).tipo === "divida";

// Blocos da tela, na ordem em que aparecem. Itens sem categoria conhecida caem em Investimentos.
const BLOCOS = [
  { titulo: "Investimentos", cats: ["investimentos", "empresas"], rotuloValor: "Valor atual", campoInst: "Banco / corretora" },
  { titulo: "Financiamentos", cats: ["financiamento"], divida: true, campoInst: "Banco" },
  { titulo: "Empréstimos e dívidas", cats: ["dividas"], divida: true, campoInst: "Credor" },
  { titulo: "Bens móveis", cats: ["veiculos"], campoInst: "Observação" },
  { titulo: "Bens imóveis", cats: ["imoveis"], campoInst: "Localização" },
  { titulo: "Milhas", cats: ["milhas"], milhas: true, campoInst: "Operadora (ex.: Smiles, LATAM Pass)" },
];
const blocoDe = (it) => BLOCOS.find((b) => b.cats.includes(it.categoria)) || BLOCOS[0];

const GRADE = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px";
const CORES_ATIVOS = ["#2C4A3E", "#8FA89B"];
const CORES_PASSIVOS = ["#B0413E", "#C9A96E"];

// ---------- Datas e valores ----------
const mesAtualYM = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};
const rotuloMes = (ym) => MESES[Number(ym.slice(5, 7)) - 1] + "/" + ym.slice(0, 4);
const somarMeses = (ym, k) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + k, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};
// Valor do item em um mês: o mês atual usa o valor atual; meses passados usam o último registro até ali.
function valorNoMes(it, ym) {
  if (ym === mesAtualYM()) return num(it.valor);
  const h = it.historico || {};
  const chaves = Object.keys(h).filter((k) => k <= ym).sort();
  return chaves.length ? num(h[chaves[chaves.length - 1]]) : 0;
}
// Número para o campo de edição no padrão brasileiro (sem símbolo).
const campo = (v) => (num(v) ? num(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

async function gravar(fn, msg) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    toast(msg);
    return false;
  }
}

// ---------- Formulário de item ----------
function formItem(bloco, it = {}) {
  return {
    cat: el("select", {}, CATEGORIAS_PATRIMONIO.map(([k, l]) => el("option", { value: k, selected: (it.categoria || bloco.cats[0]) === k }, l))),
    desc: el("input", { type: "text", value: it.descricao || "", placeholder: "Ex.: CDB Banco X, Apartamento Centro" }),
    inst: el("input", { type: "text", value: it.instituicao || "", placeholder: bloco.campoInst }),
    qtd: el("input", { type: "text", inputmode: "numeric", value: it.quantidade ? String(it.quantidade) : "", placeholder: "Ex.: 85000" }),
    val: el("input", { type: "text", inputmode: "decimal", value: campo(it.valor), placeholder: "0,00" }),
    inv: el("input", { type: "text", inputmode: "decimal", value: campo(it.valorInvestido), placeholder: "0,00" }),
    grupo: el("select", {}, [["renda", "Gerador de renda"], ["pessoal", "Uso pessoal"]].map(([k, l]) => el("option", { value: k, selected: (it.grupo || "pessoal") === k }, l))),
  };
}

function corpoForm(f, bloco) {
  return el("div", { class: "row" },
    el("label", {}, "Tipo", f.cat),
    el("label", {}, "Descrição", f.desc),
    el("label", {}, bloco.campoInst, f.inst),
    bloco.milhas ? el("label", {}, "Quantidade de milhas", f.qtd) : null,
    el("label", {}, bloco.divida ? "Saldo devedor" : bloco.milhas ? "Valor estimado" : "Valor atual", f.val),
    bloco.divida ? null : el("label", {}, "Valor investido (custo)", f.inv),
    bloco.divida ? null : el("label", {}, "Classificação", f.grupo),
  );
}

const botoes = (modal, fn, rotulo) => el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
  el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
  el("button", { onclick: (e) => acao(e.currentTarget, fn) }, rotulo),
);

function lerForm(f) {
  if (!f.desc.value.trim()) {
    alert("Informe a descrição.");
    return null;
  }
  const valor = num(f.val.value);
  if (valor < 0) {
    alert("O valor não pode ser negativo.");
    return null;
  }
  return {
    categoria: f.cat.value,
    descricao: f.desc.value.trim(),
    instituicao: f.inst.value.trim(),
    quantidade: num(f.qtd.value),
    valor,
    valorInvestido: num(f.inv.value),
    grupo: f.grupo.value,
  };
}

function modalNovo(ctx, bloco) {
  const f = formItem(bloco);
  const modal = abrirModal({ titulo: "Adicionar em " + bloco.titulo, largura: 620 });
  const salvar = async () => {
    const dados = lerForm(f);
    if (!dados) return;
    const ok = await gravar(() => addDoc(collection(db, "users", ctx.email, "patrimonio"), {
      ...dados,
      historico: { [mesAtualYM()]: dados.valor },
      atualizadoEm: new Date().toISOString(),
      criadoPor: ctx.user.email,
    }), "Não foi possível adicionar. Verifique a conexão e tente de novo.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };
  modal.trocar(corpoForm(f, bloco), botoes(modal, salvar, "Adicionar"));
}

function modalEditar(ctx, bloco, it) {
  const f = formItem(bloco, it);
  const modal = abrirModal({ titulo: "Editar item", largura: 620 });
  const salvar = async () => {
    const dados = lerForm(f);
    if (!dados) return;
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "patrimonio", it.id), {
      ...dados,
      [`historico.${mesAtualYM()}`]: dados.valor,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível salvar. Verifique a conexão e tente de novo.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };
  modal.trocar(corpoForm(f, bloco), botoes(modal, salvar, "Salvar alterações"));
}

// Registra o valor de um mês específico (monta a linha do gráfico).
function modalAtualizarMes(ctx, it) {
  const mes = el("input", { type: "month", value: mesAtualYM() });
  const val = el("input", { type: "text", inputmode: "decimal", value: campo(valorNoMes(it, mesAtualYM())), placeholder: "0,00" });
  const modal = abrirModal({ titulo: "Atualizar valor — " + (it.descricao || "item"), largura: 460 });
  const salvar = async () => {
    const ym = mes.value;
    const v = num(val.value);
    if (!ym) {
      alert("Escolha o mês.");
      return;
    }
    if (v < 0) {
      alert("O valor não pode ser negativo.");
      return;
    }
    const extra = ym === mesAtualYM() ? { valor: v } : {};
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "patrimonio", it.id), {
      [`historico.${ym}`]: v,
      ...extra,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível salvar o valor do mês. Tente de novo.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };
  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Mês", mes),
      el("label", {}, "Valor do mês", val),
    ),
    botoes(modal, salvar, "Salvar valor"),
  );
}

async function excluir(ctx, it) {
  if (!confirm("Excluir este item e todo o seu histórico?")) return;
  const ok = await gravar(() => deleteDoc(doc(db, "users", ctx.email, "patrimonio", it.id)), "Não foi possível excluir. Tente novamente.");
  if (ok) recarregar();
}

// ---------- Blocos ----------
function linhaItem(ctx, bloco, it) {
  const partes = [it.instituicao];
  if (bloco.milhas && num(it.quantidade)) partes.push(num(it.quantidade).toLocaleString("pt-BR") + " milhas");
  if (!bloco.divida && !bloco.milhas) partes.push(it.grupo === "renda" ? "Gerador de renda" : "Uso pessoal");
  if (num(it.valorInvestido)) partes.push("Investido: " + brl(it.valorInvestido));
  return el("div", { style: "display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #ECE7DE;flex-wrap:wrap" },
    el("div", {},
      el("div", { style: "font-weight:500" }, it.descricao || "—"),
      el("div", { class: "muted", style: "font-size:12px" }, partes.filter(Boolean).join(" · ") || " "),
    ),
    el("div", { style: "text-align:right" },
      el("div", { class: "num", style: "font-weight:500" }, brl(it.valor)),
      el("div", { style: "display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px" },
        el("button", { class: "ghost", onclick: () => modalAtualizarMes(ctx, it) }, "Atualizar mês"),
        el("button", { class: "ghost", onclick: () => modalEditar(ctx, bloco, it) }, "Editar"),
        el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, () => excluir(ctx, it)) }, "Excluir"),
      ),
    ),
  );
}

function cartaoBloco(ctx, bloco, itens) {
  const total = itens.reduce((s, it) => s + num(it.valor), 0);
  return el("section", { class: "card", style: "margin:0" },
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap" },
      el("h3", { style: "margin:0" }, bloco.titulo),
      el("button", { class: "ghost", onclick: () => modalNovo(ctx, bloco) }, "+ Adicionar"),
    ),
    el("p", { class: "muted", style: "margin:6px 0 4px" }, itens.length ? (bloco.divida ? "Saldo devedor: " : "Total: ") + brl(total) : ""),
    itens.length ? itens.map((it) => linhaItem(ctx, bloco, it)) : el("p", { class: "muted" }, "Você ainda não tem registros para acompanhar."),
  );
}

// ---------- Gráficos ----------
let graficos = [];
function destruirGraficos() {
  graficos.forEach((g) => g.destroy());
  graficos = [];
}

function desenharRosca(canvas, rotulos, valores, cores) {
  if (!canvas || !canvas.isConnected || !window.Chart) return;
  graficos.push(new Chart(canvas, {
    type: "doughnut",
    data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: cores, borderWidth: 0 }] },
    options: { cutout: "60%", plugins: { legend: { position: "bottom" } } },
  }));
}

function serieMensal(itens) {
  const hoje = mesAtualYM();
  let inicio = hoje;
  for (const it of itens) for (const k of Object.keys(it.historico || {})) if (k < inicio) inicio = k;
  const meses = [];
  for (let ym = inicio; ym <= hoje && meses.length < 240; ym = somarMeses(ym, 1)) meses.push(ym);
  const ativos = itens.filter((i) => !ehDivida(i));
  const dividas = itens.filter(ehDivida);
  const somar = (lista, ym) => lista.reduce((s, i) => s + valorNoMes(i, ym), 0);
  const pas = meses.map((ym) => somar(ativos, ym));
  const pss = meses.map((ym) => somar(dividas, ym));
  return { meses, ativos: pas, passivos: pss, liquido: pas.map((a, i) => a - pss[i]) };
}

function desenharLinha(canvas, serie) {
  if (!canvas || !canvas.isConnected || !window.Chart) return;
  graficos.push(new Chart(canvas, {
    type: "line",
    data: {
      labels: serie.meses.map(rotuloMes),
      datasets: [
        { label: "Ativos", data: serie.ativos, borderColor: "#2C4A3E", backgroundColor: "#2C4A3E", tension: 0.25 },
        { label: "Passivos", data: serie.passivos, borderColor: "#B0413E", backgroundColor: "#B0413E", tension: 0.25 },
        { label: "Patrimônio líquido", data: serie.liquido, borderColor: "#C9A96E", backgroundColor: "#C9A96E", borderWidth: 3, tension: 0.25 },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: { y: { ticks: { callback: (v) => brl(v) } } },
      plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + brl(c.parsed.y) } } },
    },
  }));
}

// ---------- Tela ----------
export function telaMeuPatrimonio(ctx, dados) {
  destruirGraficos();
  const itens = dados.patrimonio;
  const ativosItens = itens.filter((i) => !ehDivida(i));
  const dividasItens = itens.filter(ehDivida);
  const soma = (lista) => lista.reduce((s, i) => s + num(i.valor), 0);
  const ativos = soma(ativosItens);
  const passivos = soma(dividasItens);
  const liquido = ativos - passivos;
  const renda = soma(ativosItens.filter((i) => i.grupo === "renda"));
  const pessoal = ativos - renda;
  const financ = soma(dividasItens.filter((i) => i.categoria === "financiamento"));
  const emprest = passivos - financ;
  const pctRenda = ativos ? renda / ativos : 0;
  const pctDivida = ativos ? passivos / ativos : 0;

  const ids = { ativos: el("canvas", { height: "220" }), passivos: el("canvas", { height: "220" }), liquido: el("canvas", { height: "280" }) };
  const semDados = (texto) => el("p", { class: "muted" }, texto);

  const blocos = BLOCOS.map((b) => cartaoBloco(ctx, b, itens.filter((i) => blocoDe(i) === b)));

  const resumo = [
    el("section", { class: "card", style: "margin:0" },
      el("h3", { style: "margin:0 0 6px" }, "Ativos"),
      el("p", {}, "Seus ativos somam o total de ", el("strong", {}, brl(ativos))),
      ativos ? ids.ativos : semDados("Sem ativos cadastrados."),
    ),
    el("section", { class: "card", style: "margin:0" },
      el("h3", { style: "margin:0 0 6px" }, "Passivos"),
      el("p", {}, "Seus passivos somam o total de ", el("strong", {}, brl(passivos))),
      passivos ? ids.passivos : semDados("Sem dívidas cadastradas."),
    ),
    el("section", { class: "card", style: "margin:0" },
      el("h3", { style: "margin:0 0 6px" }, "Ativo gerador de renda"),
      el("p", {}, "Você possui ", el("strong", {}, pct(pctRenda)), " dos seus ativos gerando renda, totalizando ", el("strong", {}, brl(renda))),
      el("button", { class: "ghost", style: "margin-top:8px", onclick: () => ir(hashFerramenta(ctx, "aposentadoria")) }, "VER MEU FUTURO"),
    ),
    el("section", { class: "card", style: "margin:0" },
      el("h3", { style: "margin:0 0 6px" }, "Nível de endividamento"),
      el("p", {}, "Você possui ", el("strong", {}, pct(pctDivida)), " do seu patrimônio comprometido com financiamentos e dívidas, totalizando ", el("strong", {}, brl(passivos))),
    ),
    el("section", { class: "card", style: "margin:0" },
      el("h3", { style: "margin:0 0 6px" }, "Patrimônio líquido"),
      el("p", {}, "Seu patrimônio líquido atual é de ", el("strong", {}, brl(liquido))),
    ),
  ];

  // Rosca de ativos (renda x pessoal) e de passivos (financiamento x empréstimos) para o gráfico.
  setTimeout(() => {
    desenharRosca(ids.ativos, ["Gerador de renda", "Uso pessoal"], [renda, pessoal], CORES_ATIVOS);
    desenharRosca(ids.passivos, ["Financiamentos", "Empréstimos e dívidas"], [financ, emprest], CORES_PASSIVOS);
    if (itens.length) desenharLinha(ids.liquido, serieMensal(itens));
  }, 0);

  return el("div", {},
    el("h2", { style: "margin:0 0 12px" }, "Bens e dívidas"),
    el("div", { style: GRADE }, blocos),
    el("h2", { style: "margin:28px 0 12px" }, "Resumo patrimonial"),
    el("div", { style: GRADE }, resumo),
    el("h2", { style: "margin:28px 0 12px" }, "Evolução do patrimônio líquido"),
    el("section", { class: "card", style: "margin:0" },
      itens.length ? ids.liquido : semDados("Cadastre seus itens para ver a evolução mês a mês."),
    ),
  );
}
