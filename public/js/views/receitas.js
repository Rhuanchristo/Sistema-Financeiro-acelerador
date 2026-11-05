// Receitas e despesas: mesma estrutura da planilha, calculada a partir dos lançamentos.
import { brl, pct, fmtPct, num, soma, MESES } from "../format.js";
import { resumoAno, entidadeDe, PARAMETROS_PF } from "../calc.js";
import { el, acao, toast } from "../ui.js";
import { recarregar } from "../router.js";
import { db, doc, setDoc } from "../firebase.js";

// Seletor de ano (estado em memória no ctx).
function anoSeletor(ctx) {
  const sel = el("select", {},
    [ctx.ano - 1, ctx.ano, ctx.ano + 1].map((a) => el("option", { value: a, selected: a === ctx.ano }, String(a))),
  );
  sel.addEventListener("change", () => {
    ctx.ano = Number(sel.value);
    recarregar();
  });
  return el("label", {}, "Ano", sel);
}

// Só admin: edita impostoPct e comissaoPct do cliente (users/{email}/config/parametros).
function cardParametros(ctx, params) {
  const campo = (valor) => el("input", { type: "text", inputmode: "decimal", value: fmtPct(valor), style: "width:90px" });
  const imposto = campo(params.impostoPct);
  const comissao = campo(params.comissaoPct);
  const lerPct = (input) => {
    const t = String(input.value || "").replace("%", "").trim();
    if (t === "") return NaN;
    const v = num(t);
    return Number.isFinite(v) ? v / 100 : NaN;
  };
  const salvar = async () => {
    const impostoPct = lerPct(imposto);
    const comissaoPct = lerPct(comissao);
    if (!(impostoPct >= 0 && impostoPct <= 1) || !(comissaoPct >= 0 && comissaoPct <= 1)) {
      alert("Informe percentuais entre 0 e 100.");
      return;
    }
    await setDoc(doc(db, "users", ctx.email, "config", "parametros"), { impostoPct, comissaoPct }, { merge: true });
    toast("Percentuais salvos.");
    recarregar();
  };
  return el("section", { class: "card" },
    el("h2", {}, "Impostos e comissão da empresa"),
    el("p", { class: "muted" }, "Percentuais aplicados sobre a receita bruta da empresa deste cliente. Pessoa física não tem desconto."),
    el("div", { class: "row", style: "align-items:flex-end" },
      el("label", {}, "Impostos (%)", imposto),
      el("label", {}, "Comissão (%)", comissao),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Salvar percentuais"),
    ),
  );
}

export function telaReceitas(ctx, dados) {
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
    el("td", { colspan: 14, style: "background:#F5F0E8;font-weight:600" }, rotulo),
  );

  const bloco = (titulo, lancs, params, comDescontos) => {
    const r = resumoAno(lancs, ctx.ano, params);
    const rows = [cabecalhoSecao("Receitas")];
    for (const c of r.catsR) rows.push(linha(c, r.meses.map((m) => m.receitas[c] || 0)));
    rows.push(linha("Receita bruta", r.meses.map((m) => m.bruta), { total: r.totais.bruta, classe: "total" }));
    if (comDescontos) {
      rows.push(linha("Impostos (" + pct(r.params.impostoPct) + ")", r.meses.map((m) => m.impostos), { total: r.totais.impostos }));
      rows.push(linha("Comissão (" + pct(r.params.comissaoPct) + ")", r.meses.map((m) => m.comissao), { total: r.totais.comissao }));
      rows.push(linha("Receita líquida", r.meses.map((m) => m.liquida), { total: r.totais.liquida, classe: "total" }));
    }
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
    el("div", { class: "row" }, anoSeletor(ctx)),
    ctx.modo === "admin" ? cardParametros(ctx, dados.params) : null,
    bloco("Empresa", dados.lancamentos.filter((l) => entidadeDe(l) === "empresa"), dados.params, true),
    bloco("Pessoa física", dados.lancamentos.filter((l) => entidadeDe(l) === "pessoa"), PARAMETROS_PF, false),
  );
}
