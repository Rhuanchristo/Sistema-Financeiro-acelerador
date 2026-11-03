// Cálculos puros e constantes de domínio. Sem Firebase e sem DOM (testável em Node).
import { num, soma, addMeses, mesesEntre } from "./format.js";
import { PARAMETROS_PADRAO } from "../firebase-config.js";

// Sugestões para o campo de categoria (o cliente também pode digitar uma nova).
export const SUGESTOES = {
  receita: ["ADMICON", "ONIL", "Consultoria", "Assessoria"],
  despesa: ["Contabilidade", "Condomínio", "Advogado", "Pró-labore", "Aluguel", "Internet", "Impostos", "Comissão"],
};

export const CATEGORIAS_PATRIMONIO = [
  ["imoveis", "Imóvel", "ativo"],
  ["veiculos", "Veículo", "ativo"],
  ["investimentos", "Investimento", "ativo"],
  ["empresas", "Empresa / participação", "ativo"],
  ["financiamento", "Financiamento", "divida"],
  ["dividas", "Empréstimo / dívida", "divida"],
  ["milhas", "Milhas", "ativo"],
];

// ---------- Lançamentos ----------
// Cada lançamento parcelado vira N linhas mensais. O último mês absorve os centavos.
export const entidadeDe = (l) => (l.entidade === "empresa" ? "empresa" : "pessoa");

export function expandirLancamentos(lista) {
  const linhas = [];
  for (const l of lista) {
    const n = Math.max(1, Number(l.parcelas) || 1);
    const total = num(l.valorTotal);
    const base = Math.floor((total * 100) / n) / 100;
    for (let i = 0; i < n; i++) {
      const valor = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
      linhas.push({ tipo: l.tipo, categoria: l.categoria, entidade: entidadeDe(l), mes: addMeses(l.mesInicial, i), valor });
    }
  }
  return linhas;
}

// Parâmetros sem impostos nem comissão (pessoa física).
export const PARAMETROS_PF = { impostoPct: 0, comissaoPct: 0 };

// Resumo mensal do ano. Impostos e comissão incidem só sobre a receita de lançamentos da
// EMPRESA; a parte de pessoa física fica sempre com 0%. params é opcional (padrão 10% e 10%).
export function resumoAno(lancamentos, ano, params = PARAMETROS_PADRAO) {
  const p = { ...PARAMETROS_PADRAO, ...(params || {}) };
  const impostoPct = num(p.impostoPct);
  const comissaoPct = num(p.comissaoPct);
  const linhas = expandirLancamentos(lancamentos).filter((r) => r.mes.startsWith(ano + "-"));
  const meses = Array.from({ length: 12 }, () => ({ receitas: {}, despesas: {}, bruta: 0, brutaEmpresa: 0, despesasTotal: 0 }));

  for (const r of linhas) {
    const m = meses[Number(r.mes.slice(5, 7)) - 1];
    if (r.tipo === "receita") {
      m.receitas[r.categoria] = (m.receitas[r.categoria] || 0) + r.valor;
      m.bruta += r.valor;
      if (r.entidade === "empresa") m.brutaEmpresa += r.valor;
    } else {
      m.despesas[r.categoria] = (m.despesas[r.categoria] || 0) + r.valor;
      m.despesasTotal += r.valor;
    }
  }

  // Caixa do mês = lucro; caixa acumulado = soma corrente do lucro no ano.
  let acumulado = 0;
  for (const m of meses) {
    m.impostos = m.brutaEmpresa * impostoPct;
    m.comissao = m.brutaEmpresa * comissaoPct;
    m.liquida = m.bruta - m.impostos - m.comissao;
    m.lucro = m.liquida - m.despesasTotal;
    m.margem = m.bruta ? m.lucro / m.bruta : 0;
    acumulado += m.lucro;
    m.caixaAcumulado = acumulado;
  }

  const catsR = [...new Set(linhas.filter((r) => r.tipo === "receita").map((r) => r.categoria))].sort();
  const catsD = [...new Set(linhas.filter((r) => r.tipo === "despesa").map((r) => r.categoria))].sort();
  const total = (k) => soma(meses.map((m) => m[k]));
  const totais = {
    bruta: total("bruta"),
    impostos: total("impostos"),
    comissao: total("comissao"),
    liquida: total("liquida"),
    despesas: total("despesasTotal"),
    lucro: total("lucro"),
  };
  totais.margem = totais.bruta ? totais.lucro / totais.bruta : 0;
  return { meses, catsR, catsD, totais, params: { impostoPct, comissaoPct } };
}

export function calcPatrimonio(itens) {
  let ativos = 0, dividas = 0;
  for (const it of itens) {
    const cat = CATEGORIAS_PATRIMONIO.find(([k]) => k === it.categoria);
    if (!cat) continue;
    if (cat[2] === "divida") dividas += num(it.valor);
    else ativos += num(it.valor);
  }
  return { ativos, dividas, liquido: ativos - dividas };
}

// ---------- Planejamento de aposentadoria ----------
export const TIPOS_PROJETO = [
  ["viagem", "Viagem"], ["veiculo", "Veículo"], ["casa", "Casa"], ["familia", "Família"],
  ["eletronico", "Eletrônico"], ["educacao", "Educação"], ["hobby", "Hobby"],
  ["profissional", "Profissional"], ["saude", "Saúde"], ["outro", "Outro"],
  ["ajuste", "Ajuste da meta"], ["aporte", "Aportes financeiros"],
];
export const PRIORIDADES_PROJETO = [["essencial", "Essencial"], ["desejo", "Desejo"], ["sonho", "Sonho"]];
export const REPETICOES = [["unica", "Única"], ["mensal", "Mensal"], ["anual", "Anual"], ["personalizado", "A cada N anos"]];
export const PARAMS_APOSENT = {
  idadeAtual: 35,
  idadeAposentadoria: 65,
  rendaDesejada: 10000,
  outrasRendas: 0,
  investimentoMensal: 0,
  rentabilidadeReal: 0.04,
};
export const IDADE_FINAL = 100;

export const nomeTipo = (k) => (TIPOS_PROJETO.find(([c]) => c === k) || [])[1] || k;
export const nomePrioridade = (k) => (PRIORIDADES_PROJETO.find(([c]) => c === k) || [])[1] || k;

export function descricaoForma(pr) {
  if (pr.aPrazo) return (pr.quantidade || 1) + "x parcelas mensais";
  if (!pr.repeticao || pr.repeticao === "unica") return "Única";
  const qtd = pr.quantidade || 1;
  if (pr.repeticao === "mensal") return qtd + "x mensal";
  if (pr.repeticao === "anual") return qtd + "x anual";
  return qtd + "x a cada " + (pr.intervaloAnos || 1) + " anos";
}

// Lista de [índice do mês relativo ao início, valor] de cada ocorrência do projeto.
export function ocorrenciasProjeto(pr, mesInicio, total) {
  const out = [];
  const base = mesesEntre(mesInicio, pr.dataExecucao || mesInicio);
  const qtd = Math.max(1, Math.floor(num(pr.quantidade)) || 1);
  const v = num(pr.valorTotal);
  if (pr.aPrazo) {
    const parcela = v / qtd;
    for (let k = 0; k < qtd; k++) {
      if (base + k >= 0 && base + k < total) out.push([base + k, parcela]);
    }
    return out;
  }
  const passo =
    pr.repeticao === "mensal" ? 1 :
    pr.repeticao === "anual" ? 12 :
    pr.repeticao === "personalizado" ? Math.max(1, Math.floor(num(pr.intervaloAnos)) || 1) * 12 : 0;
  const n = passo ? qtd : 1;
  for (let k = 0; k < n; k++) {
    const idx = base + k * passo;
    if (idx >= 0 && idx < total) out.push([idx, v]);
  }
  return out;
}

// Projeção mensal em termos reais. Aportes financeiros entram; os demais projetos saem.
export function projetar(p, projetos, capitalInicial, mesInicio) {
  const i = Math.pow(1 + num(p.rentabilidadeReal), 1 / 12) - 1;
  const total = Math.max(1, Math.round((IDADE_FINAL - num(p.idadeAtual)) * 12));
  const nRet = Math.min(total, Math.max(0, Math.round((num(p.idadeAposentadoria) - num(p.idadeAtual)) * 12)));
  const saque = Math.max(0, num(p.rendaDesejada) - num(p.outrasRendas));
  const aporte = Math.max(0, num(p.investimentoMensal));

  const mov = new Array(total).fill(0);
  const eventos = Array.from({ length: total }, () => []);
  for (const pr of projetos) {
    const sinal = pr.tipo === "aporte" ? 1 : -1;
    for (const [idx, v] of ocorrenciasProjeto(pr, mesInicio, total)) {
      mov[idx] += sinal * v;
      eventos[idx].push({ nome: pr.nome || nomeTipo(pr.tipo), tipo: pr.tipo, valor: sinal * v });
    }
  }

  // V[t]: capital necessário no início do mês t para cobrir saques e projetos até o fim.
  const V = new Array(total + 1).fill(0);
  for (let t = total - 1; t >= nRet; t--) {
    V[t] = (V[t + 1] + saque) / (1 + i) - mov[t];
  }
  const idealRet = Math.max(0, V[nRet]);

  // Aporte mensal necessário para o capital chegar a idealRet na aposentadoria.
  let fvAtual = capitalInicial * Math.pow(1 + i, nRet);
  for (let t = 0; t < nRet; t++) fvAtual += mov[t] * Math.pow(1 + i, nRet - t);
  const fatorAporte = nRet === 0 ? 0 : (i > 0 ? ((1 + i) * (Math.pow(1 + i, nRet) - 1)) / i : nRet);
  const aporteNecessario = nRet === 0 ? 0 : Math.max(0, (idealRet - fvAtual) / fatorAporte);

  const serie = { idade: [], mes: [], total: [], principal: [], ideal: [] };
  let cap = capitalInicial;
  let princ = capitalInicial;
  for (let t = 0; t <= total; t++) {
    serie.idade.push(num(p.idadeAtual) + t / 12);
    serie.mes.push(addMeses(mesInicio, t));
    serie.total.push(cap);
    serie.principal.push(princ);
    serie.ideal.push(t < nRet ? idealRet / Math.pow(1 + i, nRet - t) : V[t]);
    if (t === total) break;
    if (t < nRet) {
      const fluxo = aporte + mov[t];
      cap = (cap + fluxo) * (1 + i);
      princ += fluxo;
    } else {
      cap = (cap + mov[t]) * (1 + i) - saque;
      princ += mov[t] - saque;
    }
  }

  return { serie, idealRet, aporteNecessario, total, nRet, i, eventos, mov };
}
