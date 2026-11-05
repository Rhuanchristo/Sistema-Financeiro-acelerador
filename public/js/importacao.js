// Leitura de extratos e faturas e qualificação automática das compras.
// Funções puras: não acessam o Firestore nem a tela (por isso podem ser testadas no Node).

const RE_DATA_INICIO = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s|$)/;
const RE_VALOR_FIM = /(-?)\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*(CR|C|D)?\s*$/i;
const RE_VALOR_TEXTO = /^-?\s*R?\$?\s*-?\d{1,3}(?:\.\d{3})*,\d{2}\s*(CR|C|D)?$/i;

const pad = (n) => String(n).padStart(2, "0");
const iso = (ano, mes, dia) => ano + "-" + pad(mes) + "-" + pad(dia);

export function valorBR(txt) {
  return Number(String(txt).replace(/R\$|\$|\s/gi, "").replace(/\./g, "").replace(",", "."));
}

// Uma linha de texto (ex.: "10/11 UBER *TRIP 25,90" ou "05/11/2026 PAGAMENTO -1.200,00").
export function lerLinhaTexto(linha, anoPadrao) {
  const t = String(linha || "").replace(/\s+/g, " ").trim();
  const d = t.match(RE_DATA_INICIO);
  if (!d) return null;
  const resto = t.slice(d[0].length).trim();
  const v = resto.match(RE_VALOR_FIM);
  if (!v) return null;
  const descricao = resto.slice(0, resto.length - v[0].length).trim();
  if (!descricao) return null;
  const ano = d[3] ? (d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3])) : anoPadrao;
  const sufixo = (v[3] || "").toUpperCase();
  return {
    data: iso(ano, Number(d[2]), Number(d[1])),
    descricao,
    valor: Math.abs(valorBR(v[2])),
    negativo: v[1] === "-" || sufixo === "D",
    credito: sufixo === "CR" || sufixo === "C",
  };
}

// Data de uma célula: texto dd/mm(/aaaa), Date ou número serial do Excel.
function dataDaCelula(c, anoPadrao) {
  if (c instanceof Date && !isNaN(c)) return iso(c.getFullYear(), c.getMonth() + 1, c.getDate());
  if (typeof c === "number" && Number.isInteger(c) && c > 40000 && c < 60000) {
    const d = new Date(Math.round((c - 25569) * 86400000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(c ?? "").trim();
  const m = s.match(RE_DATA_INICIO);
  if (!m) return null;
  const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : anoPadrao;
  return iso(ano, Number(m[2]), Number(m[1]));
}

// Uma linha de planilha (CSV/Excel): acha a data, o valor e junta o resto como descrição.
export function lerLinhaPlanilha(celulas, anoPadrao) {
  let data = null;
  let valor = null;
  let negativo = false;
  let credito = false;
  const textos = [];
  for (const c of celulas || []) {
    if (c === null || c === undefined || c === "") continue;
    if (!data) {
      const d = dataDaCelula(c, anoPadrao);
      if (d) { data = d; continue; }
    }
    if (valor === null && typeof c === "number") { valor = c; continue; }
    const s = String(c).trim();
    if (valor === null && RE_VALOR_TEXTO.test(s)) {
      const v = s.match(RE_VALOR_FIM);
      if (v) {
        valor = valorBR(v[2]) * (v[1] === "-" ? -1 : 1);
        const sufixo = (v[3] || "").toUpperCase();
        credito = sufixo === "CR" || sufixo === "C";
        negativo = sufixo === "D";
        continue;
      }
    }
    textos.push(s);
  }
  const descricao = textos.join(" ").replace(/\s+/g, " ").trim();
  if (!data || valor === null || !descricao) return null;
  return { data, descricao, valor: Math.abs(valor), negativo: negativo || valor < 0, credito };
}

// Regras de qualificação: a primeira que combinar vence. "ignorar" marca pagamentos de fatura, que não são gasto.
const REGRAS = [
  [/pagamento (recebido|de fatura|da fatura|fatura|cart[aã]o)|pgto\.? ?(fatura|cart)|pagto\.? ?(fatura|cart)|pag\.? ?fatura/i, "Classificação neutra", "Pagamento de fatura", true],
  [/sal[aá]ri|pro.?labore|rendimento|dividendo|b[oô]nus|reembolso/i, "Renda", "Outras fontes de renda"],
  [/\bcdb\b|tesouro|aplica[cç]|resgate|\bfundo\b|corretora|\bctvm\b|\bb3\b/i, "Investimentos", "Aplicações"],
  [/juros|\biof\b|anuidade|tarifa|encargo|multa|rotativo/i, "Dívidas", "Juros e encargos"],
  [/financiamento|empr[eé]stimo|cons[oó]rcio/i, "Financiamentos", "Financiamento"],
  [/aluguel|condom[ií]nio|enel|cemig|\blight\b|sabesp|copasa|comgas|naturgy|internet|\bvivo\b|\bclaro\b|energia/i, "Despesas obrigatórias", "Moradia e contas"],
  [/supermerc|mercado|carrefour|p[aã]o de a[cç][uú]car|\bassai\b|atacad|hortifruti|sacol[aã]o|\bextra\b/i, "Despesas obrigatórias", "Mercado"],
  [/farm[aá]c|drogas|\braia\b|pague menos|hospital|cl[ií]nica|laborat|unimed|m[eé]dic|dentist|odont/i, "Despesas obrigatórias", "Saúde"],
  [/\buber\b|99 ?app|99pop|cabify|posto|combust|\bshell\b|ipiranga|estacion|ped[aá]gio|\bipva\b|detran/i, "Despesas obrigatórias", "Transporte"],
  [/escola|faculdade|col[eé]gio|mensalidade|\bcurso\b|udemy|alura|educa/i, "Despesas obrigatórias", "Educação"],
  [/ifood|rappi|restaur|lanch|padaria|pizza|burger|caf[eé]|\bbar\b|a[cç]a[ií]|sushi/i, "Despesas não obrigatórias", "Alimentação fora"],
  [/netflix|spotify|prime video|amazon prime|disney|youtube|\bhbo\b|apple\.com|google \*|academia|smart fit|bluefit|assinatura/i, "Despesas não obrigatórias", "Assinaturas e lazer"],
  [/cinema|\bshow\b|ingresso|viagem|hotel|airbnb|booking|latam|smiles|decolar|\bcvc\b/i, "Despesas não obrigatórias", "Lazer e viagem"],
  [/shopping|renner|riachuelo|\bzara\b|shein|magalu|magazine|mercado ?livre|amazon|shopee|aliexpress|c&a|centauro|leroy|tok ?stok/i, "Despesas não obrigatórias", "Compras"],
  [/\bpix\b|transfer|\bted\b|\bdoc\b/i, "Classificação neutra", "Transferências"],
];

export function qualificar(descricao) {
  const t = String(descricao || "");
  for (const [re, classificacao, categoria, ignorar] of REGRAS) {
    if (re.test(t)) return { classificacao, categoria, ignorar: !!ignorar };
  }
  return { classificacao: "Classificação neutra", categoria: "Outros", ignorar: false };
}

// Chave para comparar descrições (sem acento, caixa ou espaços extras).
export function chaveDescricao(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
