// Testes de formatação e meses (public/js/format.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { num, brl, addMeses, mesesEntre, soma, pct, fmtPct, emailKey } from "../public/js/format.js";

// toLocaleString usa espaço não separável entre "R$" e o valor.
const semEspacos = (s) => s.replace(/\s/g, " ");

test("num lê valores no padrão brasileiro", () => {
  assert.equal(num("1.500"), 1500);
  assert.equal(num("1.500.000"), 1500000);
  assert.equal(num("1500,50"), 1500.5);
  assert.equal(num("1.500,50"), 1500.5);
  assert.equal(num("R$ 1.500,00"), 1500);
  assert.equal(num("r$2.345,67"), 2345.67);
  assert.equal(num("-1.234,56"), -1234.56);
  assert.equal(num("0,99"), 0.99);
  assert.equal(num(" 250 "), 250);
});

test("num trata ponto decimal, números e entradas inválidas", () => {
  assert.equal(num("1.5"), 1.5); // não é grupo de milhar (menos de 3 dígitos)
  assert.equal(num("1500.75"), 1500.75);
  assert.equal(num(42.5), 42.5);
  assert.equal(num(NaN), 0);
  assert.equal(num(Infinity), 0);
  assert.equal(num(""), 0);
  assert.equal(num(null), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num("abc"), 0);
});

test("brl formata em reais", () => {
  assert.equal(semEspacos(brl(1500)), "R$ 1.500,00");
  assert.equal(semEspacos(brl(0.5)), "R$ 0,50");
  assert.equal(semEspacos(brl(1234567.891)), "R$ 1.234.567,89");
  assert.equal(semEspacos(brl("x")), "R$ 0,00");
  assert.match(semEspacos(brl(-10)), /^-\s?R\$ 10,00$/);
});

test("pct, fmtPct, soma e emailKey", () => {
  assert.equal(pct(0.1234), "12,3%");
  assert.equal(fmtPct(0.105), "10,5");
  assert.equal(fmtPct(0.1), "10");
  assert.equal(soma([1, 2, 3.5]), 6.5);
  assert.equal(soma([]), 0);
  assert.equal(emailKey("  Fulano@Teste.COM "), "fulano@teste.com");
  assert.equal(emailKey(undefined), "");
});

test("addMeses avança e recua atravessando anos", () => {
  assert.equal(addMeses("2024-01", 0), "2024-01");
  assert.equal(addMeses("2024-01", 1), "2024-02");
  assert.equal(addMeses("2024-11", 2), "2025-01");
  assert.equal(addMeses("2024-12", 1), "2025-01");
  assert.equal(addMeses("2024-01", -1), "2023-12");
  assert.equal(addMeses("2024-06", 24), "2026-06");
  assert.equal(addMeses("2024-03", 359), "2054-02");
});

test("mesesEntre conta a diferença em meses", () => {
  assert.equal(mesesEntre("2024-01", "2024-01"), 0);
  assert.equal(mesesEntre("2024-01", "2024-12"), 11);
  assert.equal(mesesEntre("2024-11", "2025-02"), 3);
  assert.equal(mesesEntre("2025-02", "2024-11"), -3);
  for (const k of [0, 1, 13, 120, -5]) assert.equal(mesesEntre("2024-05", addMeses("2024-05", k)), k);
});
