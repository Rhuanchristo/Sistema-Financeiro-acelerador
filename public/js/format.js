// Formatação e utilidades sem dependências (usadas também nos testes em Node).
export const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const ANO_ATUAL = new Date().getFullYear();

export const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pct = (v) => ((Number(v) || 0) * 100).toFixed(1).replace(".", ",") + "%";
export const fmtPct = (v) => String(Math.round((Number(v) || 0) * 10000) / 100).replace(".", ",");
export const emailKey = (e) => (e || "").trim().toLowerCase();
// Lê valores digitados no padrão brasileiro: "1.500", "1500,50", "R$ 1.500,00".
// Ponto seguido de grupos de 3 dígitos é separador de milhar; números já gravados passam direto.
export const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  return Number(s) || 0;
};
export const soma = (arr) => arr.reduce((s, v) => s + v, 0);

// ---------- Meses ("AAAA-MM") ----------
export function addMeses(ym, k) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
export const mesNome = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return MESES[m - 1] + "/" + y;
};
export const mesAtual = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
};
export function mesesEntre(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}
