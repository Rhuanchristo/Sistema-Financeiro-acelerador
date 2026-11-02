// Oportunidade (admin): onde a consultoria pode agir em cada cliente.
import { brl, num, soma, addMeses, mesNome, mesAtual, mesesEntre } from "../format.js";
import { resumoAno, projetar, ocorrenciasProjeto, nomeTipo, PARAMS_APOSENT } from "../calc.js";
import { el, kpi } from "../ui.js";
import { carregarConsolidado, abrirEditorUsuario } from "./admin.js";

// Instituições da própria casa (ex.: ["XP", "Banco Inter"]). Comparação sem diferenciar maiúsculas.
// O que estiver fora desta lista aparece destacado como recurso a trazer de outros bancos.
const INSTITUICOES_DA_CASA = [];
// Caixa acumulado no ano acima deste número de meses de despesas médias é considerado alto.
const MESES_CAIXA_ALTO = 6;
const HORIZONTE_MESES = 12;

const normalizar = (s) => (s || "").trim().toLowerCase();
const daCasa = (inst) => INSTITUICOES_DA_CASA.some((c) => normalizar(c) === normalizar(inst));

// A rota chama sem parâmetros e espera um nó; os dados chegam depois.
export function telaOportunidade() {
  const slot = el("div", {}, el("p", { class: "muted" }, "Carregando oportunidades..."));
  carregarConsolidado({ metas: true })
    .then((clientes) => slot.replaceChildren(...renderOportunidades(clientes)))
    .catch((err) => {
      console.error(err);
      slot.replaceChildren(el("section", { class: "card" },
        el("h2", {}, "Oportunidade"),
        el("p", { class: "msg" }, "Não foi possível carregar as oportunidades. Tente novamente."),
      ));
    });
  return slot;
}

// ---------- Helpers de tabela ----------
const celNum = (v) => el("td", { class: "num" }, brl(v));
const botaoPainel = (c) => el("td", {}, el("button", { class: "ghost", onclick: () => abrirEditorUsuario(c.u) }, "Abrir painel"));

function tabela(cabecalho, linhas, vazio) {
  if (linhas.length === 0) return el("p", { class: "muted" }, vazio);
  return el("div", { class: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {}, cabecalho.map(([rotulo, numerico]) => el("th", numerico ? { class: "num" } : {}, rotulo)), el("th", {}, ""))),
    el("tbody", {}, linhas),
  ));
}

function bloco(titulo, descricao, ...conteudo) {
  return el("section", { class: "card" }, el("h2", {}, titulo), el("p", { class: "muted" }, descricao), ...conteudo);
}

// ---------- Blocos ----------
function renderOportunidades(clientes) {
  const hoje = mesAtual();
  return [
    blocoInstituicoes(clientes),
    blocoAposentadoria(clientes, hoje),
    blocoProximos(clientes, hoje),
    blocoCaixa(clientes, hoje),
  ];
}

// (a) Investimentos por cliente e instituição, com o que está fora da casa primeiro.
function blocoInstituicoes(clientes) {
  const linhas = [];
  for (const c of clientes) {
    const porInst = {};
    for (const it of c.patrimonio) {
      if (it.categoria !== "investimentos") continue;
      const inst = (it.instituicao || "").trim() || "Não informada";
      porInst[inst] = (porInst[inst] || 0) + num(it.valor);
    }
    for (const [inst, valor] of Object.entries(porInst)) linhas.push({ c, inst, valor, casa: daCasa(inst) });
  }
  linhas.sort((a, b) => (a.casa - b.casa) || (b.valor - a.valor));

  const total = soma(linhas.map((l) => l.valor));
  const fora = soma(linhas.filter((l) => !l.casa).map((l) => l.valor));
  const descricao = INSTITUICOES_DA_CASA.length === 0
    ? "Nenhuma instituição da casa configurada (INSTITUICOES_DA_CASA em views/oportunidade.js); todos os investimentos aparecem como fora da casa."
    : "Instituições da casa: " + INSTITUICOES_DA_CASA.join(", ") + ". O que está em outros bancos aparece primeiro, do maior para o menor valor.";

  return bloco("Investimentos por instituição", descricao,
    el("div", { class: "kpis" },
      kpi("Total investido", total),
      kpi("Fora da casa", fora),
      kpi("Na casa", total - fora),
    ),
    tabela(
      [["Cliente"], ["Instituição"], ["Situação"], ["Valor", true]],
      linhas.map((l) => el("tr", {},
        el("td", {}, l.c.nome),
        el("td", {}, l.inst),
        el("td", {}, el("span", { class: l.casa ? "badge" : "badge off" }, l.casa ? "Na casa" : "Fora da casa")),
        celNum(l.valor),
        botaoPainel(l.c),
      )),
      "Nenhum investimento cadastrado ainda.",
    ),
  );
}

// (b) Aporte necessário para a aposentadoria x investimento mensal informado.
function blocoAposentadoria(clientes, hoje) {
  const linhas = [];
  for (const c of clientes) {
    if (!c.aposentadoria && c.projetos.length === 0) continue;
    const p = { ...PARAMS_APOSENT, ...(c.aposentadoria || {}) };
    const capital = soma(c.patrimonio.filter((it) => it.categoria === "investimentos").map((it) => num(it.valor)));
    const necessario = projetar(p, c.projetos, capital, hoje).aporteNecessario;
    const informado = num(p.investimentoMensal);
    linhas.push({ c, necessario, informado, diferenca: necessario - informado });
  }
  linhas.sort((a, b) => b.diferenca - a.diferenca);

  return bloco("Aporte para a aposentadoria",
    "Diferença entre o aporte mensal necessário (simulador de aposentadoria) e o investimento mensal informado pelo cliente. Maior diferença primeiro.",
    tabela(
      [["Cliente"], ["Aporte necessário", true], ["Investimento informado", true], ["Diferença", true], ["Situação"]],
      linhas.map((l) => el("tr", {},
        el("td", {}, l.c.nome),
        celNum(l.necessario),
        celNum(l.informado),
        celNum(l.diferenca),
        el("td", {}, l.diferenca > 0
          ? el("span", { class: "badge off" }, "Abaixo do necessário")
          : el("span", { class: "badge" }, "Em dia")),
        botaoPainel(l.c),
      )),
      "Nenhum planejamento de aposentadoria salvo ainda.",
    ),
  );
}

// (c) Projetos e metas com data nos próximos 12 meses.
function blocoProximos(clientes, hoje) {
  const linhas = [];
  for (const c of clientes) {
    for (const pr of c.projetos) {
      const ocorr = ocorrenciasProjeto(pr, hoje, HORIZONTE_MESES);
      if (ocorr.length === 0) continue;
      linhas.push({
        c,
        tipo: pr.tipo === "aporte" ? "Aporte" : "Projeto",
        nome: (pr.nome || nomeTipo(pr.tipo)) + (ocorr.length > 1 ? " (" + ocorr.length + "x)" : ""),
        mes: addMeses(hoje, ocorr[0][0]),
        valor: soma(ocorr.map(([, v]) => v)),
      });
    }
    for (const m of c.metas) {
      if (!m.mesAlvo) continue;
      const k = mesesEntre(hoje, m.mesAlvo);
      if (k < 0 || k >= HORIZONTE_MESES) continue;
      linhas.push({ c, tipo: "Meta", nome: m.nome || "Meta", mes: m.mesAlvo, valor: Math.max(0, num(m.valorAlvo) - num(m.valorAtual)) });
    }
  }
  linhas.sort((a, b) => a.mes.localeCompare(b.mes) || b.valor - a.valor);

  return bloco("Projetos e metas nos próximos 12 meses",
    "Ordenados pela data mais próxima. Para projetos, o valor soma as ocorrências no período; para metas, é o que falta para atingir o alvo.",
    tabela(
      [["Cliente"], ["Tipo"], ["Nome"], ["Quando"], ["Valor", true]],
      linhas.map((l) => el("tr", {},
        el("td", {}, l.c.nome),
        el("td", {}, l.tipo),
        el("td", {}, l.nome),
        el("td", {}, mesNome(l.mes)),
        celNum(l.valor),
        botaoPainel(l.c),
      )),
      "Nenhum projeto ou meta nos próximos 12 meses.",
    ),
  );
}

// (d) Caixa acumulado no ano (receitas - despesas até o mês atual) alto em relação às despesas médias.
function blocoCaixa(clientes, hoje) {
  const ano = Number(hoje.slice(0, 4));
  const decorridos = Number(hoje.slice(5, 7));
  const linhas = [];
  for (const c of clientes) {
    const meses = resumoAno(c.lancamentos, ano, c.parametros).meses.slice(0, decorridos);
    const caixa = soma(meses.map((m) => m.lucro));
    const mediaDespesas = soma(meses.map((m) => m.despesasTotal)) / decorridos;
    if (caixa <= 0) continue;
    const cobertura = mediaDespesas > 0 ? caixa / mediaDespesas : Infinity;
    if (cobertura > MESES_CAIXA_ALTO) linhas.push({ c, caixa, mediaDespesas, cobertura });
  }
  linhas.sort((a, b) => b.cobertura - a.cobertura || b.caixa - a.caixa);

  return bloco("Caixa alto no ano",
    "Clientes cujo caixa acumulado em " + ano + " (receitas menos despesas até " + mesNome(hoje) + ") passa de " +
      MESES_CAIXA_ALTO + " meses de despesas médias. Maior cobertura primeiro.",
    tabela(
      [["Cliente"], ["Caixa acumulado", true], ["Despesa mensal média", true], ["Cobertura", true]],
      linhas.map((l) => el("tr", {},
        el("td", {}, l.c.nome),
        celNum(l.caixa),
        celNum(l.mediaDespesas),
        el("td", { class: "num" }, Number.isFinite(l.cobertura)
          ? l.cobertura.toFixed(1).replace(".", ",") + " meses"
          : "Sem despesas"),
        botaoPainel(l.c),
      )),
      "Nenhum cliente com caixa acima de " + MESES_CAIXA_ALTO + " meses de despesas.",
    ),
  );
}
