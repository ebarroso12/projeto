import { describe, expect, it } from 'vitest';
import { resumoTexto } from './resumo';

describe('resumo do mês para WhatsApp', () => {
  it('inclui só as partes que a pessoa pode ver', () => {
    const t = resumoTexto({ empresa: 'Confecção X', mes: 'Novembro de 2026', pecas: 1200, porEtapa: { Corte: 500, Costura: 400, 'Conferência': 300 }, entradas: 10000, saidas: 7500, comprar: ['Linha'] });
    expect(t.split('\n')).toEqual([
      '*Confecção X · Novembro de 2026*',
      '🧵 Produção: 1.200 peças (Corte 500, Costura 400, Conferência 300)',
      expect.stringMatching(/^💰 Entradas R\$\s10\.000,00 · Saídas R\$\s7\.500,00 · Saldo do mês R\$\s2\.500,00$/),
      '⚠️ Comprar: Linha',
    ]);
    expect(resumoTexto({ empresa: 'X', mes: 'M' })).toBe('*X · M*');
  });
});
