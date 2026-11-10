// Conexões: cartões das ferramentas (abrem na mesma página) e tela do Open Finance.
import { el } from "../ui.js";
import { ir, hashFerramenta } from "../router.js";

export function abrirFerramenta(ctx, tipo) {
  ir(hashFerramenta(ctx, tipo));
}

export function telaHome(ctx) {
  const cartoes = [
    ["metas", "Plano de metas", "Defina objetivos financeiros e veja quanto poupar por mês para alcançá-los.", "Abrir plano de metas"],
    ["aposentadoria", "Planejamento de aposentadoria", "Estime o capital necessário e o aporte mensal para a renda desejada.", "Abrir planejamento"],
    ["open-finance", "Open Finance", "Conexão com contas bancárias para importar lançamentos e saldos.", "Ver detalhes", "Em breve"],
  ];
  return el("div", { class: "ferramentas" }, cartoes.map(([tipo, titulo, desc, acao, aviso]) =>
    el("section", { class: "card ferramenta" },
      el("div", {},
        el("h2", {}, titulo, aviso ? el("span", { class: "badge off" }, aviso) : null),
        el("p", { class: "muted" }, desc),
      ),
      el("button", { class: aviso ? "ghost" : null, onclick: () => abrirFerramenta(ctx, tipo) }, acao),
    )));
}

export function telaOpenFinance() {
  return el("section", { class: "card" },
    el("h2", {}, "Conexão com contas bancárias"),
    el("p", {}, "Em breve: conexão via Open Finance para importar lançamentos e saldos automaticamente."),
    el("p", { class: "muted" }, "Enquanto isso, os lançamentos continuam sendo feitos manualmente na aba Lançamentos."),
    el("button", { disabled: true }, "Conectar banco (em breve)"),
  );
}
