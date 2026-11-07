// Crédito: cartas de consórcio do cliente (administradora, grupo, cota, crédito, dívida) com os pagamentos
// de cada parcela. Cada carta fica em users/{email}/consorcios/{id}; os pagamentos ficam dentro da carta.
// Pelas regras, só o administrador grava; o cliente vê em modo somente leitura.
import { db, doc, addDoc, updateDoc, deleteDoc, collection } from "../firebase.js";
import { brl, num } from "../format.js";
import { el, acao, abrirModal, toast } from "../ui.js";
import { recarregar } from "../router.js";

const GRADE_CARTAS = "display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px";

const soma = (lista) => lista.reduce((s, x) => s + num(x), 0);
const pctTxt = (v) => (Number(v) * 100).toFixed(1).replace(".", ",") + "%";
const dataBR = (v) => {
  const [a, m, d] = String(v || "").split("-");
  return a && m && d ? d + "/" + m + "/" + a : "—";
};
const hojeISO = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const campo = (v) => (num(v) ? num(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

// Totais de uma carta: pago = soma das parcelas registradas; falta = dívida menos o pago (nunca negativo).
function totaisCarta(c) {
  const pagamentos = Array.isArray(c.pagamentos) ? c.pagamentos : [];
  const pago = soma(pagamentos.map((p) => p.valor));
  const divida = num(c.valorDivida);
  return { pagamentos, pago, divida, falta: Math.max(0, divida - pago), quitado: divida > 0 && pago >= divida };
}

async function gravar(fn, msg) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    toast(msg);
    return false;
  }
}

// ---------- Formulários ----------
function modalCarta(ctx, c = {}) {
  const f = {
    adm: el("input", { type: "text", value: c.administradora || "", placeholder: "Ex.: Porto Seguro Consórcios" }),
    grupo: el("input", { type: "text", value: c.grupo || "", placeholder: "Ex.: 1234" }),
    cota: el("input", { type: "text", value: c.cota || "", placeholder: "Ex.: 0456" }),
    data: el("input", { type: "date", value: c.dataAquisicao || "" }),
    credito: el("input", { type: "text", inputmode: "decimal", value: campo(c.valorCredito), placeholder: "0,00" }),
    divida: el("input", { type: "text", inputmode: "decimal", value: campo(c.valorDivida), placeholder: "0,00" }),
  };
  const modal = abrirModal({ titulo: c.id ? "Editar carta de consórcio" : "Nova carta de consórcio", largura: 640 });
  const salvar = async () => {
    const administradora = f.adm.value.trim();
    if (!administradora) return alert("Informe a administradora.");
    const valorCredito = num(f.credito.value);
    const valorDivida = num(f.divida.value);
    if (!(valorCredito > 0)) return alert("Informe o valor do crédito.");
    if (valorDivida < 0) return alert("O valor da dívida não pode ser negativo.");
    const dados = {
      administradora,
      grupo: f.grupo.value.trim(),
      cota: f.cota.value.trim(),
      dataAquisicao: f.data.value || "",
      valorCredito,
      valorDivida,
      atualizadoEm: new Date().toISOString(),
    };
    const ok = c.id
      ? await gravar(() => updateDoc(doc(db, "users", ctx.email, "consorcios", c.id), { ...dados, atualizadoPor: ctx.user.email }),
        "Não foi possível salvar. Verifique a conexão e tente de novo.")
      : await gravar(() => addDoc(collection(db, "users", ctx.email, "consorcios"), { ...dados, pagamentos: [], criadoPor: ctx.user.email }),
        "Não foi possível adicionar. Verifique a conexão e tente de novo.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };
  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Administradora", f.adm),
      el("label", {}, "Grupo", f.grupo),
      el("label", {}, "Cota", f.cota),
      el("label", {}, "Data de aquisição", f.data),
      el("label", {}, "Valor do crédito", f.credito),
      el("label", {}, "Valor da dívida (total a pagar)", f.divida),
    ),
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, c.id ? "Salvar alterações" : "Adicionar"),
    ),
  );
}

function modalPagamento(ctx, c) {
  const data = el("input", { type: "date", value: hojeISO() });
  const valor = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00" });
  const obs = el("input", { type: "text", placeholder: "Opcional (ex.: parcela 12/120)" });
  const modal = abrirModal({ titulo: "Registrar pagamento", largura: 520 });
  const salvar = async () => {
    const v = num(valor.value);
    if (!data.value) return alert("Informe a data do pagamento.");
    if (!(v > 0)) return alert("Informe o valor pago.");
    const atuais = Array.isArray(c.pagamentos) ? c.pagamentos : [];
    const novos = [...atuais, { data: data.value, valor: v, obs: obs.value.trim() }];
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "consorcios", c.id), {
      pagamentos: novos,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível registrar o pagamento. Tente de novo.");
    if (!ok) return;
    toast("Pagamento registrado.");
    modal.fechar();
    recarregar();
  };
  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Data do pagamento", data),
      el("label", {}, "Valor pago", valor),
      el("label", {}, "Observação", obs),
    ),
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Registrar"),
    ),
  );
}

async function excluirCarta(ctx, c) {
  if (!confirm("Excluir a carta de " + (c.administradora || "consórcio") + " e todos os seus pagamentos?")) return;
  const ok = await gravar(() => deleteDoc(doc(db, "users", ctx.email, "consorcios", c.id)), "Não foi possível excluir. Tente novamente.");
  if (ok) recarregar();
}

async function excluirPagamento(ctx, c, indice) {
  if (!confirm("Excluir este pagamento?")) return;
  const novos = (c.pagamentos || []).filter((_, i) => i !== indice);
  const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "consorcios", c.id), {
    pagamentos: novos,
    atualizadoEm: new Date().toISOString(),
  }), "Não foi possível excluir o pagamento. Tente novamente.");
  if (ok) recarregar();
}

// ---------- Tela ----------
function kpi(rotulo, valor, sub, cor) {
  return el("div", { class: "inicio-kpi", style: "--cor:" + cor },
    el("span", {}, rotulo),
    el("strong", {}, valor),
    sub ? el("p", { class: "muted" }, sub) : null,
  );
}

function cartaCredito(ctx, c) {
  const t = totaisCarta(c);
  const ordenados = t.pagamentos.map((p, i) => ({ ...p, i })).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
  const barra = t.divida ? Math.min(100, (t.pago / t.divida) * 100) : 0;
  return el("section", { class: "card", style: "margin:0" },
    el("div", { style: "display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:flex-start" },
      el("div", {},
        el("h3", { style: "margin:0" }, c.administradora || "Carta de consórcio"),
        el("p", { class: "muted", style: "margin:4px 0 0" }, "Grupo " + (c.grupo || "—") + " · Cota " + (c.cota || "—") + " · Adquirida em " + dataBR(c.dataAquisicao)),
      ),
      ctx.modo === "admin"
        ? el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
          el("button", { class: "ghost", onclick: () => modalCarta(ctx, c) }, "Editar"),
          el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, () => excluirCarta(ctx, c)) }, "Excluir"),
        )
        : null,
    ),
    el("div", { class: "lanc-resumo", style: "margin:14px 0 10px" },
      kpi("Valor do crédito", brl(c.valorCredito), null, "#2C4A3E"),
      kpi("Valor da dívida", brl(t.divida), "Total a pagar na carta", "#B0413E"),
      kpi("Falta pagar", brl(t.falta), t.quitado ? "Quitada" : "Restante da dívida", "#C9A96E"),
    ),
    el("div", { style: "margin:4px 0 14px" },
      el("div", { class: "muted", style: "display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px" },
        el("span", {}, "Total já pago: " + brl(t.pago) + " (" + t.pagamentos.length + " pagamento(s))"),
        el("span", {}, pctTxt(t.divida ? t.pago / t.divida : 0)),
      ),
      el("div", { style: "height:10px;border-radius:999px;background:var(--areia);overflow:hidden" },
        el("div", { style: "height:100%;width:" + barra.toFixed(1) + "%;background:var(--verde);border-radius:999px" })),
    ),
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px" },
      el("strong", {}, "Pagamentos"),
      ctx.modo === "admin" ? el("button", { class: "ghost", onclick: () => modalPagamento(ctx, c) }, "+ Registrar pagamento") : null,
    ),
    ordenados.length
      ? el("ul", { class: "inicio-lista", style: "max-height:260px;overflow-y:auto" }, ordenados.map((p) =>
        el("li", {},
          el("div", {},
            el("strong", {}, dataBR(p.data)),
            el("span", { class: "muted" }, p.obs ? " · " + p.obs : ""),
          ),
          el("div", { class: "direita" },
            el("strong", {}, brl(p.valor)),
            ctx.modo === "admin" ? el("button", { class: "ghost", style: "margin-top:4px;padding:2px 8px", onclick: (e) => acao(e.currentTarget, () => excluirPagamento(ctx, c, p.i)) }, "Excluir") : null,
          ),
        )))
      : el("p", { class: "muted" }, "Nenhum pagamento registrado ainda."),
  );
}

// Página "Crédito" (sub-item de Meu Patrimônio).
export function telaCredito(ctx, cartas) {
  const lista = cartas || [];
  const totais = lista.map(totaisCarta);
  const creditoTotal = soma(lista.map((c) => c.valorCredito));
  const dividaTotal = soma(totais.map((t) => t.divida));
  const pagoTotal = soma(totais.map((t) => t.pago));
  const faltaTotal = soma(totais.map((t) => t.falta));

  return el("div", {},
    el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 6px" },
      el("h2", { style: "margin:0" }, "Cartas de consórcio"),
      ctx.modo === "admin" ? el("button", { onclick: () => modalCarta(ctx) }, "+ Adicionar carta") : null,
    ),
    el("p", { class: "muted", style: "margin:0 0 16px" }, "Cada carta mostra o crédito, a dívida, os pagamentos já feitos e o que ainda falta pagar."),
    lista.length
      ? el("div", {},
        el("div", { class: "lanc-resumo", style: "margin-bottom:16px" },
          kpi("Crédito total", brl(creditoTotal), lista.length + " carta(s)", "#2C4A3E"),
          kpi("Dívida total", brl(dividaTotal), "Total a pagar nas cartas", "#B0413E"),
          kpi("Falta pagar", brl(faltaTotal), "Já pago: " + brl(pagoTotal), "#C9A96E"),
        ),
        el("div", { style: GRADE_CARTAS }, lista.map((c) => cartaCredito(ctx, c))),
      )
      : el("p", { class: "muted" }, ctx.modo === "admin"
        ? "Nenhuma carta cadastrada. Use + Adicionar carta para registrar as cartas de consórcio do cliente."
        : "Nenhuma carta de consórcio cadastrada."),
  );
}
