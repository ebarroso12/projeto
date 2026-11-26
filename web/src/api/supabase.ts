/**
 * Servidor "Supabase": implementa a mesma interface `Api` do Apps Script, chamando as funções
 * fab_* do banco (supabase/migrations). As regras vivem no banco; aqui só há tradução.
 *
 * Particularidades:
 *  - login por nome de usuário: o Supabase Auth usa e-mail, então "ana" vira "ana@fabrica.local";
 *  - o IP para a regra do Wi-Fi é o que o SERVIDOR enxerga (o navegador não envia IP);
 *  - o link "só ver" (?k=) usa as funções *_chave, que não exigem login.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIN_SENHA } from '../lib/rules';
import type { Api } from './client';
import { parseBoot, parseFaltas, parsePainel, parseRelatorio, parseUsuarios, parseWifi, rec, str, strings, num } from './normalize';
import { ApiError, fromServerMessage } from './transport';
import type { FaltaInput, LancamentoInput, LancamentoResultado, UsuarioInput } from './types';

const emailDe = (login: string) => `${login.trim().toLowerCase()}@fabrica.local`;

interface PgError { message: string; code?: string; status?: number }

/** Traduz erros do Postgres/PostgREST para os mesmos códigos usados pelo resto do app. */
export function mapError(e: PgError): ApiError {
  const m = e.message ?? '';
  // 42501 = função sem permissão para o papel atual: acontece quando não há sessão válida
  if (e.code === '42501' || e.code === 'PGRST301' || e.code === 'PGRST303' || e.status === 401 || /jwt/i.test(m)) {
    return new ApiError('SESSAO', 'Sua sessão expirou. Entre de novo.');
  }
  if (!e.code && /fetch|network|load failed/i.test(m)) {
    return new ApiError('REDE', 'Não foi possível falar com o servidor. Confira a internet.');
  }
  return fromServerMessage(m);
}

export function createSupabaseApi(sb: SupabaseClient): Api {
  let chave: string | null = null; // preenchida quando a sessão é um link "só ver"

  const rpc = async (fn: string, args?: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw mapError(error);
    return data;
  };

  const edge = async (body: Record<string, unknown>): Promise<void> => {
    const { data, error } = await sb.functions.invoke('usuarios', { body });
    if (error) {
      let msg = error.message;
      try {
        const res = (error as { context?: Response }).context;
        const j = res ? ((await res.json()) as { error?: string }) : null;
        if (j?.error) msg = j.error;
      } catch { /* mantém a mensagem original */ }
      throw fromServerMessage(msg);
    }
    const err = (data as { error?: unknown } | null)?.error;
    if (err) throw fromServerMessage(String(err));
  };

  return {
    login: async (login, senha) => {
      const { error } = await sb.auth.signInWithPassword({ email: emailDe(login), password: senha });
      if (error) throw new ApiError('SERVIDOR', 'Login ou senha incorretos.');
      chave = null;
      return 'sb'; // marcador: a sessão real fica com o supabase-js
    },
    loginChave: async k => {
      if ((await rpc('fab_validar_chave', { p_chave: k })) !== true) throw new ApiError('SERVIDOR', 'Link de acesso inválido.');
      chave = k;
      return 'key';
    },
    sair: async () => { chave = null; await sb.auth.signOut(); },
    trocarSenha: async (atual, nova) => {
      if (nova.length < MIN_SENHA) throw new ApiError('SERVIDOR', `A nova senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
      const { data } = await sb.auth.getUser();
      const email = data.user?.email;
      if (!email) throw new ApiError('SESSAO', 'Sua sessão expirou. Entre de novo.');
      const check = await sb.auth.signInWithPassword({ email, password: atual });
      if (check.error) throw new ApiError('SERVIDOR', 'Senha atual incorreta.');
      const { error } = await sb.auth.updateUser({ password: nova });
      if (error) throw new ApiError('SERVIDOR', error.message);
    },

    boot: async () => parseBoot(await (chave ? rpc('fab_boot_chave', { p_chave: chave }) : rpc('fab_boot'))),
    painel: async () => parsePainel(await (chave ? rpc('fab_painel_chave', { p_chave: chave }) : rpc('fab_painel'))),
    relatorio: async (ini, fim) =>
      parseRelatorio(await (chave
        ? rpc('fab_relatorio_chave', { p_chave: chave, p_ini: ini, p_fim: fim })
        : rpc('fab_relatorio', { p_ini: ini, p_fim: fim }))),

    baterPonto: async tipo => str(await rpc('fab_bater_ponto', { p_tipo: tipo })),
    statusRede: async () => (await rpc('fab_status_rede')) === true,

    lancar: async (o: LancamentoInput): Promise<LancamentoResultado> => {
      const r = rec(await rpc('fab_lancar', { p_etapa: o.etapa, p_modelo: o.modelo, p_cor: o.cor, p_obs: o.obs, p_itens: o.itens }));
      return { total: num(r.total), avisos: strings(r.avisos) };
    },
    editarLancamento: async (id, qtd) => { await rpc('fab_editar_lancamento', { p_id: id, p_qtd: qtd }); },
    apagarLancamento: async id => { await rpc('fab_apagar_lancamento', { p_id: id }); },

    addEmFalta: async (o: FaltaInput) =>
      parseFaltas(await rpc('fab_add_em_falta', {
        p_modelo: o.modelo, p_cor: o.cor, p_tamanho: o.tamanho, p_qtd: Number.parseInt(o.qtd, 10) || 0, p_obs: o.obs,
      })),
    statusEmFalta: async (id, status) => parseFaltas(await rpc('fab_status_em_falta', { p_id: id, p_status: status })),

    listarUsuarios: async () => parseUsuarios(await rpc('fab_listar_usuarios')),
    salvarUsuario: async (u: UsuarioInput) => {
      if (u.novo) {
        await edge({ action: 'criar', login: u.login, nome: u.nome, senha: u.senha, setor: u.setor, perfil: u.perfil, podeFalta: u.podeFalta === 'Sim' });
        return;
      }
      await rpc('fab_atualizar_perfil', {
        p_login: u.login, p_nome: u.nome, p_setor: u.setor, p_perfil: u.perfil, p_ativo: u.ativo !== 'Não', p_pode_falta: u.podeFalta === 'Sim',
      });
      if (u.senha) await edge({ action: 'senha', login: u.login, senha: u.senha });
    },
    salvarLista: async (nome, valores) => strings(await rpc('fab_salvar_lista', { p_nome: nome, p_valores: valores })),

    criarChave: async nome => str(await rpc('fab_criar_chave', { p_nome: nome })),
    revogarChaves: async () => num(await rpc('fab_revogar_chaves')),

    verWifi: async () => parseWifi(await rpc('fab_ver_wifi')),
    salvarWifi: async (exigir, ips) => parseWifi(await rpc('fab_salvar_wifi', { p_exigir: exigir, p_manter: ips.map(i => i.ip) })),
    cadastrarRedeAtual: async nome => parseWifi(await rpc('fab_cadastrar_rede_atual', { p_nome: nome })),
  };
}
