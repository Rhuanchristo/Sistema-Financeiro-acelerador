// Home: página de abertura do cliente. Mostra o retrato completo do patrimônio (valores, composição,
// evolução, fluxo do mês e do ano, seguros, dívidas e últimos lançamentos) em uma única tela.
import { brl, num, MESES, mesAtual } from "../format.js";
import { CATEGORIAS_PATRIMONIO, resumoAno } from "../calc.js";
import { el } from "../ui.js";
import { ir, hashCliente } from "../router.js";
import { serieMensal, ehDivida } from "./meu-patrimonio.js";

const ROTULO_CAT = Object.fromEntries(CATEGORIAS_PATRIMONIO.map(([k, l]) => [k, l]));
const CORES = ["#132721", "#2C4A3E", "#8FA89B", "#C9A96E", "#B0413E", "#6E6A65", "#DDD6CA"];
const DIA_MS = 86400000;

let graficos = [];
const destruir = () => {
  graficos.forEach((g) => g.destroy());
  graficos = [];
};

// ---------- Helpers de valor e data ----------
const pctTxt = (v) => (Number(v) * 100).toFixed(1).replace(".", ",") + "%";
const dataBR = (v) => {
  const [a, m, d] = String(v || "").split("-");
  return a && m && d ? d + "/" + m + "/" + a : "—";
};
function diasAte(v) {
  const [a, m, d] = String(v || "").split("-").map(Number);
  if (!a || !m || !d) return null;
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((new Date(a, m - 1, d) - inicio) / DIA_MS);
}
const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);

// ---------- Blocos da tela ----------
function cabecalho(ctx, ativos, passivos, liquido, serie) {
  const n = serie.liquido.length;
  const variacao = n >= 2 ? serie.liquido[n - 1] - serie.liquido[n - 2] : null;
  const invest = soma(serie.itens.filter((i) => i.categoria === "investimentos" || i.categoria === "empresas"), (i) => num(i.valor));
  const minis = [
    ["Ativos", brl(ativos)],
    ["Dívidas", brl(passivos)],
    ["Investimentos", brl(invest)],
  ];
  return el("section", { class: "inicio-hero" },
    el("div", {},
      el("p", { class: "inicio-sub" }, "Olá, " + ctx.nome),
      el("p", { class: "inicio-rotulo" }, "Patrimônio líquido"),
      el("p", { class: "inicio-valor" }, brl(liquido)),
      variacao === null
        ? el("p", { class: "inicio-sub" }, "A variação aparece depois do primeiro mês com histórico.")
        : el("p", { class: "inicio-var " + (variacao >= 0 ? "pos" : "neg") },
          (variacao >= 0 ? "↑ " : "↓ ") + brl(Math.abs(variacao)) + " em relação ao mês anterior"),
    ),
    el("div", { class: "inicio-hero-lado" }, minis.map(([r, v]) =>
      el("div", { class: "inicio-mini" }, el("span", {}, r), el("strong", {}, v)))),
  );
}

function kpis(itens) {
  const hoje = mesAtual();
  const r = resumoAno(itens.lancamentos, Number(hoje.slice(0, 4)), itens.params);
  const m = r.meses[Number(hoje.slice(5, 7)) - 1];
  const ativos = soma(itens.patrimonio.filter((i) => !ehDivida(i)), (i) => num(i.valor));
  const passivos = soma(itens.patrimonio.filter(ehDivida), (i) => num(i.valor));
  const seguros = itens.protecao || [];
  const cobertura = soma(seguros, (s) => num(s.cobertura));
  const premio = soma(seguros, (s) => num(s.premioMensal));
  const tiles = [
    ["Receitas do mês", brl(m.bruta), "Entradas lançadas em " + MESES[Number(hoje.slice(5, 7)) - 1], "#2C4A3E"],
    ["Despesas do mês", brl(m.despesasTotal), "Saídas lançadas no mês", "#B0413E"],
    ["Sobra do mês", brl(m.lucro), m.bruta ? "Poupança de " + pctTxt(m.lucro / m.bruta) + " da receita" : "Sem receitas no mês", "#C9A96E"],
    ["Endividamento", ativos ? pctTxt(passivos / ativos) : "—", "Dívidas em relação aos ativos", "#6E6A65"],
    ["Cobertura de seguros", brl(cobertura), seguros.length ? "Prêmio de " + brl(premio) + " por mês" : "Nenhuma apólice cadastrada", "#8FA89B"],
  ];
  return el("div", { class: "inicio-kpis" }, tiles.map(([rotulo, valor, sub, cor]) =>
    el("div", { class: "inicio-kpi", style: "--cor:" + cor },
      el("span", {}, rotulo),
      el("strong", {}, valor),
      el("p", { class: "muted" }, sub),
    )));
}

function cartao(titulo, conteudo, extra = {}) {
  return el("section", { class: "card", ...extra }, el("h2", { style: "margin:0 0 12px" }, titulo), conteudo);
}

function cartaoComposicao(itens) {
  const ativos = itens.patrimonio.filter((i) => !ehDivida(i));
  const porCat = {};
  for (const it of ativos) {
    const rot = ROTULO_CAT[it.categoria] || "Outros";
    porCat[rot] = (porCat[rot] || 0) + num(it.valor);
  }
  const linhas = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const total = linhas.reduce((s, [, v]) => s + v, 0);
  if (!linhas.length) return cartao("Composição do patrimônio", el("p", { class: "muted" }, "Cadastre seus bens em Meu Patrimônio para ver a composição."));
  return cartao("Composição do patrimônio",
    el("div", { class: "inicio-duas" },
      el("div", { class: "inicio-canvas-rosca" }, el("canvas", { id: "inicio-composicao" })),
      el("ul", { class: "inicio-legenda" }, linhas.map(([rot, v], i) =>
        el("li", {},
          el("span", { class: "bolinha", style: "background:" + CORES[i % CORES.length] }),
          el("span", { class: "nome" }, rot),
          el("strong", {}, brl(v)),
          el("span", { class: "muted" }, total ? pctTxt(v / total) : ""),
        ))),
    ),
  );
}

function cartaoEvolucao(serie) {
  if (serie.meses.length < 2) return cartao("Evolução do patrimônio", el("p", { class: "muted" }, "O gráfico aparece quando houver histórico de pelo menos dois meses em Meu Patrimônio."));
  return cartao("Evolução do patrimônio",
    el("div", { class: "inicio-canvas" }, el("canvas", { id: "inicio-evolucao" })));
}

function cartaoFluxo() {
  const ano = Number(mesAtual().slice(0, 4));
  return cartao("Fluxo do ano " + ano,
    el("div", { class: "inicio-canvas" }, el("canvas", { id: "inicio-fluxo" })));
}

function cartaoSeguros(protecao) {
  const apolices = protecao || [];
  if (!apolices.length) return cartao("Seguros", el("p", { class: "muted" }, "Nenhuma apólice cadastrada em Proteção."));
  const ordenadas = [...apolices].sort((a, b) => (a.vencimento || "9999").localeCompare(b.vencimento || "9999"));
  return cartao("Seguros",
    el("ul", { class: "inicio-lista" }, ordenadas.map((s) => {
      const dias = diasAte(s.vencimento);
      const alerta = dias !== null && dias <= 60;
      return el("li", {},
        el("div", {},
          el("strong", {}, s.descricao || "—"),
          el("span", { class: "muted" }, s.seguradora ? " · " + s.seguradora : ""),
        ),
        el("div", { class: "direita" },
          el("strong", {}, brl(s.cobertura)),
          el("span", { class: alerta ? "alerta" : "muted" }, "Vence " + dataBR(s.vencimento) + (alerta ? (dias < 0 ? " (vencida)" : " (em " + dias + " dias)") : "")),
        ),
      );
    })),
  );
}

function cartaoDividas(patrimonio) {
  const dividas = patrimonio.filter(ehDivida);
  if (!dividas.length) return cartao("Dívidas", el("p", { class: "muted" }, "Nenhuma dívida cadastrada. Ótimo sinal."));
  const total = soma(dividas, (d) => num(d.valor));
  return cartao("Dívidas",
    el("p", { class: "muted", style: "margin:-6px 0 8px" }, "Total em dívidas: " + brl(total)),
    el("ul", { class: "inicio-lista" }, dividas.map((d) =>
      el("li", {},
        el("div", {}, el("strong", {}, d.descricao || ROTULO_CAT[d.categoria] || "Dívida")),
        el("div", { class: "direita" }, el("strong", {}, brl(d.valor))),
      ))),
  );
}

function cartaoRecentes(lancamentos) {
  const recentes = [...lancamentos]
    .sort((a, b) => String(b.data || b.mesInicial || "").localeCompare(String(a.data || a.mesInicial || "")))
    .slice(0, 6);
  if (!recentes.length) return cartao("Últimos lançamentos", el("p", { class: "muted" }, "Nenhum lançamento ainda."));
  return cartao("Últimos lançamentos",
    el("ul", { class: "inicio-lista" }, recentes.map((l) =>
      el("li", {},
        el("div", {},
          el("strong", {}, l.descricao || l.categoria || "Lançamento"),
          el("span", { class: "muted" }, " · " + dataBR(l.data)),
        ),
        el("div", { class: "direita" },
          el("strong", { class: l.tipo === "receita" ? "pos" : "neg" },
            (l.tipo === "receita" ? "+ " : "− ") + brl(l.valorTotal)),
        ),
      ))),
  );
}

function atalhos(ctx) {
  const itens = [
    ["lancamento", "Lançamentos"],
    ["patrimonio", "Meu Patrimônio"],
    ["protecao", "Proteção"],
    ["relatorio", "Relatório mensal"],
    ["home", "Home Conect"],
  ];
  return cartao("Atalhos",
    el("div", { class: "inicio-atalhos" }, itens.map(([k, l]) =>
      el("button", { class: "ghost", onclick: () => ir(hashCliente(ctx, k)) }, l))));
}

// ---------- Tela ----------
export function telaInicio(ctx, dados) {
  destruir();
  const patrimonio = dados.patrimonio || [];
  const ativos = soma(patrimonio.filter((i) => !ehDivida(i)), (i) => num(i.valor));
  const passivos = soma(patrimonio.filter(ehDivida), (i) => num(i.valor));
  const serie = serieMensal(patrimonio);
  serie.itens = patrimonio;
  const vazio = !patrimonio.length && !dados.lancamentos.length;

  return el("div", { class: "inicio" },
    vazio
      ? el("p", { class: "muted", style: "margin:0 0 16px" }, "Ainda não há dados. Comece em Lançamentos ou Meu Patrimônio e esta página se completa sozinha.")
      : null,
    cabecalho(ctx, ativos, passivos, ativos - passivos, serie),
    kpis(dados),
    el("div", { class: "inicio-grid" },
      cartaoEvolucao(serie),
      cartaoFluxo(),
      cartaoComposicao(dados),
      cartaoSeguros(dados.protecao),
      cartaoDividas(patrimonio),
      cartaoRecentes(dados.lancamentos),
      atalhos(ctx),
    ),
  );
}

// Chamar depois que a tela estiver no documento.
export function desenharInicio(ctx, dados) {
  if (typeof Chart === "undefined") return;
  const patrimonio = dados.patrimonio || [];
  const serie = serieMensal(patrimonio);

  const cvEvo = document.getElementById("inicio-evolucao");
  if (cvEvo && serie.meses.length >= 2) {
    graficos.push(new Chart(cvEvo, {
      type: "line",
      data: {
        labels: serie.meses.map((ym) => MESES[Number(ym.slice(5, 7)) - 1] + "/" + ym.slice(2, 4)),
        datasets: [
          { label: "Ativos", data: serie.ativos, borderColor: "#2C4A3E", backgroundColor: "#2C4A3E", tension: 0.3 },
          { label: "Dívidas", data: serie.passivos, borderColor: "#B0413E", backgroundColor: "#B0413E", tension: 0.3 },
          { label: "Patrimônio líquido", data: serie.liquido, borderColor: "#C9A96E", backgroundColor: "#C9A96E", borderWidth: 3, tension: 0.3, fill: false },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: { y: { ticks: { callback: (v) => brl(v) } } },
        plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + brl(c.parsed.y) } } },
      },
    }));
  }

  const cvFluxo = document.getElementById("inicio-fluxo");
  if (cvFluxo) {
    const r = resumoAno(dados.lancamentos, Number(mesAtual().slice(0, 4)), dados.params);
    graficos.push(new Chart(cvFluxo, {
      type: "bar",
      data: {
        labels: MESES,
        datasets: [
          { label: "Receitas", data: r.meses.map((m) => m.bruta), backgroundColor: "#2C4A3E", borderRadius: 4 },
          { label: "Despesas", data: r.meses.map((m) => m.despesasTotal), backgroundColor: "#B0413E", borderRadius: 4 },
          { label: "Sobra", data: r.meses.map((m) => m.lucro), backgroundColor: "#C9A96E", borderRadius: 4 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: { y: { ticks: { callback: (v) => brl(v) } } },
        plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ": " + brl(c.parsed.y) } } },
      },
    }));
  }

  const cvComp = document.getElementById("inicio-composicao");
  if (cvComp) {
    const porCat = {};
    for (const it of patrimonio.filter((i) => !ehDivida(i))) {
      const rot = ROTULO_CAT[it.categoria] || "Outros";
      porCat[rot] = (porCat[rot] || 0) + num(it.valor);
    }
    const linhas = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    graficos.push(new Chart(cvComp, {
      type: "doughnut",
      data: { labels: linhas.map((l) => l[0]), datasets: [{ data: linhas.map((l) => l[1]), backgroundColor: linhas.map((_, i) => CORES[i % CORES.length]), borderWidth: 0 }] },
      options: { cutout: "62%", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.label + ": " + brl(c.parsed) } } } },
    }));
  }
}
