# Financeiro & Patrimônio

Sistema web com login Google, painel do administrador e painel do cliente, baseado na planilha financeira usada pela consultoria.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Página principal e estilos |
| `app.js` | Login, perfis, painéis, Home Conect e cálculos |
| `firebase-config.js` | Configuração do projeto Firebase (não é segredo; a segurança vem das regras) |
| `firestore.rules` | Regras de acesso ao Firestore |
| `firebase.json` | Configuração de deploy (Firestore e Hosting) |

## Perfis

- **Administrador:** vê todos os clientes, abre o painel de qualquer um e edita. Administradores ficam na coleção `admins`.
- **Cliente:** vê e lança apenas os próprios dados. Clientes ficam na coleção `users`, identificados pelo e-mail Google.

## Dados principais (Firestore)

- `users/{email}/lancamentos`: receitas e despesas. Cada mês é um lançamento próprio, com `entidade` (`empresa` ou `pessoa`).
- `users/{email}/patrimonio`: imóveis, veículos, investimentos, empresas e dívidas.
- `users/{email}/metas`: plano de metas.
- `users/{email}/projetos`: objetivos e aportes usados no planejamento de aposentadoria.
- `users/{email}/config/aposentadoria`: parâmetros da simulação.

## Publicação

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,hosting --project <id-do-projeto>
```

Antes do primeiro deploy, cadastre o primeiro administrador no Firestore: crie o documento `admins/{email-do-admin}` com o campo `email`.
