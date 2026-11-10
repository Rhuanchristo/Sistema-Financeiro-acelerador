// Patrimônio: o cliente também pode cadastrar e editar os próprios itens.
import { db, doc, addDoc, updateDoc, deleteDoc, collection } from "../firebase.js";
import { brl, num } from "../format.js";
import { calcPatrimonio, CATEGORIAS_PATRIMONIO } from "../calc.js";
import { el, kpi, acao, abrirModal, toast } from "../ui.js";
import { recarregar } from "../router.js";

const nomeCategoria = (k) => (CATEGORIAS_PATRIMONIO.find(([c]) => c === k) || [])[1] || k || "Sem tipo";

// Executa uma gravação; se falhar mostra mensagem amigável e devolve false.
async function gravar(fn, msgErro) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    toast(msgErro);
    return false;
  }
}

// Campo vazio vale zero; texto que não vira número (ex.: "abc") é inválido.
const valorValido = (txt) => {
  const s = String(txt ?? "").trim();
  return !s || num(s) !== 0 || /^[R$\s0.,]*$/i.test(s);
};

// Número para o campo de edição no padrão brasileiro (sem símbolo).
const paraCampo = (v) => (num(v) ? num(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

// atualizadoEm pode ser texto ISO, Timestamp do Firestore ou Date. Retorna dd/mm/aaaa ou "—".
function dataBR(v) {
  if (!v) return "—";
  const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
  if (isNaN(d.getTime())) return "—";
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

// Valida os campos; devolve os dados a gravar ou null (já avisou o usuário).
function lerCampos(catSel, descInp, instInp, valInp) {
  if (!descInp.value.trim()) {
    alert("Informe a descrição.");
    return null;
  }
  if (!valorValido(valInp.value)) {
    alert("Informe um valor válido.");
    return null;
  }
  const valor = num(valInp.value);
  if (valor < 0) {
    alert("O valor não pode ser negativo. Para dívidas, escolha o tipo Dívida e informe o valor positivo.");
    return null;
  }
  return {
    categoria: catSel.value,
    descricao: descInp.value.trim(),
    instituicao: instInp.value.trim(),
    valor,
  };
}

function campos(it = {}) {
  const catSel = el("select", {}, CATEGORIAS_PATRIMONIO.map(([k, l]) => el("option", { value: k, selected: k === it.categoria }, l)));
  const descInp = el("input", { type: "text", placeholder: "Descrição", value: it.descricao || "", style: "min-width:220px" });
  const instInp = el("input", { type: "text", placeholder: "Banco / corretora", value: it.instituicao || "", style: "min-width:180px" });
  const valInp = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", value: paraCampo(it.valor), class: "num", style: "width:140px" });
  return { catSel, descInp, instInp, valInp };
}

function modalEditar(ctx, it) {
  const f = campos(it);
  const modal = abrirModal({ titulo: "Editar item do patrimônio", largura: 640 });

  const salvar = async () => {
    const dadosItem = lerCampos(f.catSel, f.descInp, f.instInp, f.valInp);
    if (!dadosItem) return;
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "patrimonio", it.id), {
      ...dadosItem,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível salvar o item. Verifique a conexão e tente novamente.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };

  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Tipo", f.catSel),
      el("label", {}, "Descrição", f.descInp),
      el("label", {}, "Instituição (investimentos)", f.instInp),
      el("label", {}, "Valor", f.valInp),
    ),
    el("p", { class: "muted" }, "Última atualização: " + dataBR(it.atualizadoEm)),
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Salvar alterações"),
    ),
  );
}

export function telaPatrimonio(ctx, dados) {
  const pat = calcPatrimonio(dados.patrimonio);
  const novo = campos();

  const salvar = async () => {
    const dadosItem = lerCampos(novo.catSel, novo.descInp, novo.instInp, novo.valInp);
    if (!dadosItem) return;
    const ok = await gravar(() => addDoc(collection(db, "users", ctx.email, "patrimonio"), {
      ...dadosItem,
      atualizadoEm: new Date().toISOString(),
      criadoPor: ctx.user.email,
    }), "Não foi possível adicionar o item. Verifique a conexão e tente novamente.");
    if (ok) recarregar();
  };

  const excluir = async (it) => {
    if (!confirm("Excluir este item?")) return;
    const ok = await gravar(() => deleteDoc(doc(db, "users", ctx.email, "patrimonio", it.id)),
      "Não foi possível excluir o item. Tente novamente.");
    if (ok) recarregar();
  };

  // Agrupa por tipo, na ordem de CATEGORIAS_PATRIMONIO; tipos desconhecidos vão ao final.
  const ordem = CATEGORIAS_PATRIMONIO.map(([k]) => k);
  const grupos = new Map();
  for (const it of dados.patrimonio) {
    const k = it.categoria || "";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(it);
  }
  const chaves = [...grupos.keys()].sort((a, b) => {
    const ia = ordem.indexOf(a), ib = ordem.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const linhas = chaves.flatMap((k) => {
    const itens = grupos.get(k).slice().sort((a, b) => num(b.valor) - num(a.valor));
    const subtotal = itens.reduce((s, it) => s + num(it.valor), 0);
    return [
      el("tr", { style: "background:#F5F0E8" },
        el("td", { colspan: "6", style: "font-weight:600" }, nomeCategoria(k) + " (" + itens.length + ")"),
      ),
      ...itens.map((it) => el("tr", {},
        el("td", {}, nomeCategoria(it.categoria)),
        el("td", {}, it.descricao || "—"),
        el("td", {}, it.instituicao || "—"),
        el("td", { class: "num" }, brl(it.valor)),
        el("td", {}, dataBR(it.atualizadoEm)),
        el("td", { style: "white-space:nowrap" },
          el("button", { class: "ghost", onclick: () => modalEditar(ctx, it) }, "Editar"), " ",
          el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, () => excluir(it)) }, "Excluir"),
        ),
      )),
      el("tr", {},
        el("td", { colspan: "3", style: "text-align:right;font-weight:600" }, "Subtotal " + nomeCategoria(k)),
        el("td", { class: "num", style: "font-weight:600" }, brl(subtotal)),
        el("td", { colspan: "2" }, ""),
      ),
    ];
  });

  const tabela = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Tipo"),
      el("th", {}, "Descrição"),
      el("th", {}, "Instituição"),
      el("th", { class: "num" }, "Valor"),
      el("th", {}, "Atualizado em"),
      el("th", {}, ""),
    )),
    el("tbody", {}, linhas),
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
        el("label", {}, "Tipo", novo.catSel),
        el("label", {}, "Descrição", novo.descInp),
        el("label", {}, "Instituição (investimentos)", novo.instInp),
        el("label", {}, "Valor", novo.valInp),
        el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Adicionar"),
      ),
    ),
  );
}
