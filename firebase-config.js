// Configuração do projeto Firebase (dashboard-financeiro-faaa2).
// Esses valores não são segredos: a segurança vem das regras do Firestore (firestore.rules).
export const firebaseConfig = {
  apiKey: "AIzaSyCvp4rogImwMI0erETjZ4HGh5l0BHWcoNA",
  authDomain: "dashboard-financeiro-faaa2.firebaseapp.com",
  projectId: "dashboard-financeiro-faaa2",
  storageBucket: "dashboard-financeiro-faaa2.firebasestorage.app",
  messagingSenderId: "998539094104",
  appId: "1:998539094104:web:a80569bda2d479312ac22d",
};

// Valores padrão usados quando um usuário ainda não tem parâmetros próprios.
// Espelham a aba "Como usar" da planilha original (10% de impostos e 10% de comissão).
export const PARAMETROS_PADRAO = { impostoPct: 0.10, comissaoPct: 0.10 };
