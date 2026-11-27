import { describe, expect, it } from 'vitest';
import type { Empresa } from '../../api/types';
import { painelDono } from './painel';

const AGORA = Date.parse('2026-11-27T12:00:00');
const E = (o: Partial<Empresa>): Empresa => ({ id: o.nome ?? 'x', codigo: 'x', nome: 'X', ativa: true, motivo: '', criadaEm: '2026-11-01T10:00', usuarios: 1, admins: 1,
  ultimoAcesso: '2026-11-27T09:00', testeAte: '', porLink: false, tempo7d: 0, entradas7d: 0, acoes7d: 0, tipoLink: '', pessoas7d: 0, online: 0,
  implantacao: { pessoas: true, listas: true, producao: true, ponto: false, financeiro: false, resultado: false }, ...o });

describe('painel do dono', () => {
  it('funil: quem veio de teste e quantos viraram cliente', () => {
    const p = painelDono([
      E({ nome: 'A', tipoLink: 'teste', testeAte: '' }),                       // convertida
      E({ nome: 'B', tipoLink: 'teste', testeAte: '2026-12-02T10:00' }),        // em teste
      E({ nome: 'C', tipoLink: 'teste', testeAte: '2026-11-20T10:00' }),        // vencida
      E({ nome: 'D', tipoLink: 'pro' }),
    ], AGORA);
    expect([p.vieramDeTeste, p.convertidas, p.conversao, p.emTeste, p.vencidos]).toEqual([3, 1, 33, 1, 1]);
  });
  it('atenção: teste acabando, vencido, parada e implantação fraca, nessa ordem', () => {
    const p = painelDono([
      E({ nome: 'Parada', ultimoAcesso: '2026-11-15T09:00' }),
      E({ nome: 'Vence', testeAte: '2026-11-28T18:00' }),
      E({ nome: 'Venceu', testeAte: '2026-11-24T10:00' }),
      E({ nome: 'Nunca', ultimoAcesso: '', criadaEm: '2026-11-22T10:00' }),
      E({ nome: 'Fraca', testeAte: '2026-12-05T10:00', implantacao: { a: true, b: false, c: false, d: false, e: false, f: false } }),
      E({ nome: 'Bloqueada', ativa: false, ultimoAcesso: '2026-01-01T00:00' }),
    ], AGORA);
    expect(p.atencao.map(a => [a.empresa.nome, a.motivo])).toEqual([['Vence', 'vence'], ['Venceu', 'vencido'], ['Nunca', 'parada'], ['Parada', 'parada'], ['Fraca', 'implantacao']]);
    expect(p.atencao[0]!.detalhe).toBe('teste acaba em 2 dia(s)');
    expect([p.vencendo, p.paradas]).toEqual([1, 2]);
  });
});
