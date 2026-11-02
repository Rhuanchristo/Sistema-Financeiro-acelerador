// Popula o emulador local do Firestore com dados de teste.
// Uso (com os emuladores rodando): node emulador/seed.mjs
// "Bearer owner" é aceito só pelo emulador e ignora as regras; não funciona em produção.

const BASE = "http://127.0.0.1:8085/v1/projects/demo-financeiro/databases/(default)/documents";

const ADMIN = "admin@teste.com";
const CLIENTE = "cliente@teste.com";
const INATIVO = "inativo@teste.com";

function valor(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  if (v === null) return { nullValue: null };
  throw new Error("Tipo não suportado: " + v);
}

async function gravar(caminho, dados) {
  const fields = Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, valor(v)]));
  const res = await fetch(BASE + "/" + caminho, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(caminho + ": " + res.status + " " + (await res.text()));
}

const agora = new Date().toISOString();
const ano = new Date().getFullYear();
const mes = (m) => ano + "-" + String(m).padStart(2, "0");

await gravar("admins/" + ADMIN, { email: ADMIN, criadoEm: agora });
await gravar("users/" + CLIENTE, { email: CLIENTE, nome: "Cliente Teste", ativo: true, criadoEm: agora });
await gravar("users/" + INATIVO, { email: INATIVO, nome: "Cliente Inativo", ativo: false, criadoEm: agora });

const lancamentos = [];
for (let m = 1; m <= 12; m++) {
  lancamentos.push(
    { tipo: "receita", categoria: "Consultoria", valorTotal: 15000, entidade: "empresa", mes: mes(m) },
    { tipo: "despesa", categoria: "Aluguel", valorTotal: 3500, entidade: "empresa", mes: mes(m) },
    { tipo: "despesa", categoria: "Contabilidade", valorTotal: 800, entidade: "empresa", mes: mes(m) },
    { tipo: "receita", categoria: "Pró-labore", valorTotal: 8000, entidade: "pessoa", mes: mes(m) },
    { tipo: "despesa", categoria: "Condomínio", valorTotal: 1200, entidade: "pessoa", mes: mes(m) },
  );
}
let n = 0;
for (const l of lancamentos) {
  await gravar("users/" + CLIENTE + "/lancamentos/seed-" + ++n, {
    tipo: l.tipo, categoria: l.categoria, descricao: "", valorTotal: l.valorTotal,
    mesInicial: l.mes, parcelas: 1, modo: "unico", entidade: l.entidade,
    criadoEm: agora, criadoPor: ADMIN,
  });
}

const patrimonio = [
  ["imoveis", "Apartamento", "", 650000],
  ["veiculos", "Carro", "", 90000],
  ["investimentos", "CDB", "Banco Inter", 120000],
  ["investimentos", "Tesouro IPCA+", "XP", 80000],
  ["dividas", "Financiamento do apartamento", "Caixa", 210000],
];
n = 0;
for (const [categoria, descricao, instituicao, v] of patrimonio) {
  await gravar("users/" + CLIENTE + "/patrimonio/seed-" + ++n, {
    categoria, descricao, instituicao, valor: v, atualizadoEm: agora, criadoPor: ADMIN,
  });
}

await gravar("users/" + CLIENTE + "/metas/seed-1", {
  nome: "Reserva de emergência", valorAlvo: 60000, valorAtual: 20000, mesAlvo: mes(12), criadoEm: agora, criadoPor: ADMIN,
});
await gravar("users/" + CLIENTE + "/projetos/seed-1", {
  prioridade: "desejo", tipo: "viagem", nome: "Viagem em família", dataExecucao: mes(12), valorTotal: 25000,
  aPrazo: false, repeticao: "unica", intervaloAnos: null, quantidade: 1, criadoEm: agora, criadoPor: ADMIN,
});
await gravar("users/" + CLIENTE + "/config/aposentadoria", {
  idadeAtual: 40, idadeAposentadoria: 65, rendaDesejada: 15000, outrasRendas: 0, investimentoMensal: 3000,
  rentabilidadeReal: 0.04, atualizadoEm: agora,
});
await gravar("users/" + INATIVO + "/lancamentos/seed-1", {
  tipo: "receita", categoria: "Consultoria", descricao: "", valorTotal: 5000, mesInicial: mes(1),
  parcelas: 1, modo: "unico", entidade: "empresa", criadoEm: agora, criadoPor: ADMIN,
});

console.log("Dados de teste criados.");
console.log("  Admin:   " + ADMIN);
console.log("  Cliente: " + CLIENTE + " (ativo)");
console.log("  Cliente: " + INATIVO + " (inativo)");
