// Roteador único por hash + resolução de perfil (feita uma vez após o login).
//
// Rotas:
//   cliente:            #/inicio (Home, abertura)  #/dashboard  #/lancamento  #/receitas  #/patrimonio  #/home  #/relatorio
//   admin:              #/admin/clientes  #/admin/dashboard  #/admin/oportunidade
//   admin vê cliente:   #/cliente/{email codificado}/{secao}
//   ferramentas:        #/metas  #/aposentadoria  #/open-finance  (Conexões, na mesma página; admin usa #/cliente/{email}/{tipo})
//   formato antigo:     #/ferramenta/{tipo}[?cliente=...] é redirecionado para a seção equivalente
// Para navegar use ir(hash). Para redesenhar a rota atual (ex.: após salvar) use recarregar().
import { auth, db, doc, getDoc, updateDoc, onAuthStateChanged } from "./firebase.js";
import { emailKey, ANO_ATUAL } from "./format.js";
import { el, setView } from "./ui.js";
import { carregarLancamentos, carregarParametros, carregarPatrimonio, carregarProtecao, carregarConsorcios } from "./data.js";
import { shellAdmin, shellPortal } from "./layout.js";
import { renderLogin, renderNegado } from "./views/login.js";
import { telaDashboard, desenharGrafico } from "./views/dashboard.js";
import { telaInicio, desenharInicio } from "./views/inicio.js";
import { telaLancamento } from "./views/lancamento.js";
import { telaReceitas } from "./views/receitas.js";
import { telaMeuPatrimonio } from "./views/meu-patrimonio.js";
import { telaCredito } from "./views/credito.js";
import { telaProtecao } from "./views/protecao.js";
import { telaHome, telaOpenFinance } from "./views/home.js";
import { telaMetas } from "./views/metas.js";
import { montarAposentadoria } from "./views/aposentadoria.js";
import { montarClientes, montarConsolidado } from "./views/admin.js";
import { telaOportunidade } from "./views/oportunidade.js";
import { telaRelatorio } from "./views/relatorio.js";

export const FERRAMENTAS = ["metas", "aposentadoria", "open-finance"];
export const SECOES_CLIENTE = ["inicio", "dashboard", "lancamento", "receitas", "patrimonio", "credito", "protecao", "home", "relatorio", ...FERRAMENTAS];
export const SECOES_ADMIN = ["clientes", "dashboard", "oportunidade"];

const MSG_SEM_ACESSO = "Este e-mail não tem acesso ao sistema. Fale com o administrador.";

// perfil = { uid, user, email, tipo: "admin" | "cliente" | "negado" | "erro", nome?, mensagem? }
let perfil = null;
// Contextos por cliente, reaproveitados entre telas para manter ano/mês escolhidos.
// ctx = { user, email, nome, modo: "cliente" | "admin", ano, mes?, anoGrafico? }
const contextos = new Map();
let seq = 0;
let authPronto = false;

export const perfilAtual = () => perfil;

// ---------- Hashes ----------
export const hashAdmin = (secao = "clientes") => "#/admin/" + secao;
export const hashCliente = (ctx, secao) =>
  ctx.modo === "admin" ? "#/cliente/" + encodeURIComponent(ctx.email) + "/" + secao : "#/" + secao;
// As ferramentas do Conexões abrem na mesma página, como as demais seções.
export const hashFerramenta = (ctx, tipo) => hashCliente(ctx, tipo);

const decodificar = (s) => {
  try { return emailKey(decodeURIComponent(s)); } catch { return null; }
};

export function lerRota(hash = location.hash) {
  const h = (hash || "").replace(/^#/, "");
  let m;
  if ((m = h.match(/^\/ferramenta\/([a-z-]+)(?:\?cliente=(.+))?$/))) {
    return { tipo: "ferramenta", ferramenta: m[1], cliente: m[2] ? decodificar(m[2]) : null };
  }
  if ((m = h.match(/^\/admin\/([a-z]+)$/)) && SECOES_ADMIN.includes(m[1])) return { tipo: "admin", secao: m[1] };
  if ((m = h.match(/^\/cliente\/([^/?]+)\/([a-z-]+)$/)) && SECOES_CLIENTE.includes(m[2]) && decodificar(m[1])) {
    return { tipo: "clienteAdmin", email: decodificar(m[1]), secao: m[2] };
  }
  // Formato antigo: #/secao/{nome}[?cliente=email]
  if ((m = h.match(/^\/secao\/([a-z]+)(?:\?cliente=(.+))?$/)) && SECOES_CLIENTE.includes(m[1])) {
    return m[2] && decodificar(m[2]) ? { tipo: "clienteAdmin", email: decodificar(m[2]), secao: m[1] } : { tipo: "cliente", secao: m[1] };
  }
  if ((m = h.match(/^\/([a-z-]+)$/)) && SECOES_CLIENTE.includes(m[1])) return { tipo: "cliente", secao: m[1] };
  return { tipo: "inicio" };
}

// ---------- Navegação ----------
export function ir(hash) {
  const alvo = hash.startsWith("#") ? hash : "#" + hash;
  if (location.hash === alvo) return renderizar();
  location.hash = alvo;
}

export function recarregar() {
  return renderizar();
}

// Troca a rota sem criar entrada no histórico (para redirecionamentos).
function redirecionar(hash) {
  history.replaceState(null, "", hash);
  return renderizar();
}

// ---------- Perfil ----------
async function resolverPerfil(user) {
  const email = emailKey(user.email);
  const base = { uid: user.uid, user, email };
  try {
    const adminSnap = await getDoc(doc(db, "admins", email));
    if (adminSnap.exists()) return { ...base, tipo: "admin" };
    const userSnap = await getDoc(doc(db, "users", email));
    if (userSnap.exists() && userSnap.data().ativo) {
      registrarAcesso(email);
      return { ...base, tipo: "cliente", nome: userSnap.data().nome || email };
    }
    return { ...base, tipo: "negado", mensagem: MSG_SEM_ACESSO };
  } catch (err) {
    console.error(err);
    return { ...base, tipo: "erro", mensagem: "Erro ao verificar seu acesso. Tente novamente mais tarde." };
  }
}

// Grava users/{email}.ultimoAcesso no máximo uma vez por sessão do navegador. Falha não bloqueia o login.
const acessosRegistrados = new Set();
function registrarAcesso(email) {
  const chave = "ultimoAcesso|" + email;
  if (acessosRegistrados.has(chave)) return;
  acessosRegistrados.add(chave);
  try {
    if (sessionStorage.getItem(chave)) return;
    sessionStorage.setItem(chave, "1");
  } catch { /* sessionStorage indisponível: vale o controle em memória */ }
  updateDoc(doc(db, "users", email), { ultimoAcesso: new Date().toISOString() })
    .catch((err) => console.error("Não foi possível registrar o último acesso.", err));
}

function contextoProprio() {
  const k = "cliente|" + perfil.email;
  if (!contextos.has(k)) contextos.set(k, { user: perfil.user, email: perfil.email, nome: perfil.nome, modo: "cliente", ano: ANO_ATUAL });
  return contextos.get(k);
}

async function contextoCliente(email) {
  const k = "admin|" + email;
  if (!contextos.has(k)) {
    const snap = await getDoc(doc(db, "users", email));
    const nome = snap.exists() ? (snap.data().nome || email) : email;
    contextos.set(k, { user: perfil.user, email, nome, modo: "admin", ano: ANO_ATUAL });
  }
  return contextos.get(k);
}

// ---------- Renderização ----------
const carregando = () => el("div", {}, el("p", { class: "muted" }, "Carregando..."));

async function renderizar() {
  const token = ++seq;
  if (!authPronto) return;
  const user = auth.currentUser;
  if (!user) return renderLogin();
  if (!user.emailVerified) return renderNegado("Sua conta Google precisa ter o e-mail verificado.");

  if (!perfil || perfil.uid !== user.uid || perfil.tipo === "erro") {
    const p = await resolverPerfil(user);
    if (token !== seq) return;
    perfil = p;
  }
  if (perfil.tipo === "negado" || perfil.tipo === "erro") return renderNegado(perfil.mensagem);

  const rota = lerRota();
  try {
    // Links antigos de ferramenta (abriam em nova janela) viram a seção equivalente no portal.
    if (rota.tipo === "ferramenta") {
      const tipo = FERRAMENTAS.includes(rota.ferramenta) ? rota.ferramenta : "home";
      if (perfil.tipo === "admin") {
        return redirecionar(rota.cliente ? "#/cliente/" + encodeURIComponent(rota.cliente) + "/" + tipo : hashAdmin("clientes"));
      }
      return redirecionar("#/" + tipo);
    }
    if (perfil.tipo === "admin") {
      if (rota.tipo === "admin") return await renderAdmin(rota.secao);
      if (rota.tipo === "clienteAdmin") {
        const ctx = await contextoCliente(rota.email);
        if (token !== seq) return;
        return await renderPortal(ctx, rota.secao, token);
      }
      return redirecionar(hashAdmin("clientes"));
    }
    if (rota.tipo === "cliente") return await renderPortal(contextoProprio(), rota.secao, token);
    return redirecionar("#/inicio");
  } catch (err) {
    console.error(err);
    if (token === seq) {
      renderNegado(rota.tipo === "ferramenta" ? "Erro ao abrir a ferramenta. Tente novamente." : "Erro ao abrir a página. Tente novamente.");
    }
  }
}

async function renderAdmin(secao) {
  const slot = carregando();
  setView(shellAdmin(perfil.user, secao, slot));
  if (secao === "dashboard") return montarConsolidado(slot);
  if (secao === "oportunidade") return slot.replaceChildren(telaOportunidade());
  return montarClientes(perfil.user, slot);
}

async function renderPortal(ctx, secao, token) {
  const slot = carregando();
  setView(shellPortal(ctx, secao, slot));

  // Ferramentas do Conexões carregam os próprios dados.
  if (secao === "metas") {
    const tela = await telaMetas(ctx);
    if (token === seq) slot.replaceChildren(tela);
    return;
  }
  if (secao === "aposentadoria") return montarAposentadoria(ctx, slot);
  if (secao === "open-finance") return slot.replaceChildren(telaOpenFinance());

  if (secao === "protecao") {
    const apolices = await carregarProtecao(ctx.email);
    if (token === seq) slot.replaceChildren(telaProtecao(ctx, apolices));
    return;
  }

  const [lancamentos, params, patrimonio, protecao] = await Promise.all([
    carregarLancamentos(ctx.email),
    carregarParametros(ctx.email),
    carregarPatrimonio(ctx.email),
    carregarProtecao(ctx.email),
  ]);
  if (token !== seq) return;
  const dados = { lancamentos, params, patrimonio, protecao };

  if (secao === "inicio") {
    slot.replaceChildren(telaInicio(ctx, dados));
    desenharInicio(ctx, dados);
    return;
  }

  if (secao === "home") return slot.replaceChildren(telaHome(ctx));
  if (secao === "lancamento") return slot.replaceChildren(telaLancamento(ctx, dados));
  if (secao === "receitas") return slot.replaceChildren(telaReceitas(ctx, dados));
  if (secao === "credito") {
    const cartas = await carregarConsorcios(ctx.email);
    if (token === seq) slot.replaceChildren(telaCredito(ctx, cartas));
    return;
  }
  if (secao === "patrimonio") return slot.replaceChildren(telaMeuPatrimonio(ctx, dados));
  if (secao === "relatorio") return slot.replaceChildren(telaRelatorio(ctx, dados));
  slot.replaceChildren(telaDashboard(ctx, dados));
  desenharGrafico(ctx, dados);
}

// ---------- Início ----------
let iniciado = false;
export function iniciar() {
  if (iniciado) return;
  iniciado = true;
  window.addEventListener("hashchange", () => { renderizar(); });
  onAuthStateChanged(auth, (user) => {
    authPronto = true;
    perfil = null;
    contextos.clear();
    if (!user) {
      seq++;
      return renderLogin();
    }
    renderizar();
  });
}
