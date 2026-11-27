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

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** R$ 1.234,56 (negativos com sinal). */
export const formatBRL = (n: number): string => brl.format(Number.isFinite(n) ? n : 0);

/** "2026-11" -> "novembro de 2026" com maiúscula. */
export function nomeDoMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const s = new Date(y!, (m ?? 1) - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Soma meses a "AAAA-MM". */
export function somarMes(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y!, (m ?? 1) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "26/11/2026" a partir de "2026-11-26". */
export function dataCompleta(d?: string | null): string {
  if (!d) return '';
  const p = d.slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pela hora local. */
export function saudacao(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;
/** "Edson Barroso" -> "EB". */
export const iniciais = (nome: string) => nome.trim().split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
