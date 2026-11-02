// Helpers de interface: montagem de DOM, troca de tela, modal, toast e ações com botão.
import { brl } from "./format.js";

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function setView(node) {
  document.getElementById("app").replaceChildren(node);
}

export function kpi(rotulo, valor, fmt = brl) {
  return el("div", { class: "kpi" }, el("span", {}, rotulo), el("strong", {}, fmt(valor)));
}

// Modal reutilizável. Retorna { fechar, trocar(...nós), card }.
// "trocar" substitui o conteúdo (útil para modais que se redesenham).
// Fecha com Esc e com clique fora; o foco fica preso dentro e volta ao elemento de origem ao fechar.
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let idModal = 0;
const pilhaModais = []; // só o modal do topo responde ao teclado

function focaveisEm(raiz) {
  return [...raiz.querySelectorAll(FOCAVEIS)].filter((n) => n.offsetParent !== null || n === document.activeElement);
}

export function abrirModal({ titulo, conteudo = [], largura = 640, aoFechar } = {}) {
  const origem = document.activeElement;
  const idTitulo = "modal-titulo-" + (++idModal);
  const overlay = el("div", { class: "modal-fundo", style: "position:fixed;inset:0;background:rgba(19,39,33,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px" });
  const card = el("div", {
    class: "modal-card",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titulo ? idTitulo : null,
    tabindex: "-1",
    style: "background:#fff;border-radius:12px;max-width:" + largura + "px;width:100%;max-height:92vh;overflow:auto;padding:24px;outline:none",
  });
  let aberto = true;
  const fechar = () => {
    if (!aberto) return;
    aberto = false;
    const i = pilhaModais.indexOf(card);
    if (i >= 0) pilhaModais.splice(i, 1);
    document.removeEventListener("keydown", teclado, true);
    overlay.remove();
    if (origem && origem.isConnected && typeof origem.focus === "function") origem.focus();
    if (aoFechar) aoFechar();
  };
  // Esc fecha; Tab e Shift+Tab circulam só entre os elementos do modal.
  function teclado(e) {
    if (!overlay.isConnected) return fechar();
    if (pilhaModais[pilhaModais.length - 1] !== card) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fechar();
      return;
    }
    if (e.key !== "Tab") return;
    const lista = focaveisEm(card);
    if (!lista.length) { e.preventDefault(); card.focus(); return; }
    const primeiro = lista[0], ultimo = lista[lista.length - 1];
    const atual = document.activeElement;
    if (e.shiftKey && (atual === primeiro || !card.contains(atual))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (atual === ultimo || !card.contains(atual))) { e.preventDefault(); primeiro.focus(); }
  }
  // Clique fora fecha (só quando o clique começa e termina no fundo, para não fechar ao arrastar uma seleção).
  let cliqueNoFundo = false;
  overlay.addEventListener("mousedown", (e) => { cliqueNoFundo = e.target === overlay; });
  overlay.addEventListener("click", (e) => {
    if (cliqueNoFundo && e.target === overlay) fechar();
    cliqueNoFundo = false;
  });
  const focarPrimeiro = () => {
    const campo = card.querySelector('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');
    const alvo = (campo && campo.offsetParent !== null) ? campo : focaveisEm(card)[0];
    (alvo || card).focus();
  };
  const trocar = (...nos) => {
    const tinhaFoco = card.contains(document.activeElement);
    card.replaceChildren(...[titulo ? el("h2", { id: idTitulo }, titulo) : null, ...nos.flat()].filter((n) => n !== null && n !== undefined && n !== false));
    // Se o elemento focado sumiu no redesenho, o foco volta para dentro do modal.
    if (aberto && overlay.isConnected && (tinhaFoco || document.activeElement === document.body) && !card.contains(document.activeElement)) focarPrimeiro();
  };
  trocar(conteudo);
  overlay.append(card);
  document.body.append(overlay);
  pilhaModais.push(card);
  document.addEventListener("keydown", teclado, true);
  focarPrimeiro();
  return { fechar, trocar, card };
}

// Mensagem curta no canto da tela, some sozinha.
export function toast(msg, ms = 4000) {
  const t = el("div", {
    role: "status",
    "aria-live": "polite",
    style: "position:fixed;left:50%;bottom:max(24px, calc(env(safe-area-inset-bottom) + 12px));transform:translateX(-50%);background:#132721;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:90vw",
  }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// Desabilita o botão, executa fn, mostra erro amigável se falhar e reabilita.
export async function acao(botao, fn) {
  if (botao && botao.disabled) return;
  if (botao) botao.disabled = true;
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    toast("Não foi possível concluir a operação. Tente novamente.");
  } finally {
    if (botao) botao.disabled = false;
  }
}
