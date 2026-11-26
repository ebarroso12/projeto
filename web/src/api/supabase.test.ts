import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import boot from './__fixtures__/supabase-boot.json';
import painel from './__fixtures__/supabase-painel.json';
import relatorio from './__fixtures__/supabase-relatorio.json';
import fin from './__fixtures__/supabase-fin.json';
import dre from './__fixtures__/supabase-dre.json';
import { parseBoot, parseDre, parseFin, parsePainel, parseRelatorio } from './normalize';
import { calcularDre } from '../features/dre/calc';
import { faturasAbertas, saldoTotal } from '../features/financeiro/calc';
import { createSupabaseApi, mapError } from './supabase';

type Reply = { data?: unknown; error?: { message: string; code?: string } | null };

/** Cliente falso: grava as chamadas e devolve respostas combinadas. */
function fake(replies: Record<string, Reply> = {}) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const auth = {
    signInWithPassword: vi.fn(async () => ({ data: {}, error: null as { message: string } | null })),
    signOut: vi.fn(async () => ({ error: null })),
    getUser: vi.fn(async () => ({ data: { user: { email: 'ana@fabrica.local' } } })),
    updateUser: vi.fn(async () => ({ error: null })),
  };
  const functions = { invoke: vi.fn(async () => ({ data: { ok: true }, error: null as { message: string } | null })) };
  const sb = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: null, error: null, ...replies[fn] };
    },
    auth, functions,
  } as unknown as SupabaseClient;
  return { sb, calls, auth, functions };
}

describe('respostas reais do banco (geradas pelos testes do Postgres) são entendidas pelo app', () => {
  it('carga inicial', () => {
    const b = parseBoot(boot);
    expect(b.eu).toMatchObject({ nome: 'Carla Dias', admin: false, leitura: false, podeFalta: true });
    expect(b.etapas).toEqual(['Corte', 'Costura', 'Conferência']);
    expect(b.modelos).toEqual(['Camisa Polo', 'Calça Jeans']);
    expect(b.horaFim).toBe('17:30');
    expect(b.disponivel.length).toBeGreaterThan(0);
    expect(Object.keys(b.disponivel[0]!.valores).sort()).toEqual(['Conferência', 'Corte', 'Costura']);
    expect(b.meusHoje.every(l => l.id && l.hora && l.qtd > 0)).toBe(true);
  });
  it('painel', () => {
    const p = parsePainel(painel);
    expect(p.saldo.some(s => s.erro)).toBe(true);
    expect(Object.keys(p.prodHoje).sort()).toEqual(['Conferência', 'Corte', 'Costura']);
    expect(p.presenca.length).toBeGreaterThan(0);
  });
  it('relatório', () => {
    const r = parseRelatorio(relatorio);
    expect(r.diasUteis).toBe(4);
    const ana = r.pessoas.find(x => x.nome === 'Ana Souza')!;
    expect(ana).toMatchObject({ diasTrab: 2, horas: '19:30', extras: '1:00' });
    expect(ana.faltas).toHaveLength(2);
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0]).toMatchObject({ entrada: '08:00', saida: '18:30', extra: '1:00', auto: false });
  });
});

describe('tradução de erros do Postgres', () => {
  it('códigos de negócio', () => {
    expect(mapError({ message: 'WIFI', code: 'P0001' }).code).toBe('WIFI');
    expect(mapError({ message: 'SESSAO', code: 'P0001' }).code).toBe('SESSAO');
    const e = mapError({ message: 'Seu setor não lança esta etapa.', code: 'P0001' });
    expect(e).toMatchObject({ code: 'SERVIDOR', message: 'Seu setor não lança esta etapa.' });
  });
  it('sem sessão (função sem permissão ou JWT vencido) vira SESSAO', () => {
    expect(mapError({ message: 'permission denied for function fab_boot', code: '42501' }).code).toBe('SESSAO');
    expect(mapError({ message: 'JWT expired', code: 'PGRST303' }).code).toBe('SESSAO');
  });
  it('queda de rede vira REDE', () => {
    expect(mapError({ message: 'TypeError: Failed to fetch' }).code).toBe('REDE');
  });
});

describe('adaptador Supabase', () => {
  it('login usa e-mail interno e recusa senha errada', async () => {
    const { sb, auth } = fake();
    const api = createSupabaseApi(sb);
    expect(await api.login('  Ana ', 'segredo1', ' Alfa ')).toBe('sb');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'alfa.ana@fabrica.local', password: 'segredo1' });
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } });
    await expect(api.login('ana', 'x', 'alfa')).rejects.toThrow('Empresa, login ou senha incorretos.');
    await expect(api.login('ana', 'x')).rejects.toThrow('Informe o código da empresa.');
  });

  it('lança produção com os parâmetros nomeados do banco', async () => {
    const { sb, calls } = fake({ fab_lancar: { data: { total: 8, avisos: ['G: aviso'] } } });
    const r = await createSupabaseApi(sb).lancar({ etapa: 'Corte', modelo: 'M', cor: 'C', obs: '', itens: [{ tamanho: 'G', qtd: 8 }] });
    expect(r).toEqual({ total: 8, avisos: ['G: aviso'] });
    expect(calls[0]).toEqual({ fn: 'fab_lancar', args: { p_etapa: 'Corte', p_modelo: 'M', p_cor: 'C', p_obs: '', p_itens: [{ tamanho: 'G', qtd: 8 }] } });
  });

  it('erro de negócio do banco chega como mensagem', async () => {
    const { sb } = fake({ fab_bater_ponto: { error: { message: 'Entrada já marcada hoje.', code: 'P0001' } } });
    await expect(createSupabaseApi(sb).baterPonto('entrada')).rejects.toThrow('Entrada já marcada hoje.');
  });

  it('link "só ver" usa as funções *_chave e nunca as de usuário', async () => {
    const { sb, calls } = fake({ fab_validar_chave: { data: true }, fab_boot_chave: { data: boot } });
    const api = createSupabaseApi(sb);
    expect(await api.loginChave('a'.repeat(32))).toBe('key');
    await api.boot();
    await api.painel();
    await api.relatorio('2026-11-01', '2026-11-30');
    expect(calls.map(c => c.fn)).toEqual(['fab_validar_chave', 'fab_boot_chave', 'fab_painel_chave', 'fab_relatorio_chave']);
    expect(calls[3]!.args).toEqual({ p_chave: 'a'.repeat(32), p_ini: '2026-11-01', p_fim: '2026-11-30' });
  });

  it('gera e revoga links de acompanhamento', async () => {
    const { sb, calls } = fake({ fab_criar_chave: { data: 'f'.repeat(32) }, fab_revogar_chaves: { data: 2 } });
    const api = createSupabaseApi(sb);
    expect(await api.criarChave('TV')).toBe('f'.repeat(32));
    expect(await api.revogarChaves()).toBe(2);
    expect(calls).toEqual([{ fn: 'fab_criar_chave', args: { p_nome: 'TV' } }, { fn: 'fab_revogar_chaves', args: undefined }]);
  });

  it('chave inválida é recusada', async () => {
    const { sb } = fake({ fab_validar_chave: { data: false } });
    await expect(createSupabaseApi(sb).loginChave('x'.repeat(32))).rejects.toThrow('Link de acesso inválido.');
  });

  it('Wi-Fi: manda só os IPs que continuam cadastrados', async () => {
    const { sb, calls } = fake({ fab_salvar_wifi: { data: { exigir: true, ips: [] } } });
    await createSupabaseApi(sb).salvarWifi(true, [{ nome: 'A', ip: '1.1.1.1', em: '' }, { nome: 'B', ip: '2.2.2.2', em: '' }]);
    expect(calls[0]!.args).toEqual({ p_exigir: true, p_manter: ['1.1.1.1', '2.2.2.2'] });
  });

  it('usuário novo passa pela função de borda; edição usa o banco e só chama a borda se houver senha', async () => {
    const { sb, calls, functions } = fake();
    const api = createSupabaseApi(sb);
    const base = { nome: 'Teste', login: 'teste', setor: 'Costureira', perfil: 'funcionario', ativo: 'Sim', podeFalta: 'Não' } as const;
    await api.salvarUsuario({ ...base, novo: true, senha: '123456' });
    expect(functions.invoke).toHaveBeenCalledWith('usuarios', { body: expect.objectContaining({ action: 'criar', login: 'teste', senha: '123456' }) });
    expect(calls).toHaveLength(0);

    await api.salvarUsuario({ ...base, novo: false, senha: '' });
    expect(calls.map(c => c.fn)).toEqual(['fab_atualizar_perfil']);
    expect(functions.invoke).toHaveBeenCalledTimes(1);

    await api.salvarUsuario({ ...base, novo: false, senha: 'nova123' });
    expect(functions.invoke).toHaveBeenLastCalledWith('usuarios', { body: { action: 'senha', login: 'teste', senha: 'nova123' } });
  });

  it('trocar senha confere a atual e exige o mínimo', async () => {
    const { sb, auth } = fake();
    const api = createSupabaseApi(sb);
    await expect(api.trocarSenha('atual1', '123')).rejects.toThrow('pelo menos 6');
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'bad' } });
    await expect(api.trocarSenha('errada', 'nova1234')).rejects.toThrow('Senha atual incorreta.');
    await api.trocarSenha('atual1', 'nova1234');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'nova1234' });
  });
});

describe('contratos do financeiro e do resultado (saída real do banco)', () => {
  it('fin_dados vira FinDados utilizável pelos cálculos', () => {
    const d = parseFin(fin);
    expect(d.contas.length).toBeGreaterThan(0);
    expect(d.listas.categorias.length).toBeGreaterThan(0);
    expect(Number.isFinite(saldoTotal(d))).toBe(true);
    expect(Array.isArray(faturasAbertas(d))).toBe(true);
  });
  it('dre_dados vira DreDados com as categorias padrão', () => {
    const d = parseDre(dre);
    expect(d.categorias.length).toBeGreaterThanOrEqual(18);
    const r = calcularDre(d.categorias, d.meses[0]?.valores ?? {});
    expect(r.final).toBeCloseTo(r.operacional + r.financeiro);
  });
});
