// Acesso a dados no Firestore.
import { db, doc, getDoc, getDocs, deleteDoc, collection } from "./firebase.js";
import { PARAMETROS_PADRAO } from "../firebase-config.js";

// Todas as subcoleções de users/{email}. Ao criar uma nova, inclua aqui para a exclusão não deixar dados para trás.
export const SUBCOLECOES_USUARIO = ["lancamentos", "patrimonio", "metas", "projetos", "fluxo", "config", "protecao"];

export async function listar(caminho) {
  const snap = await getDocs(collection(db, ...caminho));
  const itens = [];
  snap.forEach((d) => itens.push({ id: d.id, ...d.data() }));
  return itens;
}

export const carregarLancamentos = (email) => listar(["users", email, "lancamentos"]);
export const carregarPatrimonio = (email) => listar(["users", email, "patrimonio"]);
export const carregarProtecao = (email) => listar(["users", email, "protecao"]);

export async function carregarParametros(email) {
  const snap = await getDoc(doc(db, "users", email, "config", "parametros"));
  return snap.exists() ? { ...PARAMETROS_PADRAO, ...snap.data() } : { ...PARAMETROS_PADRAO };
}

export async function carregarUsuarios() {
  const snap = await getDocs(collection(db, "users"));
  const usuarios = [];
  snap.forEach((d) => usuarios.push({ email: d.id, ...d.data() }));
  usuarios.sort((a, b) => a.email.localeCompare(b.email));
  return usuarios;
}

// Apaga o documento users/{email} e todas as suas subcoleções. Lança erro se algo falhar.
export async function excluirDadosUsuario(email) {
  for (const sub of SUBCOLECOES_USUARIO) {
    const snap = await getDocs(collection(db, "users", email, sub));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }
  await deleteDoc(doc(db, "users", email));
}
