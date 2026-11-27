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
import { aparelhoId, descreverAparelho } from '../lib/aparelho';
import type { Api } from './client';
import {
  parseAcessos, parseConvites, parseDadosPessoas, parseDestinatarios, parseEmpresaDetalhe, parseEnviadas, parseFuncoesPessoa, parseMensagens, parseRegistros, parseSessoes, parseStatusAcesso,
  parseBoot, parseContrapartes, parseDre, parseEmpresas, parseFaltas, parseFin, parsePainel, parseRelatorio, parseUsuarios, parseWifi,
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
      // registra a sessão: administrador entra direto; os demais aguardam liberação (ou aparelho confiável)
      try { await rpc('fab_pedir_acesso', { p_aparelho: aparelhoId(), p_descricao: descreverAparelho() }); } catch { /* o boot mostra o motivo */ }
      return 'sb'; // marcador: a sessão real fica com o supabase-js
    },
    loginChave: async k => {
      if ((await rpc('fab_validar_chave', { p_chave: k })) !== true) throw new ApiError('SERVIDOR', 'Link de acesso inválido.');
      chave = k;
      return 'key';
    },
    sair: async () => {
      if (!chave) await rpc('fab_sair_sessao').catch(() => {});
      chave = null;
      await sb.auth.signOut();
    },
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

    pedirAcesso: async (aparelho, descricao) => parseStatusAcesso(await rpc('fab_pedir_acesso', { p_aparelho: aparelho, p_descricao: descricao })),
    statusAcesso: async () => parseStatusAcesso(await rpc('fab_status_acesso')),
    presenca: async tela => { if (!chave) await rpc('fab_presenca', { p_tela: tela }); },
    acessosPendentes: async () => parseSessoes(await rpc('fab_acessos_pendentes')),
    decidirAcesso: async (id, liberar, confiar) => { await rpc('fab_decidir_acesso', { p_id: id, p_liberar: liberar, p_confiar: confiar }); },
    encerrarSessao: async id => { await rpc('fab_encerrar_sessao', { p_id: id }); },
    revogarAparelho: async (login, aparelho) => { await rpc('fab_revogar_aparelho', { p_login: login, p_aparelho: aparelho }); },
    configAcesso: async exigir => { await rpc('fab_config_acesso', { p_exigir: exigir }); },
    acessos: async (ini, fim) => parseAcessos(await rpc('fab_acessos', { p_ini: ini, p_fim: fim })),
    exportar: async () => rpc('fab_exportar'),

    verWifi: async () => parseWifi(await rpc('fab_ver_wifi')),
    salvarWifi: async (exigir, ips) => parseWifi(await rpc('fab_salvar_wifi', { p_exigir: exigir, p_manter: ips.map(i => i.ip) })),
    cadastrarRedeAtual: async nome => parseWifi(await rpc('fab_cadastrar_rede_atual', { p_nome: nome })),

    // ----- dono do sistema -----
    empresas: async () => parseEmpresas(await rpc('fab_empresas')),
    criarEmpresa: async o => { await edge({ action: 'criar_empresa', ...o }); },
    bloquearEmpresa: async (id, bloquear, motivo) => { await rpc('fab_bloquear_empresa', { p_id: id, p_bloquear: bloquear, p_motivo: motivo }); },
    convites: async () => parseConvites(await rpc('fab_convites')),
    criarConvite: async (tipo, dias, usos, validadeDias, nota) => str(await rpc('fab_criar_convite', { p_tipo: tipo, p_dias: dias, p_usos: usos, p_validade_dias: validadeDias, p_nota: nota })),
    empresaDetalhe: async id => parseEmpresaDetalhe(await rpc('fab_empresa_detalhe', { p_id: id })),
    revogarConvite: async id => { await rpc('fab_revogar_convite', { p_id: id }); },
    ajustarTeste: async (empresaId, dias) => { await rpc('fab_ajustar_teste', { p_empresa: empresaId, p_dias: dias }); },
    meuTeste: async () => (chave ? '' : str(await rpc('fab_meu_teste'))),
    validarConvite: async convite => { const r = rec(await rpc('fab_validar_convite', { p_token: convite })); return { valido: r.valido === true, tipo: (str(r.tipo) === 'pro' ? 'pro' : 'teste') as 'teste' | 'pro', dias: num(r.dias), ate: str(r.ate) }; },
    criarEmpresaTeste: async o => { await edge({ action: 'teste', ...o }); },
    bloquearPessoa: async (login, bloquear) => { await rpc('fab_bloquear_pessoa', { p_login: login, p_bloquear: bloquear }); },
    registros: async tipo => parseRegistros(await rpc('fab_registros', { p_tipo: tipo })),
    salvarRegistro: async o => str(await rpc('fab_salvar_registro', { p: o })),
    apagarRegistro: async id => { await rpc('fab_apagar_registro', { p_id: id }); },
    dadosPessoas: async () => parseDadosPessoas(await rpc('fab_dados_pessoas')),
    salvarDadosPessoa: async (login, dados) => { await rpc('fab_salvar_dados_pessoa', { p_login: login, p_dados: dados }); },
    minhasMensagens: async () => (chave ? [] : parseMensagens(await rpc('fab_minhas_mensagens'))),
    marcarLidas: async ids => { if (ids.length) await rpc('fab_marcar_lidas', { p_ids: ids }); },
    destinatarios: async () => parseDestinatarios(await rpc('fab_destinatarios')),
    enviarMensagem: async (para, titulo, texto, importante) => str(await rpc('fab_enviar_mensagem', { p_para: para, p_titulo: titulo, p_texto: texto, p_importante: importante })),
    mensagensEnviadas: async () => parseEnviadas(await rpc('fab_mensagens_enviadas')),
    apagarMensagem: async id => { await rpc('fab_apagar_mensagem', { p_id: id }); },
    funcoesPessoa: async login => parseFuncoesPessoa(await rpc('fab_funcoes_pessoa', { p_login: login })),
    salvarFuncoes: async (login, funcoes) => { await rpc('fab_salvar_funcoes', { p_login: login, p_funcoes: funcoes }); },
    renomearEmpresa: async (id, nome) => { await rpc('fab_renomear_empresa', { p_id: id, p_nome: nome }); },

    // ----- financeiro -----
    finDados: async () => parseFin(await rpc('fin_dados')),
    finSalvarLancamento: async o => str(await rpc('fin_salvar_lancamento', { p: o })),
    finContrapartes: async () => parseContrapartes(await rpc('fin_contrapartes')),
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
