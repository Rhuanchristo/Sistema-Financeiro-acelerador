// Proteção: apólices de seguro do cliente (vida, residencial, casa e carro).
// Cada apólice fica em users/{email}/protecao/{id}. Pelas regras atuais, só o administrador grava;
// o cliente vê a própria proteção em modo somente leitura.
import { db, doc, addDoc, updateDoc, deleteDoc, collection } from "../firebase.js";
import { brl, num } from "../format.js";
import { el, acao, abrirModal, toast } from "../ui.js";
import { recarregar } from "../router.js";

export const BLOCOS_PROTECAO = [
  { id: "vida", titulo: "Seguro de vida", rotuloCob: "Capital segurado", rotuloDesc: "Segurado / beneficiário" },
  { id: "residencial", titulo: "Seguro residencial", rotuloCob: "Cobertura do imóvel", rotuloDesc: "Imóvel" },
  { id: "casa", titulo: "Casa", rotuloCob: "Cobertura da casa", rotuloDesc: "Descrição do bem" },
  { id: "carro", titulo: "Carro", rotuloCob: "Valor segurado", rotuloDesc: "Modelo do veículo" },
];

const GRADE = "display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px";
const DIA_MS = 86400000;

// Data AAAA-MM-DD para exibição dd/mm/aaaa.
const dataBR = (v) => {
  if (!v) return "—";
  const [a, m, d] = String(v).split("-");
  return a && m && d ? d + "/" + m + "/" + a : "—";
};
const diasAte = (v) => {
  if (!v) return null;
  const [a, m, d] = String(v).split("-").map(Number);
  if (!a || !m || !d) return null;
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((new Date(a, m - 1, d) - inicio) / DIA_MS);
};
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

// ---------- Formulário ----------
function formApolice(bloco, it = {}) {
  return {
    desc: el("input", { type: "text", value: it.descricao || "", placeholder: bloco.rotuloDesc }),
    seg: el("input", { type: "text", value: it.seguradora || "", placeholder: "Ex.: Porto Seguro" }),
    cob: el("input", { type: "text", inputmode: "decimal", value: campo(it.cobertura), placeholder: "0,00" }),
    premio: el("input", { type: "text", inputmode: "decimal", value: campo(it.premioMensal), placeholder: "0,00" }),
    venc: el("input", { type: "date", value: it.vencimento || "" }),
    obs: el("input", { type: "text", value: it.observacao || "", placeholder: "Opcional" }),
  };
}

function corpoForm(f, bloco) {
  return el("div", { class: "row" },
    el("label", {}, bloco.rotuloDesc, f.desc),
    el("label", {}, "Seguradora", f.seg),
    el("label", {}, bloco.rotuloCob, f.cob),
    el("label", {}, "Prêmio mensal", f.premio),
    el("label", {}, "Vencimento da vigência", f.venc),
    el("label", {}, "Observação", f.obs),
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
  const cobertura = num(f.cob.value);
  const premio = num(f.premio.value);
  if (cobertura < 0 || premio < 0) {
    alert("Cobertura e prêmio não podem ser negativos.");
    return null;
  }
  return {
    descricao: f.desc.value.trim(),
    seguradora: f.seg.value.trim(),
    cobertura,
    premioMensal: premio,
    vencimento: f.venc.value || "",
    observacao: f.obs.value.trim(),
  };
}

function modalNova(ctx, bloco) {
  const f = formApolice(bloco);
  const modal = abrirModal({ titulo: "Adicionar em " + bloco.titulo, largura: 620 });
  const salvar = async () => {
    const dados = lerForm(f);
    if (!dados) return;
    const ok = await gravar(() => addDoc(collection(db, "users", ctx.email, "protecao"), {
      ...dados,
      categoria: bloco.id,
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
  const f = formApolice(bloco, it);
  const modal = abrirModal({ titulo: "Editar apólice", largura: 620 });
  const salvar = async () => {
    const dados = lerForm(f);
    if (!dados) return;
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "protecao", it.id), {
      ...dados,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível salvar. Verifique a conexão e tente de novo.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };
  modal.trocar(corpoForm(f, bloco), botoes(modal, salvar, "Salvar alterações"));
}

async function excluir(ctx, it) {
  if (!confirm("Excluir esta apólice?")) return;
  const ok = await gravar(() => deleteDoc(doc(db, "users", ctx.email, "protecao", it.id)), "Não foi possível excluir. Tente novamente.");
  if (ok) recarregar();
}

// ---------- Tela ----------
function linhaApolice(ctx, bloco, it) {
  const dias = diasAte(it.vencimento);
  const alerta = dias !== null && dias <= 60;
  const detalhe = [it.seguradora, it.observacao].filter(Boolean).join(" · ");
  const botoesAcao = ctx.modo === "admin"
    ? el("div", { style: "display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px" },
        el("button", { class: "ghost", onclick: () => modalEditar(ctx, bloco, it) }, "Editar"),
        el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, () => excluir(ctx, it)) }, "Excluir"),
      )
    : null;
  return el("div", { style: "display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #ECE7DE;flex-wrap:wrap" },
    el("div", {},
      el("div", { style: "font-weight:500" }, it.descricao || "—"),
      el("div", { class: "muted", style: "font-size:12px" }, detalhe || " "),
      el("div", { class: "muted", style: "font-size:12px;color:" + (alerta ? "#B0413E" : "inherit") },
        "Vence em " + dataBR(it.vencimento) + (alerta ? (dias < 0 ? " (vencida)" : " (em " + dias + " dias)") : "")),
    ),
    el("div", { style: "text-align:right" },
      el("div", { class: "muted", style: "font-size:12px" }, bloco.rotuloCob),
      el("div", { class: "num", style: "font-weight:500" }, brl(it.cobertura)),
      num(it.premioMensal) ? el("div", { class: "muted", style: "font-size:12px" }, "Prêmio " + brl(it.premioMensal) + " / mês") : null,
      botoesAcao,
    ),
  );
}

function cartaoBloco(ctx, bloco, itens) {
  const total = itens.reduce((s, it) => s + num(it.cobertura), 0);
  return el("section", { class: "card", style: "margin:0" },
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap" },
      el("h3", { style: "margin:0" }, bloco.titulo),
      ctx.modo === "admin" ? el("button", { class: "ghost", onclick: () => modalNova(ctx, bloco) }, "+ Adicionar") : null,
    ),
    el("p", { class: "muted", style: "margin:6px 0 4px" }, itens.length ? "Cobertura total: " + brl(total) : ""),
    itens.length
      ? el("div", { style: "max-height:420px;overflow-y:auto;padding-right:6px;margin-right:-6px" }, itens.map((it) => linhaApolice(ctx, bloco, it)))
      : el("p", { class: "muted" }, "Nenhuma apólice cadastrada."),
  );
}

export function telaProtecao(ctx, apolices) {
  const todas = apolices || [];
  const cobertura = todas.reduce((s, it) => s + num(it.cobertura), 0);
  const premio = todas.reduce((s, it) => s + num(it.premioMensal), 0);
  const proximas = todas.filter((it) => {
    const d = diasAte(it.vencimento);
    return d !== null && d <= 60;
  }).length;

  const resumo = el("section", { class: "kpis" },
    el("div", { class: "kpi" }, el("span", {}, "Cobertura total"), el("strong", {}, brl(cobertura))),
    el("div", { class: "kpi" }, el("span", {}, "Prêmio mensal total"), el("strong", {}, brl(premio))),
    el("div", { class: "kpi" }, el("span", {}, "Vencem em até 60 dias"), el("strong", {}, String(proximas))),
  );

  const blocos = BLOCOS_PROTECAO.map((b) => cartaoBloco(ctx, b, todas.filter((it) => it.categoria === b.id)));

  return el("div", {},
    ctx.modo === "cliente"
      ? el("p", { class: "muted", style: "margin:0 0 16px" }, "Suas apólices são cadastradas pela sua consultoria. Qualquer dúvida, fale com ela.")
      : null,
    resumo,
    el("div", { style: GRADE }, blocos),
  );
}
