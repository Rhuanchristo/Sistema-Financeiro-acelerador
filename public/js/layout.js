// Cascas de página (menu lateral com a marca + título da página) do admin, do portal do cliente e da janela de ferramenta.
import { auth, signOut } from "./firebase.js";
import { el } from "./ui.js";
import { ir, hashAdmin, hashCliente, hashFerramenta } from "./router.js";

export const TITULOS_FERRAMENTA = {
  "open-finance": "Open Finance",
  "metas": "Plano de metas",
  "aposentadoria": "Planejamento de aposentadoria",
};

const TITULOS_SECAO = {
  dashboard: "Visão do mês",
  lancamento: "Lançamentos",
  receitas: "Receitas e despesas",
  patrimonio: "Patrimônio",
  relatorio: "Relatório mensal",
  home: "Home Conect",
  clientes: "Clientes",
  oportunidade: "Oportunidades",
};

const botaoSair = () => el("button", { class: "light", onclick: () => signOut(auth) }, "Sair");

// Menu verde com o logo AP. No celular vira uma barra no topo com o menu rolável na horizontal;
// depois de entrar no documento, rola o menu até o item ativo.
function casca({ itens, quem, acoes, titulo, subtitulo, conteudo, larguraMax }) {
  const menu = el("nav", { class: "menu", "aria-label": "Menu" }, ...itens);
  const aside = el("aside", { class: "sidebar" },
    el("div", { class: "marca" },
      el("img", { src: "./img/ap-logo-claro.svg", alt: "AP" }),
      el("div", { class: "sidebar-rodape-celular" }, ...acoes()),
    ),
    menu,
    el("div", { class: "sidebar-rodape" },
      el("span", { class: "quem", title: quem }, quem),
      el("div", { class: "acoes" }, ...acoes()),
    ),
  );
  setTimeout(() => {
    if (!menu.isConnected || !window.matchMedia("(max-width: 767px)").matches) return;
    const ativo = menu.querySelector(".menu-item.ativo");
    if (ativo) menu.scrollLeft = Math.max(0, ativo.offsetLeft - (menu.clientWidth - ativo.offsetWidth) / 2);
  }, 0);
  return el("div", { class: "app" },
    aside,
    el("main", { class: "conteudo", style: larguraMax ? "max-width:" + larguraMax : null },
      el("div", { class: "pagina" },
        el("div", {},
          el("h1", {}, titulo),
          subtitulo ? el("p", {}, subtitulo) : null,
        ),
      ),
      conteudo,
    ),
  );
}

const item = (rotulo, ativo, onclick, extra = "") => el("button", {
  class: "menu-item" + (ativo ? " ativo" : "") + extra,
  "aria-current": ativo ? "page" : null,
  onclick,
}, rotulo);

// ---------- Painel do administrador ----------
export function shellAdmin(user, ativa, conteudo) {
  const itens = [["clientes", "Clientes"], ["dashboard", "Visão consolidada"], ["oportunidade", "Oportunidades"]];
  return casca({
    itens: itens.map(([k, l]) => item(l, k === ativa, () => ir(hashAdmin(k)))),
    quem: user.email,
    acoes: () => [botaoSair()],
    titulo: ativa === "dashboard" ? "Visão consolidada" : TITULOS_SECAO[ativa] || "Painel",
    subtitulo: "Painel do assessor",
    conteudo,
  });
}

// ---------- Painel do cliente (também usado pelo administrador ao abrir um cliente) ----------
// ctx = { user, email, nome, modo: "cliente" | "admin", ano }
export function shellPortal(ctx, secao, conteudo) {
  const itens = [
    ["dashboard", "Visão do mês"],
    ["lancamento", "Lançamentos"],
    ["receitas", "Receitas e despesas"],
    ["patrimonio", "Patrimônio"],
    ["relatorio", "Relatório"],
    ["home", "Home Conect"],
  ];
  const voltar = ctx.modo === "admin"
    ? [item("← Clientes", false, () => ir(hashAdmin("clientes")), " menu-voltar")]
    : [];
  return casca({
    itens: [...voltar, ...itens.map(([k, l]) => item(l, k === secao, () => ir(hashCliente(ctx, k))))],
    quem: ctx.user.email,
    acoes: () => [botaoSair()],
    titulo: TITULOS_SECAO[secao] || "Painel",
    subtitulo: ctx.modo === "admin" ? "Cliente: " + ctx.nome : "Olá, " + ctx.nome,
    conteudo,
  });
}

// ---------- Janela de ferramenta (Home Conect) ----------
export function shellFerramenta(ctx, tipo, conteudo) {
  const secoes = [["dashboard", "Visão do mês"], ["lancamento", "Lançamentos"], ["receitas", "Receitas e despesas"], ["patrimonio", "Patrimônio"]];
  const ferramentas = [["open-finance", "Open Finance"], ["metas", "Plano de metas"], ["aposentadoria", "Aposentadoria"]];
  return casca({
    itens: [
      ctx.modo === "admin" ? item("← Clientes", false, () => ir(hashAdmin("clientes")), " menu-voltar") : null,
      ...secoes.map(([k, l]) => item(l, false, () => ir(hashCliente(ctx, k)))),
      el("div", { class: "menu-grupo" }, "Home Conect"),
      ...ferramentas.map(([k, l]) => item(l, k === tipo, () => ir(hashFerramenta(ctx, k)))),
    ].filter(Boolean),
    quem: ctx.nome,
    acoes: () => [el("button", { class: "light", onclick: () => window.close() }, "Fechar janela")],
    titulo: TITULOS_FERRAMENTA[tipo] || "Ferramenta",
    subtitulo: ctx.modo === "admin" ? "Cliente: " + ctx.nome : null,
    conteudo,
    larguraMax: "1100px",
  });
}
