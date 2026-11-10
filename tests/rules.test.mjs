// Testes das regras do Firestore (firestore.rules) no emulador.
// Precisa do emulador do Firestore rodando (127.0.0.1:8085 ou FIRESTORE_EMULATOR_HOST).
// Em "npm test" os testes são pulados se o emulador não responder; em "npm run test:rules" eles falham.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, collectionGroup, writeBatch, setLogLevel,
} from "firebase/firestore";

// As negações esperadas geram avisos do SDK; só erros reais aparecem.
setLogLevel("silent");

const PROJETO = "demo-financeiro-teste";
const [HOST, PORTA] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
// "npm run test:rules" exige o emulador; "npm test" só pula estes testes se ele não estiver no ar.
const OBRIGATORIO = process.env.npm_lifecycle_event === "test:rules" || process.env.EXIGIR_EMULADOR === "1";

const ADMIN = "admin@teste.com";
const CLIENTE = "cliente@teste.com";
const OUTRO = "outro@teste.com";
const INATIVO = "inativo@teste.com";

async function emuladorNoAr() {
  try {
    const r = await fetch(`http://${HOST}:${PORTA}/`, { signal: AbortSignal.timeout(2000) });
    return r.status > 0;
  } catch {
    return false;
  }
}

const noAr = await emuladorNoAr();
if (!noAr && OBRIGATORIO) {
  throw new Error(`Emulador do Firestore não respondeu em ${HOST}:${PORTA}. Rode-o antes (veja o README).`);
}
const opcoes = noAr ? {} : { skip: `emulador do Firestore fora do ar em ${HOST}:${PORTA}` };

let env;
const lanc = (extra = {}) => ({ tipo: "despesa", categoria: "Aluguel", valorTotal: 100, parcelas: 1, mesInicial: "2024-01", ...extra });
const comoUsuario = (email, verificado = true) =>
  env.authenticatedContext(email.replace(/\W/g, "_"), { email, email_verified: verificado }).firestore();

before(async () => {
  if (!noAr) return;
  env = await initializeTestEnvironment({
    projectId: PROJETO,
    firestore: { host: HOST, port: Number(PORTA), rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});

after(async () => {
  if (env) await env.cleanup();
});

// Cada teste começa com o mesmo cenário, gravado sem regras.
beforeEach(async () => {
  if (!env) return;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "admins", ADMIN), { criadoEm: "2024-01-01" });
    for (const [email, ativo] of [[CLIENTE, true], [OUTRO, true], [INATIVO, false]]) {
      await setDoc(doc(db, "users", email), { nome: email, ativo, criadoEm: "2024-01-01" });
      await setDoc(doc(db, "users", email, "lancamentos", "l1"), lanc());
      await setDoc(doc(db, "users", email, "patrimonio", "p1"), { categoria: "imoveis", valor: 1000 });
      await setDoc(doc(db, "users", email, "metas", "m1"), { nome: "Reserva", valorAlvo: 5000 });
      await setDoc(doc(db, "users", email, "projetos", "pr1"), { tipo: "viagem", valorTotal: 3000 });
      await setDoc(doc(db, "users", email, "config", "parametros"), { impostoPct: 0.1, comissaoPct: 0.1 });
    }
  });
});

test("admin lê e escreve tudo", opcoes, async () => {
  const db = comoUsuario(ADMIN);
  await assertSucceeds(getDocs(collection(db, "users")));
  await assertSucceeds(getDoc(doc(db, "users", CLIENTE, "lancamentos", "l1")));
  await assertSucceeds(getDoc(doc(db, "users", INATIVO, "patrimonio", "p1")));
  await assertSucceeds(setDoc(doc(db, "users", "novo@teste.com"), { nome: "Novo", ativo: true }));
  await assertSucceeds(updateDoc(doc(db, "users", CLIENTE), { ativo: false }));
  await assertSucceeds(setDoc(doc(db, "users", CLIENTE, "config", "parametros"), { impostoPct: 0.2 }, { merge: true }));
  await assertSucceeds(addDoc(collection(db, "users", INATIVO, "lancamentos"), lanc()));
  await assertSucceeds(deleteDoc(doc(db, "users", CLIENTE, "metas", "m1")));
  await assertSucceeds(setDoc(doc(db, "admins", "outroadmin@teste.com"), { criadoEm: "2024-01-01" }));
  await assertSucceeds(deleteDoc(doc(db, "users", OUTRO)));
});

test("admin consulta collectionGroup", opcoes, async () => {
  const db = comoUsuario(ADMIN);
  for (const sub of ["lancamentos", "patrimonio", "projetos", "metas"]) {
    await assertSucceeds(getDocs(collectionGroup(db, sub)));
  }
});

test("cliente ativo lê e escreve os próprios dados", opcoes, async () => {
  const db = comoUsuario(CLIENTE);
  await assertSucceeds(getDoc(doc(db, "users", CLIENTE)));
  await assertSucceeds(getDocs(collection(db, "users", CLIENTE, "lancamentos")));
  await assertSucceeds(addDoc(collection(db, "users", CLIENTE, "lancamentos"), lanc({ grupoId: "g1", serie: { indice: 1, total: 2 } })));
  await assertSucceeds(updateDoc(doc(db, "users", CLIENTE, "lancamentos", "l1"), { valorTotal: 250 }));
  await assertSucceeds(deleteDoc(doc(db, "users", CLIENTE, "lancamentos", "l1")));
  await assertSucceeds(setDoc(doc(db, "users", CLIENTE, "patrimonio", "p2"), { categoria: "veiculos", valor: 50000 }));
  await assertSucceeds(updateDoc(doc(db, "users", CLIENTE, "metas", "m1"), { acumulado: 100, valorAlvo: 5000 }));
  await assertSucceeds(setDoc(doc(db, "users", CLIENTE, "projetos", "pr2"), { tipo: "casa", valorTotal: 1000 }));
  await assertSucceeds(setDoc(doc(db, "users", CLIENTE, "config", "aposentadoria"), { rendaDesejada: 8000 }));
  await assertSucceeds(getDoc(doc(db, "users", CLIENTE, "config", "parametros")));
  await assertSucceeds(updateDoc(doc(db, "users", CLIENTE), { ultimoAcesso: new Date().toISOString() }));
});

test("cliente ativo grava um lote de 360 lançamentos (parcelado máximo)", opcoes, async () => {
  const db = comoUsuario(CLIENTE);
  const lote = writeBatch(db);
  for (let i = 0; i < 360; i++) lote.set(doc(collection(db, "users", CLIENTE, "lancamentos")), lanc({ grupoId: "g2" }));
  await assertSucceeds(lote.commit());
});

test("cliente não acessa dados de outro cliente", opcoes, async () => {
  const db = comoUsuario(CLIENTE);
  await assertFails(getDoc(doc(db, "users", OUTRO)));
  await assertFails(getDoc(doc(db, "users", OUTRO, "lancamentos", "l1")));
  await assertFails(getDocs(collection(db, "users", OUTRO, "patrimonio")));
  await assertFails(addDoc(collection(db, "users", OUTRO, "lancamentos"), lanc()));
  await assertFails(deleteDoc(doc(db, "users", OUTRO, "metas", "m1")));
  await assertFails(updateDoc(doc(db, "users", OUTRO), { ultimoAcesso: new Date().toISOString() }));
  await assertFails(getDocs(collection(db, "users")));
});

test("cliente não altera o próprio cadastro nem os parâmetros do admin", opcoes, async () => {
  const db = comoUsuario(CLIENTE);
  await assertFails(updateDoc(doc(db, "users", CLIENTE), { ativo: false }));
  await assertFails(updateDoc(doc(db, "users", CLIENTE), { nome: "Outro nome" }));
  await assertFails(updateDoc(doc(db, "users", CLIENTE), { nome: "X", ultimoAcesso: new Date().toISOString() }));
  await assertFails(updateDoc(doc(db, "users", CLIENTE), { ultimoAcesso: 123 }));
  await assertFails(deleteDoc(doc(db, "users", CLIENTE)));
  await assertFails(setDoc(doc(db, "users", CLIENTE, "config", "parametros"), { impostoPct: 0 }));
  await assertFails(setDoc(doc(db, "admins", CLIENTE), { criadoEm: "2024-01-01" }));
});

test("cliente inativo lê o próprio cadastro, mas fica bloqueado nas subcoleções", opcoes, async () => {
  const db = comoUsuario(INATIVO);
  await assertSucceeds(getDoc(doc(db, "users", INATIVO)));
  for (const sub of ["lancamentos", "patrimonio", "metas", "projetos", "config"]) {
    await assertFails(getDocs(collection(db, "users", INATIVO, sub)));
  }
  await assertFails(addDoc(collection(db, "users", INATIVO, "lancamentos"), lanc()));
  await assertFails(setDoc(doc(db, "users", INATIVO, "patrimonio", "p2"), { categoria: "imoveis", valor: 1 }));
  await assertFails(updateDoc(doc(db, "users", INATIVO), { ultimoAcesso: new Date().toISOString() }));
  await assertFails(updateDoc(doc(db, "users", INATIVO), { ativo: true }));
});

test("não-admin não consulta collectionGroup", opcoes, async () => {
  for (const email of [CLIENTE, INATIVO]) {
    const db = comoUsuario(email);
    for (const sub of ["lancamentos", "patrimonio", "projetos", "metas"]) {
      await assertFails(getDocs(collectionGroup(db, sub)));
    }
  }
});

test("lançamento inválido é rejeitado para o cliente", opcoes, async () => {
  const db = comoUsuario(CLIENTE);
  const col = collection(db, "users", CLIENTE, "lancamentos");
  for (const invalido of [
    lanc({ tipo: "transferencia" }),
    lanc({ valorTotal: 0 }),
    lanc({ valorTotal: -10 }),
    lanc({ valorTotal: "100" }),
    lanc({ parcelas: 0 }),
    lanc({ parcelas: 361 }),
    lanc({ parcelas: 1.5 }),
  ]) {
    await assertFails(addDoc(col, invalido));
  }
  await assertFails(updateDoc(doc(col, "l1"), { valorTotal: -1 }));
  await assertFails(setDoc(doc(db, "users", CLIENTE, "patrimonio", "p3"), { categoria: "imoveis", valor: -5 }));
  await assertFails(setDoc(doc(db, "users", CLIENTE, "metas", "m2"), { nome: "X", valorAlvo: 0 }));
  await assertFails(setDoc(doc(db, "users", CLIENTE, "projetos", "pr3"), { tipo: "casa", valorTotal: 0 }));
});

test("visitante, e-mail não verificado e e-mail fora do cadastro são bloqueados", opcoes, async () => {
  const anonimo = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonimo, "users", CLIENTE)));
  await assertFails(getDocs(collection(anonimo, "users", CLIENTE, "lancamentos")));
  const naoVerificado = comoUsuario(CLIENTE, false);
  await assertFails(getDoc(doc(naoVerificado, "users", CLIENTE)));
  await assertFails(getDocs(collection(naoVerificado, "users", CLIENTE, "lancamentos")));
  const naoVerificadoAdmin = comoUsuario(ADMIN, false);
  await assertFails(getDocs(collection(naoVerificadoAdmin, "users")));
  const estranho = comoUsuario("estranho@teste.com");
  await assertFails(getDocs(collection(estranho, "users", "estranho@teste.com", "lancamentos")));
  await assertFails(getDoc(doc(estranho, "outra-colecao", "x")));
});
