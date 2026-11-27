import { useState } from 'react';
import { periodRange, type Period } from '../lib/format';
import { TextField } from './Field';
import { Segmented } from './primitives';

export interface Intervalo { ini: string; fim: string }

/** Estado do período (atalhos + datas livres) — o mesmo do Relatório. */
export function usePeriodo(inicial: Period = 'mes') {
  const [range, setRange] = useState<Intervalo>(() => periodRange(inicial));
  const [preset, setPreset] = useState<Period | 'custom'>(inicial);
  const valido = Boolean(range.ini && range.fim && range.ini <= range.fim);
  return { range, setRange, preset, setPreset, valido };
}

export function PeriodoPicker({ p }: { p: ReturnType<typeof usePeriodo> }) {
  const { range, setRange, preset, setPreset, valido } = p;
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
        <Segmented<Period | 'custom'> label="Período" value={preset} onChange={v => { if (v !== 'custom') { setPreset(v); setRange(periodRange(v)); } }}
          options={[{ value: 'semana', label: 'Esta semana' }, { value: 'mes', label: 'Este mês' }, { value: 'mesPassado', label: 'Mês passado' },
            ...(preset === 'custom' ? [{ value: 'custom' as const, label: 'Personalizado' }] : [])]} />
        <div style={{ width: 160 }}><TextField label="De" type="date" value={range.ini} onChange={e => { setPreset('custom'); setRange(r => ({ ...r, ini: e.target.value })); }} /></div>
        <div style={{ width: 160 }}><TextField label="Até" type="date" value={range.fim} onChange={e => { setPreset('custom'); setRange(r => ({ ...r, fim: e.target.value })); }} /></div>
      </div>
      {!valido && <p className="err" style={{ marginTop: 8, color: 'var(--danger)' }}>Escolha as duas datas, com o início antes do fim.</p>}
    </div>
  );
}
