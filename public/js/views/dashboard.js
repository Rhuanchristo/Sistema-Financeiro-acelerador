// Dashboard do cliente: um mês por vez + gráfico mensal do ano.
import { brl, pct, MESES, mesNome, mesAtual } from "../format.js";
import { resumoAno, calcPatrimonio } from "../calc.js";
import { el, kpi, campoMes } from "../ui.js";
import { recarregar } from "../router.js";

// ----- Gráfico mensal consolidado: receitas, despesas e caixa -----
let graficoAtual = null;

function cardGrafico(ctx) {
  const ano = ctx.anoGrafico || ctx.ano;
  const sel = el("select", {},
    [ctx.ano - 1, ctx.ano, ctx.ano + 1].map((a) => el("option", { value: a, selected: a === ano }, String(a))),
  );
  sel.addEventListener("change", () => {
    ctx.anoGrafico = Number(sel.value);
    recarregar();
  });
  return el("section", { class: "card" },
    el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" },
      el("h2", { style: "margin:0" }, "Receitas, despesas e caixa em " + ano),
      el("label", {}, "Ano", sel),
    ),
    el("div", { style: "position:relative;height:340px" }, el("canvas", { id: "grafico-caixa" })),
    el("p", { class: "muted" },
      "Caixa do mês = receita bruta menos impostos e comissão (só da empresa) menos despesas. " +
        "A linha mostra o caixa acumulado no ano (soma do caixa de cada mês).",
    ),
  );
}

// Chamar depois que a tela do dashboard estiver no documento.
export function desenharGrafico(ctx, dados) {
  const canvas = document.getElementById("grafico-caixa");
  if (!canvas || typeof Chart === "undefined") return;
  const ano = ctx.anoGrafico || ctx.ano;
  const r = resumoAno(dados.lancamentos, ano, dados.params);

  if (graficoAtual) graficoAtual.destroy();
  graficoAtual = new Chart(canvas, {
    data: {
      labels: MESES,
      datasets: [
        { type: "bar", label: "Receitas (bruta)", data: r.meses.map((m) => m.bruta), backgroundColor: "#132721", order: 2 },
        { type: "bar", label: "Despesas", data: r.meses.map((m) => m.despesasTotal), backgroundColor: "#B0413E", order: 2 },
        { type: "bar", label: "Caixa do mês", data: r.meses.map((m) => m.lucro), backgroundColor: "#8FA89B", order: 2 },
        {
          type: "line", label: "Caixa acumulado", data: r.meses.map((m) => m.caixaAcumulado),
          borderColor: "#C9A96E", backgroundColor: "#C9A96E", tension: 0.25, pointRadius: 3, order: 1,
          // Eixo próprio: o acumulado cresce muito mais que os valores do mês e achataria as barras.
          yAxisID: "acumulado",
        },
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
        acumulado: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { color: "#C9A96E", callback: (v) => brl(v) },
          title: { display: true, text: "Acumulado", color: "#C9A96E" },
        },
      },
    },
  });
}

export function telaDashboard(ctx, dados) {
  const mesSel = ctx.mes || mesAtual();
  const ano = Number(mesSel.slice(0, 4));
  const idx = Number(mesSel.slice(5, 7)) - 1;
  const r = resumoAno(dados.lancamentos, ano, dados.params);
  const m = r.meses[idx];
  const pat = calcPatrimonio(dados.patrimonio);

  const seletor = campoMes(mesSel);
  seletor.addEventListener("change", () => {
    if (!seletor.value) return;
    ctx.mes = seletor.value;
    recarregar();
  });

  const detalhe = el("table", {},
    el("tbody", {},
      el("tr", {}, el("td", {}, "Receita bruta"), el("td", { class: "num" }, brl(m.bruta))),
      el("tr", {}, el("td", {}, "(-) Impostos (empresa)"), el("td", { class: "num" }, brl(m.impostos))),
      el("tr", {}, el("td", {}, "(-) Comissão (empresa)"), el("td", { class: "num" }, brl(m.comissao))),
      el("tr", { class: "total" }, el("td", {}, "Receita líquida"), el("td", { class: "num" }, brl(m.liquida))),
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
      kpi("Receita líquida", m.liquida),
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
