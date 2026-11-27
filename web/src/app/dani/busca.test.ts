import { describe, expect, it } from 'vitest';
import { buscar, respostaDoManual, SECOES } from './busca';
import edge from '../../../../supabase/functions/dani/conhecimento.json';

describe('Dani: busca no manual', () => {
  it('acha a seção certa pelas palavras do dia a dia', () => {
    expect(buscar('como mando as peças para a costureira?')[0]?.id).toBe('remessa');
    expect(buscar('quanto pagar pra facção no acerto')[0]?.id).toBe('acerto');
    expect(buscar('esqueci a senha')[0]?.id).toBe('entrar');
    expect(buscar('rendimento da bobina de malha')[0]?.id).toBe('ordem-corte');
    expect(buscar('ligar notificações no celular')[0]?.id).toBe('instalar');
  });
  it('sem resultado responde com orientação', () => {
    expect(respostaDoManual('xyzw')).toMatch(/Não achei/);
    expect(respostaDoManual('registrar retorno da remessa')).toMatch(/\[\[ir:\/remessas\|/);
  });
  it('a base da função de borda é a mesma do app', () => {
    expect(edge).toEqual(SECOES);
  });
});
