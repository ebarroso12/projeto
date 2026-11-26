const nf = new Intl.NumberFormat('pt-BR');

export const formatNumber = (n: number): string => nf.format(n);

/** "2026-11-26" ou "2026-11-26T14:05" -> "26/11" ou "26/11 14:05". */
export function dataBR(d?: string | null): string {
  if (!d) return '';
  const p = d.slice(0, 10).split('-');
  if (p.length < 3) return d;
  return `${p[2]}/${p[1]}` + (d.length > 10 ? ` ${d.slice(11, 16)}` : '');
}

/** Data local em YYYY-MM-DD (sem o desvio de fuso do toISOString). */
export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function hmToMin(t?: string): number {
  const p = String(t ?? '0:0').split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

export function nowMin(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

export type Period = 'semana' | 'mes' | 'mesPassado';

/** Intervalo [ini, fim] em YYYY-MM-DD para os atalhos do relatório. */
export function periodRange(kind: Period, ref = new Date()): { ini: string; fim: string } {
  const h = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12);
  let ini = new Date(h);
  let fim = new Date(h);
  if (kind === 'semana') ini.setDate(h.getDate() - ((h.getDay() + 6) % 7)); // segunda-feira
  if (kind === 'mes') ini = new Date(h.getFullYear(), h.getMonth(), 1, 12);
  if (kind === 'mesPassado') {
    ini = new Date(h.getFullYear(), h.getMonth() - 1, 1, 12);
    fim = new Date(h.getFullYear(), h.getMonth(), 0, 12);
  }
  return { ini: isoDay(ini), fim: isoDay(fim) };
}

export function longDate(d = new Date()): string {
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

/** Sugere o login a partir do nome: primeiro nome, sem acento, minúsculo. */
export function loginFromName(nome: string): string {
  return (nome.trim().split(/\s+/)[0] ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
