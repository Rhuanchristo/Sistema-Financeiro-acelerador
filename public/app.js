// Entrada do app: inicia o roteador (login, perfil e telas ficam em js/).
import { iniciar } from "./js/router.js";
import { rotularTabelas } from "./js/ui.js";

// Tabelas são montadas e redesenhadas em vários pontos; um observador rotula todas para o layout de celular.
// O observador já agrupa as mudanças de cada ciclo; só mexe em atributos, então não dispara a si mesmo.
const raiz = document.getElementById("app");
new MutationObserver(() => rotularTabelas(raiz)).observe(raiz, { childList: true, subtree: true });

// Gráficos com a tipografia e os tons da marca AP.
if (window.Chart) {
  Chart.defaults.font.family = '"Poppins", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#6E6A65";
  Chart.defaults.borderColor = "#ECE7DE";
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
}

iniciar();
