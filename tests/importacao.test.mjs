import { test } from "node:test";
import assert from "node:assert/strict";
import { lerLinhaTexto, lerLinhaPlanilha, qualificar, chaveDescricao } from "../public/js/importacao.js";

test("linha de fatura com data curta e valor simples", () => {
  const r = lerLinhaTexto("10/11 UBER *TRIP 25,90", 2026);
  assert.equal(r.data, "2026-11-10");
  assert.equal(r.descricao, "UBER *TRIP");
  assert.equal(r.valor, 25.9);
  assert.equal(r.negativo, false);
});

test("pagamento com sinal de menos e milhar", () => {
  const r = lerLinhaTexto("05/11/2026 PAGAMENTO RECEBIDO -1.200,00", 2026);
  assert.equal(r.data, "2026-11-05");
  assert.equal(r.valor, 1200);
  assert.equal(r.negativo, true);
});

test("linha sem data ou sem valor é ignorada", () => {
  assert.equal(lerLinhaTexto("Total a pagar 1.234,56", 2026), null);
  assert.equal(lerLinhaTexto("10/11 SEM VALOR", 2026), null);
});

test("linha de planilha com data em texto e valor numérico", () => {
  const r = lerLinhaPlanilha(["01/11/2026", "IFOOD *RESTAURANTE", -45.9], 2026);
  assert.equal(r.data, "2026-11-01");
  assert.equal(r.descricao, "IFOOD *RESTAURANTE");
  assert.equal(r.valor, 45.9);
  assert.equal(r.negativo, true);
});

test("qualificação automática das compras", () => {
  assert.deepEqual(
    [qualificar("IFOOD *RESTAURANTE").classificacao, qualificar("IFOOD *RESTAURANTE").categoria],
    ["Despesas não obrigatórias", "Alimentação fora"],
  );
  assert.equal(qualificar("PAGAMENTO FATURA").ignorar, true);
  assert.equal(qualificar("ALGUMA COISA QUALQUER").categoria, "Outros");
});

test("chave de descrição ignora acento e caixa", () => {
  assert.equal(chaveDescricao("  Padaria  Pão  "), chaveDescricao("padaria pao"));
});
