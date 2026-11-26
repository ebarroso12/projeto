import type { ReactNode } from 'react';
import type { Editado, Falta } from '../../api/types';
import { dataBR } from '../../lib/format';
import { Badge, Progress } from '../../ui/primitives';

/** Linha de item em falta (usada no Painel e na tela Em falta). */
export function FaltaItem({ f, actions }: { f: Falta; actions?: ReactNode }) {
  const urgente = f.status === 'Urgente';
  return (
    <div className={`item falta${urgente ? '' : ' andamento'}`}>
      <div className="item-main" style={{ flex: 1 }}>
        <div><b>{f.modelo}</b> {f.cor} {f.tamanho}</div>
        {f.qtd > 0
          ? <small>faltam <b>{f.falta}</b> de {f.qtd} pç</small>
          : f.feito > 0 && <small>{f.feito} prontas</small>}
        {f.qtd > 0 && <div style={{ margin: '6px 0 2px', maxWidth: 320 }}><Progress value={f.feito} max={f.qtd} /></div>}
        <small>{dataBR(f.criado)}{f.obs ? ` · ${f.obs}` : ''}</small>
      </div>
      <Badge tone={urgente ? 'danger' : 'warn'}>{f.status}</Badge>
      {actions && <div className="row" style={{ flexWrap: 'nowrap' }}>{actions}</div>}
    </div>
  );
}

/** Lançamentos alterados depois de feitos: o admin precisa enxergar quem mexeu e quantas vezes. */
export function EditadoList({ items, withDate }: { items: Editado[]; withDate?: boolean }) {
  if (!items.length) return <div className="table-empty">Nenhum lançamento editado.</div>;
  return (
    <div className="list">
      {items.map((x, i) => (
        <div key={i} className={`item edit${Math.min(3, Math.max(1, x.edicoes))}`}>
          <div className="item-main">
            <div><b>{x.nome}</b> · {x.etapa} · {x.modelo} {x.cor} {x.tamanho}</div>
            <small>{withDate && x.data ? `${dataBR(x.data)} · ` : ''}{x.hist}</small>
          </div>
          <div style={{ textAlign: 'right' }}>
            <b className="tnum">{x.qtd}</b><br />
            <Badge tone={x.edicoes >= 2 ? 'danger' : 'warn'}>editado {x.edicoes}x</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
