// Testes dos cálculos puros (public/js/calc.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expandirLancamentos, resumoAno, calcPatrimonio, projetar, ocorrenciasProjeto,
  entidadeDe, PARAMETROS_PF, PARAMS_APOSENT,
} from "../public/js/calc.js";

const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} esperado ${b}, veio ${a}`);
const centavos = (v) => Math.round(v * 100);

test("expandirLancamentos divide parcelas e o último mês absorve os centavos", () => {
  const linhas = expandirLancamentos([{ tipo: "despesa", categoria: "Aluguel", valorTotal: 100, parcelas: 3, mesInicial: "2024-11" }]);
  assert.deepEqual(linhas.map((l) => l.mes), ["2024-11", "2024-12", "2025-01"]);
  assert.deepEqual(linhas.map((l) => l.valor), [33.33, 33.33, 33.34]);
  assert.equal(linhas.reduce((s, l) => s + centavos(l.valor), 0), 10000);
  assert.ok(linhas.every((l) => l.entidade === "pessoa" && l.tipo === "despesa"));
});

test("expandirLancamentos preserva o total em centavos para vários valores", () => {
  for (const [total, n] of [[0.1, 3], [1000, 7], [999.99, 12], [0.01, 2], [12345.67, 360]]) {
    const linhas = expandirLancamentos([{ tipo: "receita", categoria: "X", valorTotal: total, parcelas: n, mesInicial: "2024-01" }]);
    assert.equal(linhas.length, n);
    assert.equal(linhas.reduce((s, l) => s + centavos(l.valor), 0), centavos(total), `total ${total} em ${n}`);
    assert.ok(linhas.every((l) => l.valor >= 0), `sem parcela negativa (${total}/${n})`);
  }
});

test("expandirLancamentos aceita valor em texto e parcelas ausentes", () => {
  const [l] = expandirLancamentos([{ tipo: "receita", categoria: "C", valorTotal: "1.500,50", mesInicial: "2024-02", entidade: "empresa" }]);
  assert.equal(l.valor, 1500.5);
  assert.equal(l.entidade, "empresa");
  assert.equal(entidadeDe({}), "pessoa");
});

const LANCS = [
  { tipo: "receita", categoria: "Consultoria", valorTotal: 1000, parcelas: 1, mesInicial: "2024-02", entidade: "empresa" },
  { tipo: "receita", categoria: "Salário", valorTotal: 500, parcelas: 1, mesInicial: "2024-02", entidade: "pessoa" },
  { tipo: "despesa", categoria: "Aluguel", valorTotal: 150, parcelas: 1, mesInicial: "2024-02", entidade: "pessoa" },
  { tipo: "despesa", categoria: "Internet", valorTotal: 300, parcelas: 3, mesInicial: "2024-01" },
  { tipo: "receita", categoria: "Outro ano", valorTotal: 9999, parcelas: 1, mesInicial: "2023-02", entidade: "empresa" },
];

test("resumoAno aplica impostos e comissão só sobre a receita da empresa", () => {
  const r = resumoAno(LANCS, 2024, { impostoPct: 0.1, comissaoPct: 0.05 });
  const fev = r.meses[1];
  perto(fev.bruta, 1500);
  perto(fev.brutaEmpresa, 1000);
  perto(fev.impostos, 100);
  perto(fev.comissao, 50);
  perto(fev.liquida, 1350);
  perto(fev.despesasTotal, 250);
  perto(fev.lucro, 1100);
  perto(fev.margem, 1100 / 1500);
  // Janeiro só tem a parcela da internet: lucro -100; acumulado em fevereiro = 1000.
  perto(r.meses[0].lucro, -100);
  perto(fev.caixaAcumulado, 1000);
  perto(r.meses[11].caixaAcumulado, r.totais.lucro);
  perto(r.totais.bruta, 1500);
  perto(r.totais.impostos, 100);
  perto(r.totais.comissao, 50);
  perto(r.totais.liquida, 1350);
  perto(r.totais.despesas, 450);
  perto(r.totais.lucro, 900);
  perto(r.totais.margem, 900 / 1500);
  assert.deepEqual(r.params, { impostoPct: 0.1, comissaoPct: 0.05 });
  assert.deepEqual(r.catsR, ["Consultoria", "Salário"]);
  assert.deepEqual(r.catsD, ["Aluguel", "Internet"]);
});

test("resumoAno: pessoa física não paga impostos nem comissão", () => {
  const pf = LANCS.filter((l) => entidadeDe(l) === "pessoa");
  for (const params of [undefined, { impostoPct: 0.3, comissaoPct: 0.2 }, PARAMETROS_PF]) {
    const r = resumoAno(pf, 2024, params);
    perto(r.totais.impostos, 0);
    perto(r.totais.comissao, 0);
    perto(r.totais.liquida, r.totais.bruta);
  }
});

test("resumoAno usa 10% + 10% quando não há parâmetros e mescla parâmetros parciais", () => {
  const emp = LANCS.filter((l) => entidadeDe(l) === "empresa");
  const padrao = resumoAno(emp, 2024);
  perto(padrao.totais.impostos, 100);
  perto(padrao.totais.comissao, 100);
  const parcial = resumoAno(emp, 2024, { impostoPct: 0.2 });
  perto(parcial.totais.impostos, 200);
  perto(parcial.totais.comissao, 100);
  const texto = resumoAno(emp, 2024, { impostoPct: "0,15", comissaoPct: 0 });
  perto(texto.totais.impostos, 150);
  perto(texto.totais.comissao, 0);
});

test("resumoAno de ano sem lançamentos fica zerado sem dividir por zero", () => {
  const r = resumoAno(LANCS, 2030, PARAMETROS_PF);
  assert.equal(r.meses.length, 12);
  assert.ok(r.meses.every((m) => m.lucro === 0 && m.margem === 0));
  assert.equal(r.totais.margem, 0);
});

test("calcPatrimonio soma ativos, desconta dívidas e ignora categorias desconhecidas", () => {
  const p = calcPatrimonio([
    { categoria: "imoveis", valor: 500000 },
    { categoria: "investimentos", valor: "1.500,50" },
    { categoria: "veiculos", valor: 80000 },
    { categoria: "dividas", valor: 120000 },
    { categoria: "desconhecida", valor: 999 },
    { categoria: "empresas" },
  ]);
  perto(p.ativos, 581500.5);
  perto(p.dividas, 120000);
  perto(p.liquido, 461500.5);
  assert.deepEqual(calcPatrimonio([]), { ativos: 0, dividas: 0, liquido: 0 });
});

test("projetar: aporte necessário é 0 quando o capital já basta", () => {
  const p = { ...PARAMS_APOSENT, idadeAtual: 40, idadeAposentadoria: 60, rendaDesejada: 5000 };
  const r = projetar(p, [], 1e9, "2024-01");
  assert.ok(r.idealRet > 0);
  assert.equal(r.aporteNecessario, 0);
  assert.ok(r.serie.total.every(Number.isFinite));
});

test("projetar: caso simples sem juros confere com a conta à mão", () => {
  // 6 meses até aposentar, 6 meses de saque de 1000 até os 100 anos, sem rentabilidade.
  const p = { idadeAtual: 99, idadeAposentadoria: 99.5, rendaDesejada: 1000, outrasRendas: 0, investimentoMensal: 1000, rentabilidadeReal: 0 };
  const r = projetar(p, [], 0, "2024-01");
  assert.equal(r.total, 12);
  assert.equal(r.nRet, 6);
  perto(r.idealRet, 6000);
  perto(r.aporteNecessario, 1000);
  // Aportando exatamente o necessário, o capital chega ao ideal e zera no fim.
  perto(r.serie.total[r.nRet], 6000);
  perto(r.serie.total[r.total], 0);
});

test("projetar: idade de aposentadoria menor ou igual à atual não quebra", () => {
  for (const idadeAposentadoria of [50, 49, 30]) {
    const p = { ...PARAMS_APOSENT, idadeAtual: 50, idadeAposentadoria };
    const r = projetar(p, [{ tipo: "viagem", valorTotal: 10000, dataExecucao: "2025-01" }], 100000, "2024-01");
    assert.equal(r.nRet, 0);
    assert.equal(r.aporteNecessario, 0);
    assert.ok(Number.isFinite(r.idealRet) && r.idealRet >= 0);
    assert.ok(r.serie.total.every(Number.isFinite));
    assert.ok(r.serie.ideal.every(Number.isFinite));
  }
});

test("projetar: idade atual acima da idade final não quebra", () => {
  const r = projetar({ ...PARAMS_APOSENT, idadeAtual: 120, idadeAposentadoria: 65 }, [], 0, "2024-01");
  assert.equal(r.total, 1);
  assert.equal(r.aporteNecessario, 0);
  assert.ok(r.serie.total.every(Number.isFinite));
});

test("projetar: aportes financeiros reduzem e gastos aumentam o aporte necessário", () => {
  const p = { ...PARAMS_APOSENT, idadeAtual: 35, idadeAposentadoria: 65 };
  const base = projetar(p, [], 0, "2024-01").aporteNecessario;
  const comGasto = projetar(p, [{ tipo: "casa", valorTotal: 300000, dataExecucao: "2030-01" }], 0, "2024-01").aporteNecessario;
  const comAporte = projetar(p, [{ tipo: "aporte", valorTotal: 300000, dataExecucao: "2030-01" }], 0, "2024-01").aporteNecessario;
  assert.ok(comGasto > base && base > comAporte);
});

test("ocorrenciasProjeto: única, anual, a prazo e fora da janela", () => {
  assert.deepEqual(ocorrenciasProjeto({ valorTotal: 100, dataExecucao: "2024-03" }, "2024-01", 12), [[2, 100]]);
  assert.deepEqual(ocorrenciasProjeto({ valorTotal: 100, dataExecucao: "2024-01", repeticao: "anual", quantidade: 3 }, "2024-01", 30),
    [[0, 100], [12, 100], [24, 100]]);
  assert.deepEqual(ocorrenciasProjeto({ valorTotal: 300, dataExecucao: "2024-02", aPrazo: true, quantidade: 3 }, "2024-01", 12),
    [[1, 100], [2, 100], [3, 100]]);
  assert.deepEqual(ocorrenciasProjeto({ valorTotal: 100, dataExecucao: "2023-01" }, "2024-01", 12), []);
});
