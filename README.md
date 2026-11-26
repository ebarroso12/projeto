# Painel de Dados (cliente para Google Apps Script)

App web estático (um único `index.html`, sem build nem dependências) que consome um
**Web App do Google Apps Script** e mostra os dados com busca, ordenação, exportação CSV,
cache offline e cadastro opcional.

## Usar

1. Abra `index.html` (ou publique a pasta em qualquer hospedagem estática: GitHub Pages, Vercel, Netlify).
2. Em **Configurações**, cole o endereço `…/exec`. Se vier com `?k=CHAVE`, a chave é separada sozinha.
3. Opcional: copie `config.example.js` para `config.js` (ignorado pelo git) para já abrir configurado.

> A chave **não** está no repositório. Fica no `localStorage` do navegador ou em `config.js` local.
> Em hospedagem pública, quem abrir o site e tiver o `config.js` publicado verá a chave; para
> uso público, deixe o usuário digitá-la em Configurações.

## Como funciona (detalhes técnicos)

- **Requisição:** `GET <url>?k=<chave>`. O Apps Script responde com um redirect 302 para
  `script.googleusercontent.com`, que devolve `Access-Control-Allow-Origin: *`; por isso o
  `fetch` funciona de qualquer origem, com `credentials: 'omit'`.
- **Escrita:** `POST` com `Content-Type: text/plain` e corpo JSON `{k, action:"create", data:{…}}`.
  Usar `text/plain` evita o *preflight* CORS, que o Apps Script não responde.
- **Formatos aceitos na resposta** (detectados automaticamente):
  lista de objetos · lista de listas com cabeçalho na 1ª linha · `{data|rows|items|records|values|result|results|list:[…]}` ·
  objeto simples (vira campo/valor). `{ok:false,error}` vira mensagem de erro.
- **Erros explicados:** página de login do Google (implantação não pública), HTML de erro do
  Apps Script (ex.: `doGet` inexistente), timeout de 25 s, rede/CORS. Em falha, mantém os dados
  anteriores ou a última cópia salva.
- **Segurança:** células renderizadas com `textContent` (sem XSS); CSV neutraliza fórmulas
  (`= + - @`); só aceita `https://` (e `http://localhost` para testes).
- **Desempenho:** 100 linhas por vez com "Mostrar mais"; índice de busca em cache por linha.
- **Layout:** tabela no desktop, cartões no celular; tema claro/escuro automático.

## Backend de referência

`apps-script/Code.gs` implementa o contrato acima (planilha `Dados`, chave em
*Propriedades do script* `KEY`, `LockService` na gravação). Use apenas se o seu script atual
ainda não devolve JSON.

Lembrete: Web Apps do Apps Script não permitem definir código HTTP; erros devem ir no corpo
(`{ok:false,error}`), que o app já interpreta.
