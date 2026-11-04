// Importação de extrato ou fatura de cartão: lê o arquivo (PDF, CSV ou Excel), qualifica cada compra
// e lança as selecionadas no mês escolhido. Nada é gravado antes da confirmação.
import { db, doc, collection, writeBatch } from "../firebase.js";
import { brl, num, mesAtual } from "../format.js";
import { el, abrirModal, acao, toast, campoMes } from "../ui.js";
import { recarregar } from "../router.js";
import { lerLinhaTexto, lerLinhaPlanilha, qualificar, chaveDescricao } from "../importacao.js";

const URL_PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
const URL_PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
const URL_XLSX = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const TAMANHO_LOTE = 450;

const carregados = new Map();
// Carrega uma biblioteca só quando precisa (evita pesar a tela de lançamentos).
function carregarScript(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!carregados.has(url)) {
    carregados.set(url, new Promise((ok, erro) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => (window[global] ? ok(window[global]) : erro(new Error("biblioteca indisponível")));
      s.onerror = () => erro(new Error("não foi possível carregar a leitura de arquivos; verifique a conexão"));
      document.head.appendChild(s);
    }));
  }
  return carregados.get(url);
}

// Texto de cada linha do PDF: agrupa os trechos pela altura (mesma linha) e ordena da esquerda para a direita.
async function lerPdfLinhas(arquivo) {
  const pdfjs = await carregarScript(URL_PDFJS, "pdfjsLib");
  pdfjs.GlobalWorkerOptions.workerSrc = URL_PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await arquivo.arrayBuffer(), disableFontFace: true }).promise;
  const linhas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const conteudo = await page.getTextContent();
    const itens = conteudo.items.map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5] }));
    itens.sort((a, b) => b.y - a.y || a.x - b.x);
    let alturaAtual = null;
    let texto = "";
    for (const it of itens) {
      if (alturaAtual === null || Math.abs(it.y - alturaAtual) > 2) {
        if (texto) linhas.push(texto);
        texto = it.s;
        alturaAtual = it.y;
      } else {
        texto += " " + it.s;
      }
    }
    if (texto) linhas.push(texto);
  }
  return linhas;
}

async function lerPlanilhaLinhas(arquivo) {
  const XLSX = await carregarScript(URL_XLSX, "XLSX");
  const livro = XLSX.read(await arquivo.arrayBuffer(), { type: "array", cellDates: true });
  const planilha = livro.Sheets[livro.SheetNames[0]];
  return XLSX.utils.sheet_to_json(planilha, { header: 1, raw: true, blankrows: false });
}

async function lerArquivo(arquivo, anoPadrao) {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith(".pdf")) {
    return (await lerPdfLinhas(arquivo)).map((l) => lerLinhaTexto(l, anoPadrao)).filter(Boolean);
  }
  if (/\.(csv|xlsx|xls)$/.test(nome)) {
    return (await lerPlanilhaLinhas(arquivo)).map((c) => lerLinhaPlanilha(c, anoPadrao)).filter(Boolean);
  }
  throw new Error("formato não suportado. Use PDF, CSV ou Excel.");
}

export function abrirImportacao(ctx, dados) {
  const modal = abrirModal({ titulo: "Importar extrato ou fatura", largura: 1040 });
  const historico = new Map();
  for (const l of dados.lancamentos) {
    const k = chaveDescricao(l.descricao);
    if (k && l.classificacao) historico.set(k, { classificacao: l.classificacao, categoria: l.categoria });
  }
  const fonte = el("select", {},
    el("option", { value: "fatura" }, "Fatura de cartão"),
    el("option", { value: "extrato" }, "Extrato de conta"),
  );
  const mes = campoMes(mesAtual());
  const quem = el("select", {},
    el("option", { value: "empresa" }, "Empresa"),
    el("option", { value: "pessoa", selected: true }, "Pessoa física"),
  );
  const arquivo = el("input", { type: "file", accept: ".pdf,.csv,.xlsx,.xls" });
  const status = el("p", { class: "muted" }, "Escolha o arquivo e clique em Ler arquivo. Nada é lançado antes da sua confirmação.");
  const resumo = el("p", { class: "muted", style: "margin:8px 0" });
  const area = el("div", { class: "scroll" });
  // Nomes das linhas do painel Receitas e despesas (um por tipo). A categoria digitada aqui precisa ser igual
  // ao nome da linha para o lançamento aparecer nela.
  const nomesDoPainel = (tipo) => [...new Set(dados.lancamentos
    .filter((l) => l.tipo === tipo).map((l) => String(l.categoria || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const opcoes = (nomes) => nomes.map((c) => el("option", { value: c }));
  const datalistReceitas = el("datalist", { id: "painel-receitas" }, opcoes(nomesDoPainel("receita")));
  const datalistDespesas = el("datalist", { id: "painel-despesas" }, opcoes(nomesDoPainel("despesa")));
  const listaDo = (tipo) => (tipo === "receita" ? "painel-receitas" : "painel-despesas");
  // Usa o nome exato da linha do painel quando ele existe (sem diferenciar maiúsculas e acentos).
  const nomeNoPainel = (nome, tipo) => nomesDoPainel(tipo).find((n) => chaveDescricao(n) === chaveDescricao(nome)) || nome;
  let linhas = [];

  // Marca ou desmarca todas as linhas de uma vez (entradas e saídas).
  const botaoTodas = el("button", { class: "ghost", type: "button" }, "Selecionar todos");
  const alternarTodas = () => {
    const todasMarcadas = linhas.length > 0 && linhas.every((r) => r.inputs.incluir.checked);
    for (const r of linhas) r.inputs.incluir.checked = !todasMarcadas;
    atualizarBotaoTodas();
    atualizarResumo();
  };
  const atualizarBotaoTodas = () => {
    const todasMarcadas = linhas.length > 0 && linhas.every((r) => r.inputs.incluir.checked);
    botaoTodas.textContent = todasMarcadas ? "Desmarcar todos" : "Selecionar todos";
  };
  botaoTodas.addEventListener("click", alternarTodas);

  const valorLinha = (r) => num(r.inputs.valor.value);
  const atualizarResumo = () => {
    atualizarBotaoTodas();
    const marcadas = linhas.filter((r) => r.inputs.incluir.checked);
    const entradas = marcadas.filter((r) => r.inputs.tipo.value === "receita").reduce((s, r) => s + valorLinha(r), 0);
    const saidas = marcadas.filter((r) => r.inputs.tipo.value === "despesa").reduce((s, r) => s + valorLinha(r), 0);
    resumo.textContent = marcadas.length + " selecionado(s) · Entradas: " + brl(entradas) + " · Saídas: " + brl(saidas);
  };

  const criarLinha = (it) => {
    const q = qualificar(it.descricao);
    const hist = historico.get(chaveDescricao(it.descricao));
    const entrada = fonte.value === "fatura" ? (it.negativo || it.credito) : (!it.negativo || it.credito);
    const existe = dados.lancamentos.some((l) => l.mesInicial === mes.value
      && Math.abs(num(l.valorTotal) - it.valor) < 0.005
      && chaveDescricao(l.descricao) === chaveDescricao(it.descricao));
    const incluir = !q.ignorar && !existe;
    const situacao = q.ignorar ? "Pagamento de fatura (fora do gasto)" : existe ? "Já lançado neste mês" : "Novo";
    const inputsDaLinha = {};
    const inputs = {
      incluir: el("input", { type: "checkbox", onchange: atualizarResumo }),
      desc: el("input", { type: "text", value: it.descricao, style: "min-width:200px" }),
      valor: el("input", { type: "text", inputmode: "decimal", value: it.valor.toFixed(2).replace(".", ","), class: "num", style: "width:110px" }),
      tipo: el("select", { onchange: () => { inputsDaLinha.cat.setAttribute("list", listaDo(inputsDaLinha.tipo.value)); atualizarResumo(); } },
        el("option", { value: "despesa", selected: !entrada }, "Saída"),
        el("option", { value: "receita", selected: entrada }, "Entrada"),
      ),
      cat: el("input", { type: "text", list: listaDo(entrada ? "receita" : "despesa"), value: hist ? hist.categoria : nomeNoPainel(q.categoria, entrada ? "receita" : "despesa"), placeholder: "Nome da linha no painel", style: "min-width:220px" }),
    };
    Object.assign(inputsDaLinha, inputs);
    inputs.incluir.checked = incluir;
    inputs.valor.addEventListener("input", atualizarResumo);
    return { data: it.data, situacao, grupo: hist ? hist.classificacao : q.classificacao, inputs };
  };

  const ler = async () => {
    const f = arquivo.files && arquivo.files[0];
    if (!f) return alert("Escolha um arquivo.");
    if (!mes.value) return alert("Escolha o mês de lançamento.");
    status.textContent = "Lendo o arquivo...";
    try {
      const itens = await lerArquivo(f, Number(mes.value.slice(0, 4)));
      linhas = itens.map(criarLinha);
      status.textContent = itens.length
        ? itens.length + " lançamento(s) encontrado(s). Confira a classificação antes de lançar."
        : "Nenhum lançamento reconhecido. Confira se o arquivo tem data e valor em cada linha.";
      desenhar();
    } catch (err) {
      console.error(err);
      status.textContent = "Não foi possível ler este arquivo: " + err.message;
    }
  };

  const desenhar = () => {
    if (linhas.length === 0) {
      area.replaceChildren();
      resumo.textContent = "";
      return;
    }
    area.replaceChildren(el("table", {},
      el("thead", {}, el("tr", {},
        el("th", {}, "Lançar"),
        el("th", {}, "Data"),
        el("th", {}, "Descrição"),
        el("th", { class: "num" }, "Valor"),
        el("th", {}, "Tipo"),
        el("th", {}, "Classificação (linha do painel)"),
        el("th", {}, "Situação"),
      )),
      el("tbody", {}, linhas.map((r) => el("tr", {},
        el("td", {}, r.inputs.incluir),
        el("td", { style: "white-space:nowrap" }, r.data.split("-").reverse().join("/")),
        el("td", {}, r.inputs.desc),
        el("td", { class: "num" }, r.inputs.valor),
        el("td", {}, r.inputs.tipo),
        el("td", {}, r.inputs.cat),
        el("td", { class: "muted" }, r.situacao),
      ))),
    ));
    atualizarResumo();
  };

  const lancar = async () => {
    const marcadas = linhas.filter((r) => r.inputs.incluir.checked);
    if (marcadas.length === 0) return alert("Marque pelo menos um lançamento.");
    for (const r of marcadas) {
      if (!(valorLinha(r) > 0)) return alert("Há um valor inválido em \"" + r.inputs.desc.value + "\".");
      if (!r.inputs.cat.value.trim()) return alert("Informe a categoria de \"" + r.inputs.desc.value + "\".");
    }
    const colecao = collection(db, "users", ctx.email, "lancamentos");
    const criadoEm = new Date().toISOString();
    let gravados = 0;
    try {
      for (let i = 0; i < marcadas.length; i += TAMANHO_LOTE) {
        const lote = writeBatch(db);
        for (const r of marcadas.slice(i, i + TAMANHO_LOTE)) {
          lote.set(doc(colecao), {
            tipo: r.inputs.tipo.value,
            categoria: r.inputs.cat.value.trim(),
            classificacao: r.grupo,
            descricao: r.inputs.desc.value.trim(),
            estabelecimento: r.inputs.desc.value.trim(),
            meioPagamento: fonte.value === "fatura" ? "Cartão de crédito" : "",
            data: r.data,
            valorTotal: valorLinha(r),
            mesInicial: mes.value,
            parcelas: 1,
            modo: "unico",
            entidade: quem.value,
            origemImportacao: fonte.value,
            criadoEm,
            criadoPor: ctx.user.email,
          });
        }
        await lote.commit();
        gravados += Math.min(TAMANHO_LOTE, marcadas.length - i);
      }
    } catch (err) {
      console.error(err);
      toast(gravados > 0
        ? "Parte dos lançamentos foi gravada (" + gravados + " de " + marcadas.length + "). Confira a lista antes de tentar de novo."
        : "Não foi possível lançar. Nada foi gravado; verifique a conexão e tente de novo.", 7000);
      if (gravados > 0) { modal.fechar(); recarregar(); }
      return;
    }
    toast(marcadas.length + " lançamento(s) importado(s).");
    modal.fechar();
    recarregar();
  };

  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Origem", fonte),
      el("label", {}, "Mês de lançamento", mes),
      el("label", {}, "Quem", quem),
    ),
    el("div", { class: "row", style: "align-items:center" },
      el("label", {}, "Arquivo (PDF, CSV ou Excel)", arquivo),
      el("button", { class: "ghost", onclick: (e) => acao(e.currentTarget, ler) }, "Ler arquivo"),
    ),
    status,
    el("div", { class: "row", style: "align-items:center;justify-content:space-between;margin:8px 0" }, resumo, botaoTodas),
    area,
    datalistReceitas,
    datalistDespesas,
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, lancar) }, "Lançar selecionados"),
    ),
  );
}
