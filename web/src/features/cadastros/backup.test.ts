import { describe, expect, it } from 'vitest';
import { textoSituacao } from './backup';

describe('situação da cópia de segurança', () => {
  it('sem cópia: alerta', () => {
    expect(textoSituacao({ ultima: null, quem: '', dias: null })).toEqual({ texto: 'A empresa ainda não tem nenhuma cópia de segurança.', tom: 'danger' });
    expect(textoSituacao(undefined).tom).toBe('danger');
  });
  it('hoje, ontem e até 7 dias: ok', () => {
    expect(textoSituacao({ ultima: 'x', quem: 'Edson', dias: 0 }).texto).toBe('Última cópia feita hoje por Edson.');
    expect(textoSituacao({ ultima: 'x', quem: '', dias: 1 }).texto).toBe('Última cópia feita ontem.');
    expect(textoSituacao({ ultima: 'x', quem: 'Ana', dias: 7 }).tom).toBe('ok');
  });
  it('mais de 7 dias: pede nova cópia', () => {
    const s = textoSituacao({ ultima: 'x', quem: 'Ana', dias: 12 });
    expect(s.tom).toBe('warn');
    expect(s.texto).toContain('há 12 dias por Ana');
  });
});
