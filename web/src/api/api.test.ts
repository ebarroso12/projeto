import { describe, expect, it } from 'vitest';
import { parseBoot, parsePainel, parseRelatorio, parseUsuarios } from './normalize';
import { ApiError, fromServerMessage } from './transport';
import { createApi } from './client';
import { createMockTransport } from './mock';

describe('normalize: o servidor nunca derruba a tela', () => {
  it('aceita respostas vazias, nulas e de tipo errado', () => {
    for (const bad of [undefined, null, 'x', 5, [], {}]) {
      const b = parseBoot(bad);
      expect(b.etapas).toEqual([]);
      expect(b.emFalta).toEqual([]);
      expect(b.eu.admin).toBe(false);
      expect(parsePainel(bad).saldo).toEqual([]);
      expect(parseRelatorio(bad).porEtapa).toEqual({});
      expect(parseUsuarios(bad)).toEqual([]);
    }
  });
  it('converte tipos do servidor (planilha manda texto)', () => {
    const b = parseBoot({
      eu: { nome: 'Ana', admin: 'Sim', leitura: false, podeFalta: 'true' },
      emFalta: [{ id: 7, qtd: '80', feito: '32', falta: '48', status: null }],
      disponivel: [{ modelo: 'A', cor: 'B', tamanho: 'M', Corte: '10', Costura: 4 }],
    });
    expect(b.eu).toMatchObject({ nome: 'Ana', admin: true, podeFalta: true });
    expect(b.emFalta[0]).toMatchObject({ id: '7', qtd: 80, falta: 48, status: 'Urgente' });
    expect(b.disponivel[0]?.valores).toEqual({ Corte: 10, Costura: 4 });
  });
  it('lê situação e permissão de usuários', () => {
    const [u] = parseUsuarios([{ login: 'a', ativo: 'Não', podeFalta: 'Sim' }]);
    expect(u).toMatchObject({ login: 'a', ativo: false, podeFalta: true });
  });
});

describe('erros do servidor', () => {
  it('reconhece WIFI e SESSAO', () => {
    expect(fromServerMessage('Error: WIFI').code).toBe('WIFI');
    expect(fromServerMessage('SESSAO').code).toBe('SESSAO');
    const e = fromServerMessage('Error: Senha incorreta');
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('SERVIDOR');
    expect(e.message).toBe('Senha incorreta');
  });
});

describe('contrato (cliente tipado contra o servidor simulado)', () => {
  const mock = createMockTransport(0);
  let token: string | null = null;
  const api = createApi(mock, () => token);

  it('rejeita login errado e aceita admin', async () => {
    await expect(api.login('admin', 'errada')).rejects.toThrow('incorretos');
    token = await api.login('admin', 'admin');
    expect(token).toBeTruthy();
  });
  it('carrega o boot e o painel', async () => {
    const b = await api.boot();
    expect(b.eu.admin).toBe(true);
    expect(b.etapas).toEqual(['Corte', 'Costura', 'Conferência']);
    const p = await api.painel();
    expect(p.saldo.some(s => s.erro)).toBe(true); // erro plantado no simulado
  });
  it('lança produção e devolve o total', async () => {
    const r = await api.lancar({ etapa: 'Corte', modelo: 'Camisa Polo', cor: 'Preto', obs: '', itens: [{ tamanho: 'M', qtd: 5 }, { tamanho: 'G', qtd: 3 }] });
    expect(r.total).toBe(8);
  });
  it('sessão inválida vira SESSAO', async () => {
    token = 'invalido';
    await expect(api.boot()).rejects.toMatchObject({ code: 'SESSAO' });
  });
});
