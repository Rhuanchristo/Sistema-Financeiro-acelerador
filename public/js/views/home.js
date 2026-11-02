// Home Conect: cartões das ferramentas (abrem em nova janela) e tela do Open Finance.
import { el } from "../ui.js";
import { hashFerramenta } from "../router.js";

export function abrirFerramenta(ctx, tipo) {
  window.open(window.location.origin + "/" + hashFerramenta(ctx, tipo), "_blank", "noopener");
}

export function telaHome(ctx) {
  const cartoes = [
    ["open-finance", "Open Finance", "Conexão com contas bancárias para importar lançamentos e saldos.", "Em breve"],
    ["metas", "Plano de metas", "Defina objetivos financeiros e veja quanto poupar por mês para alcançá-los."],
    ["aposentadoria", "Planejamento de aposentadoria", "Estime o capital necessário e o aporte mensal para a renda desejada."],
  ];
  return el("div", {},
    el("p", { class: "muted" }, "Cada ferramenta abre em uma nova janela."),
    el("div", { class: "kpis" }, cartoes.map(([tipo, titulo, desc, aviso]) => el("section", { class: "card", style: "margin:0" },
      el("h2", {}, titulo),
      el("p", { class: "muted" }, desc),
      aviso ? el("p", {}, el("span", { class: "badge off" }, aviso)) : null,
      el("button", { onclick: () => abrirFerramenta(ctx, tipo) }, "Abrir em nova janela"),
    ))),
  );
}

export function telaOpenFinance() {
  return el("section", { class: "card" },
    el("h2", {}, "Conexão com contas bancárias"),
    el("p", {}, "Em breve: conexão via Open Finance para importar lançamentos e saldos automaticamente."),
    el("p", { class: "muted" }, "Enquanto isso, os lançamentos continuam sendo feitos manualmente na aba Lançamento."),
    el("button", { disabled: true }, "Conectar banco (em breve)"),
  );
}
