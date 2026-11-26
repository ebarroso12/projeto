import { createContext, useContext } from 'react';
import type { FinDados } from '../../api/types';
import { nomeDoMes, somarMes } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';

export const FIN_KEY = ['financeiro'] as const;

const Ctx = createContext<FinDados | null>(null);
export const FinProvider = Ctx.Provider;
export function useFin(): FinDados {
  const d = useContext(Ctx);
  if (!d) throw new Error('useFin fora do FinProvider');
  return d;
}

export const nomeConta = (d: FinDados, id: string | null) => d.contas.find(c => c.id === id)?.nome ?? '—';
export const nomeCartao = (d: FinDados, id: string | null) => d.cartoes.find(c => c.id === id)?.nome ?? '—';

/** Seletor de mês com setas (‹ novembro de 2026 ›). */
export function MesPicker({ mes, onChange }: { mes: string; onChange: (m: string) => void }) {
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
      <Button size="sm" variant="ghost" iconOnly aria-label="Mês anterior" onClick={() => onChange(somarMes(mes, -1))}><span aria-hidden="true">‹</span></Button>
      <label className="mes-picker">
        <Icon name="calendar" size={15} />
        <span>{nomeDoMes(mes)}</span>
        <input type="month" value={mes} onChange={e => e.target.value && onChange(e.target.value)} aria-label="Escolher mês" />
      </label>
      <Button size="sm" variant="ghost" iconOnly aria-label="Próximo mês" onClick={() => onChange(somarMes(mes, 1))}><span aria-hidden="true">›</span></Button>
    </div>
  );
}

/** Barra horizontal simples para "para onde vai o dinheiro". */
export function Barras({ itens, total }: { itens: [string, number][]; total: number }) {
  if (!itens.length) return <p className="table-empty" style={{ padding: 24 }}>Nada lançado neste mês.</p>;
  return (
    <div className="barras">
      {itens.map(([nome, v]) => (
        <div key={nome} className="barra">
          <div className="barra-top"><span>{nome}</span><b className="tnum">{v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b></div>
          <div className="progress"><span style={{ width: `${total ? Math.max(2, (v / total) * 100) : 0}%`, background: 'var(--brand)' }} /></div>
        </div>
      ))}
    </div>
  );
}
