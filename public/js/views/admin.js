// Painel do administrador: clientes, administradores e visão consolidada.
import {
  db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch,
  collectionGroup, query, orderBy, limit,
} from "../firebase.js";
import { brl, num, soma, emailKey, mesAtual } from "../format.js";
import { resumoAno, entidadeDe, projetar, PARAMS_APOSENT, PARAMETROS_PF } from "../calc.js";
import { carregarUsuarios, carregarParametros, excluirDadosUsuario, SUBCOLECOES_USUARIO } from "../data.js";
import { el, kpi, acao, abrirModal, toast } from "../ui.js";
import { ir, recarregar } from "../router.js";

const URL_SISTEMA = "https://dashboard-financeiro-faaa2.web.app";
const DIAS_SEM_ATIVIDADE = 30;

// Administrador abre o painel de um cliente.
export const abrirEditorUsuario = (u) => ir("#/cliente/" + encodeURIComponent(u.email) + "/dashboard");

// Agrupa um snapshot de collectionGroup por e-mail do dono (users/{email}/sub/{id}).
function agruparPorEmail(snap) {
  const mapa = new Map();
  snap.forEach((d) => {
    const dono = d.ref.parent.parent;
    if (!dono || !dono.parent || dono.parent.id !== "users") return;
    if (!mapa.has(dono.id)) mapa.set(dono.id, []);
    mapa.get(dono.id).push({ id: d.id, ...d.data() });
  });
  return mapa;
}

// Carrega de uma vez os dados de todos os clientes (consultas collectionGroup, só admin).
// Retorna [{ u, nome, patrimonio, lancamentos, projetos, metas, aposentadoria | null, parametros }].
export async function carregarConsolidado({ metas = false } = {}) {
  const comConfig = carregarUsuarios().then(async (usuarios) => {
    const [cfgs, params] = await Promise.all([
      Promise.all(usuarios.map((u) => getDoc(doc(db, "users", u.email, "config", "aposentadoria")))),
      Promise.all(usuarios.map((u) => carregarParametros(u.email))),
    ]);
    return usuarios.map((u, k) => ({ u, cfg: cfgs[k].exists() ? cfgs[k].data() : null, parametros: params[k] }));
  });
  const [lista, patSnap, lancSnap, projSnap, metasSnap] = await Promise.all([
    comConfig,
    getDocs(collectionGroup(db, "patrimonio")),
    getDocs(collectionGroup(db, "lancamentos")),
    getDocs(collectionGroup(db, "projetos")),
    metas ? getDocs(collectionGroup(db, "metas")) : null,
  ]);
  const pat = agruparPorEmail(patSnap);
  const lanc = agruparPorEmail(lancSnap);
  const proj = agruparPorEmail(projSnap);
  const met = metasSnap ? agruparPorEmail(metasSnap) : new Map();
  return lista.map(({ u, cfg, parametros }) => ({
    u,
    nome: u.nome || u.email,
    patrimonio: pat.get(u.email) || [],
    lancamentos: lanc.get(u.email) || [],
    projetos: proj.get(u.email) || [],
    metas: met.get(u.email) || [],
    aposentadoria: cfg,
    parametros,
  }));
}

export async function montarConsolidado(conteudo) {
  conteudo.replaceChildren(renderConsolidado(await carregarConsolidado()));
}

// ---------- Engajamento ----------
const paraData = (v) => {
  if (!v) return null;
  const d = typeof v.toDate === "function" ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Célula com a data e há quantos dias; destaca quando passou do limite ou não existe.
function celulaData(valor, textoVazio) {
  const d = paraData(valor);
  if (!d) return el("td", {}, el("span", { class: "badge off" }, textoVazio));
  const dias = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  const texto = d.toLocaleDateString("pt-BR") + (dias === 0 ? " (hoje)" : " (há " + dias + (dias === 1 ? " dia)" : " dias)"));
  return el("td", {}, dias > DIAS_SEM_ATIVIDADE
    ? el("span", { class: "badge off", title: "Mais de " + DIAS_SEM_ATIVIDADE + " dias" }, texto)
    : texto);
}

// Maior criadoEm dos lançamentos de cada cliente (uma consulta por cliente, em paralelo, com limit 1).
async function ultimosLancamentos(usuarios) {
  const snaps = await Promise.all(usuarios.map((u) =>
    getDocs(query(collection(db, "users", u.email, "lancamentos"), orderBy("criadoEm", "desc"), limit(1)))
      .catch((err) => { console.error(err); return null; })));
  const mapa = new Map();
  usuarios.forEach((u, k) => {
    const s = snaps[k];
    if (s && !s.empty) mapa.set(u.email, s.docs[0].data().criadoEm);
  });
  return mapa;
}

export async function montarClientes(user, conteudo) {
  const [usuarios, adminsSnap] = await Promise.all([
    carregarUsuarios(),
    getDocs(collection(db, "admins")),
  ]);
  const ultimoLanc = await ultimosLancamentos(usuarios);

  const admins = [];
  adminsSnap.forEach((d) => admins.push(d.id));

  const emailNovo = el("input", { type: "email", placeholder: "email@gmail.com", style: "min-width:260px" });
  const nomeNovo = el("input", { type: "text", placeholder: "Nome" });
  const emailAdmin = el("input", { type: "email", placeholder: "admin@gmail.com", style: "min-width:260px" });

  const tabelaUsuarios = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Nome"), el("th", {}, "E-mail"), el("th", {}, "Status"),
      el("th", {}, "Último acesso"), el("th", {}, "Último lançamento"), el("th", {}, ""),
    )),
    el("tbody", {}, usuarios.map((u) => el("tr", {},
      el("td", {}, u.nome || "—"),
      el("td", {}, u.email),
      el("td", {}, el("span", { class: u.ativo ? "badge" : "badge off" }, u.ativo ? "Ativo" : "Inativo")),
      celulaData(u.ultimoAcesso, "Nunca acessou"),
      celulaData(ultimoLanc.get(u.email), "Nenhum lançamento"),
      el("td", {}, el("div", { class: "row", style: "margin:0" },
        el("button", { class: "ghost", onclick: () => abrirEdicaoUsuario(u) }, "Editar"),
        el("button", { class: "ghost", onclick: () => abrirEditorUsuario(u) }, "Abrir painel"),
        el("button", {
          class: "ghost",
          onclick: async () => {
            await updateDoc(doc(db, "users", u.email), { ativo: !u.ativo });
            recarregar();
          },
        }, u.ativo ? "Desativar" : "Ativar"),
        el("a", {
          href: linkConvite(u),
          style: "display:inline-block;padding:8px 14px;border:1px solid var(--accent);border-radius:6px;color:var(--accent);text-decoration:none;font-size:14px",
        }, "Enviar convite"),
        el("button", { class: "danger", onclick: () => excluirUsuario(u) }, "Excluir"),
      )),
    ))),
  );

  const formNovoUsuario = el("div", { class: "row" },
    el("label", {}, "E-mail Google", emailNovo),
    el("label", {}, "Nome", nomeNovo),
    el("button", {
      onclick: (e) => acao(e.currentTarget, async () => {
        const key = emailKey(emailNovo.value);
        if (!key.includes("@")) return alert("Informe um e-mail válido.");
        await setDoc(doc(db, "users", key), {
          email: key,
          nome: nomeNovo.value.trim(),
          ativo: true,
          criadoEm: new Date().toISOString(),
        }, { merge: true });
        location.href = linkConvite({ email: key, nome: nomeNovo.value.trim() });
        recarregar();
      }),
    }, "Cadastrar usuário"),
  );

  const listaAdmins = el("ul", {}, admins.map((a) => el("li", {},
    a, " ",
    a !== emailKey(user.email) && el("button", {
      class: "ghost",
      style: "margin-left:8px;padding:2px 8px",
      onclick: async () => {
        if (!confirm("Remover " + a + " da lista de administradores?")) return;
        await deleteDoc(doc(db, "admins", a));
        recarregar();
      },
    }, "Remover"),
  )));

  const formNovoAdmin = el("div", { class: "row" },
    el("label", {}, "E-mail do novo administrador", emailAdmin),
    el("button", {
      onclick: (e) => acao(e.currentTarget, async () => {
        const key = emailKey(emailAdmin.value);
        if (!key.includes("@")) return alert("Informe um e-mail válido.");
        await setDoc(doc(db, "admins", key), { email: key, criadoEm: new Date().toISOString() });
        recarregar();
      }),
    }, "Adicionar admin"),
  );

  conteudo.replaceChildren(
    el("section", { class: "card" },
      el("h2", {}, "Usuários"),
      formNovoUsuario,
      el("div", { class: "scroll" }, tabelaUsuarios),
      usuarios.length === 0 && el("p", { class: "muted" }, "Nenhum usuário cadastrado ainda."),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Administradores"),
      listaAdmins,
      formNovoAdmin,
    ),
  );
}

// ---------- Edição de cadastro (nome e e-mail) ----------
// Trocar o e-mail move o cadastro e todos os dados para o novo e-mail. Copia tudo primeiro e só apaga
// o cadastro antigo depois que a cópia foi gravada, então um erro no meio não perde dados.
async function migrarEmail(antigo, novo, nome) {
  const destino = await getDoc(doc(db, "users", novo));
  if (destino.exists()) throw new Error("Já existe um usuário com o e-mail " + novo + ".");
  const origem = await getDoc(doc(db, "users", antigo));
  if (!origem.exists()) throw new Error("O cadastro antigo não existe mais. Recarregue a página.");

  const copias = [[doc(db, "users", novo), { ...origem.data(), email: novo, nome }]];
  const apagar = [doc(db, "users", antigo)];
  for (const sub of SUBCOLECOES_USUARIO) {
    const snap = await getDocs(collection(db, "users", antigo, sub));
    for (const d of snap.docs) {
      copias.push([doc(db, "users", novo, sub, d.id), d.data()]);
      apagar.push(d.ref);
    }
  }
  for (let i = 0; i < copias.length; i += 400) {
    const lote = writeBatch(db);
    for (const [ref, dados] of copias.slice(i, i + 400)) lote.set(ref, dados);
    await lote.commit();
  }
  for (let i = 0; i < apagar.length; i += 400) {
    const lote = writeBatch(db);
    for (const ref of apagar.slice(i, i + 400)) lote.delete(ref);
    await lote.commit();
  }
}

function abrirEdicaoUsuario(u) {
  const nome = el("input", { type: "text", value: u.nome || "", style: "min-width:260px" });
  const email = el("input", { type: "email", value: u.email, style: "min-width:260px" });
  const modal = abrirModal({ titulo: "Editar usuário", largura: 560 });
  const salvar = async () => {
    const novoNome = nome.value.trim();
    const novoEmail = emailKey(email.value);
    if (!novoEmail.includes("@")) return alert("Informe um e-mail válido.");
    const trocou = novoEmail !== u.email;
    if (trocou && !confirm("Trocar o e-mail de " + u.email + " para " + novoEmail + "? Todos os dados serão movidos. O cliente precisará entrar com o novo e-mail.")) return;
    try {
      if (trocou) await migrarEmail(u.email, novoEmail, novoNome);
      else await updateDoc(doc(db, "users", u.email), { nome: novoNome });
    } catch (err) {
      console.error(err);
      toast(err.message && err.message.startsWith("Já existe") ? err.message : "Não foi possível salvar. Nada foi apagado; tente de novo.", 6000);
      return;
    }
    toast("Cadastro atualizado.");
    modal.fechar();
    recarregar();
  };
  modal.trocar(
    el("div", { class: "row" },
      el("label", {}, "Nome", nome),
      el("label", {}, "E-mail Google", email),
    ),
    el("p", { class: "muted", style: "margin:12px 0 0" }, "Se corrigir o e-mail, todos os dados do cliente são movidos para o novo endereço."),
    el("div", { class: "row", style: "justify-content:flex-end;margin-top:16px" },
      el("button", { class: "ghost", onclick: () => modal.fechar() }, "Cancelar"),
      el("button", { onclick: (e) => acao(e.currentTarget, salvar) }, "Salvar"),
    ),
  );
}

// Exclui o usuário e todos os seus dados (lançamentos, patrimônio, metas, projetos e configuração).
async function excluirUsuario(u) {
  const nome = u.nome || u.email;
  if (!confirm("Excluir " + nome + "? Todos os lançamentos, o patrimônio, as metas e os projetos dele serão apagados. Esta ação não pode ser desfeita.")) return;
  try {
    await excluirDadosUsuario(u.email);
    recarregar();
  } catch (err) {
    console.error(err);
    alert("Não foi possível excluir o usuário. Tente novamente.");
  }
}

// Monta um e-mail pronto (abre no app de e-mail do administrador) com o convite de acesso.
function linkConvite(usuario) {
  const assunto = encodeURIComponent("Acesso ao seu painel Financeiro & Patrimônio");
  const corpo = encodeURIComponent(
    "Olá" + (usuario.nome ? ", " + usuario.nome : "") + "!\n\n" +
    "Seu acesso ao painel financeiro e patrimonial já está liberado.\n\n" +
    "Para entrar, acesse:\n" + URL_SISTEMA + "\n\n" +
    "Use a conta Google " + usuario.email + " para fazer login.\n\n" +
    "Qualquer dúvida, é só responder este e-mail."
  );
  return "mailto:" + usuario.email + "?subject=" + assunto + "&body=" + corpo;
}

// Visão consolidada de todos os clientes (painel do administrador).
function renderConsolidado(clientes) {
  const hoje = mesAtual();
  const ano = Number(hoje.slice(0, 4));
  const financeiro = [];
  const aposentadoria = [];
  for (const c of clientes) {
    const { nome, lancamentos: lancs, patrimonio: itens, projetos, aposentadoria: cfg, parametros } = c;
    financeiro.push({
      nome,
      emp: resumoAno(lancs.filter((l) => entidadeDe(l) === "empresa"), ano, parametros).totais,
      pf: resumoAno(lancs.filter((l) => entidadeDe(l) === "pessoa"), ano, PARAMETROS_PF).totais,
    });
    if (cfg || projetos.length > 0) {
      const p = { ...PARAMS_APOSENT, ...(cfg || {}) };
      const capital = soma(itens.filter((it) => it.categoria === "investimentos").map((it) => num(it.valor)));
      const res = projetar(p, projetos, capital, hoje);
      aposentadoria.push({ nome, p, projetos: projetos.length, res });
    }
  }

  const celNum = (v) => el("td", { class: "num" }, brl(v));
  const tot = (campo, grupo) => soma(financeiro.map((f) => f[grupo][campo]));
  const linhaTotal = el("tr", { class: "total" },
    el("td", {}, "Total"),
    celNum(tot("bruta", "emp")), celNum(tot("despesas", "emp")), celNum(tot("lucro", "emp")),
    celNum(tot("bruta", "pf")), celNum(tot("despesas", "pf")), celNum(tot("lucro", "pf")),
  );
  const tabelaFin = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Cliente"),
      el("th", { class: "num" }, "Receitas (empresa)"),
      el("th", { class: "num" }, "Despesas (empresa)"),
      el("th", { class: "num" }, "Lucro (empresa)"),
      el("th", { class: "num" }, "Receitas (pessoal)"),
      el("th", { class: "num" }, "Despesas (pessoal)"),
      el("th", { class: "num" }, "Lucro (pessoal)"),
    )),
    el("tbody", {},
      financeiro.map((f) => el("tr", {},
        el("td", {}, f.nome),
        celNum(f.emp.bruta), celNum(f.emp.despesas), celNum(f.emp.lucro),
        celNum(f.pf.bruta), celNum(f.pf.despesas), celNum(f.pf.lucro),
      )),
      linhaTotal,
    ),
  );

  const tabelaAp = aposentadoria.length === 0
    ? el("p", { class: "muted" }, "Nenhum planejamento de aposentadoria salvo ou com projetos cadastrados ainda.")
    : el("div", { class: "scroll" }, el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, "Cliente"),
          el("th", { class: "num" }, "Idade atual"),
          el("th", { class: "num" }, "Aposentadoria aos"),
          el("th", { class: "num" }, "Renda desejada"),
          el("th", { class: "num" }, "Capital ideal"),
          el("th", { class: "num" }, "Aporte mensal necessário"),
          el("th", { class: "num" }, "Projetos"),
        )),
        el("tbody", {}, aposentadoria.map((a) => el("tr", {},
          el("td", {}, a.nome),
          el("td", { class: "num" }, String(a.p.idadeAtual)),
          el("td", { class: "num" }, String(a.p.idadeAposentadoria)),
          celNum(a.p.rendaDesejada),
          celNum(a.res.idealRet),
          celNum(a.res.aporteNecessario),
          el("td", { class: "num" }, String(a.projetos)),
        ))),
      ));

  return el("div", {},
    renderPatrimonioConsolidado(clientes),
    el("section", { class: "card" },
      el("h2", {}, "Financeiro consolidado · " + ano),
      el("p", { class: "muted" }, "Receitas, despesas e lucro de cada cliente, separados entre empresa e pessoa física."),
      el("div", { class: "scroll" }, tabelaFin),
    ),
    el("section", { class: "card" },
      el("h2", {}, "Planejamento de aposentadoria"),
      el("p", { class: "muted" }, "Capital ideal e aporte mensal necessário, com base nos parâmetros e projetos de cada cliente."),
      tabelaAp,
    ),
  );
}

function renderPatrimonioConsolidado(clientes) {
  const linhas = [];
  const porInstituicao = {};
  for (const c of clientes) {
    const l = { nome: c.nome, imoveis: 0, veiculos: 0, empresas: 0, investimentos: 0, dividas: 0 };
    for (const it of c.patrimonio) {
      const v = num(it.valor);
      if (l[it.categoria] !== undefined) l[it.categoria] += v;
      if (it.categoria === "investimentos") {
        const inst = (it.instituicao || "").trim() || "Não informada";
        porInstituicao[inst] = (porInstituicao[inst] || 0) + v;
      }
    }
    linhas.push(l);
  }

  const somaCol = (k) => soma(linhas.map((l) => l[k]));
  const imobilizado = somaCol("imoveis") + somaCol("veiculos");
  const liquido = imobilizado + somaCol("empresas") + somaCol("investimentos") - somaCol("dividas");

  const colunas = [
    ["imoveis", "Imóveis"],
    ["veiculos", "Veículos"],
    ["empresas", "Empresas"],
    ["investimentos", "Investimentos (bancos)"],
    ["dividas", "Dívidas"],
  ];

  const tabela = el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Usuário"),
      colunas.map(([, rotulo]) => el("th", { class: "num" }, rotulo)),
      el("th", { class: "num" }, "Patrimônio líquido"),
    )),
    el("tbody", {},
      linhas.map((l) => el("tr", {},
        el("td", {}, l.nome),
        colunas.map(([k]) => el("td", { class: "num" }, brl(l[k]))),
        el("td", { class: "num" }, brl(l.imoveis + l.veiculos + l.empresas + l.investimentos - l.dividas)),
      )),
      el("tr", { class: "total" },
        el("td", {}, "Total"),
        colunas.map(([k]) => el("td", { class: "num" }, brl(somaCol(k)))),
        el("td", { class: "num" }, brl(liquido)),
      ),
    ),
  );

  const instituicoes = Object.entries(porInstituicao).sort((a, b) => b[1] - a[1]);
  const blocoInstituicoes = instituicoes.length === 0
    ? el("p", { class: "muted" }, "Nenhum investimento cadastrado ainda.")
    : el("div", { class: "scroll" },
        el("table", {},
          el("thead", {}, el("tr", {}, el("th", {}, "Instituição / custódia"), el("th", { class: "num" }, "Valor"))),
          el("tbody", {}, instituicoes.map(([nome, v]) => el("tr", {},
            el("td", {}, nome),
            el("td", { class: "num" }, brl(v)),
          ))),
        ),
      );

  return el("section", { class: "card" },
    el("h2", {}, "Visão consolidada"),
    el("p", { class: "muted" }, "Patrimônio imobilizado = imóveis + veículos. Empresas e participações são exibidas à parte."),
    el("div", { class: "kpis" },
      kpi("Patrimônio imobilizado", imobilizado),
      kpi("Investimentos em bancos (custódia)", somaCol("investimentos")),
      kpi("Empresas e participações", somaCol("empresas")),
      kpi("Dívidas", somaCol("dividas")),
      kpi("Patrimônio líquido total", liquido),
    ),
    el("div", { class: "scroll" }, tabela),
    el("h3", {}, "Investimentos por instituição"),
    blocoInstituicoes,
  );
}
