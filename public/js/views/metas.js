// Plano de metas (ferramenta em janela própria).
import { db, doc, addDoc, updateDoc, deleteDoc, collection } from "../firebase.js";
import { brl, num, addMeses, mesNome, mesAtual, mesesEntre } from "../format.js";
import { listar } from "../data.js";
import { el, kpi, acao, abrirModal, toast } from "../ui.js";
import { recarregar } from "../router.js";

// Executa uma gravação; se falhar mostra mensagem amigável e devolve false.
async function gravar(fn, msgErro) {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    toast(msgErro);
    return false;
  }
}

// Campo vazio vale zero; texto que não vira número (ex.: "abc") é inválido.
const valorValido = (txt) => {
  const s = String(txt ?? "").trim();
  return !s || num(s) !== 0 || /^[R$\s0.,]*$/i.test(s);
};

// Número para o campo de edição no padrão brasileiro (sem símbolo).
const paraCampo = (v) => (num(v) ? num(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

const selo = (texto, fundo, cor) =>
  el("span", { style: "background:" + fundo + ";color:" + cor + ";border-radius:99px;padding:2px 10px;font-size:12px;font-weight:600" }, texto);

function modalEditar(ctx, m) {
  const nome = el("input", { type: "text", value: m.nome || "", style: "min-width:220px" });
  const alvo = el("input", { type: "text", inputmode: "decimal", value: paraCampo(m.valorAlvo), class: "num", style: "width:140px" });
  const atual = el("input", { type: "text", inputmode: "decimal", value: paraCampo(m.valorAtual), class: "num", style: "width:140px" });
  const prazo = el("input", { type: "month", value: m.mesAlvo || "" });
  const modal = abrirModal({ titulo: "Editar meta", largura: 560 });

  const salvar = async () => {
    if (!nome.value.trim()) return alert("Informe o nome da meta.");
    if (!(num(alvo.value) > 0)) return alert("Informe um valor alvo maior que zero.");
    if (!valorValido(atual.value) || num(atual.value) < 0) return alert("Informe um valor acumulado válido.");
    if (!prazo.value) return alert("Informe o prazo.");
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "metas", m.id), {
      nome: nome.value.trim(),
      valorAlvo: num(alvo.value),
      valorAtual: num(atual.value),
      mesAlvo: prazo.value,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível salvar a meta. Verifique a conexão e tente novamente.");
    if (!ok) return;
    modal.fechar();
    recarregar();
  };

  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Meta", nome),
      el("label", {}, "Valor alvo", alvo),
      el("label", {}, "Já acumulado", atual),
      el("label", {}, "Prazo (mês)", prazo),
    ),
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Salvar alterações"),
    ),
  );
}

function modalAporte(ctx, m) {
  const valor = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", class: "num", style: "width:160px" });
  const modal = abrirModal({ titulo: "Registrar aporte", largura: 440 });

  const salvar = async () => {
    const v = num(valor.value);
    if (!(v > 0)) return alert("Informe um valor de aporte maior que zero.");
    if (!(num(m.valorAlvo) > 0)) return alert("Esta meta está sem valor alvo. Edite a meta antes de registrar o aporte.");
    const novo = Math.round((num(m.valorAtual) + v) * 100) / 100;
    const ok = await gravar(() => updateDoc(doc(db, "users", ctx.email, "metas", m.id), {
      valorAlvo: num(m.valorAlvo),
      valorAtual: novo,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: ctx.user.email,
    }), "Não foi possível registrar o aporte. Verifique a conexão e tente novamente.");
    if (!ok) return;
    modal.fechar();
    toast("Aporte de " + brl(v) + " registrado.");
    recarregar();
  };

  modal.trocar(
    el("p", { class: "muted" }, (m.nome || "Meta") + " · já acumulado " + brl(m.valorAtual)),
    el("label", {}, "Valor do aporte", valor),
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Registrar"),
    ),
  );
  valor.focus();
}

export async function telaMetas(ctx) {
  const metas = await listar(["users", ctx.email, "metas"]);
  const hoje = mesAtual();

  const nome = el("input", { type: "text", placeholder: "Ex.: Reserva de emergência", style: "min-width:220px" });
  const alvo = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", class: "num", style: "width:140px" });
  const atual = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00", class: "num", style: "width:140px" });
  const prazo = el("input", { type: "month", value: addMeses(hoje, 12) });

  const salvar = async () => {
    if (!nome.value.trim()) return alert("Informe o nome da meta.");
    if (!(num(alvo.value) > 0)) return alert("Informe o valor da meta.");
    if (!valorValido(atual.value) || num(atual.value) < 0) return alert("Informe um valor guardado válido.");
    if (!prazo.value) return alert("Informe o prazo.");
    const ok = await gravar(() => addDoc(collection(db, "users", ctx.email, "metas"), {
      nome: nome.value.trim(),
      valorAlvo: num(alvo.value),
      valorAtual: num(atual.value),
      mesAlvo: prazo.value,
      criadoEm: new Date().toISOString(),
      criadoPor: ctx.user.email,
    }), "Não foi possível criar a meta. Verifique a conexão e tente novamente.");
    if (ok) recarregar();
  };

  const cartoes = metas.map((m) => {
    const temPrazo = /^\d{4}-\d{2}$/.test(m.mesAlvo || "");
    const meses = temPrazo ? mesesEntre(hoje, m.mesAlvo) : 0;
    const vencida = temPrazo && meses < 0;
    const restantes = Math.max(1, meses);
    const falta = Math.max(0, num(m.valorAlvo) - num(m.valorAtual));
    const concluida = num(m.valorAlvo) > 0 && falta === 0;
    const progresso = num(m.valorAlvo) ? Math.min(1, num(m.valorAtual) / num(m.valorAlvo)) : 0;

    const excluir = async () => {
      if (!confirm("Excluir esta meta?")) return;
      const ok = await gravar(() => deleteDoc(doc(db, "users", ctx.email, "metas", m.id)),
        "Não foi possível excluir a meta. Tente novamente.");
      if (ok) recarregar();
    };

    let textoPrazo;
    if (!temPrazo) textoPrazo = "Sem prazo definido";
    else if (vencida) textoPrazo = "Prazo: " + mesNome(m.mesAlvo) + " · venceu há " + -meses + " mês(es)";
    else textoPrazo = "Prazo: " + mesNome(m.mesAlvo) + " · " + restantes + " mês(es) restantes";

    let terceiro;
    if (concluida) terceiro = kpi("Falta", 0);
    else if (vencida) terceiro = kpi("Falta (prazo vencido)", falta);
    else terceiro = kpi("Poupar por mês", falta / restantes);

    return el("section", { class: "card" },
      el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
        el("div", { class: "row", style: "align-items:center;gap:10px" },
          el("h2", { style: "margin:0" }, m.nome),
          concluida ? selo("Concluída", "#E3EBE6", "#2C4A3E") : null,
          !concluida && vencida ? selo("Prazo vencido", "#F3E1DF", "#B0413E") : null,
        ),
        el("div", { class: "row", style: "gap:8px" },
          el("button", { onclick: () => modalAporte(ctx, m) }, "Registrar aporte"),
          el("button", { class: "ghost", onclick: () => modalEditar(ctx, m) }, "Editar"),
          el("button", { class: "danger", onclick: (e) => acao(e.currentTarget, excluir) }, "Excluir"),
        ),
      ),
      el("p", { class: "muted" }, textoPrazo + " · " + Math.floor(progresso * 100) + "% concluído"),
      el("div", { style: "background:#ECE7DE;border-radius:99px;height:12px;overflow:hidden;margin:10px 0" },
        el("div", { style: "background:" + (vencida && !concluida ? "#B0413E" : "#2C4A3E") + ";height:100%;width:" + (progresso * 100).toFixed(1) + "%" }),
      ),
      el("div", { class: "kpis", style: "margin-bottom:0" },
        kpi("Valor alvo", m.valorAlvo),
        kpi("Já acumulado", m.valorAtual),
        terceiro,
      ),
    );
  });

  return el("div", {},
    el("section", { class: "card" },
      el("h2", {}, "Nova meta"),
      el("div", { class: "row" },
        el("label", {}, "Meta", nome),
        el("label", {}, "Valor alvo", alvo),
        el("label", {}, "Já tenho guardado", atual),
        el("label", {}, "Prazo (mês)", prazo),
        el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Criar meta"),
      ),
    ),
    metas.length === 0 ? el("p", { class: "muted" }, "Nenhuma meta criada ainda.") : cartoes,
  );
}
