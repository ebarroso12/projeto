/**
 * Manual interativo do app, publicado junto em /manual/ (ver manualPlugin em vite.config.ts).
 * Caminho relativo: funciona no domínio principal e em subpastas (base './').
 */
export const URL_MANUAL = 'manual/';

/** Seções do manual (ids das <section>), para abrir direto no assunto. */
export type SecaoManual = 'primeiro-acesso' | 'montar' | 'equipe' | 'oficinas' | 'pedidos' | 'materia-prima' | 'produtividade'
  | 'financeiro' | 'resultado' | 'acompanhar' | 'acessos' | 'avisos' | 'iphone' | 'dono' | 'duvidas';

export const linkManual = (secao?: SecaoManual) => URL_MANUAL + (secao ? `#${secao}` : '');

export function abrirManual(secao?: SecaoManual) {
  window.open(linkManual(secao), '_blank');
}
