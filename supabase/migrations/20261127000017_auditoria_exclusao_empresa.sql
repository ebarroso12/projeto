-- Ao apagar uma empresa inteira (ex.: desfazer uma empresa de teste), as linhas filhas são apagadas em cascata
-- depois da empresa: não há onde registrar o evento. O gatilho de auditoria ignora esse caso.
create or replace function fab.auditar() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  novo jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  velho jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  r jsonb := coalesce(novo, velho);
  ignorar text[] := array['empresa_id', 'id', 'criado_em', 'atualizado_em', 'chave_hash', 'criado_por', 'atualizado_por'];
  det jsonb := '{}'::jsonb; k text; tipo text; u fab.perfis;
begin
  if r ->> 'empresa_id' is null then return null; end if;
  if not exists (select 1 from fab.empresas where id = (r ->> 'empresa_id')::uuid) then return null; end if;
  tipo := case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'apagou' end;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(novo) loop
      if k <> all (ignorar) and (novo -> k) is distinct from (velho -> k) then
        det := det || jsonb_build_object(k, jsonb_build_array(velho -> k, novo -> k));
      end if;
    end loop;
    if det = '{}'::jsonb then return null; end if;
    if (novo ->> 'apagado') = 'true' and coalesce(velho ->> 'apagado', 'false') <> 'true' then tipo := 'apagou'; end if;
    det := jsonb_build_object('mudou', det, 'item', (r - ignorar) - 'apagado');
  else
    det := r - ignorar;
  end if;
  select * into u from fab.perfis where id = auth.uid();
  perform fab.registrar((r ->> 'empresa_id')::uuid, u.id, u.nome, tipo, tg_table_name, det);
  return null;
end $$;
