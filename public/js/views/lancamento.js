// Lançamento: um único campo com categoria, valor, mês, parcelas + lista com filtros e edição.
import { db, doc, collection, writeBatch } from "../firebase.js";
import { brl, num, soma, addMeses, mesNome, mesAtual } from "../format.js";
import { entidadeDe, SUGESTOES } from "../calc.js";
import { el, abrirModal, acao, toast, campoMes } from "../ui.js";
import { recarregar } from "../router.js";

// Limite do Firestore por writeBatch.
const MAX_LOTE = 500;
// Janela de tempo (criadoEm) para considerar dois lançamentos iguais como possível duplicado.
const JANELA_DUPLICADO_MS = 2 * 60 * 1000;

const refLancamento = (ctx, id) => doc(db, "users", ctx.email, "lancamentos", id);

function novoGrupoId() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

// Aplica as operações em writeBatch de até 500. Retorna quantos lotes foram gravados.
// Se algo falhar, lança um erro com "lotesGravados" para a mensagem ao usuário.
async function gravarEmLotes(operacoes) {
  let lotesGravados = 0;
  for (let i = 0; i < operacoes.length; i += MAX_LOTE) {
    const lote = writeBatch(db);
    for (const op of operacoes.slice(i, i + MAX_LOTE)) op(lote);
    try {
      await lote.commit();
    } catch (err) {
      err.lotesGravados = lotesGravados;
      throw err;
    }
    lotesGravados++;
  }
  return lotesGravados;
}

// Mensagem clara de falha. Com mais de um lote, avisa que parte pode ter sido gravada.
function avisarFalha(err, oQue) {
  console.error(err);
  if (err && err.lotesGravados > 0) {
    toast("Não foi possível concluir: " + oQue + ". Parte da operação já foi gravada; confira a lista e tente de novo.", 7000);
  } else {
    toast("Não foi possível concluir: " + oQue + ". Nada foi alterado; verifique a conexão e tente de novo.", 7000);
  }
}

// Lançamentos criados juntos (mesmo grupoId), em ordem de série/mês.
function membrosDaSerie(l, dados) {
  if (!l.grupoId) return [];
  return dados.lancamentos
    .filter((x) => x.grupoId === l.grupoId)
    .sort((a, b) => ((a.serie && a.serie.indice) || 0) - ((b.serie && b.serie.indice) || 0)
      || (a.mesInicial || "").localeCompare(b.mesInicial || ""));
}

// Divide um total em n valores com 2 casas; a última parcela recebe o ajuste do arredondamento.
function dividirValor(total, n) {
  const base = Math.floor((total * 100) / n) / 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base));
}

async function excluirIds(ctx, ids) {
  try {
    await gravarEmLotes(ids.map((id) => (lote) => lote.delete(refLancamento(ctx, id))));
  } catch (err) {
    avisarFalha(err, "excluir os lançamentos");
    return false;
  }
  return true;
}

async function excluirLancamento(ctx, l, dados) {
  const serie = membrosDaSerie(l, dados);
  if (serie.length <= 1) {
    const legado = Number(l.parcelas || 1) > 1;
    const msg = legado
      ? "Excluir este lançamento? Todas as parcelas dele serão removidas."
      : "Excluir este lançamento? Essa ação não pode ser desfeita.";
    if (!confirm(msg)) return;
    if (await excluirIds(ctx, [l.id])) recarregar();
    return;
  }
  // Lançamento de uma série: pergunta se exclui só este ou a série inteira.
  const modal = abrirModal({ largura: 520 });
  const excluir = async (ids) => {
    if (await excluirIds(ctx, ids)) {
      modal.fechar();
      recarregar();
    }
  };
  modal.trocar(
    el("h2", {}, "Excluir lançamento"),
    el("p", {}, "Este lançamento faz parte de uma série de " + serie.length + " lançamentos criados juntos ("
      + mesNome(serie[0].mesInicial) + " a " + mesNome(serie[serie.length - 1].mesInicial) + ")."),
    el("p", { class: "muted" }, "Essa ação não pode ser desfeita."),
    el("div", { class: "row" },
      el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, () => excluir([l.id])) }, "Somente este"),
      el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, () => excluir(serie.map((x) => x.id))) }, "Toda a série (" + serie.length + ")"),
      el("button", { class: "ghost", onclick: modal.fechar }, "Cancelar"),
    ),
  );
}

// Novo lançamento em popup, no estilo do modelo: direção, valor, data, descrição, estabelecimento,
// meio de pagamento, parcelamento, quem, classificação e categoria.
const CLASSIFICACOES = [
  "Classificação neutra", "Despesas não obrigatórias", "Despesas obrigatórias", "Dívidas",
  "Empresa e autônomo", "Financiamentos", "Investimentos", "Projetos", "Renda",
];
const CATEGORIAS_POR_CLASSIFICACAO = {
  "Renda": ["Outras fontes de renda", "Renda Cliente", "Renda cônjuge"],
};
const MEIOS_PAGAMENTO = ["Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito", "Transferência", "Boleto", "Débito automático"];

const hojeISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

// Botões de escolha única com aparência de chip (como no modelo).
function chips(opcoes, valorInicial, aoMudar) {
  const estado = { valor: valorInicial };
  const marcar = (btn, ativo) => {
    btn.setAttribute("aria-pressed", String(ativo));
    btn.style.background = ativo ? "#ECE7DE" : "#FFFFFF";
    btn.style.borderColor = ativo ? "#132721" : "#DDD6CA";
    btn.style.fontWeight = ativo ? "600" : "400";
  };
  const botoes = opcoes.map(([valor, rotulo]) => {
    const btn = el("button", { type: "button", class: "ghost", style: "border-radius:8px;padding:9px 14px;color:#2A2A2A;border:1px solid #DDD6CA;background:#FFFFFF" }, rotulo);
    return { valor, btn };
  });
  botoes.forEach(({ valor, btn }) => {
    marcar(btn, valor === valorInicial);
    btn.addEventListener("click", () => {
      estado.valor = valor;
      botoes.forEach((x) => marcar(x.btn, x.valor === valor));
      if (aoMudar) aoMudar(valor);
    });
  });
  return { el: el("div", { style: "display:flex;flex-wrap:wrap;gap:8px" }, botoes.map((x) => x.btn)), valor: () => estado.valor };
}

const secaoForm = (titulo, conteudo) => el("div", { style: "margin-bottom:18px" }, el("h3", { style: "margin:0 0 8px" }, titulo), conteudo);
const grade2 = (...itens) => el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px" }, ...itens);

function modalNovoLancamento(ctx) {
  const modal = abrirModal({ titulo: "Novo lançamento", largura: 760 });
  const direcao = chips([["receita", "Entrada"], ["despesa", "Saída"]], "despesa");
  const quem = chips([["empresa", "Empresa"], ["pessoa", "Pessoa física"]], "empresa");
  const valor = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", class: "num", style: "width:100%" });
  const data = el("input", { type: "date", value: hojeISO(), style: "width:100%" });
  const descricao = el("input", { type: "text", placeholder: "Digite sua descrição", style: "width:100%" });
  const estabelecimento = el("input", { type: "text", placeholder: "Digite o nome do estabelecimento", style: "width:100%" });
  const meio = el("select", { style: "width:100%" },
    el("option", { value: "" }, "Selecione o meio de pagamento"),
    MEIOS_PAGAMENTO.map((m) => el("option", { value: m }, m)),
  );
  const forma = el("select", { style: "width:100%" },
    el("option", { value: "parcelado" }, "Parcelado (divide o valor)"),
    el("option", { value: "replicar" }, "Replicar (mesmo valor em cada mês)"),
  );
  const meses = el("input", { type: "number", min: "2", max: "360", value: "12", style: "width:100%" });
  const blocoParcela = el("div", { style: "display:none;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-bottom:18px" },
    el("label", {}, "Forma", forma),
    el("label", {}, "Nº de meses", meses),
  );
  const preview = el("p", { class: "muted", style: "margin:-6px 0 14px" });

  const atualizarPreview = () => {
    const total = num(valor.value);
    const parcelado = parcela.valor() === "sim";
    const n = parcelado ? Math.max(1, Math.floor(num(meses.value))) : 1;
    const mesIni = data.value ? data.value.slice(0, 7) : "";
    if (!(total > 0) || !mesIni) {
      preview.textContent = "";
      return;
    }
    if (n === 1) {
      preview.textContent = "Lançamento único de " + brl(total) + " em " + mesNome(mesIni) + ".";
      return;
    }
    const fim = mesNome(addMeses(mesIni, n - 1));
    if (forma.value === "replicar") {
      preview.textContent = n + " lançamentos de " + brl(total) + " por mês, de " + mesNome(mesIni) + " a " + fim + ". Total: " + brl(total * n) + ".";
      return;
    }
    const base = Math.floor((total * 100) / n) / 100;
    preview.textContent = n + " parcelas de aproximadamente " + brl(base) + ", de " + mesNome(mesIni) + " a " + fim + ". Total: " + brl(total) + ".";
  };

  const parcela = chips([["nao", "Não"], ["sim", "Sim"]], "nao", (v) => {
    blocoParcela.style.display = v === "sim" ? "grid" : "none";
    atualizarPreview();
  });
  for (const c of [valor, data, meses]) {
    c.addEventListener("input", atualizarPreview);
    c.addEventListener("change", atualizarPreview);
  }
  forma.addEventListener("change", atualizarPreview);

  // Categoria: chips para as classificações que têm lista (ex.: Renda); nas demais, texto livre com sugestões.
  let categoriaEscolhida = "";
  let categoriaTemLista = false;
  const categoriaTexto = el("input", { type: "text", list: "sugestoes-categoria", placeholder: "Digite a categoria", style: "width:100%" });
  const datalist = el("datalist", { id: "sugestoes-categoria" },
    [...SUGESTOES.receita, ...SUGESTOES.despesa].map((s) => el("option", { value: s })));
  const boxCategoria = el("div", {});
  const desenharCategoria = (classificacao) => {
    const lista = CATEGORIAS_POR_CLASSIFICACAO[classificacao];
    categoriaTemLista = !!lista;
    categoriaEscolhida = "";
    if (lista) {
      const escolha = chips(lista.map((c) => [c, c]), "", (v) => { categoriaEscolhida = v; });
      boxCategoria.replaceChildren(escolha.el);
    } else {
      categoriaTexto.value = "";
      boxCategoria.replaceChildren(categoriaTexto);
    }
  };
  const classificacao = chips(CLASSIFICACOES.map((c) => [c, c]), "", (v) => desenharCategoria(v));
  desenharCategoria("");

  const salvar = async () => {
    const total = num(valor.value);
    const classif = classificacao.valor();
    const cat = categoriaTemLista ? categoriaEscolhida : categoriaTexto.value.trim();
    const mesIni = data.value ? data.value.slice(0, 7) : "";
    const parcelado = parcela.valor() === "sim";
    const n = parcelado ? Math.floor(num(meses.value)) : 1;
    if (!data.value) return alert("Informe a data.");
    if (!(total > 0)) return alert("Informe um valor maior que zero.");
    if (!classif) return alert("Escolha a classificação.");
    if (!cat) return alert("Escolha ou informe a categoria.");
    if (!(n >= 1 && n <= 360)) return alert("O número de meses deve estar entre 1 e 360.");
    const valores = parcelado && forma.value === "parcelado" ? dividirValor(total, n) : Array(n).fill(total);
    if (valores.some((v) => !(v > 0))) return alert("O valor é pequeno demais para dividir em " + n + " parcelas.");
    const grupoId = novoGrupoId();
    const criadoEm = new Date().toISOString();
    const colecao = collection(db, "users", ctx.email, "lancamentos");
    const lote = writeBatch(db);
    valores.forEach((v, i) => {
      const novo = {
        tipo: direcao.valor(),
        categoria: cat,
        classificacao: classif,
        descricao: descricao.value.trim(),
        estabelecimento: estabelecimento.value.trim(),
        meioPagamento: meio.value,
        data: data.value,
        valorTotal: v,
        mesInicial: addMeses(mesIni, i),
        parcelas: 1,
        modo: n === 1 ? "unico" : forma.value,
        entidade: quem.valor(),
        grupoId,
        criadoEm,
        criadoPor: ctx.user.email,
      };
      if (n > 1) novo.serie = { indice: i + 1, total: n };
      lote.set(doc(colecao), novo);
    });
    try {
      await lote.commit();
    } catch (err) {
      avisarFalha(err, "gravar " + (n > 1 ? "os " + n + " lançamentos" : "o lançamento"));
      return;
    }
    modal.fechar();
    recarregar();
  };

  modal.trocar(
    secaoForm("Direção do lançamento", direcao.el),
    grade2(secaoForm("Valor", valor), secaoForm("Data", data)),
    grade2(secaoForm("Descrição", descricao), secaoForm("Estabelecimento", estabelecimento)),
    grade2(secaoForm("Meio de pagamento", meio), secaoForm("Lançamento parcelado", parcela.el)),
    blocoParcela,
    preview,
    secaoForm("Quem", quem.el),
    secaoForm("Classificação", classificacao.el),
    secaoForm("Categoria", boxCategoria),
    datalist,
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:20px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Lançar"),
    ),
  );
  atualizarPreview();
}

export function telaLancamento(ctx, dados) {
  const selecionados = new Set();
  const botaoExcluirSel = el("button", { class: "danger", style: "display:none", onclick: () => acao(botaoExcluirSel, excluirSelecionados) }, "Excluir selecionados");
  const atualizarSel = () => {
    botaoExcluirSel.textContent = "Excluir selecionados (" + selecionados.size + ")";
    botaoExcluirSel.style.display = selecionados.size ? "" : "none";
  };
  const excluirSelecionados = async () => {
    const ids = [...selecionados];
    if (ids.length === 0) return;
    if (!confirm("Excluir " + ids.length + " lançamento(s) selecionado(s)? Essa ação não pode ser desfeita.")) return;
    if (!(await excluirIds(ctx, ids))) return;
    selecionados.clear();
    recarregar();
  };
  const categoriasUnicas = [...new Set(dados.lancamentos.map((l) => l.categoria))].sort();
  const filtroDe = campoMes("", { vazio: true });
  const filtroAte = campoMes("", { vazio: true });
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
      el("td", { class: "num" }, l.serie && l.serie.total > 1
        ? l.serie.indice + "/" + l.serie.total
        : String(l.parcelas || 1)),
      el("td", { class: "num" }, brl(num(l.valorTotal) / (l.parcelas || 1))),
      el("td", {},
        el("button", { class: "ghost", onclick: () => abrirEdicaoLancamento(ctx, l, dados) }, "Editar"),
        " ",
        el("button", { class: "danger", onclick: () => excluirLancamento(ctx, l, dados) }, "Excluir"),
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
      el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
        el("h2", { style: "margin:0" }, "Lançamentos registrados"),
        el("div", { class: "row", style: "gap:8px" },
          el("button", { onclick: () => modalNovoLancamento(ctx) }, "+ Novo lançamento"),
          el("button", { class: "ghost", onclick: () => verificarDuplicados(ctx, dados) }, "Verificar duplicados"),
        ),
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

// Grupos suspeitos: mesmos campos, criados com até 2 minutos de diferença e sem grupoId em comum.
function encontrarSuspeitos(lancamentos) {
  const porChave = new Map();
  for (const l of lancamentos) {
    const t = Date.parse(l.criadoEm || "");
    if (!Number.isFinite(t)) continue; // sem data de criação não dá para comparar
    const chave = [l.tipo, l.categoria, l.descricao || "", num(l.valorTotal), l.mesInicial, entidadeDe(l), Number(l.parcelas || 1)].join("|");
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave).push({ l, t });
  }
  const grupos = [];
  for (const lista of porChave.values()) {
    if (lista.length < 2) continue;
    // Une os pares próximos no tempo (componentes conexos).
    const pai = lista.map((_, i) => i);
    const raiz = (i) => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        const mesmoGrupo = a.l.grupoId && a.l.grupoId === b.l.grupoId;
        if (!mesmoGrupo && Math.abs(a.t - b.t) <= JANELA_DUPLICADO_MS) pai[raiz(i)] = raiz(j);
      }
    }
    const comp = new Map();
    lista.forEach((x, i) => {
      const r = raiz(i);
      if (!comp.has(r)) comp.set(r, []);
      comp.get(r).push(x);
    });
    for (const itens of comp.values()) {
      if (itens.length > 1) grupos.push(itens.sort((a, b) => a.t - b.t).map((x) => x.l));
    }
  }
  return grupos.sort((a, b) => (b[0].mesInicial || "").localeCompare(a[0].mesInicial || ""));
}

// Mostra os possíveis duplicados para o usuário escolher; nada é excluído sem ser marcado.
function verificarDuplicados(ctx, dados) {
  const grupos = encontrarSuspeitos(dados.lancamentos);
  if (grupos.length === 0) return alert("Nenhum possível duplicado encontrado.");

  const modal = abrirModal({ largura: 760 });
  const marcados = new Set();
  const botaoExcluir = el("button", { class: "danger", disabled: true }, "Excluir marcados (0)");
  const atualizar = () => {
    botaoExcluir.textContent = "Excluir marcados (" + marcados.size + ")";
    botaoExcluir.disabled = marcados.size === 0;
  };
  const dataHora = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
  };

  const excluirMarcados = async () => {
    const ids = [...marcados];
    if (ids.length === 0) return;
    const gruposInteiros = grupos.filter((g) => g.every((x) => marcados.has(x.id))).length;
    const aviso = gruposInteiros
      ? "\n\nAtenção: em " + gruposInteiros + " grupo(s) você marcou todos os itens, então nenhum deles será mantido."
      : "";
    if (!confirm("Excluir " + ids.length + " lançamento(s) marcado(s)? Essa ação não pode ser desfeita." + aviso)) return;
    if (!(await excluirIds(ctx, ids))) return;
    modal.fechar();
    recarregar();
  };
  botaoExcluir.addEventListener("click", () => acao(botaoExcluir, excluirMarcados));

  const blocos = grupos.map((g, gi) => el("div", { style: "border:1px solid #DDD6CA;border-radius:8px;padding:10px 12px;margin:10px 0" },
    el("strong", {}, "Grupo " + (gi + 1) + ": " + g[0].categoria + " · " + brl(g[0].valorTotal) + " · " + mesNome(g[0].mesInicial)
      + " · " + (entidadeDe(g[0]) === "empresa" ? "Empresa" : "Pessoa física")),
    g[0].descricao ? el("div", { class: "muted" }, g[0].descricao) : null,
    g.map((x, i) => el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:6px;font-weight:normal" },
      el("input", { type: "checkbox", onchange: (e) => {
        if (e.target.checked) marcados.add(x.id); else marcados.delete(x.id);
        atualizar();
      } }),
      el("span", {}, (i === 0 ? "Primeiro registro" : "Cópia " + i) + " · criado em " + dataHora(x.criadoEm)
        + (x.criadoPor ? " por " + x.criadoPor : "")),
    )),
  ));

  modal.trocar(
    el("h2", {}, "Possíveis duplicados"),
    el("p", {}, "Encontrei " + grupos.length + " grupo(s) de lançamentos com o mesmo tipo, categoria, descrição, valor, mês e quem, registrados com até 2 minutos de diferença. Isso costuma acontecer quando o botão Lançar é clicado mais de uma vez."),
    el("p", { class: "muted" }, "Gastos iguais no mesmo mês podem ser legítimos (por exemplo, duas compras de mesmo valor). Por isso nada vem marcado: marque somente as cópias que você quer excluir."),
    blocos,
    el("div", { class: "row" },
      botaoExcluir,
      el("button", { class: "ghost", onclick: modal.fechar }, "Fechar"),
    ),
  );
}

// Edição: pergunta se o ajuste vale só para este lançamento, para a série ou para todos da mesma categoria.
function abrirEdicaoLancamento(ctx, l, dados) {
  const iguais = dados.lancamentos.filter((x) => x.tipo === l.tipo && x.categoria === l.categoria && entidadeDe(x) === entidadeDe(l));
  const serie = membrosDaSerie(l, dados);
  const temSerie = serie.length > 1;
  const serieParcelada = temSerie && l.modo === "parcelado";
  const modal = abrirModal({ largura: 640 });
  const fechar = modal.fechar;

  const mostrarForm = (escopo) => {
    const ehTodos = escopo === "todos";
    const ehSerie = escopo === "serie";
    const varios = ehTodos || ehSerie;
    const legado = Number(l.parcelas || 1) > 1;
    const valorInicial = ehSerie && serieParcelada ? soma(serie.map((x) => num(x.valorTotal))) : num(l.valorTotal);
    const inCat = el("input", { type: "text", list: "sugestoes-edicao", value: l.categoria, style: "min-width:200px" });
    const datalistEd = el("datalist", { id: "sugestoes-edicao" }, SUGESTOES[l.tipo].map((s) => el("option", { value: s })));
    const inDesc = el("input", { type: "text", value: l.descricao || "", style: "min-width:200px" });
    const inEnt = el("select", {},
      el("option", { value: "empresa", selected: entidadeDe(l) === "empresa" }, "Empresa"),
      el("option", { value: "pessoa", selected: entidadeDe(l) === "pessoa" }, "Pessoa física"),
    );
    const inVal = el("input", { type: "text", inputmode: "decimal", value: valorInicial.toFixed(2).replace(".", ","), class: "num", style: "width:140px" });
    const inMes = campoMes(l.mesInicial || mesAtual(), { disabled: varios || legado });
    const aviso = legado
      ? "Este é um parcelamento de cadastro antigo: a alteração vale para o total do parcelamento."
      : ehSerie && serieParcelada
        ? "O valor informado é o total do parcelamento e será dividido entre as " + serie.length + " parcelas. O mês de cada uma não muda."
        : varios
          ? "O mês de cada lançamento não muda. Categoria, descrição e valor valem para todos."
          : "";
    const rotuloValor = ehSerie && serieParcelada ? "Valor total do parcelamento" : varios ? "Valor de cada lançamento" : "Valor";

    const salvarEd = async () => {
      const v = num(inVal.value);
      const cat = inCat.value.trim();
      const desc = inDesc.value.trim();
      if (!cat) return alert("Informe a categoria.");
      if (!(v > 0)) return alert("Informe um valor maior que zero.");
      const comuns = { categoria: cat, descricao: desc, entidade: inEnt.value };
      let operacoes;
      if (ehSerie) {
        const valores = serieParcelada ? dividirValor(v, serie.length) : serie.map(() => v);
        if (valores.some((x) => !(x > 0))) return alert("O valor é pequeno demais para dividir em " + serie.length + " parcelas.");
        operacoes = serie.map((x, i) => (lote) => lote.update(refLancamento(ctx, x.id), { ...comuns, valorTotal: valores[i] }));
      } else if (ehTodos) {
        operacoes = iguais.map((x) => {
          const alteracoes = { ...comuns };
          if (Number(x.parcelas || 1) <= 1) alteracoes.valorTotal = v;
          return (lote) => lote.update(refLancamento(ctx, x.id), alteracoes);
        });
      } else {
        const alteracoes = { ...comuns, valorTotal: v };
        if (!legado) alteracoes.mesInicial = inMes.value;
        operacoes = [(lote) => lote.update(refLancamento(ctx, l.id), alteracoes)];
      }
      try {
        await gravarEmLotes(operacoes);
      } catch (err) {
        avisarFalha(err, "salvar as alterações");
        return;
      }
      fechar();
      recarregar();
    };

    modal.trocar(
      el("h2", {}, ehTodos ? "Editar todos da categoria" : ehSerie ? "Editar toda a série" : "Editar este lançamento"),
      el("p", { class: "muted" }, ehTodos
        ? iguais.length + " lançamento(s) de «" + l.categoria + "» serão alterados."
        : ehSerie
          ? "Os " + serie.length + " lançamentos desta série (" + mesNome(serie[0].mesInicial) + " a " + mesNome(serie[serie.length - 1].mesInicial) + ") serão alterados."
          : "Somente este lançamento será alterado."),
      el("div", { class: "row" },
        el("label", {}, "Categoria", inCat),
        el("label", {}, rotuloValor, inVal),
        el("label", {}, "Mês", inMes),
      ),
      el("div", { class: "row" }, el("label", {}, "Descrição", inDesc), el("label", {}, "Quem", inEnt)),
      aviso ? el("p", { class: "muted" }, aviso) : null,
      datalistEd,
      el("div", { class: "row" },
        el("button", { onclick: (e) => acao(e.currentTarget, salvarEd) }, "Salvar alterações"),
        el("button", { class: "ghost", onclick: fechar }, "Cancelar"),
      ),
    );
  };

  modal.trocar(
    el("h2", {}, "Editar lançamento"),
    el("p", {}, temSerie
      ? "Você quer alterar somente este lançamento, toda a série criada junto com ele ou todos da mesma categoria?"
      : "Você quer alterar somente este lançamento ou todos os outros da mesma categoria?"),
    temSerie ? el("p", { class: "muted" }, "Série: " + serie.length + " lançamento(s), de " + mesNome(serie[0].mesInicial) + " a " + mesNome(serie[serie.length - 1].mesInicial) + ".") : null,
    el("p", { class: "muted" }, "«" + l.categoria + "»: " + iguais.length + " lançamento(s) encontrado(s)."),
    el("div", { class: "row" },
      el("button", { onclick: () => mostrarForm("somente") }, "Somente este"),
      temSerie ? el("button", { onclick: () => mostrarForm("serie") }, "Toda a série (" + serie.length + ")") : null,
      el("button", { onclick: () => mostrarForm("todos") }, "Todos da categoria"),
      el("button", { class: "ghost", onclick: fechar }, "Cancelar"),
    ),
  );
}
