// Configuração de execução. Edite sem precisar recompilar o app.
// (Nada aqui é segredo: a chave "publishable" do Supabase foi feita para ficar no navegador;
//  quem protege os dados são as regras do banco.)
//
// Escolha UM servidor:
//   1) Supabase (recomendado):  supabaseUrl + supabaseKey
//   2) Google Apps Script:      apiUrl (endereço /exec com o Api.gs implantado)
//   3) Nenhum: MODO DEMONSTRAÇÃO, com dados fictícios e nada é enviado.
//
// Link "só ver" para TV/tablet:  https://seu-site/?k=SUA_CHAVE
window.__FABRICA__ = {
  supabaseUrl: '',
  supabaseKey: '',
  apiUrl: '',
};
