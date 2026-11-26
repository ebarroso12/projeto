-- Índices nas chaves estrangeiras apontadas pelo "performance advisor" do Supabase.
create index if not exists chaves_acesso_empresa_idx        on fab.chaves_acesso (empresa_id);
create index if not exists dre_meses_atualizado_por_idx     on fab.dre_meses (atualizado_por);
create index if not exists dre_valores_categoria_idx        on fab.dre_valores (categoria_id);
create index if not exists em_falta_criado_por_idx          on fab.em_falta (criado_por);
create index if not exists fin_lanc_cartao_idx              on fab.fin_lancamentos (cartao_id);
create index if not exists fin_lanc_conta_idx               on fab.fin_lancamentos (conta_id);
create index if not exists fin_lanc_criado_por_idx          on fab.fin_lancamentos (criado_por);
create index if not exists fin_lanc_origem_idx              on fab.fin_lancamentos (origem_id);
create index if not exists fin_metas_empresa_idx            on fab.fin_metas (empresa_id);
create index if not exists fin_mov_meta_conta_idx           on fab.fin_movimentos_meta (conta_id);
create index if not exists fin_mov_meta_empresa_idx         on fab.fin_movimentos_meta (empresa_id);
create index if not exists fin_mov_meta_meta_idx            on fab.fin_movimentos_meta (meta_id);
create index if not exists fin_pag_fatura_cartao_idx        on fab.fin_pagamentos_fatura (cartao_id);
create index if not exists fin_pag_fatura_conta_idx         on fab.fin_pagamentos_fatura (conta_id);
create index if not exists lancamento_log_empresa_idx       on fab.lancamento_log (empresa_id);
