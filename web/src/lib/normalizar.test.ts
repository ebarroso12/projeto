import { describe, expect, it } from 'vitest';
import { emailDe } from '../api/supabase';
import { normalizar } from './rules';

describe('código da empresa e login', () => {
  it('aceita acento, maiúscula e espaços', () => {
    expect(normalizar(' Fábrica ')).toBe('fabrica');
    expect(emailDe('FÁBRICA', 'Edson ')).toBe('fabrica.edson@fabrica.local');
    expect(emailDe('confecção-são-joão', 'joão')).toBe('confeccao-sao-joao.joao@fabrica.local');
  });
});
