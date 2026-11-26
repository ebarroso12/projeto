# Colocar o sistema no Supabase (passo a passo)

O banco concentra as regras da fábrica. O app só chama funções `fab_*`; as tabelas ficam num schema
privado (`fab`) que a API nem enxerga. Tudo foi testado em Postgres local (`cd supabase && npm test`,
82 verificações), mas **ainda não foi aplicado em nenhum projeto seu**.

## 1. Projeto
Use um projeto **só da fábrica**. Não misture com bancos de outros sistemas (clínica, CRM): as
migrações criam o schema `fab` e funções `fab_*` em `public`, e os dados de pessoas não devem dividir
o mesmo banco por acaso. Plano gratuito: cada organização pode ter 2 projetos ativos; passando disso
o Supabase cobra. Verifique em *Organization → Billing* antes de criar.

## 2. Aplicar o banco
Opção A, pelo CLI (recomendada, fica no histórico do projeto):
```bash
npm i -g supabase
supabase login                      # abre o navegador; não precisa colar token no terminal
supabase link --project-ref SEU_REF
supabase db push                    # aplica supabase/migrations/*.sql em ordem
```
Opção B: colar cada arquivo de `supabase/migrations/` no *SQL Editor*, na ordem do nome.

Depois rode *Advisors → Security* no painel: não deve haver alerta de tabela sem proteção nem de
função executável por `anon` além das 4 funções de link "só ver" (`fab_validar_chave`, `fab_boot_chave`,
`fab_painel_chave`, `fab_relatorio_chave`).

## 3. Função de borda (criar pessoas e redefinir senhas)
```bash
supabase secrets set BOOTSTRAP_TOKEN=$(openssl rand -hex 16)   # só para o 1º administrador
supabase functions deploy usuarios
```

## 4. Primeiro administrador
Chame uma vez (troque os valores). Só funciona enquanto não existir nenhum perfil:
```bash
curl -X POST "https://SEU_REF.supabase.co/functions/v1/usuarios" \
  -H "Authorization: Bearer SUA_CHAVE_PUBLISHABLE" -H "Content-Type: application/json" \
  -d '{"action":"bootstrap","token":"O_BOOTSTRAP_TOKEN","login":"edson","nome":"Edson","senha":"MINIMO6"}'
supabase secrets unset BOOTSTRAP_TOKEN                         # apague depois de usar
```
Daí em diante, entre no app como administrador e crie as pessoas em **Cadastros → Nova pessoa**.
Senhas têm no mínimo **6 caracteres** (piso do Supabase Auth).

## 5. Listas e link de acompanhamento
- **Cadastros → Modelos, cores e tamanhos:** preencha as listas (o lançamento só aceita itens dessas listas).
- **Cadastros → Links de acompanhamento → Gerar link**: copie o endereço (aparece **uma vez**; no banco fica só o hash)
  e abra na TV/tablet. Se vazar, **Revogar todos os links** e gere outro.

## 6. Ligar o app
Em `web/public/config.js` (ou, no GitHub Pages, nas variáveis `SUPABASE_URL` e
`SUPABASE_PUBLISHABLE_KEY`):
```js
window.__FABRICA__ = { supabaseUrl: 'https://SEU_REF.supabase.co', supabaseKey: 'sb_publishable_…', apiUrl: '' };
```
A chave *publishable* foi feita para ficar no navegador. **Nunca** coloque a `service_role` aqui.

## Regras que agora ficam no servidor (antes só no navegador ou na planilha)
| Regra | Onde |
|---|---|
| Setor só lança a própria etapa | `fab_lancar` |
| Só lança modelo/cor/tamanho das listas; quantidade inteira positiva | `fab_lancar` |
| Aviso quando uma etapa passa do que a anterior entregou | `fab_lancar` |
| Funcionário só edita/apaga os próprios lançamentos **de hoje**; admin edita tudo | `fab_editar_lancamento` / `fab_apagar_lancamento` |
| Apagar é lógico; toda edição fica no log de auditoria | `fab.lancamento_log` |
| Um ponto por pessoa por dia (toque duplo não duplica) | `unique (user_id, dia)` |
| Hora extra e fechamento automático do ponto esquecido | `fab_bater_ponto`, `fab.fechar_pendentes` (pg_cron, a cada 10 min) |
| Wi-Fi da fábrica conferido pelo **IP que o servidor vê** | `fab.checa_wifi` (o navegador não envia IP) |
| Item em falta dá baixa sozinho ao completar a quantidade | gatilho `lancamentos_baixa` |
| Sempre sobra um administrador ativo | `fab_atualizar_perfil` |
| Feriados não contam como falta | tabela `fab.dias_sem_expediente` |
| Link "só ver": chave aleatória de 128 bits, guardada como hash, revogável | `fab_criar_chave` / `fab_revogar_chaves` |

## Trazer os dados da planilha
Não tenho acesso à planilha. Exporte cada aba em CSV (lançamentos, ponto, pessoas) e me envie as
colunas: escrevo o script de importação (`insert … select` a partir de uma tabela temporária) e
confiro os totais por modelo/dia contra a planilha antes de desligar o sistema antigo.

## Fuso horário
Datas e horas usam `America/Sao_Paulo` (campo `fuso` em `fab.configuracao`).
