/**
 * Gráficos em SVG puro (sem biblioteca), seguindo o mesmo vocabulário visual do app:
 * marcas finas, cantos arredondados só na ponta do dado, grade discreta, legenda sempre presente
 * para 2+ séries, rótulos diretos seletivos, dica (tooltip) no passar do mouse / toque e
 * tabela equivalente para leitores de tela. Cores por papel em styles/components.css (--viz-*).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

const nf = new Intl.NumberFormat('pt-BR');
export const SERIES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)'];
export const OUTROS = 'var(--viz-other)';

interface Tip { x: number; y: number; content: ReactNode }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return <div className="viz-tip" role="status" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>;
}

/** Tabela oculta com os mesmos números do gráfico (acessibilidade). */
function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="sr-only"><table>
      <caption>{caption}</caption>
      <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <ul className="viz-legend">
      {items.map(i => (
        <li key={i.label}><span className="viz-swatch" style={{ background: i.color }} aria-hidden="true" /><span>{i.label}</span>{i.value !== undefined && <b className="tnum">{i.value}</b>}</li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Rosca (parte do todo)
export interface Fatia { label: string; value: number; color: string }

export function Donut({ fatias, total, centro, sub, titulo }: { fatias: Fatia[]; total?: number; centro: ReactNode; sub: string; titulo: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const soma = total ?? fatias.reduce((s, f) => s + f.value, 0);
  const R = 70, W = 18, C = 2 * Math.PI * R, GAP = fatias.filter(f => f.value > 0).length > 1 ? 2 : 0;
  let acc = 0;
  return (
    <div className="viz-donut">
      <div className="viz-donut-svg" onMouseLeave={() => setTip(null)}>
        <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label={titulo}>
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--viz-track)" strokeWidth={W} />
          {soma > 0 && fatias.map(f => {
            const len = (f.value / soma) * C;
            const el = f.value > 0 ? (
              <circle key={f.label} cx="90" cy="90" r={R} fill="none" stroke={f.color} strokeWidth={W}
                strokeDasharray={`${Math.max(0, len - GAP)} ${C}`} strokeDashoffset={-acc} transform="rotate(-90 90 90)"
                onMouseMove={e => { const b = (e.currentTarget.ownerSVGElement!.parentElement!).getBoundingClientRect(); setTip({ x: e.clientX - b.left, y: e.clientY - b.top, content: <><b>{f.label}</b><br />{nf.format(f.value)} · {pct(f.value, soma)}</> }); }}
                style={{ cursor: 'default' }} />
            ) : null;
            acc += len;
            return el;
          })}
          <text x="90" y="88" textAnchor="middle" className="viz-donut-num" style={{ fontSize: String(centro).length > 7 ? 17 : String(centro).length > 5 ? 21 : 26 }}>{centro}</text>
          <text x="90" y="108" textAnchor="middle" className="viz-donut-sub">{sub}</text>
        </svg>
        <Tooltip tip={tip} />
      </div>
      <Legend items={fatias.map(f => ({ label: f.label, color: f.color, value: <>{nf.format(f.value)} <small>({pct(f.value, soma)})</small></> }))} />
      <SrTable caption={titulo} head={['Item', 'Valor', '%']} rows={fatias.map(f => [f.label, f.value, pct(f.value, soma)])} />
    </div>
  );
}

export const pct = (v: number, total: number) => (total ? `${(Math.round((v / total) * 1000) / 10).toLocaleString('pt-BR')}%` : '—');

/** Largura real do contêiner: o SVG é desenhado em pixels de verdade (texto legível em qualquer tela). */
function useLargura<T extends HTMLElement>(inicial = 520) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { const nw = Math.round(e!.contentRect.width); if (nw > 0) setW(nw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ------------------------------------------------------------------ Barras agrupadas: mês × média
export interface GrupoBarras { label: string; valores: number[] }

/** Barras verticais por categoria; cada grupo tem uma barra por série (ex.: média de 3 meses × mês atual). */
export function BarrasComparadas({ grupos, series, titulo, formato = (n: number) => nf.format(n), altura = 220 }: {
  grupos: GrupoBarras[]; series: { label: string; color: string }[]; titulo: string; formato?: (n: number) => string; altura?: number;
}) {
  const id = useId();
  const [tip, setTip] = useState<Tip | null>(null);
  const [box, W] = useLargura<HTMLDivElement>();
  const maxV = Math.max(0, ...grupos.flatMap(g => g.valores));
  const max = niceMax(Math.max(1, maxV));
  // rótulo de valor só cabe se a coluna for larga o bastante; senão mostra só o maior (o resto fica no toque/tabela)
  const H = altura, L = 44, B = 28, T = 22, plotH = H - B - T, plotW = W - L - 8;
  const gw = plotW / Math.max(1, grupos.length), bw = Math.min(46, Math.max(gw - 20, gw * 0.6) / series.length);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  return (
    <div className="viz-wrap" onMouseLeave={() => setTip(null)}>
      <Legend items={series} />
      <div ref={box} style={{ position: 'relative', width: '100%', minWidth: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-labelledby={id} style={{ display: 'block', maxWidth: '100%' }}>
          <title id={id}>{titulo}</title>
          {ticks.map(t => (
            <g key={t}><line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" className="viz-axis">{compacto(t)}</text></g>
          ))}
          {grupos.map((g, gi) => {
            const x0 = L + gi * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2;
            return (
              <g key={g.label}>
                {g.valores.map((v, si) => {
                  const x = x0 + si * (bw + 2), h = Math.max(0, T + plotH - y(v));
                  return (
                    <g key={si}>
                      <path d={barPath(x, y(v), bw, h)} fill={series[si]!.color}
                        onMouseMove={e => { const b = e.currentTarget.ownerSVGElement!.parentElement!.getBoundingClientRect(); setTip({ x: e.clientX - b.left, y: e.clientY - b.top, content: <><b>{g.label}</b><br />{series[si]!.label}: {formato(v)}</> }); }} />
                      {si === g.valores.length - 1 && v > 0 && (gw >= formato(v).length * 6.5 || v === maxV) && <text x={x + bw / 2} y={y(v) - 6} textAnchor="middle" className="viz-label">{formato(v)}</text>}
                    </g>
                  );
                })}
                {(gw >= 46 || gi % Math.ceil(46 / gw) === 0) && <text x={L + gi * gw + gw / 2} y={H - 8} textAnchor="middle" className="viz-axis viz-axis-x">{g.label}</text>}
              </g>
            );
          })}
          <line x1={L} x2={W - 8} y1={T + plotH} y2={T + plotH} className="viz-base" />
        </svg>
        <Tooltip tip={tip} />
      </div>
      <SrTable caption={titulo} head={['', ...series.map(s => s.label)]} rows={grupos.map(g => [g.label, ...g.valores.map(formato)])} />
    </div>
  );
}

// ------------------------------------------------------------------ Barras horizontais (ranking)
export function BarrasHorizontais({ itens, titulo, cor = 'var(--viz-1)', formato = (n: number) => nf.format(n) }: {
  itens: { label: string; value: number; detalhe?: string }[]; titulo: string; cor?: string; formato?: (n: number) => string;
}) {
  const max = Math.max(1, ...itens.map(i => i.value));
  if (!itens.length) return <p className="table-empty" style={{ padding: 24 }}>Sem dados no período.</p>;
  return (
    <div className="viz-hbars" role="list" aria-label={titulo}>
      {itens.map(i => (
        <div className="viz-hbar" role="listitem" key={i.label} title={`${i.label}: ${formato(i.value)}`}>
          <div className="viz-hbar-top"><span>{i.label}{i.detalhe && <small> · {i.detalhe}</small>}</span><b className="tnum">{formato(i.value)}</b></div>
          <div className="viz-hbar-track"><span style={{ width: `${Math.max(1.5, (i.value / max) * 100)}%`, background: cor }} /></div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ util
/** Eixo curto: 12.500 -> "12,5 mil"; 1.200.000 -> "1,2 mi". */
const compacto = (n: number) => n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  : n >= 1e4 ? `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : nf.format(Math.round(n));
function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
/** Retângulo com 4px de raio só no topo (a ponta do dado); a base fica reta na linha zero. */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Variação percentual com seta, ex.: "▲ 12,5%". Neutra quando não há base. */
export function Variacao({ atual, base, inverso = false }: { atual: number; base: number; inverso?: boolean }) {
  if (!base) return <span className="viz-var neutro">sem base de comparação</span>;
  const d = ((atual - base) / base) * 100;
  const bom = inverso ? d <= 0 : d >= 0;
  return <span className={`viz-var ${Math.abs(d) < 0.5 ? 'neutro' : bom ? 'bom' : 'ruim'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(Math.round(d * 10) / 10).toLocaleString('pt-BR')}%</span>;
}
