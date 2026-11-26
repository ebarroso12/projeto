import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import { dataBR, hmToMin, isoDay, loginFromName, periodRange } from './format';
import { etapaDoSetor } from '../features/lancar/etapas';

describe('format', () => {
  it('formata datas do servidor', () => {
    expect(dataBR('2026-11-26')).toBe('26/11');
    expect(dataBR('2026-11-26T14:05:00')).toBe('26/11 14:05');
    expect(dataBR('')).toBe('');
    expect(dataBR(undefined)).toBe('');
  });
  it('converte hora em minutos', () => {
    expect(hmToMin('17:30')).toBe(1050);
    expect(hmToMin('')).toBe(0);
    expect(hmToMin(undefined)).toBe(0);
  });
  it('usa a data local, sem desvio de fuso', () => {
    expect(isoDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('calcula os atalhos de período', () => {
    const ref = new Date(2026, 10, 26, 9); // quinta-feira
    expect(periodRange('semana', ref)).toEqual({ ini: '2026-11-23', fim: '2026-11-26' });
    expect(periodRange('mes', ref)).toEqual({ ini: '2026-11-01', fim: '2026-11-26' });
    expect(periodRange('mesPassado', ref)).toEqual({ ini: '2026-10-01', fim: '2026-10-31' });
  });
  it('sugere login sem acento', () => {
    expect(loginFromName('  João da Silva')).toBe('joao');
    expect(loginFromName('Dóris Prado')).toBe('doris');
  });
});

describe('csv', () => {
  it('escapa separador, aspas e quebra de linha', () => {
    expect(toCsv(['a', 'b'], [['x;y', 'diz "oi"'], ['1\n2', 3]])).toBe('a;b\r\n"x;y";"diz ""oi"""\r\n"1\n2";3');
  });
  it('neutraliza fórmulas', () => {
    expect(toCsv(['a'], [['=1+1'], ['+cmd'], ['@x'], ['-5']])).toBe("a\r\n'=1+1\r\n'+cmd\r\n'@x\r\n'-5");
  });
});

describe('etapa do setor', () => {
  it('mapeia setores para etapas', () => {
    expect(etapaDoSetor('Cortador')).toBe('Corte');
    expect(etapaDoSetor('Costureira')).toBe('Costura');
    expect(etapaDoSetor('Produção')).toBe('Costura');
    expect(etapaDoSetor('Conferente')).toBe('Conferência');
    expect(etapaDoSetor('Estoque')).toBe('Conferência');
    expect(etapaDoSetor('Administração')).toBe('');
  });
});
