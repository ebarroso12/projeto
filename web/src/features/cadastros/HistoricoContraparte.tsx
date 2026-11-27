import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Registro2 } from '../../api/types';
import { useApi } from '../../app/auth';
import { dataBR, formatBRL, isoDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { BarrasComparadas, Variacao } from '../../ui/charts';
import { QueryView } from '../../ui/QueryView';
import { Badge, Stat } from '../../ui/primitives';
import { historicoContraparte } from '../financeiro/calc';

/** Rótulo curto para as barras (cabe em 12 colunas no celular): 12,3 mil · 860 */
const curto = (n: number) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toLocaleString('pt-BR')} mil` : Math.round(n).toLocaleString('pt-BR'));
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Histórico no Financeiro de um cliente (o que ele pagou) ou fornecedor (o que pagamos a ele). */
export function HistoricoContraparte({ registro }: { registro: Registro2 }) {
  const api = useApi();
  const hoje = isoDay(new Date());
  const [ano, setAno] = useState(hoje.slice(0, 4));
  const q = useQuery({ queryKey: ['financeiro', 'contraparte', registro.id], queryFn: () => api.finContraparteLancamentos(registro.id) });
  const cliente = registro.tipo === 'cliente';

  return (
    <QueryView query={q}>
      {lancs => {
        const h = historicoContraparte(lancs, ano, hoje);
        const total = cliente ? h.recebido : h.pago;
        const base = cliente ? h.recebidoAnterior : h.pagoAnterior;
        if (!lancs.length) {
          return <p className="muted" style={{ margin: 0 }}>Nenhum lançamento ligado a {registro.nome} ainda. No Financeiro, escolha {cliente ? 'o cliente numa entrada' : 'o fornecedor numa saída ou conta a pagar'}.</p>;
        }
        return (
          <div className="stack" style={{ gap: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>Ano</b>
              <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <Button size="sm" variant="ghost" iconOnly aria-label="Ano anterior" onClick={() => setAno(String(Number(ano) - 1))}><span aria-hidden="true">‹</span></Button>
                <b className="tnum" aria-live="polite">{ano}</b>
                <Button size="sm" variant="ghost" iconOnly aria-label="Próximo ano" onClick={() => setAno(String(Number(ano) + 1))}><span aria-hidden="true">›</span></Button>
              </span>
            </div>
            <div className="kpi-ficha">
              <Stat label={cliente ? `Recebido em ${ano}` : `Pago em ${ano}`} value={formatBRL(total)} tone={cliente && total ? 'ok' : undefined}
                hint={<>{Number(ano) - 1}: {formatBRL(base)} <Variacao atual={total} base={base} inverso={!cliente} /></>} />
              <Stat label="Lançamentos no ano" value={h.qtd} hint={h.ultimo ? `último em ${dataBR(h.ultimo)}` : 'nenhum realizado'} />
              {!cliente && <Stat label="Ainda a pagar" value={formatBRL(h.emAberto)} hint={`${h.parcelasAbertas} parcela(s) em aberto`} tone={h.emAberto ? 'danger' : undefined} />}
              {cliente && <Stat label="A receber" value={formatBRL(h.aReceber)} hint={h.vencidoAReceber ? `${formatBRL(h.vencidoAReceber)} atrasado` : `${h.parcelasAReceber} parcela(s) em aberto`} tone={h.vencidoAReceber ? 'danger' : undefined} />}
              {cliente && <Stat label="Média por mês com venda" value={formatBRL(h.porMes.filter(v => v > 0).length ? total / h.porMes.filter(v => v > 0).length : 0)} />}
            </div>
            {total > 0 && (
              <BarrasComparadas titulo={`${cliente ? 'Recebido' : 'Pago'} por mês em ${ano}`} altura={170}
                grupos={MESES.map((m, i) => ({ label: m, valores: [h.porMes[i] ?? 0] }))}
                series={[{ label: cliente ? 'Recebido' : 'Pago', color: 'var(--viz-1)' }]} formato={curto} />
            )}
            <div>
              <b style={{ display: 'block', marginBottom: 8 }}>Lançamentos de {ano}</b>
              {h.doAno.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nada neste ano.</p> : (
                <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
                  {h.doAno.map(l => (
                    <div className="item" key={l.id}>
                      <div className="item-main">
                        <b>{l.descricao}</b>
                        <small>{dataBR(l.data)}{l.categoria ? ` · ${l.categoria}` : ''}{l.tipo === 'programada' || l.tipo === 'receber' ? ` · ${l.parcelas}x de ${formatBRL(l.valorParcela ?? 0)}${l.cartaoId ? ' no cartão' : `, ${l.parcelasPagas} ${l.tipo === 'receber' ? 'recebida(s)' : 'paga(s)'}`}` : ''}</small>
                      </div>
                      {l.tipo === 'programada' || l.tipo === 'receber' ? <Badge tone={l.tipo === 'receber' ? 'ok' : 'info'}>{formatBRL(l.valor)}</Badge>
                        : <b className={l.tipo === 'entrada' ? 'valor-pos' : 'tnum'}>{l.tipo === 'entrada' ? '+' : '−'} {formatBRL(l.valor)}</b>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      }}
    </QueryView>
  );
}
