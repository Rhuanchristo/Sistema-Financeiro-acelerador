// Tela de login e de acesso negado, com a marca AP à esquerda.
import { auth, GoogleAuthProvider, signInWithPopup, signOut } from "../firebase.js";
import { el, setView } from "../ui.js";

function entrada(...form) {
  return el("div", { class: "entrada" },
    el("section", { class: "entrada-marca" },
      el("img", { src: "./img/ap-logo-claro.svg", alt: "AP" }),
      el("div", {},
        el("h1", {}, "Seu financeiro e seu patrimônio em um só lugar."),
        el("p", {}, "Lance receitas e despesas, acompanhe o que você construiu e veja quanto falta para a sua aposentadoria."),
      ),
      el("small", {}, "Acesso exclusivo para clientes da consultoria."),
    ),
    el("section", { class: "entrada-form" }, el("div", { class: "login" }, ...form)),
  );
}

export function renderLogin() {
  setView(entrada(
    el("h2", {}, "Entrar"),
    el("p", {}, "Use a conta Google cadastrada pela sua consultoria."),
    el("button", { onclick: entrarComGoogle }, "Entrar com Google"),
    el("div", { id: "msg", class: "msg", role: "alert" }),
  ));
}

async function entrarComGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const msg = document.getElementById("msg");
    if (msg) msg.textContent = "Não foi possível entrar. Confira se a janela do Google não foi bloqueada e tente de novo.";
  }
}

export function renderNegado(mensagem) {
  setView(entrada(
    el("h2", {}, "Acesso não liberado"),
    el("p", {}, mensagem),
    el("button", { class: "ghost", onclick: () => signOut(auth) }, "Entrar com outra conta"),
  ));
}
