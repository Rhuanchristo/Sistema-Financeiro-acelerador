# Financeiro & Patrimônio

Sistema web com login Google, painel do administrador e painel do cliente, baseado na planilha financeira usada pela consultoria.
HTML + JavaScript puro (ES modules nativos, sem build), Firebase Auth + Firestore, hospedado no Firebase Hosting.

## Estrutura

Tudo o que vai para o ar fica em `public/` (é a pasta publicada pelo Hosting).

| Arquivo | Função |
|---|---|
| `public/index.html` | Página principal e estilos |
| `public/app.js` | Entrada: só inicia o roteador |
| `public/firebase-config.js` | Configuração do projeto Firebase (não é segredo; a segurança vem das regras) |
| `public/js/firebase.js` | Inicializa Firebase (usa os emuladores em localhost) e reexporta as funções usadas. Os outros módulos importam Firebase só daqui |
| `public/js/format.js` | Formatação e meses: `brl`, `pct`, `num` (valores no padrão brasileiro), `addMeses`, `mesNome`... |
| `public/js/calc.js` | Cálculos puros (resumo do ano, patrimônio, projeção de aposentadoria) e constantes. Sem DOM e sem Firebase, pode ser testado em Node |
| `public/js/data.js` | Leitura de dados no Firestore e exclusão completa de um usuário |
| `public/js/ui.js` | `el` (monta DOM), `setView`, `kpi`, `abrirModal`, `toast`, `acao` |
| `public/js/router.js` | Roteador por hash e resolução do perfil (admin / cliente / sem acesso) |
| `public/js/layout.js` | Cabeçalho e menu lateral do admin, do cliente e da janela de ferramenta |
| `public/js/views/` | Uma tela por arquivo: login, dashboard, lançamento, receitas, patrimônio, home, metas, aposentadoria, admin, oportunidade, relatório |
| `firestore.rules` | Regras de acesso ao Firestore |
| `firebase.json` | Configuração de deploy (Firestore e Hosting) e dos emuladores |
| `emulador/` | Scripts para rodar tudo localmente |

## Rotas

Toda navegação é feita pelo hash da URL (o botão Voltar e o F5 funcionam):

- Cliente: `#/dashboard`, `#/lancamento`, `#/receitas`, `#/patrimonio`, `#/home`, `#/relatorio`
- Administrador: `#/admin/clientes`, `#/admin/dashboard`, `#/admin/oportunidade`
- Administrador vendo um cliente: `#/cliente/{e-mail codificado}/{seção}`
- Ferramentas do Conexões (abrem na mesma página): `#/metas`, `#/aposentadoria`, `#/open-finance`; o administrador usa `#/cliente/{e-mail}/{ferramenta}`. Links antigos `#/ferramenta/...` são redirecionados.

No código, navegue com `ir(hash)` e redesenhe a tela atual com `recarregar()` (ambos em `js/router.js`).

## Perfis

- **Administrador:** vê todos os clientes, abre o painel de qualquer um e edita. Administradores ficam na coleção `admins`.
- **Cliente:** vê e lança apenas os próprios dados. Clientes ficam na coleção `users`, identificados pelo e-mail Google.

## Dados principais (Firestore)

- `users/{email}/lancamentos`: receitas e despesas. Cada mês é um lançamento próprio, com `entidade` (`empresa` ou `pessoa`).
- `users/{email}/patrimonio`: imóveis, veículos, investimentos, empresas e dívidas.
- `users/{email}/metas`: plano de metas.
- `users/{email}/projetos`: objetivos e aportes usados no planejamento de aposentadoria.
- `users/{email}/config/aposentadoria`: parâmetros da simulação.

Ao criar uma subcoleção nova em `users/{email}`, inclua o nome em `SUBCOLECOES_USUARIO` (`public/js/data.js`) para a exclusão do usuário não deixar dados para trás.

## Rodando localmente (emuladores)

Em `localhost` o app usa sempre os emuladores (projeto `demo-financeiro`), nunca o banco de produção.

1. Ligue os emuladores (precisa de Node e Java): execute `emulador\iniciar.cmd`.
   Site em http://localhost:5050, painel dos emuladores em http://localhost:4000.
2. Em outro terminal, popule os dados de teste: `node emulador/seed.mjs`.
   Contas criadas: `admin@teste.com` (administrador), `cliente@teste.com` (cliente ativo) e `inativo@teste.com` (cliente inativo).
3. Abra o site e entre escolhendo uma dessas contas na janela de login do emulador.

## Testes

O site continua sem build e sem dependências de runtime. O `package.json` da raiz existe só para os testes (Node 20 ou mais novo); `npm install` instala apenas devDependencies (`firebase` e `@firebase/rules-unit-testing`).

```bash
npm install
npm test             # formatação e cálculos (tests/format.test.mjs e tests/calc.test.mjs)
npm run test:rules   # regras do Firestore (tests/rules.test.mjs), precisa do emulador
```

- `tests/format.test.mjs`: `num` com valores no padrão brasileiro, `brl`, `addMeses` e `mesesEntre`.
- `tests/calc.test.mjs`: parcelas com centavos (`expandirLancamentos`), impostos e comissão só sobre a receita da empresa (`resumoAno`), `calcPatrimonio` e casos de sanidade de `projetar`.
- `tests/rules.test.mjs`: admin lê e escreve tudo; cliente ativo só os próprios dados; cliente inativo lê o cadastro mas não as subcoleções; cliente não muda o próprio `ativo`; só admin consulta `collectionGroup`; lançamentos inválidos são recusados.

Os testes de regras usam o emulador do Firestore em `127.0.0.1:8085` (ou o endereço de `FIRESTORE_EMULATOR_HOST`) com o projeto `demo-financeiro-teste`, separado do `demo-financeiro` usado no navegador; eles apagam e recriam só os dados desse projeto de teste. Com o emulador já ligado (`emulador\iniciar.cmd`), basta `npm run test:rules`. Sem ele, use:

```bash
npx firebase-tools emulators:exec --only firestore --project demo-financeiro-teste "npm run test:rules"
```

No `npm test`, os testes de regras são pulados (aparecem como *skipped*) se o emulador não responder; no `npm run test:rules` eles falham.

A integração contínua (`.github/workflows/ci.yml`) roda em cada push e pull request: Node 20, Java 21, `npm ci`, checagem de sintaxe dos módulos de `public/`, `npm test` e os testes de regras dentro do `emulators:exec`.

## Publicação

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,hosting --project <id-do-projeto>
```

Antes do primeiro deploy, cadastre o primeiro administrador no Firestore: crie o documento `admins/{email-do-admin}` com o campo `email`.
