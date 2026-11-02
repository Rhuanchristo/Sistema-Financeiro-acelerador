// Planejamento de aposentadoria (simulador + projetos), ferramenta em janela própria.
import { db, doc, getDoc, setDoc, addDoc, deleteDoc, collection } from "../firebase.js";
import { brl, num, soma, MESES, addMeses, mesNome, mesAtual } from "../format.js";
import {
  TIPOS_PROJETO, PRIORIDADES_PROJETO, REPETICOES, PARAMS_APOSENT, IDADE_FINAL,
  nomeTipo, nomePrioridade, descricaoForma, ocorrenciasProjeto, projetar,
} from "../calc.js";
import { carregarPatrimonio, listar } from "../data.js";
import { el, abrirModal, acao } from "../ui.js";
import { recarregar } from "../router.js";

let graficoSimulacao = null;

function desenharSimulacao(canvasId, res, horizonteAnos, mostrarNeg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  const H = horizonteAnos ? Math.min(res.total, horizonteAnos * 12) : res.total;
  const vis = (v) => (mostrarNeg ? v : Math.max(0, v));
  const idades = res.serie.idade.slice(0, H + 1);
  const NOME_EVENTOS = "Projetos e aportes";
  const ICONES = {
    viagem: "🏖️", veiculo: "🚗", casa: "🏠", familia: "👨‍👩‍👧", eletronico: "💻", educacao: "🎓",
    hobby: "🎨", profissional: "💼", saude: "🩺", outro: "📌", ajuste: "⚙️", aporte: "💰",
  };

  // Série em degraus: cada movimento vira um salto vertical no mês em que ocorre.
  const degraus = (valores, saltos) => {
    const pts = [];
    for (let k = 0; k <= H; k++) {
      const v = valores[k];
      const s = k < H ? (saltos[k] || 0) : 0;
      pts.push({ x: idades[k], y: vis(v) });
      if (s !== 0) pts.push({ x: idades[k], y: vis(v + s) });
    }
    return pts;
  };

  // Marcadores dos projetos e aportes, no topo de cada salto.
  const evList = [];
  for (let k = 0; k < H; k++) {
    const ev = res.eventos[k] || [];
    if (!ev.length) continue;
    const s = ev.reduce((a, e) => a + e.valor, 0);
    evList.push({ x: idades[k], y: vis(res.serie.total[k] + s), lista: ev, icone: ICONES[ev[0].tipo] || "📌" });
  }

  const iconesPlugin = {
    id: "iconesEventos",
    afterDatasetsDraw(chart) {
      const idx = chart.data.datasets.findIndex((d) => d.isEventos);
      if (idx < 0) return;
      const meta = chart.getDatasetMeta(idx);
      const c2 = chart.ctx;
      meta.data.forEach((pt, j) => {
        const ev = evList[j];
        if (!ev) return;
        c2.save();
        c2.beginPath();
        c2.arc(pt.x, pt.y - 24, 13, 0, Math.PI * 2);
        c2.fillStyle = "#ECE7DE";
        c2.fill();
        c2.lineWidth = 2;
        c2.strokeStyle = "#132721";
        c2.stroke();
        c2.font = "14px sans-serif";
        c2.textAlign = "center";
        c2.textBaseline = "middle";
        c2.fillStyle = "#2A2A2A";
        c2.fillText(ev.icone, pt.x, pt.y - 24);
        c2.beginPath();
        c2.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        c2.fillStyle = "#ffffff";
        c2.fill();
        c2.lineWidth = 2;
        c2.strokeStyle = "#132721";
        c2.stroke();
        c2.restore();
      });
    },
  };

  if (graficoSimulacao) graficoSimulacao.destroy();
  graficoSimulacao = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        { label: "Patrimônio total projetado", data: degraus(res.serie.total, res.mov), borderColor: "#C9A96E", backgroundColor: "rgba(201,169,110,0.30)", fill: "origin", pointRadius: 0, borderWidth: 3 },
        { label: "Patrimônio principal investido", data: degraus(res.serie.principal, res.mov), borderColor: "#2C4A3E", backgroundColor: "rgba(44,74,62,0.55)", fill: "origin", pointRadius: 0, borderWidth: 3 },
        { label: "Aposentadoria ideal", data: idades.map((x, k) => ({ x, y: vis(res.serie.ideal[k]) })), borderColor: "#B0815A", backgroundColor: "#B0815A", fill: false, pointRadius: 0, tension: 0.2 },
        { label: NOME_EVENTOS, data: evList.map((e) => ({ x: e.x, y: e.y })), borderColor: "#132721", backgroundColor: "#ffffff", showLine: false, pointRadius: 0, pointHoverRadius: 0, isEventos: true },
      ],
    },
    plugins: [iconesPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, filter: (item) => item.text !== NOME_EVENTOS } },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items[0].parsed.x;
              const k = Math.min(Math.max(0, Math.round((x - res.serie.idade[0]) * 12)), res.serie.mes.length - 1);
              return mesNome(res.serie.mes[k]) + ": " + Math.floor(x) + " anos";
            },
            label: (c) => {
              if (c.dataset.isEventos) {
                const ev = evList[c.dataIndex];
                return ev ? ev.lista.map((e) => (e.valor >= 0 ? "+ " : "− ") + e.nome + ": " + brl(Math.abs(e.valor))) : "";
              }
              return c.dataset.label + ": " + brl(c.parsed.y);
            },
          },
        },
      },
      scales: {
        x: { type: "linear", min: idades[0], max: idades[idades.length - 1], ticks: { stepSize: 5, callback: (v) => Math.round(v) }, title: { display: true, text: "Idade" } },
        y: { min: mostrarNeg ? undefined : 0, ticks: { callback: (v) => brl(v) } },
      },
    },
  });
}

// Retorna { tela, recalc }; recalc desenha o gráfico e deve rodar com a tela já no documento.
async function telaAposentadoria(ctx) {
  const [cfgSnap, patrimonio, projetos] = await Promise.all([
    getDoc(doc(db, "users", ctx.email, "config", "aposentadoria")),
    carregarPatrimonio(ctx.email),
    listar(["users", ctx.email, "projetos"]),
  ]);
  const p = { ...PARAMS_APOSENT, ...(cfgSnap.exists() ? cfgSnap.data() : {}) };
  const capitalInicial = soma(patrimonio.filter((it) => it.categoria === "investimentos").map((it) => num(it.valor)));
  const mesInicio = mesAtual();
  let horizonteAnos = null;
  let mostrarNeg = false;
  const canvasId = "grafico-aposentadoria";

  const resumo = el("p", { style: "font-size:17px;line-height:1.5;margin:0 0 12px" });

  const recalc = () => {
    const res = projetar(p, projetos, capitalInicial, mesInicio);
    resumo.replaceChildren(
      "Você precisa investir ", el("strong", {}, brl(res.aporteNecessario)),
      "/mês para chegar na sua aposentadoria ideal com ", el("strong", {}, brl(res.idealRet)), " acumulados.",
    );
    desenharSimulacao(canvasId, res, horizonteAnos, mostrarNeg);
  };

  const opcoesHoriz = [["2 anos", 2], ["5 anos", 5], ["10 anos", 10], ["Máximo", null]];
  const botoesHoriz = opcoesHoriz.map(([rotulo, anos]) => {
    const b = el("button", {
      class: "ghost",
      onclick: () => { horizonteAnos = anos; atualizarBotoes(); recalc(); },
    }, rotulo);
    b.dataset.anos = anos === null ? "max" : String(anos);
    return b;
  });
  const atualizarBotoes = () => {
    botoesHoriz.forEach((b) => {
      const ativo = (b.dataset.anos === "max" && horizonteAnos === null) || b.dataset.anos === String(horizonteAnos);
      b.style.background = ativo ? "#ECE7DE" : "transparent";
    });
  };
  atualizarBotoes();

  const toggleNeg = el("input", { type: "checkbox", checked: false });
  toggleNeg.addEventListener("change", () => { mostrarNeg = toggleNeg.checked; recalc(); });

  const slider = (rotulo, chave, min, max, passo, fmt) => {
    const valorEl = el("strong", {}, fmt(num(p[chave])));
    const range = el("input", { type: "range", min: String(min), max: String(max), step: String(passo), value: String(num(p[chave])), style: "width:100%" });
    const campo = el("input", { type: "number", min: "0", step: String(passo), value: String(num(p[chave])), style: "width:130px" });
    const aplicar = (v) => {
      p[chave] = v;
      valorEl.textContent = fmt(v);
      if (document.activeElement !== range) range.value = String(Math.min(max, Math.max(min, v)));
      if (document.activeElement !== campo) campo.value = String(v);
      recalc();
    };
    range.addEventListener("input", () => aplicar(Number(range.value)));
    campo.addEventListener("input", () => aplicar(Number(campo.value) || 0));
    return el("div", { style: "margin-bottom:18px" },
      el("div", { class: "row", style: "justify-content:space-between;margin:0 0 4px" }, el("span", {}, rotulo), valorEl),
      el("div", { class: "row", style: "margin:0;gap:8px;align-items:center" }, range, campo),
    );
  };

  const inputIdade = el("input", { type: "number", min: "1", max: "99", value: String(num(p.idadeAtual)), style: "width:120px" });
  inputIdade.addEventListener("input", () => { p.idadeAtual = Number(inputIdade.value) || 0; recalc(); });

  const inputRent = el("input", { type: "number", step: "0.1", value: (num(p.rentabilidadeReal) * 100).toFixed(2), style: "width:120px" });
  inputRent.addEventListener("input", () => { p.rentabilidadeReal = (Number(inputRent.value) || 0) / 100; recalc(); });

  const salvar = async () => {
    await setDoc(doc(db, "users", ctx.email, "config", "aposentadoria"), {
      idadeAtual: num(p.idadeAtual),
      idadeAposentadoria: num(p.idadeAposentadoria),
      rendaDesejada: num(p.rendaDesejada),
      outrasRendas: num(p.outrasRendas),
      investimentoMensal: num(p.investimentoMensal),
      rentabilidadeReal: num(p.rentabilidadeReal),
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });
    alert("Simulação salva.");
  };

  const topo = el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
    el("h2", { style: "margin:0" }, "Independência financeira"),
    el("label", { style: "flex-direction:row;align-items:center;gap:6px" }, toggleNeg, "Negativos"),
    el("div", { class: "row", style: "margin:0" }, botoesHoriz),
  );

  const cardSimulacao = el("section", { class: "card", style: "margin:0" },
    topo,
    resumo,
    el("div", { style: "position:relative;height:420px" }, el("canvas", { id: canvasId })),
  );

  const cardParametros = el("section", { class: "card", style: "margin:0" },
    el("h2", {}, "Parâmetros"),
    el("div", { class: "row", style: "margin:0 0 14px" }, el("label", {}, "Idade atual", inputIdade)),
    slider("Idade de aposentadoria", "idadeAposentadoria", 40, 90, 1, (v) => v + " anos"),
    slider("Renda desejada (mensal)", "rendaDesejada", 0, 100000, 500, brl),
    slider("Outras fontes de renda", "outrasRendas", 0, 50000, 500, brl),
    slider("Investimento mensal", "investimentoMensal", 0, 50000, 100, brl),
    el("div", { class: "row", style: "margin:0 0 14px" }, el("label", {}, "Rentabilidade real (% a.a.)", inputRent)),
    el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Salvar simulação"),
  );

  const grade = el("div", { style: "display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px;align-items:start" },
    cardSimulacao,
    cardParametros,
  );

  const totalMeses = Math.max(1, Math.round((IDADE_FINAL - num(p.idadeAtual)) * 12));
  const ocorrencias = [];
  for (const pr of projetos) {
    const sinal = pr.tipo === "aporte" ? 1 : -1;
    for (const [idx, v] of ocorrenciasProjeto(pr, mesInicio, totalMeses)) {
      ocorrencias.push({ idx, mes: addMeses(mesInicio, idx), nome: pr.nome || nomeTipo(pr.tipo), tipo: pr.tipo, valor: sinal * v });
    }
  }
  ocorrencias.sort((a, b) => a.idx - b.idx);
  const totalAportes = soma(ocorrencias.filter((o) => o.valor > 0).map((o) => o.valor));
  const totalSaidas = soma(ocorrencias.filter((o) => o.valor < 0).map((o) => -o.valor));

  const lista = projetos.slice().sort((a, b) => (a.dataExecucao || "").localeCompare(b.dataExecucao || ""));
  const tabelaProjetos = lista.length === 0
    ? el("p", { class: "muted" }, "Nenhum projeto cadastrado ainda.")
    : el("div", { class: "scroll" },
        el("table", {},
          el("thead", {}, el("tr", {},
            el("th", {}, "Projeto"), el("th", {}, "Tipo"), el("th", {}, "Prioridade"),
            el("th", {}, "Data"), el("th", { class: "num" }, "Valor"), el("th", {}, "Forma"), el("th", {}, ""),
          )),
          el("tbody", {}, lista.map((pr) => el("tr", {},
            el("td", {}, pr.nome),
            el("td", {}, nomeTipo(pr.tipo)),
            el("td", {}, nomePrioridade(pr.prioridade)),
            el("td", {}, pr.dataExecucao ? mesNome(pr.dataExecucao) : "—"),
            el("td", { class: "num" }, brl(pr.valorTotal)),
            el("td", {}, descricaoForma(pr) + " · " + ocorrenciasProjeto(pr, mesInicio, totalMeses).length + " lançamento(s)"),
            el("td", {}, el("button", {
              class: "danger",
              onclick: async () => {
                if (!confirm("Excluir este projeto?")) return;
                await deleteDoc(doc(db, "users", ctx.email, "projetos", pr.id));
                recarregar();
              },
            }, "Excluir")),
          ))),
        ),
      );

  const cronograma = ocorrencias.length === 0
    ? el("p", { class: "muted" }, "Nenhum lançamento provisionado.")
    : el("div", {},
        el("h3", {}, "Lançamentos provisionados no planejamento"),
        el("p", { class: "muted" }, "Total de aportes: " + brl(totalAportes) + " · Total de saídas: " + brl(totalSaidas) + " · " + ocorrencias.length + " lançamento(s)"),
        el("div", { class: "scroll", style: "max-height:360px;overflow:auto" },
          el("table", {},
            el("thead", {}, el("tr", {}, el("th", {}, "Mês"), el("th", {}, "Projeto"), el("th", {}, "Tipo"), el("th", { class: "num" }, "Movimento"))),
            el("tbody", {}, ocorrencias.map((o) => el("tr", {},
              el("td", {}, mesNome(o.mes)),
              el("td", {}, o.nome),
              el("td", {}, nomeTipo(o.tipo)),
              el("td", { class: "num", style: o.valor > 0 ? "color:#2C4A3E" : "color:#B0413E" }, (o.valor > 0 ? "+ " : "− ") + brl(Math.abs(o.valor))),
            ))),
          ),
        ),
      );

  const cardProjetos = el("section", { class: "card" },
    el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
      el("h2", { style: "margin:0" }, "Objetivos e projetos"),
      el("button", { onclick: () => abrirModalProjeto(ctx) }, "Novo projeto"),
    ),
    el("p", { class: "muted" },
      "Projetos de outros tipos saem do patrimônio na data informada. Aportes financeiros entram no patrimônio e funcionam como salto patrimonial.",
    ),
    tabelaProjetos,
    cronograma,
  );

  return { tela: el("div", {}, grade, cardProjetos), recalc };
}

function abrirModalProjeto(ctx) {
  const f = {
    prioridade: "essencial",
    tipo: "viagem",
    nome: "",
    dataExecucao: mesAtual(),
    valorTotal: "",
    aPrazo: false,
    repeticao: "unica",
    quantidade: "1",
    intervaloAnos: "3",
  };
  const modal = abrirModal({ largura: 720 });
  const fechar = modal.fechar;
  const botao = (ativo, rotulo, onclick) => el("button", { class: ativo ? "" : "ghost", onclick }, rotulo);

  const salvarProjeto = async () => {
    const valor = num(f.valorTotal);
    const qtd = Math.floor(num(f.quantidade)) || 1;
    const intervalo = Math.floor(num(f.intervaloAnos)) || 1;
    if (!f.nome.trim()) return alert("Informe o nome do projeto.");
    if (!(valor > 0)) return alert("Informe o valor total.");
    if (!/^\d{4}-\d{2}$/.test(f.dataExecucao) || Number(f.dataExecucao.slice(0, 4)) < 2000) return alert("Informe o mês e o ano de execução.");
    if (qtd < 1 || qtd > 360) return alert("A quantidade deve estar entre 1 e 360.");
    if (!f.aPrazo && f.repeticao === "personalizado" && (intervalo < 1 || intervalo > 50)) {
      return alert("O intervalo deve estar entre 1 e 50 anos.");
    }
    await addDoc(collection(db, "users", ctx.email, "projetos"), {
      prioridade: f.prioridade,
      tipo: f.tipo,
      nome: f.nome.trim(),
      dataExecucao: f.dataExecucao,
      valorTotal: valor,
      aPrazo: f.aPrazo,
      repeticao: f.aPrazo ? "unica" : f.repeticao,
      intervaloAnos: f.repeticao === "personalizado" ? intervalo : null,
      quantidade: qtd,
      criadoEm: new Date().toISOString(),
      criadoPor: ctx.user.email,
    });
    fechar();
    recarregar();
  };

  const desenhar = () => {
    const inputNome = el("input", { type: "text", value: f.nome, placeholder: "Ex.: Viagem para a Europa", style: "min-width:260px" });
    inputNome.addEventListener("input", () => { f.nome = inputNome.value; });

    const [anoIni, mesIni] = f.dataExecucao.split("-");
    const selMes = el("select", {}, MESES.map((m, i) => {
      const v = String(i + 1).padStart(2, "0");
      return el("option", { value: v, selected: mesIni === v }, m);
    }));
    const inputAno = el("input", { type: "number", min: "2000", max: "2100", value: anoIni, style: "width:110px" });
    const atualizaData = () => { f.dataExecucao = inputAno.value + "-" + selMes.value; };
    selMes.addEventListener("change", atualizaData);
    inputAno.addEventListener("input", atualizaData);

    const inputValor = el("input", { type: "text", inputmode: "decimal", value: f.valorTotal, placeholder: "R$ 0,00", style: "min-width:200px" });
    inputValor.addEventListener("input", () => { f.valorTotal = inputValor.value; });

    const selRep = el("select", { disabled: f.aPrazo }, REPETICOES.map(([v, r]) => el("option", { value: v, selected: f.repeticao === v }, r)));
    selRep.addEventListener("change", () => { f.repeticao = selRep.value; desenhar(); });

    const inputQtd = el("input", { type: "number", min: "1", value: f.quantidade, style: "width:120px" });
    inputQtd.addEventListener("input", () => { f.quantidade = inputQtd.value; });

    const inputIntervalo = el("input", { type: "number", min: "1", max: "50", value: f.intervaloAnos, style: "width:120px" });
    inputIntervalo.addEventListener("input", () => { f.intervaloAnos = inputIntervalo.value; });

    const mostrarIntervalo = !f.aPrazo && f.repeticao === "personalizado";

    modal.trocar(
      el("div", { class: "row", style: "justify-content:space-between;align-items:center" },
        el("h2", { style: "margin:0" }, "Novo projeto"),
        el("button", { class: "ghost", onclick: fechar }, "Fechar"),
      ),
      el("h3", {}, "Prioridade do projeto"),
      el("div", { class: "row", style: "margin:0 0 14px" },
        PRIORIDADES_PROJETO.map(([v, r]) => botao(f.prioridade === v, r, () => { f.prioridade = v; desenhar(); })),
      ),
      el("h3", {}, "Tipo do projeto"),
      el("div", { class: "row", style: "margin:0 0 14px" },
        TIPOS_PROJETO.map(([v, r]) => botao(f.tipo === v, r, () => { f.tipo = v; desenhar(); })),
      ),
      el("div", { class: "row" },
        el("label", {}, "Nome do projeto", inputNome),
        el("label", {}, "Mês e ano de execução", el("div", { class: "row", style: "margin:0;gap:8px" }, selMes, inputAno)),
        el("label", {}, "Valor total", inputValor),
      ),
      el("h3", {}, "Projeto a prazo (parcelado)"),
      el("div", { class: "row", style: "margin:0 0 14px" },
        botao(!f.aPrazo, "Não", () => { f.aPrazo = false; desenhar(); }),
        botao(f.aPrazo, "Sim", () => { f.aPrazo = true; desenhar(); }),
      ),
      el("div", { class: "row" },
        el("label", {}, "Repetição", selRep),
        mostrarIntervalo ? el("label", {}, "Intervalo (anos)", inputIntervalo) : null,
        el("label", {}, f.aPrazo ? "Número de parcelas mensais" : "Quantidade de repetições", inputQtd),
      ),
      el("p", { class: "muted" }, f.aPrazo
        ? "O valor total é dividido igualmente nas parcelas mensais, a partir do mês informado."
        : "O valor total é o de cada ocorrência. Repetição mensal, anual ou a cada N anos repete o valor pelo número de repetições informado."),
      el("div", { class: "row" }, el("button", { onclick: (e) => acao(e.currentTarget, salvarProjeto) }, "Salvar projeto")),
    );
  };

  desenhar();
}

// Monta a tela no slot e desenha o gráfico (o canvas precisa estar no documento).
export async function montarAposentadoria(ctx, slot) {
  const { tela, recalc } = await telaAposentadoria(ctx);
  slot.replaceChildren(tela);
  if (slot.isConnected) recalc();
}
