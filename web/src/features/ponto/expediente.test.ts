import { describe, expect, it } from 'vitest';
import { expediente } from './expediente';

const m = (hhmm: string) => { const [h, mi] = hhmm.split(':').map(Number); return h! * 60 + mi!; };

describe('expediente (anel do Ponto)', () => {
  it('sem entrada: vazio', () => expect(expediente('', '', '17:30', m('10:00'))).toEqual({ frac: 0, feito: 0, extra: 0, falta: 0 }));
  it('dia normal: falta para o fim', () => {
    const e = expediente('08:00', '', '17:00', m('12:30'));
    expect(e.feito).toBe(270); expect(e.falta).toBe(270); expect(e.extra).toBe(0); expect(e.frac).toBeCloseTo(0.5);
  });
  it('passou do fim: hora extra desde o fim', () => expect(expediente('08:00', '', '17:00', m('17:40')).extra).toBe(40));
  it('entrou depois do fim: extra só desde a entrada', () => {
    const e = expediente('18:30', '', '17:00', m('19:00'));
    expect(e.extra).toBe(30); expect(e.feito).toBe(30); expect(e.frac).toBe(1);
  });
  it('turno da noite antes da meia-noite', () => {
    const e = expediente('22:00', '', '06:00', m('23:00'));
    expect(e.feito).toBe(60); expect(e.falta).toBe(420); expect(e.extra).toBe(0);
  });
  it('turno da noite depois da meia-noite', () => {
    const e = expediente('22:00', '', '06:00', m('01:00'));
    expect(e.feito).toBe(180); expect(e.falta).toBe(300);
  });
  it('turno da noite com saída depois do fim', () => expect(expediente('22:00', '06:45', '06:00', m('07:00')).extra).toBe(45));
});
