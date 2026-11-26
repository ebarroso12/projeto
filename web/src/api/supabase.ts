/**
 * Servidor "Supabase" (multiempresa): implementa a mesma interface `Api`, chamando as funções
 * fab_* / fin_* / dre_* do banco. As regras vivem no banco; aqui só há tradução.
 *
 * Particularidades:
 *  - login = código da empresa + usuário: o Supabase Auth usa e-mail, então "alfa" + "ana" vira
 *    "alfa.ana@fabrica.local" (o mesmo login pode existir em empresas diferentes);
 *  - o IP para a regra do Wi-Fi é o que a BORDA do Supabase enxerga (o navegador não envia IP);
 *  - o link "só ver" (?k=) usa as funções *_chave, que não exigem login.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIN_SENHA } from '../lib/rules';
import type { Api } from './client';
import {
  parseBoot, parseDre, parseEmpresas, parseFaltas, parseFin, parsePainel, parseRelatorio, parseUsuarios, parseWifi,
  rec, str, strings, num,
} from './normalize';
import { ApiError, fromServerMessage } from './transport';
import type { FaltaInput, LancamentoInput, LancamentoResultado, UsuarioInput } from './types';

export const emailDe = (empresa: string, login: string) => `${empresa.trim().toLowerCase()}.${login.trim().toLowerCase()}@fabrica.local`;

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
    precisaEmpresa: true,

    login: async (login, senha, empresa) => {
      if (!empresa?.trim()) throw new ApiError('SERVIDOR', 'Informe o código da empresa.');
      const { error } = await sb.auth.signInWithPassword({ email: emailDe(empresa, login), password: senha });
      if (error) {
        if (error.status === 400 || /invalid/i.test(error.message)) throw new ApiError('SERVIDOR', 'Empresa, login ou senha incorretos.');
        if (!error.status || /fetch|network/i.test(error.message)) throw new ApiError('REDE', 'Não foi possível falar com o servidor. Confira a internet.');
        throw new ApiError('SERVIDOR', error.message);
      }
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
    exportar: async () => rpc('fab_exportar'),

    verWifi: async () => parseWifi(await rpc('fab_ver_wifi')),
    salvarWifi: async (exigir, ips) => parseWifi(await rpc('fab_salvar_wifi', { p_exigir: exigir, p_manter: ips.map(i => i.ip) })),
    cadastrarRedeAtual: async nome => parseWifi(await rpc('fab_cadastrar_rede_atual', { p_nome: nome })),

    // ----- dono do sistema -----
    empresas: async () => parseEmpresas(await rpc('fab_empresas')),
    criarEmpresa: async o => { await edge({ action: 'criar_empresa', ...o }); },
    bloquearEmpresa: async (id, bloquear, motivo) => { await rpc('fab_bloquear_empresa', { p_id: id, p_bloquear: bloquear, p_motivo: motivo }); },
    renomearEmpresa: async (id, nome) => { await rpc('fab_renomear_empresa', { p_id: id, p_nome: nome }); },

    // ----- financeiro -----
    finDados: async () => parseFin(await rpc('fin_dados')),
    finSalvarLancamento: async o => str(await rpc('fin_salvar_lancamento', { p: o })),
    finApagarLancamento: async id => { await rpc('fin_apagar_lancamento', { p_id: id }); },
    finPagarParcela: async (id, data, valor, contaId) => { await rpc('fin_pagar_parcela', { p_id: id, p_data: data, p_valor: valor, p_conta: contaId }); },
    finPagarFatura: async (cartaoId, vencimento, valor, contaId, data) => {
      await rpc('fin_pagar_fatura', { p_cartao: cartaoId, p_vencimento: vencimento, p_valor: valor, p_conta: contaId, p_data: data });
    },
    finSalvarConta: async o => str(await rpc('fin_salvar_conta', { p: o })),
    finSalvarCartao: async o => str(await rpc('fin_salvar_cartao', { p: o })),
    finSalvarMeta: async o => str(await rpc('fin_salvar_meta', { p: o })),
    finMovimentarMeta: async (metaId, tipo, valor, data, contaId) => {
      await rpc('fin_movimentar_meta', { p_meta: metaId, p_tipo: tipo, p_valor: valor, p_data: data, p_conta: contaId });
    },
    finSalvarExpectativa: async (mes, entradas, saidas) => { await rpc('fin_salvar_expectativa', { p_mes: mes, p_entradas: entradas, p_saidas: saidas }); },
    finSalvarConfig: async dataInicio => { await rpc('fin_salvar_config', { p_data_inicio: dataInicio }); },
    finSalvarLista: async (tipo, valores) => { await rpc('fin_salvar_lista', { p_tipo: tipo, p_valores: valores }); },

    // ----- resultado (DRE) -----
    dreDados: async () => parseDre(await rpc('dre_dados')),
    dreSalvarMes: async (mes, itens) => ((await rpc('dre_salvar_mes', { p_mes: mes, p_itens: itens })) === 'fechado' ? 'fechado' : 'pendente'),
    dreApagarMes: async mes => { await rpc('dre_apagar_mes', { p_mes: mes }); },
    dreSalvarCategoria: async o => str(await rpc('dre_salvar_categoria', { p: o })),
    dreRestaurarCategorias: async () => { await rpc('dre_restaurar_categorias'); },
  };
}
