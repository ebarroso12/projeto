# Fábrica · Gestão da produção

Front-end administrativo (React + TypeScript) para o sistema da fábrica que roda em
Google Apps Script + planilha: painel, relatório, itens em falta, lançamento de produção,
ponto e cadastros. Serve o computador do administrador (menu lateral, tabelas densas)
e o celular de quem está no chão da fábrica (barra inferior, botões grandes).

```
web/                    app (Vite + React + TS), publicado como site estático
  src/api/              contrato com o servidor: types, normalize, transport, client, mock
  src/app/              sessão (auth), carga inicial (boot), registro de módulos, casca do app
  src/ui/               componentes (Button, Card, DataTable, Dialog, QueryView, …)
  src/features/         uma pasta por módulo (painel, relatorio, falta, lancar, ponto, cadastros)
  src/styles/           tokens de design (claro/escuro) + layout + componentes
  public/config.js      endereço do servidor (editável sem recompilar)
apps-script/Api.gs      roteador JSON que se adiciona ao projeto do Apps Script
```

## Rodar agora (modo demonstração, dados fictícios)

```bash
cd web && npm install && npm run dev
```
Logins: `admin/admin` · `ana/1234` (costura) · `bruno/1234` (corte) · `carla/1234` (conferência).
Link "só ver": `…/?k=demo-key`.

## Ligar ao sistema real

1. No projeto do Apps Script crie o arquivo **Api.gs** com o conteúdo de `apps-script/Api.gs`.
   O `doGet` atual não muda: o app antigo continua funcionando em paralelo.
2. *Implantar → Gerenciar implantações → editar → Nova versão → Implantar*
   (acesso "Qualquer pessoa"; o endereço `/exec` continua o mesmo).
3. Em `web/public/config.js` coloque `apiUrl` com o endereço `/exec`.
4. `cd web && npm run build` e publique a pasta `web/dist` (GitHub Pages, Vercel, Netlify…).
5. Link de acompanhamento: `https://seu-site/?k=SUA_CHAVE`.

## Como o código foi organizado (para crescer sem bagunçar)

- **Novo módulo = uma entrada em `src/app/registry.ts`.** Menu, rota, permissão por perfil e
  divisão de código (cada tela só baixa quando aberta) saem dali.
- **Servidor atrás de uma interface.** Telas só conhecem `Api` (`src/api/client.ts`).
  Trocar Apps Script por banco de dados (Supabase/Postgres) é reescrever essa camada, não as telas.
- **Nunca confiar no formato do servidor.** `normalize.ts` converte tudo (a planilha manda texto)
  e entrega valores padrão; uma coluna faltando não derruba a tela.
- **Um jeito de carregar e de gravar.** `QueryView` (carregando → aviso de lentidão → erro com
  "tentar de novo") e `useAction` (mensagem, erro, atualização e proteção contra toque duplo).
- **Sessão e Wi-Fi tratados em um lugar** (`auth.tsx`): erro `SESSAO` volta ao login,
  `WIFI` mostra a tela de Wi-Fi; o serviço de IP tem limite de 4 s (o app antigo podia travar nele).
- **Tokens de design** (`styles/tokens.css`): cores, raios e sombras em um só lugar; tema escuro incluso.

## Testes

```bash
cd web
npm run typecheck && npm test            # tipos + 16 testes (regras, normalização, contrato)
npm run build && npx vite preview --port 4173 &
node e2e/smoke.cjs                        # 25 verificações no navegador (desktop, celular, perfis)
```

## Pontos de atenção

- **O contrato foi deduzido do front-end antigo**, não do `Code.gs`. Na primeira execução com o
  servidor real, confira cada tela; ajustes ficam só em `normalize.ts`.
- **Lentidão do `painel`** (o app antigo travava em "Carregando…") é do servidor: o app novo
  avisa e permite tentar de novo, mas a causa (leitura de abas inteiras ou bloqueio) precisa ser
  otimizada no Apps Script.
- **Cotas do Apps Script** (execuções simultâneas e por dia) limitam o crescimento. A interface
  `Api` já permite migrar para banco de dados quando o volume exigir.
- **Senhas em texto puro:** a tela Cadastros recebe a senha do servidor (`listarUsuarios`).
  Ela aparece mascarada, mas o ideal é o servidor guardar apenas hash.
