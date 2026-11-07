// Crédito: cartas de consórcio do cliente (administradora, grupo, cota, crédito, dívida) com os pagamentos
// de cada parcela. Cada carta fica em users/{email}/consorcios/{id}; os pagamentos ficam dentro da carta.
// Pelas regras, só o administrador grava; o cliente vê em modo somente leitura.
import { db, doc, addDoc, updateDoc, deleteDoc, collection } from "../firebase.js";
import { brl, num, MESES } from "../format.js";
import { el, acao, abrirModal, toast } from "../ui.js";
import { recarregar } from "../router.js";

let grafico = null;
// Cada carta ocupa a largura toda da página, para os valores aparecerem inteiros.
const GRADE_CARTAS = "display:grid;grid-template-columns:minmax(0,1fr);gap:16px";

const soma = (lista) => lista.reduce((s, x) => s + num(x), 0);
const pctTxt = (v) => (Number(v) * 100).toFixed(1).replace(".", ",") + "%";
const dataBR = (v) => {
  const [a, m, d] = String(v || "").split("-");
  return a && m && d ? d + "/" + m + "/" + a : "—";
};
const hojeISO = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const campo = (v) => (num(v) ? num(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

// Totais de uma carta: pago = soma das parcelas registradas; falta = dívida menos o pago (nunca negativo).
function totaisCarta(c) {
  const pagamentos = Array.isArray(c.pagamentos) ? c.pagamentos : [];
  const pago = soma(pagamentos.map((p) => p.valor));
  const divida = num(c.valorDivida);
  const aplicados = reajustesAplicados(c);
  return {
    pagamentos, pago, divida, falta: Math.max(0, divida - pago), quitado: divida > 0 && pago >= divida,
    aplicados,
    creditoCorrigido: num(c.valorCredito) * fatorReajuste(aplicados, "incCredito"),
    parcelaCorrigida: num(c.valorParcela) * fatorReajuste(aplicados, "incParcela"),
  };
}

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

// ---------- Formulários ----------
// Gera as parcelas já pagas no cadastro: a primeira na data de aquisição e as seguintes mês a mês.
function parcelasIniciais(dataAquisicao, quantidade, valor) {
  const [a, m, d] = dataAquisicao.split("-").map(Number);
  const out = [];
  for (let i = 0; i < quantidade; i++) {
    const ano = a + Math.floor((m - 1 + i) / 12);
    const mes = (m - 1 + i) % 12;
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();
    const dia = Math.min(d, ultimoDia);
    const iso = ano + "-" + String(mes + 1).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
    out.push({ data: iso, valor, obs: "Parcela " + (i + 1) + " (registro inicial)" });
  }
  return out;
}

// Parcelas criadas pelo registro inicial (ao cadastrar a carta). Só elas são trocadas na edição.
const ehRegistroInicial = (p) => String(p.obs || "").endsWith("(registro inicial)");

// Reajustes de janeiro (INCC): só valem a partir do ano seguinte ao da aquisição e até o ano atual.
function reajustesAplicados(c) {
  const anoAtual = new Date().getFullYear();
  const anoAquisicao = Number(String(c.dataAquisicao || "").slice(0, 4)) || anoAtual;
  return (Array.isArray(c.reajustes) ? c.reajustes : [])
    .filter((r) => Number(r.ano) > anoAquisicao && Number(r.ano) <= anoAtual)
    .sort((a, b) => Number(a.ano) - Number(b.ano));
}
const fatorReajuste = (lista, campo) => lista.reduce((f, r) => f * (1 + num(r[campo]) / 100), 1);

// Lista editável de reajustes (ano, % do crédito e % da parcela), com botão para adicionar e remover.
function blocoReajustes(c) {
  const linhas = (Array.isArray(c.reajustes) ? c.reajustes : []).map((r) => ({ ano: r.ano, cred: r.incCredito, par: r.incParcela }));
  const lista = el("div", {});
  const itens = [];
  const desenhar = () => {
    lista.replaceChildren(itens.map((it) => el("div", { class: "row", style: "align-items:flex-end;margin-bottom:6px" },
      el("label", {}, "Ano", it.ano),
      el("label", {}, "Crédito (%)", it.cred),
      el("label", {}, "Parcela (%)", it.par),
      el("button", { class: "danger", type: "button", onclick: () => { itens.splice(itens.indexOf(it), 1); desenhar(); } }, "Remover"),
    )));
  };
  const criar = (r = {}) => {
    const it = {
      ano: el("input", { type: "number", min: "2000", step: "1", placeholder: "Ex.: 2027", value: r.ano ? String(r.ano) : "" }),
      cred: el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", value: r.cred ? campo(r.cred) : "" }),
      par: el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", value: r.par ? campo(r.par) : "" }),
    };
    itens.push(it);
    return it;
  };
  linhas.forEach((r) => criar(r));
  desenhar();
  const bloco = el("div", {},
    el("p", { class: "muted", style: "margin:14px 0 6px" }, "Reajustes de janeiro (INCC). Informe o percentual de cada ano; ele vale para o crédito e para a parcela."),
    lista,
    el("button", { class: "ghost", type: "button", onclick: () => { criar(); desenhar(); } }, "+ Adicionar reajuste de janeiro"),
  );
  const coletar = () => itens
    .map((it) => ({ ano: Math.floor(Number(it.ano.value) || 0), incCredito: num(it.cred.value), incParcela: num(it.par.value) }))
    .filter((r) => r.ano > 0)
    .sort((a, b) => a.ano - b.ano);
  return { el: bloco, coletar };
}

function modalCarta(ctx, c = {}) {
  const novo = !c.id;
  const pagamentosAtuais = Array.isArray(c.pagamentos) ? c.pagamentos : [];
  const iniciaisAtuais = pagamentosAtuais.filter(ehRegistroInicial);
  const f = {
    adm: el("input", { type: "text", value: c.administradora || "", placeholder: "Ex.: Porto Seguro Consórcios" }),
    grupo: el("input", { type: "text", value: c.grupo || "", placeholder: "Ex.: 1234" }),
    cota: el("input", { type: "text", value: c.cota || "", placeholder: "Ex.: 0456" }),
    data: el("input", { type: "date", value: c.dataAquisicao || "" }),
    credito: el("input", { type: "text", inputmode: "decimal", value: campo(c.valorCredito), placeholder: "0,00" }),
    divida: el("input", { type: "text", inputmode: "decimal", value: campo(c.valorDivida), placeholder: "0,00" }),
    contemplada: el("input", { type: "checkbox", checked: !!c.contemplada }),
    dataCont: el("input", { type: "date", value: c.dataContemplacao || "" }),
    parcelas: el("input", { type: "number", min: "0", step: "1", placeholder: "0", value: iniciaisAtuais.length ? String(iniciaisAtuais.length) : "" }),
    valorParcela: el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", value: c.valorParcela ? campo(c.valorParcela) : (iniciaisAtuais[0] ? campo(iniciaisAtuais[0].valor) : "") }),
  };
  const reajustes = blocoReajustes(c);
  const previa = el("p", { class: "muted", style: "margin:12px 0 0" });
  const atualizarPrevia = () => {
    const qtd = Math.floor(Number(f.parcelas.value) || 0);
    const v = num(f.valorParcela.value);
    const extra = novo ? "" : " As parcelas de registro inicial desta carta serão substituídas; pagamentos lançados à parte são mantidos.";
    if (!(qtd > 0)) return (previa.textContent = "Informe a quantidade e o valor de cada parcela já paga para registrar o histórico." + extra);
    previa.textContent = qtd + " parcela(s) de " + brl(v) + " = " + brl(qtd * v) + " já pagos. Os pagamentos serão lançados a partir de " + (f.data.value ? dataBR(f.data.value) : "da data de aquisição") + ", mês a mês." + extra;
  };
  f.parcelas.addEventListener("input", atualizarPrevia);
  f.valorParcela.addEventListener("input", atualizarPrevia);
  f.data.addEventListener("input", atualizarPrevia);
  atualizarPrevia();

  const modal = abrirModal({ titulo: novo ? "Nova carta de consórcio" : "Editar carta de consórcio", largura: 680 });
  const salvar = async () => {
    const administradora = f.adm.value.trim();
    if (!administradora) return alert("Informe a administradora.");
    const valorCredito = num(f.credito.value);
    const valorDivida = num(f.divida.value);
    if (!(valorCredito > 0)) return alert("Informe o valor do crédito.");
    if (valorDivida < 0) return alert("O valor da dívida não pode ser negativo.");
    const qtdPagas = Math.floor(Number(f.parcelas.value) || 0);
    const valorParcela = num(f.valorParcela.value);
    if (qtdPagas > 0) {
      if (!f.data.value) return alert("Informe a data de aquisição para registrar as parcelas já pagas.");
      if (!(valorParcela > 0)) return alert("Informe o valor da parcela.");
    }
    const dados = {
      administradora,
      grupo: f.grupo.value.trim(),
      cota: f.cota.value.trim(),
      dataAquisicao: f.data.value || "",
      valorCredito,
      valorDivida,
      contemplada: f.contemplada.checked,
      dataContemplacao: f.contemplada.checked ? (f.dataCont.value || "") : "",
      valorParcela,
      reajustes: reajustes.coletar(),
      atualizadoEm: new Date().toISOString(),
    };
    const geradas = qtdPagas > 0 ? parcelasIniciais(f.data.value, qtdPagas, valorParcela) : [];
    const ok = c.id
      ? await gravar(() => updateDoc(doc(db, "users", ctx.email, "consorcios", c.id), {
        ...dados,
        pagamentos: [...pagamentosAtuais.filter((p) => !ehRegistroInicial(p)), ...geradas],
        atualizadoPor: ctx.user.email,
      }), "Não foi possível salvar. Verifique a conexão e tente de novo.")
      : await gravar(() => addDoc(collection(db, "users", ctx.email, "consorcios"), {
        ...dados,
        pagamentos: geradas,
        criadoPor: ctx.user.email,
      }), "Não foi possível adicionar. Verifique a conexão e tente de novo.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };
  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Administradora", f.adm),
      el("label", {}, "Grupo", f.grupo),
      el("label", {}, "Cota", f.cota),
      el("label", {}, "Data de aquisição", f.data),
      el("label", {}, "Valor do crédito", f.credito),
      el("label", {}, "Valor da dívida (total a pagar)", f.divida),
      el("label", {}, "Contemplada", f.contemplada),
      el("label", {}, "Data da contemplação", f.dataCont),
      el("label", {}, "Parcelas já pagas", f.parcelas),
      el("label", {}, "Valor de cada parcela", f.valorParcela),
    ),
    previa,
    reajustes.el,
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, c.id ? "Salvar alterações" : "Adicionar"),
    ),
  );
}

function modalPagamento(ctx, c) {
  const data = el("input", { type: "date", value: hojeISO() });
  const valor = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00" });
  const obs = el("input", { type: "text", placeholder: "Opcional (ex.: parcela 12/120)" });
  const modal = abrirModal({ titulo: "Registrar pagamento", largura: 520 });
  const salvar = async () => {
    const v = num(valor.value);
    if (!data.value) return alert("Informe a data do pagamento.");
    if (!(v > 0)) return alert("Informe o valor pago.");
    const atuais = Array.isArray(c.pagamentos) ? c.pagamentos : [];
    const novos = [...atuais, { data: data.value, valor: v, obs: obs.value.trim() }];
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "consorcios", c.id), {
      pagamentos: novos,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível registrar o pagamento. Tente de novo.");
    if (!ok) return;
    toast("Pagamento registrado.");
    modal.fechar();
    recarregar();
  };
  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Data do pagamento", data),
      el("label", {}, "Valor pago", valor),
      el("label", {}, "Observação", obs),
    ),
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Registrar"),
    ),
  );
}

async function excluirCarta(ctx, c) {
  if (!confirm("Excluir a carta de " + (c.administradora || "consórcio") + " e todos os seus pagamentos?")) return;
  const ok = await gravar(() => deleteDoc(doc(db, "users", ctx.email, "consorcios", c.id)), "Não foi possível excluir. Tente novamente.");
  if (ok) recarregar();
}

async function excluirPagamento(ctx, c, indice) {
  if (!confirm("Excluir este pagamento?")) return;
  const novos = (c.pagamentos || []).filter((_, i) => i !== indice);
  const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "consorcios", c.id), {
    pagamentos: novos,
    atualizadoEm: new Date().toISOString(),
  }), "Não foi possível excluir o pagamento. Tente novamente.");
  if (ok) recarregar();
}

// ---------- Tela ----------
function kpi(rotulo, valor, sub, cor) {
  return el("div", { class: "inicio-kpi", style: "--cor:" + cor },
    el("span", {}, rotulo),
    el("strong", {}, valor),
    sub ? el("p", { class: "muted" }, sub) : null,
  );
}

function cartaCredito(ctx, c) {
  const t = totaisCarta(c);
  const ordenados = t.pagamentos.map((p, i) => ({ ...p, i })).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  const barra = t.divida ? Math.min(100, (t.pago / t.divida) * 100) : 0;
  return el("section", { class: "card", style: "margin:0;min-width:0" },
    el("div", { style: "display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start" },
      el("div", { style: "min-width:0" },
        el("h3", { style: "margin:0;overflow-wrap:anywhere" }, c.administradora || "Carta de consórcio"),
        el("p", { class: "muted", style: "margin:4px 0 0" }, "Grupo " + (c.grupo || "—") + " · Cota " + (c.cota || "—") + " · Adquirida em " + dataBR(c.dataAquisicao)),
        el("p", { style: "margin:6px 0 0;font-size:12px;font-weight:500;color:" + (c.contemplada ? "var(--verde)" : "var(--cinza-texto, #6E6A65)") },
          c.contemplada ? "Contemplada" + (c.dataContemplacao ? " em " + dataBR(c.dataContemplacao) : "") : "Não contemplada"),
        c.valorParcela
          ? el("p", { class: "muted", style: "margin:4px 0 0;font-size:13px" },
            "Parcela " + brl(c.valorParcela) + (t.aplicados.length ? " · corrigida pelo INCC: " + brl(t.parcelaCorrigida) : ""))
          : null,
        t.aplicados.length
          ? el("p", { class: "muted", style: "margin:4px 0 0;font-size:12px" },
            "Reajustes de janeiro: " + t.aplicados.map((r) => r.ano + " (crédito " + campo(r.incCredito) + "%, parcela " + campo(r.incParcela) + "%)").join(" · "))
          : null,
      ),
      ctx.modo === "admin"
        ? el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
          el("button", { class: "ghost", onclick: () => modalCarta(ctx, c) }, "Editar"),
          el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, () => excluirCarta(ctx, c)) }, "Excluir"),
        )
        : null,
    ),
    el("div", { class: "credito-kpis" },
      kpi("Valor do crédito", brl(c.valorCredito), t.aplicados.length ? "Corrigido pelo INCC: " + brl(t.creditoCorrigido) : "Sem reajuste aplicado ainda", "#2C4A3E"),
      kpi("Valor da dívida", brl(t.divida), "Total a pagar na carta", "#B0413E"),
      kpi("Falta pagar", brl(t.falta), t.quitado ? "Quitada" : "Restante da dívida", "#C9A96E"),
    ),
    el("div", { style: "margin:4px 0 14px" },
      el("div", { class: "muted", style: "display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;margin-bottom:4px" },
        el("span", {}, "Total já pago: " + brl(t.pago) + " (" + t.pagamentos.length + " pagamento(s))"),
        el("span", {}, pctTxt(t.divida ? t.pago / t.divida : 0)),
      ),
      el("div", { style: "height:10px;border-radius:999px;background:var(--areia);overflow:hidden" },
        el("div", { style: "height:100%;width:" + barra.toFixed(1) + "%;background:var(--verde);border-radius:999px" })),
    ),
    // Pagamentos recolhidos: a seta abre e fecha a lista.
    el("details", { class: "credito-pag" },
      el("summary", {}, "Pagamentos (" + t.pagamentos.length + ")"),
      ctx.modo === "admin"
        ? el("div", { style: "margin:4px 0 8px" }, el("button", { class: "ghost", onclick: () => modalPagamento(ctx, c) }, "+ Registrar pagamento"))
        : null,
      ordenados.length
        ? el("ul", { class: "inicio-lista" }, ordenados.map((p) =>
          el("li", {},
            el("div", { style: "min-width:0" },
              el("strong", {}, dataBR(p.data)),
              el("span", { class: "muted" }, p.obs ? " · " + p.obs : ""),
            ),
            el("div", { class: "direita" },
              el("strong", {}, brl(p.valor)),
              ctx.modo === "admin" ? el("button", { class: "ghost", style: "margin-top:4px;padding:2px 8px", onclick: (e) => acao(e.currentTarget, () => excluirPagamento(ctx, c, p.i)) }, "Excluir") : null,
            ),
          )))
        : el("p", { class: "muted" }, "Nenhum pagamento registrado ainda."),
    ),
  );
}

// Indicadores do dashboard de Crédito.
// Lucro no crédito = crédito das cartas contempladas menos a dívida total dessas cartas.
export function indicadoresCredito(cartas) {
  const lista = cartas || [];
  const contempladas = lista.filter((c) => c.contemplada);
  const todosPagamentos = lista.flatMap((c) => totaisCarta(c).pagamentos);
  const creditoContratado = soma(lista.map((c) => c.valorCredito));
  const creditoContemplado = soma(contempladas.map((c) => c.valorCredito));
  const dividaContempladas = soma(contempladas.map((c) => c.valorDivida));
  return {
    qtdCartas: lista.length,
    creditoContratado,
    qtdContempladas: contempladas.length,
    creditoContemplado,
    totalPago: soma(todosPagamentos.map((p) => p.valor)),
    qtdParcelas: todosPagamentos.length,
    lucro: creditoContemplado - dividaContempladas,
    pagamentos: todosPagamentos,
  };
}

// Abre ou fecha a tela cheia de um elemento (com fallback para navegadores antigos).
function alternarTelaCheia(id) {
  const alvo = document.getElementById(id);
  if (!alvo) return;
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    const sair = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (sair) sair.call(doc);
    return;
  }
  const pedir = alvo.requestFullscreen || alvo.webkitRequestFullscreen;
  if (!pedir) return toast("Este navegador não permite tela cheia.");
  try {
    const p = pedir.call(alvo);
    if (p && p.catch) p.catch(() => toast("Não foi possível abrir em tela cheia."));
  } catch (err) {
    toast("Não foi possível abrir em tela cheia.");
  }
}

// Página "Crédito" (sub-item de Meu Patrimônio).
export function telaCredito(ctx, cartas) {
  const lista = cartas || [];
  const ind = indicadoresCredito(lista);
  const botaoAdicionar = ctx.modo === "admin" ? el("button", { onclick: () => modalCarta(ctx) }, "+ Adicionar carta") : null;

  const cabecalhoCartas = el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px" },
    el("h2", { style: "margin:0" }, "Cartas de consórcio"),
    botaoAdicionar,
  );
  if (!lista.length) {
    return el("div", {},
      cabecalhoCartas,
      el("p", { class: "muted" }, ctx.modo === "admin"
        ? "Nenhuma carta cadastrada. Use + Adicionar carta para registrar as cartas de consórcio do cliente."
        : "Nenhuma carta de consórcio cadastrada."),
    );
  }

  // Quadro de totais: ocupa a largura toda e pode abrir em tela cheia.
  return el("div", {},
    el("section", { id: "credito-dash", class: "credito-dash" },
      el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px" },
        el("h2", { style: "margin:0" }, "Dashboard de crédito"),
        el("button", { class: "ghost", onclick: () => alternarTelaCheia("credito-dash") }, "Tela cheia"),
      ),
      el("div", { class: "credito-kpis4" },
        kpi("Total de crédito contratado", brl(ind.creditoContratado), ind.qtdCartas + " carta(s)", "#2C4A3E"),
        kpi("Crédito contemplado", brl(ind.creditoContemplado), ind.qtdContempladas + " carta(s) contemplada(s)", "#C9A96E"),
        kpi("Total de valores pagos", brl(ind.totalPago), ind.qtdParcelas + " pagamento(s)", "#B0413E"),
        kpi("Lucro no crédito", brl(ind.lucro), "Crédito contemplado menos a dívida dessas cartas", ind.lucro >= 0 ? "#2C4A3E" : "#B0413E"),
      ),
      el("section", { class: "card", style: "margin:0 0 20px" },
        el("h3", { style: "margin:0 0 10px" }, "Pagamentos por mês"),
        ind.pagamentos.length
          ? el("div", { class: "inicio-canvas" }, el("canvas", { id: "credito-pagamentos" }))
          : el("p", { class: "muted" }, "Os pagamentos registrados aparecem aqui, mês a mês."),
      ),
    ),
    cabecalhoCartas,
    el("div", { style: GRADE_CARTAS }, lista.map((c) => cartaCredito(ctx, c))),
  );
}

// Desenha o gráfico de pagamentos por mês. Chamar depois que a tela estiver no documento.
export function desenharCredito(cartas) {
  if (grafico) { grafico.destroy(); grafico = null; }
  const canvas = document.getElementById("credito-pagamentos");
  if (!canvas || typeof Chart === "undefined") return;
  const porMes = {};
  for (const p of indicadoresCredito(cartas).pagamentos) {
    const ym = String(p.data || "").slice(0, 7);
    if (ym) porMes[ym] = (porMes[ym] || 0) + num(p.valor);
  }
  const meses = Object.keys(porMes).sort();
  grafico = new Chart(canvas, {
    type: "bar",
    data: {
      labels: meses.map((ym) => MESES[Number(ym.slice(5, 7)) - 1] + "/" + ym.slice(2, 4)),
      datasets: [{ label: "Pago no mês", data: meses.map((ym) => porMes[ym]), backgroundColor: "#2C4A3E", borderRadius: 4 }],
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: (v) => brl(v) } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => brl(c.parsed.y) } } },
    },
  });
}
