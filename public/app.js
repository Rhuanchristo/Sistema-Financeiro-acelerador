// Entrada do app: inicia o roteador (login, perfil e telas ficam em js/).
import { iniciar } from "./js/router.js";

// Gráficos com a tipografia e os tons da marca AP.
if (window.Chart) {
  Chart.defaults.font.family = '"Poppins", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = "#6E6A65";
  Chart.defaults.borderColor = "#ECE7DE";
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
}

iniciar();
