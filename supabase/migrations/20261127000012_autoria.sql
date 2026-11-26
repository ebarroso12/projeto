-- Autoria (criado_por / atualizado_por) não deve impedir remover uma pessoa do Auth:
-- se a pessoa for apagada, o registro fica e só perde a autoria.
alter table fab.em_falta        drop constraint if exists em_falta_criado_por_fkey,
  add constraint em_falta_criado_por_fkey foreign key (criado_por) references fab.perfis (id) on delete set null;
alter table fab.fin_lancamentos drop constraint if exists fin_lancamentos_criado_por_fkey,
  add constraint fin_lancamentos_criado_por_fkey foreign key (criado_por) references fab.perfis (id) on delete set null;
alter table fab.dre_meses       drop constraint if exists dre_meses_atualizado_por_fkey,
  add constraint dre_meses_atualizado_por_fkey foreign key (atualizado_por) references fab.perfis (id) on delete set null;
