import { describe, expect, it } from 'vitest';
import { pecas } from './formatar';

const plano = (s: string) => pecas(s).map(p => (p.tipo === 'texto' ? p.texto : `<${p.tipo}>${p.filhos ? p.filhos.map(f => (f.tipo === 'texto' ? f.texto : `<${f.tipo}>${f.texto}</${f.tipo}>`)).join('') : p.texto}</${p.tipo}>`)).join('');

describe('formatação da Dani', () => {
  it('negrito, itálico e código', () => {
    expect(plano('Vá em **Lançar** e toque *(Lembrete: veio da Ordem)* fim')).toBe('Vá em <b>Lançar</b> e toque <i>(Lembrete: veio da Ordem)</i> fim');
    expect(plano('use `fabrica` aqui')).toBe('use <code>fabrica</code> aqui');
  });
  it('contas com * não viram itálico', () => {
    expect(plano('Calcule 2*3 e depois 4*5')).toBe('Calcule 2*3 e depois 4*5');
    expect(plano('45 boas * R$ 3 = 135 e 2 * 5')).toBe('45 boas * R$ 3 = 135 e 2 * 5');
  });
  it('itálico dentro do negrito, sem asteriscos sobrando', () => {
    expect(plano('**Atenção *muito* importante**')).toBe('<b>Atenção <i>muito</i> importante</b>');
  });
  it('texto que só começa e termina com * mas não foi reconhecido fica como está', () => {
    expect(plano('* item solto *')).toBe('* item solto *');
    expect(plano('**')).toBe('**');
  });
});
