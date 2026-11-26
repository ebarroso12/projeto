# Fábrica · Gestão da produção

Sistema administrativo da fábrica: painel, relatório, itens em falta, lançamento de produção, ponto e
cadastros. Funciona no computador do administrador (menu lateral, tabelas densas) e no celular de quem
está no chão da fábrica (barra inferior, botões grandes).

```
web/                  app (Vite + React + TypeScript), site estático
  src/api/            contrato com o servidor + 3 servidores: supabase, apps script (client+transport), demonstração (mock)
  src/app/            sessão, carga inicial, registro de módulos, casca do app
  src/ui/             componentes (Button, Card, DataTable, Dialog, QueryView, …)
  src/features/       um módulo por pasta (painel, relatorio, falta, lancar, ponto, cadastros)
supabase/             banco de dados: migrações SQL, função de borda e testes (Postgres local)
apps-script/Api.gs    ligação opcional ao sistema antigo em Google Apps Script
docs/SUPABASE.md      passo a passo para colocar no Supabase
.github/workflows/    testes + publicação no GitHub Pages
```

## Três servidores, o mesmo app
O app escolhe o servidor em `web/public/config.js`:

| Servidor | Como ligar | Para quê |
|---|---|---|
| **Supabase** (recomendado) | `supabaseUrl` + `supabaseKey` | Produção: regras no banco, login seguro, auditoria, escala |
| **Google Apps Script** | `apiUrl` + `apps-script/Api.gs` | Ponte enquanto a planilha ainda for a fonte dos dados |
| **Demonstração** | (vazio) | Testar e treinar com dados fictícios |

## Rodar agora (demonstração)
```bash
cd web && npm install && npm run dev
```
Logins: `admin/admin` · `ana/1234` · `bruno/1234` · `carla/1234`. Link "só ver": `/?k=demo-key`.

## Testes
```bash
cd supabase && npm install && npm test        # banco: migrações, regras e segurança (80+ verificações)
cd web && npm install && npm run typecheck && npm test      # app: 31 testes
cd web && npm run build && npx vite preview --port 4173 &   # e depois:
node web/e2e/smoke.cjs                         # 25 verificações no navegador (desktop, celular, perfis)
```

## Publicar (sem Vercel)
- **GitHub Pages:** `.github/workflows/web.yml` roda os testes e publica. Defina as variáveis
  `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` e, em *Settings → Pages*, a fonte "GitHub Actions".
- **Netlify / Cloudflare Pages:** raiz `web`, comando `npm run build`, saída `dist`
  (`netlify.toml` e `public/_headers` já estão prontos; o `config.js` pode ser editado no próprio host).
- O site é 100% estático e usa rotas com `#`: funciona em qualquer hospedagem de arquivos.

## Como o código foi organizado (para crescer sem bagunçar)
- **Módulo novo = uma entrada em `web/src/app/registry.ts`** (menu, rota, permissão e carregamento sob demanda).
- **Servidor atrás de uma interface (`Api`).** Telas não sabem se falam com Supabase, Apps Script ou demonstração.
- **Regras no banco, não no navegador.** Permissões, listas válidas, edição só do próprio dia, Wi-Fi pelo IP
  que o servidor vê, auditoria e baixa automática de itens em falta ficam no Postgres, testadas.
- **Nunca confiar no formato do servidor** (`normalize.ts`) e um único jeito de carregar (`QueryView`) e gravar
  (`useAction`, com proteção contra toque duplo).
- **Tokens de design** (`styles/tokens.css`) com tema claro e escuro.

## Pontos de atenção
- **Nada foi aplicado ainda em um projeto Supabase seu**: veja `docs/SUPABASE.md` (item 1) sobre onde criar o projeto.
- Os dados históricos da planilha precisam ser importados (ver `docs/SUPABASE.md`).
- Senhas: mínimo de 6 caracteres (piso do Supabase Auth). O Supabase guarda apenas hash; a tela
  Cadastros nunca mostra senhas.
- O link "só ver" leva a chave na URL: use `no-referrer` (já configurado) e revogue se vazar.
