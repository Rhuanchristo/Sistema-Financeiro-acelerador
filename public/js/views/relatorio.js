// Relatório mensal do cliente, pronto para imprimir ou salvar em PDF pelo navegador (window.print).
// Recebe ctx e dados = { lancamentos, params, patrimonio } já carregados pelo roteador.
// Metas, projetos e parâmetros da aposentadoria são carregados aqui. Estilos de impressão: css/print.css.
import { db, doc, getDoc } from "../firebase.js";
import { brl, pct, num, soma, mesNome, mesAtual, mesesEntre } from "../format.js";
import { resumoAno, calcPatrimonio, projetar, entidadeDe, CATEGORIAS_PATRIMONIO, PARAMS_APOSENT } from "../calc.js";
import { listar } from "../data.js";
import { el, kpi, campoMes } from "../ui.js";
import { recarregar } from "../router.js";

const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesExtenso = (ym) => MESES_LONGOS[Number(ym.slice(5, 7)) - 1] + " de " + ym.slice(0, 4);
const MAX_CATEGORIAS = 10;

// Mês de uma entidade. Usa "liquida" se o resumoAno já a calcular; senão cai para a bruta.
function mesDaEntidade(lancamentos, entidade, ano, idx, params) {
  const r = resumoAno(lancamentos.filter((l) => entidadeDe(l) === entidade), ano, params);
  const m = r.meses[idx] || {};
  const bruta = num(m.bruta);
  const despesas = num(m.despesasTotal);
  const temLiquida = typeof m.liquida === "number";
  const liquida = temLiquida ? m.liquida : bruta;
  const lucro = typeof m.lucro === "number" ? m.lucro : liquida - despesas;
  const margem = typeof m.margem === "number" ? m.margem : (bruta ? lucro / bruta : 0);
  return { bruta, liquida, temLiquida, despesas, lucro, margem, mapaDespesas: m.despesas || {} };
}

function secao(titulo, ...conteudo) {
  return el("section", { class: "card rel-secao" }, el("h2", {}, titulo), ...conteudo);
}

function linha(rotulo, valor, classe) {
  return el("tr", { class: classe }, el("td", {}, rotulo), el("td", { class: "num" }, valor));
}

function blocoResumo(titulo, r) {
  return el("div", { class: "rel-bloco" },
    el("h3", {}, titulo),
    el("table", {},
      el("tbody", {},
        linha("Receita bruta", brl(r.bruta)),
        r.temLiquida ? linha("Receita líquida", brl(r.liquida)) : null,
        linha("Despesas", brl(r.despesas)),
        linha("Lucro / prejuízo", brl(r.lucro), "total"),
        linha("Margem", pct(r.margem)),
      ),
    ),
  );
}

function tabelaDespesas(emp, pf) {
  const cats = [...new Set([...Object.keys(emp.mapaDespesas), ...Object.keys(pf.mapaDespesas)])]
    .map((c) => {
      const e = num(emp.mapaDespesas[c]);
      const p = num(pf.mapaDespesas[c]);
      return { c, e, p, t: e + p };
    })
    .filter((x) => x.t > 0)
    .sort((a, b) => b.t - a.t);
  if (cats.length === 0) return el("p", { class: "muted" }, "Sem despesas neste mês.");
  const top = cats.slice(0, MAX_CATEGORIAS);
  const resto = cats.slice(MAX_CATEGORIAS);
  const totalGeral = soma(cats.map((x) => x.t));
  const linhaCat = (nome, e, p, t, classe) => el("tr", { class: classe },
    el("td", {}, nome),
    el("td", { class: "num" }, brl(e)),
    el("td", { class: "num" }, brl(p)),
    el("td", { class: "num" }, brl(t)),
    el("td", { class: "num" }, pct(totalGeral ? t / totalGeral : 0)),
  );
  return el("div", { class: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Categoria"),
      el("th", { class: "num" }, "Empresa"),
      el("th", { class: "num" }, "Pessoa física"),
      el("th", { class: "num" }, "Total"),
      el("th", { class: "num" }, "% do total"),
    )),
    el("tbody", {},
      top.map((x) => linhaCat(x.c, x.e, x.p, x.t)),
      resto.length
        ? linhaCat("Outras (" + resto.length + ")", soma(resto.map((x) => x.e)), soma(resto.map((x) => x.p)), soma(resto.map((x) => x.t)))
        : null,
      linhaCat("Total", soma(cats.map((x) => x.e)), soma(cats.map((x) => x.p)), totalGeral, "total"),
    ),
  ));
}

function tabelaPatrimonio(itens) {
  const pat = calcPatrimonio(itens);
  const linhas = CATEGORIAS_PATRIMONIO.map(([k, nome, natureza]) => {
    const doTipo = itens.filter((it) => it.categoria === k);
    return { nome, natureza, qtd: doTipo.length, total: soma(doTipo.map((it) => num(it.valor))) };
  }).filter((x) => x.qtd > 0);
  const ativos = linhas.filter((x) => x.natureza === "ativo");
  const dividas = linhas.filter((x) => x.natureza === "divida");
  const linhaTipo = (x, sinal) => el("tr", {},
    el("td", {}, x.nome),
    el("td", { class: "num" }, String(x.qtd)),
    el("td", { class: "num" }, sinal + brl(x.total)),
  );
  return el("div", {},
    el("div", { class: "kpis" },
      kpi("Ativos", pat.ativos),
      kpi("Dívidas", pat.dividas),
      kpi("Patrimônio líquido", pat.liquido),
    ),
    linhas.length === 0
      ? el("p", { class: "muted" }, "Nenhum item de patrimônio cadastrado.")
      : el("div", { class: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {}, el("th", {}, "Tipo"), el("th", { class: "num" }, "Itens"), el("th", { class: "num" }, "Valor"))),
        el("tbody", {},
          ativos.map((x) => linhaTipo(x, "")),
          el("tr", { class: "total" }, el("td", {}, "Total de ativos"), el("td", {}), el("td", { class: "num" }, brl(pat.ativos))),
          dividas.map((x) => linhaTipo(x, "− ")),
          el("tr", { class: "total" }, el("td", {}, "Patrimônio líquido"), el("td", {}), el("td", { class: "num" }, brl(pat.liquido))),
        ),
      )),
  );
}

function tabelaMetas(metas, mesRef) {
  if (metas.length === 0) return el("p", { class: "muted" }, "Nenhuma meta criada.");
  const lista = metas.slice().sort((a, b) => (a.mesAlvo || "").localeCompare(b.mesAlvo || ""));
  return el("div", { class: "scroll" }, el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Meta"),
      el("th", {}, "Prazo"),
      el("th", { class: "num" }, "Alvo"),
      el("th", { class: "num" }, "Acumulado"),
      el("th", {}, "Progresso"),
      el("th", { class: "num" }, "Poupar por mês"),
    )),
    el("tbody", {}, lista.map((m) => {
      const alvo = num(m.valorAlvo);
      const atual = num(m.valorAtual);
      const progresso = alvo ? Math.min(1, atual / alvo) : 0;
      const restantes = m.mesAlvo ? Math.max(1, mesesEntre(mesRef, m.mesAlvo)) : 1;
      const poupar = Math.max(0, alvo - atual) / restantes;
      return el("tr", {},
        el("td", {}, m.nome || "—"),
        el("td", {}, m.mesAlvo ? mesNome(m.mesAlvo) : "—"),
        el("td", { class: "num" }, brl(alvo)),
        el("td", { class: "num" }, brl(atual)),
        el("td", {},
          el("div", { class: "rel-barra", style: "display:inline-block;vertical-align:middle;width:90px;height:8px;background:#ECE7DE;border-radius:99px;overflow:hidden;margin-right:6px" },
            el("div", { style: "height:100%;background:#2C4A3E;width:" + (progresso * 100).toFixed(1) + "%" }),
          ),
          el("span", { class: "muted" }, pct(progresso)),
        ),
        el("td", { class: "num" }, progresso >= 1 ? "Concluída" : brl(poupar)),
      );
    })),
  ));
}

function blocoAposentadoria(p, projetos, capitalInicial) {
  const res = projetar(p, projetos, capitalInicial, mesAtual());
  const aporteAtual = num(p.investimentoMensal);
  const situacao = res.nRet === 0
    ? "A idade de aposentadoria informada já foi atingida."
    : aporteAtual >= res.aporteNecessario
      ? "O aporte mensal atual cobre o necessário para a meta."
      : "Faltam " + brl(res.aporteNecessario - aporteAtual) + " por mês em relação ao aporte atual.";
  return el("div", {},
    el("div", { class: "kpis" },
      kpi("Capital ideal na aposentadoria", res.idealRet),
      kpi("Aporte mensal necessário", res.aporteNecessario),
      kpi("Aporte mensal atual", aporteAtual),
      kpi("Capital investido hoje", capitalInicial),
    ),
    el("table", {},
      el("tbody", {},
        linha("Idade atual", num(p.idadeAtual) + " anos"),
        linha("Idade de aposentadoria", num(p.idadeAposentadoria) + " anos"),
        linha("Renda desejada (valores de hoje)", brl(p.rendaDesejada)),
        linha("Outras rendas", brl(p.outrasRendas)),
        linha("Rentabilidade real ao ano", pct(p.rentabilidadeReal)),
        linha("Projetos e aportes considerados", String(projetos.length)),
      ),
    ),
    el("p", { class: "muted" }, situacao, " Valores em termos reais (descontada a inflação). Capital investido hoje = soma dos investimentos do patrimônio."),
  );
}

export function telaRelatorio(ctx, dados) {
  const mesSel = ctx.mes || mesAtual();
  const ano = Number(mesSel.slice(0, 4));
  const idx = Number(mesSel.slice(5, 7)) - 1;
  const emp = mesDaEntidade(dados.lancamentos, "empresa", ano, idx, dados.params);
  const pf = mesDaEntidade(dados.lancamentos, "pessoa", ano, idx, dados.params);

  const seletor = campoMes(mesSel);
  seletor.addEventListener("change", () => {
    if (!seletor.value) return;
    ctx.mes = seletor.value;
    recarregar();
  });

  const geradoEm = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
  const slotMetas = el("p", { class: "muted" }, "Carregando metas...");
  const slotAposent = el("p", { class: "muted" }, "Carregando aposentadoria...");

  // Metas, projetos e parâmetros não vêm do roteador; carregam depois que a tela aparece.
  Promise.all([
    listar(["users", ctx.email, "metas"]),
    listar(["users", ctx.email, "projetos"]),
    getDoc(doc(db, "users", ctx.email, "config", "aposentadoria")),
  ]).then(([metas, projetos, cfgSnap]) => {
    slotMetas.replaceWith(tabelaMetas(metas, mesAtual()));
    const p = { ...PARAMS_APOSENT, ...(cfgSnap.exists() ? cfgSnap.data() : {}) };
    const capitalInicial = soma(dados.patrimonio.filter((it) => it.categoria === "investimentos").map((it) => num(it.valor)));
    slotAposent.replaceWith(blocoAposentadoria(p, projetos, capitalInicial));
  }).catch((err) => {
    console.error(err);
    slotMetas.textContent = "Não foi possível carregar as metas.";
    slotAposent.textContent = "Não foi possível carregar a aposentadoria.";
  });

  const total = {
    bruta: emp.bruta + pf.bruta,
    despesas: emp.despesas + pf.despesas,
    lucro: emp.lucro + pf.lucro,
  };
  total.margem = total.bruta ? total.lucro / total.bruta : 0;

  return el("div", { class: "relatorio" },
    el("div", { class: "row no-print" },
      el("label", {}, "Mês do relatório", seletor),
      el("button", { onclick: () => window.print() }, "Imprimir / salvar PDF"),
      el("span", { class: "muted" }, "Na janela de impressão, escolha \"Salvar como PDF\" para gerar o arquivo."),
    ),
    el("section", { class: "card rel-capa" },
      el("p", { class: "muted", style: "margin:0" }, "Relatório financeiro mensal"),
      el("h1", { style: "margin:4px 0 2px;font-size:22px" }, ctx.nome || ctx.email),
      el("p", { style: "margin:0;font-size:16px" }, "Referência: " + mesExtenso(mesSel)),
      el("p", { class: "muted", style: "margin:6px 0 0" }, "Gerado em " + geradoEm),
    ),
    secao("Resumo do mês",
      el("div", { class: "kpis" },
        kpi("Receita bruta", total.bruta),
        kpi("Despesas", total.despesas),
        kpi("Lucro / prejuízo", total.lucro),
        kpi("Margem", total.margem, pct),
      ),
      el("div", { class: "rel-colunas", style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px" },
        blocoResumo("Empresa", emp),
        blocoResumo("Pessoa física", pf),
      ),
    ),
    secao("Maiores despesas por categoria", tabelaDespesas(emp, pf)),
    secao("Patrimônio", tabelaPatrimonio(dados.patrimonio)),
    secao("Progresso das metas", slotMetas),
    secao("Aposentadoria", slotAposent),
    el("p", { class: "muted rel-rodape" }, "Relatório de " + (ctx.nome || ctx.email) + " · " + mesExtenso(mesSel) + " · gerado em " + geradoEm),
  );
}
