import { useMemo, useState, type ReactNode } from 'react';
import { downloadCsv, toCsv, type Cell } from '../lib/csv';
import { Button } from './Button';
import { Icon } from './Icon';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Valor puro da coluna: habilita ordenar, buscar e exportar CSV. */
  value?: (row: T) => Cell;
  numeric?: boolean;
  nowrap?: boolean;
}

interface Props<T> {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowClass?: (row: T) => string | undefined;
  empty?: string;
  searchable?: boolean;
  exportName?: string;
  initialSort?: { id: string; dir: 1 | -1 };
  pageSize?: number;
  maxHeight?: number | string;
  toolbar?: ReactNode;
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
function compare(a: Cell, b: Cell): number {
  const ea = a === null || a === undefined || a === '';
  const eb = b === null || b === undefined || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // vazios sempre por último
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

export function DataTable<T>({
  label, columns, rows, rowKey, rowClass, empty = 'Nada por aqui.', searchable, exportName, initialSort,
  pageSize = 50, maxHeight, toolbar,
}: Props<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(pageSize);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) out = out.filter(r => columns.some(c => c.value && String(c.value(r) ?? '').toLowerCase().includes(q)));
    const col = sort ? columns.find(c => c.id === sort.id) : undefined;
    if (sort && col?.value) {
      const get = col.value;
      out = [...out].sort((a, b) => sort.dir * compare(get(a), get(b)));
    }
    return out;
  }, [rows, columns, query, sort]);

  const toggleSort = (id: string) =>
    setSort(s => (s?.id === id ? (s.dir === 1 ? { id, dir: -1 } : null) : { id, dir: 1 }));

  const exportCsv = () => {
    const cols = columns.filter(c => c.value);
    downloadCsv(exportName ?? 'dados', toCsv(cols.map(c => c.header), view.map(r => cols.map(c => c.value!(r)))));
  };

  const showTools = searchable || exportName || toolbar;
  return (
    <div>
      {showTools && (
        <div className="table-tools">
          {searchable && (
            <div className="search">
              <Icon name="search" size={16} />
              <input type="search" value={query} onChange={e => { setQuery(e.target.value); setLimit(pageSize); }}
                placeholder="Buscar…" aria-label={`Buscar em ${label}`} />
            </div>
          )}
          <span className="spacer" />
          {toolbar}
          {exportName && (
            <Button size="sm" icon={<Icon name="download" size={15} />} onClick={exportCsv} disabled={!view.length}>CSV</Button>
          )}
        </div>
      )}

      {view.length === 0 ? (
        <div className="table-empty">{query ? 'Nenhum resultado para a busca.' : empty}</div>
      ) : (
        <div className="table-scroll" style={maxHeight ? { maxHeight } : undefined}>
          <table className="table" aria-label={label}>
            <thead>
              <tr>
                {columns.map(c => (
                  <th key={c.id} scope="col" className={c.numeric ? 'num' : undefined}
                    aria-sort={sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    {c.value ? <button type="button" onClick={() => toggleSort(c.id)}>{c.header}</button> : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.slice(0, limit).map((r, i) => (
                <tr key={rowKey(r, i)} className={rowClass?.(r)}>
                  {columns.map(c => (
                    <td key={c.id} className={[c.numeric && 'num', c.nowrap && 'nowrap'].filter(Boolean).join(' ') || undefined}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.length > 0 && (
        <div className="table-foot">
          <span>{view.length === rows.length ? `${rows.length} registro(s)` : `${view.length} de ${rows.length} registro(s)`}</span>
          {view.length > limit && <Button size="sm" onClick={() => setLimit(l => l + pageSize)}>Mostrar mais</Button>}
        </div>
      )}
    </div>
  );
}
