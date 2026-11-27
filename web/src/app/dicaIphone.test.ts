import { describe, expect, it } from 'vitest';
import { deveMostrarDicaIphone } from './DicaIphone';
import { linkManual } from '../lib/manual';

describe('dica do iPhone', () => {
  it('aparece só no iPhone, fora do app instalado e se não foi dispensada', () => {
    expect(deveMostrarDicaIphone(true, false, false)).toBe(true);
    expect(deveMostrarDicaIphone(true, true, false)).toBe(false);
    expect(deveMostrarDicaIphone(true, false, true)).toBe(false);
    expect(deveMostrarDicaIphone(false, false, false)).toBe(false);
  });
});

describe('link do manual', () => {
  it('relativo, com seção opcional', () => {
    expect(linkManual()).toBe('manual/');
    expect(linkManual('iphone')).toBe('manual/#iphone');
  });
});
