# Fábrica · Gestão da produção

Sistema administrativo **multiempresa** para fábricas: painel, relatório, itens em falta, lançamento de
produção, ponto, cadastros, **financeiro** (entradas, saídas, contas a pagar, cartões, metas, planejamento) e
**resultado da empresa** (DRE gerencial). Cada empresa cliente tem seus próprios usuários e administradores e só
enxerga os próprios dados; o responsável pelo sistema cria e bloqueia empresas na tela **Empresas**. Funciona no computador do administrador (menu lateral, tabelas densas) e no celular de quem
está no chão da fábrica (barra inferior, botões grandes).

```
web/                  app (Vite + React + TypeScript), site estático
  src/api/            contrato com o servidor + 3 servidores: supabase, apps script (client+transport), demonstração (mock)
  src/app/            sessão, carga inicial, registro de módulos, casca do app
  src/ui/             componentes (Button, Card, DataTable, Dialog, QueryView, …)
  src/features/       um módulo por pasta (painel, dashboard, relatorio, falta, lancar, ponto, cadastros, financeiro, dre, empresas)
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
cd supabase && npm install && npm test        # banco: migrações, regras, isolamento entre empresas (183 verificações)
cd web && npm install && npm run typecheck && npm test      # app: 52 testes
cd web && npm run build && npx vite preview --port 4173 &   # e depois:
node web/e2e/smoke.cjs                         # 58 verificações no navegador (desktop, celular, perfis, financeiro, DRE, empresas)
```

## Publicar (sem Vercel)
- **GitHub Pages:** `.github/workflows/web.yml` roda os testes e publica. Defina as variáveis
  `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` e, em *Settings → Pages*, a fonte "GitHub Actions".
- **Vercel:** *Add New → Project*, importe `ebarroso12/projeto`, **Root Directory = `web`** (o `web/vercel.json` já
  define build e cabeçalhos). Em *Settings → Environment Variables* não é preciso nada: edite `public/config.js`.
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

## Em produção
- Site: Vercel (projeto `fabrica`, time `edsonbdados-9184`), banco: Supabase `wwflyczpnizlmnzczqsl`.
- Entrar: **Empresa** (código) + **Login** + **Senha**. Link pronto para mandar à equipe: `https://SEU_SITE/?e=codigo-da-empresa`.
- No Auth, o e-mail interno de cada pessoa é `<empresa>.<login>@fabrica.local` (o mesmo login pode existir em empresas diferentes).

## Multiempresa (vender para outras fábricas)
1. Entre com o usuário dono do sistema → **Empresas → Nova empresa** (nome, código de acesso e o 1º administrador).
2. Mande ao cliente os dados mostrados (botão **Copiar dados**). O administrador dele cria a própria equipe em **Cadastros**.
3. Cliente em atraso: **Bloquear** (todos perdem o acesso na hora; os dados ficam guardados). **Liberar** devolve o acesso.
- Isolamento garantido no banco: toda tabela tem `empresa_id` e toda função usa a empresa de quem está logado (`fab.eu()`).

## Controle de acesso e auditoria (tela **Acessos**, só administrador)
- **Liberação a cada entrada** (ligada por padrão): o funcionário faz login e fica em "Aguardando liberação" até um
  administrador liberar. O pedido aparece no topo de qualquer tela do administrador (Liberar / Liberar e confiar / Negar)
  e a tela do funcionário abre sozinha. Administradores entram direto. "Confiar" faz aquele aparelho entrar direto nas próximas vezes.
- Conferido no servidor: `fab.eu()` exige a sessão (o `session_id` do token) liberada. Negar ou **Derrubar** tira a pessoa na hora.
- **Online agora** (tela atual e tempo ativo, por sinal enviado a cada minuto), **Entradas** (aparelho, IP, duração, quem liberou),
  **Atividade** (gatilho de auditoria em todas as tabelas: quem criou, alterou ou apagou o quê, com antes → depois) e **Métricas** por pessoa.

## Links TESTE e PRO — tela **Empresas**, só o dono do sistema
- **Gerar link TESTE**: o prazo conta do envio; o link e o teste vencem juntos (ex.: 7 dias após gerar).
- **Gerar link PRO**: a empresa nasce na versão completa, sem prazo (o link tem validade própria).
- Clique no nome de uma empresa para ver a **ficha**: uso e ações por dia (14 dias), implantação (0 a 6 passos),
  o que mais usam, pessoas (entradas, tempo logado/ativo, aparelhos), últimas entradas com IP e linha do tempo.
  Alertas automáticos: teste sem uso há 2+ dias e implantação baixa.

### Detalhes do link de teste
- **Gerar link de teste**: dias de teste (7/14/30), quantas empresas podem usar (1 a 100) e validade do link.
  O link (`?convite=...`) aparece uma vez; no banco fica só o hash. Botões Copiar, WhatsApp e Compartilhar.
- Quem abre cria a própria empresa e já entra como administrador. Uma faixa mostra quantos dias faltam.
- Vencido o prazo, ninguém da empresa entra (`EMPRESA_TESTE_EXPIRADO`). Em Empresas: **+7 dias** ou **Tornar cliente**.
- Empresas mostra também: cliente/teste/vencido, uso dos últimos 7 dias (tempo, entradas e ações) e os links gerados.

## Proteção dos dados
- **Cadastros → Cópia de segurança**: o administrador baixa um arquivo com todos os dados da empresa (sem senhas).
  Recomendado uma vez por semana. Função `fab_exportar` (só administrador, só a própria empresa).
- **`.github/workflows/manter-ativo.yml`**: uma consulta leve por dia para o Supabase gratuito não pausar o projeto.
- O projeto Supabase hoje é compartilhado com outro app (tabelas no esquema `public`). A Fábrica fica toda no
  esquema `fab`. **Nunca** rode `supabase db reset` nesse projeto: apagaria os dois sistemas.

## Pontos de atenção
- Os dados históricos da planilha precisam ser importados (ver `docs/SUPABASE.md`).
- Senhas: mínimo de 6 caracteres (piso do Supabase Auth). O Supabase guarda apenas hash; a tela
  Cadastros nunca mostra senhas.
- O link "só ver" leva a chave na URL: use `no-referrer` (já configurado) e revogue se vazar.
