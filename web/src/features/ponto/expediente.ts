import { hmToMin } from '../../lib/format';

export interface Expediente { frac: number; feito: number; extra: number; falta: number }

const DIA = 1440;

/**
 * Andamento do expediente para o anel do Ponto (minutos).
 *  - horas antes da entrada são do dia seguinte (turno que passa da meia-noite);
 *  - quem entra depois do fim previsto (fim "a mais de 16 h" da entrada) está todo em hora extra;
 *  - hora extra conta a partir do que vier por último: entrada ou fim previsto.
 */
export function expediente(entrada: string, saida: string, horaFim: string, agoraMin: number): Expediente {
  if (!entrada) return { frac: 0, feito: 0, extra: 0, falta: 0 };
  const ini = hmToMin(entrada);
  const ajusta = (m: number) => (m < ini ? m + DIA : m);
  const agora = ajusta(saida ? hmToMin(saida) : agoraMin);
  let fim = ajusta(hmToMin(horaFim));
  if (fim - ini > 16 * 60) fim = ini; // entrou depois do fim do expediente
  const feito = Math.max(0, agora - ini);
  const total = fim - ini;
  return {
    feito,
    frac: total > 0 ? Math.min(1, feito / total) : 1,
    extra: Math.max(0, agora - Math.max(ini, fim)),
    falta: !saida && agora < fim ? fim - agora : 0,
  };
}
