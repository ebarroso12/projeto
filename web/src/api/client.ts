import { getIp } from '../lib/network';
import {
  parseAcessos, parseConvites, parseDadosPessoas, parseDestinatarios, parseEmpresaDetalhe, parseEnviadas, parseFuncoesPessoa, parseMensagens, parseRegistros, parseSessoes, parseStatusAcesso,
  parseBoot, parseContrapartes, parseAcerto, parseRemessaOpcoes, parseRemessaPublica, parseRemessasDados, parseVitrineAdmin, parseHistoricoMaterial, parseMateriais, parseMaterialOpcoes, parseLucroModelos, parseProdutividade, parsePedidoOpcoes, parsePedidos, parseContrapartesTotais, parseLancamentos, parseDre, parseEmpresas, parseFaltas, parseFin, parsePainel, parseRelatorio, parseUsuarios, parseWifi,
  rec, str, strings, num,
} from './normalize';
import type { Transport } from './transport';
import type {
  DreCategoriaInput, DreItemInput, FaltaInput, FinLancamentoInput, FinListaTipo, LancamentoInput, LancamentoResultado,
  DadosPessoa, NovaEmpresaInput, NovaEmpresaTesteInput, ConfirmarRemessaInput, ConfirmarRemessaResultado, DaniConfig, DaniMsg, DaniResposta, RemessaPublica, MaterialInput, MovMaterialInput, OrdemCorteInput, PedidoInput, PedidoReceber, QuemFez, RemessaInput, RetornoInput, PedidoStatus, ValorPeca, Vitrine, VitrineAdmin, RegistroInput, TipoRegistro, UsuarioInput,
} from './types';

/**
 * Cliente tipado do servidor por "transporte" (Apps Script ou demonstração).
 * Cada método corresponde a uma função do servidor. O token é lido na hora da chamada.
 * O servidor Supabase implementa esta MESMA interface em supabase.ts.
 */
export function createApi(transport: Transport, getToken: () => string | null) {
  const tok = () => getToken() ?? '';
  const call = (fn: string, ...args: unknown[]) => transport(fn, args);

  return {
    /** true quando o login precisa do código da empresa (servidor multiempresa). */
    precisaEmpresa: false as boolean,

    login: async (login: string, senha: string, _empresa?: string) => str(await call('login', login, senha)),
    loginChave: async (chave: string) => str(await call('loginChave', chave)),
    sair: async () => { await call('sair', tok()); },
    trocarSenha: async (atual: string, nova: string) => { await call('trocarSenha', tok(), atual, nova); },

    // ----- controle de acesso e auditoria -----
    pedirAcesso: async (aparelho: string, descricao: string) => parseStatusAcesso(await call('pedirAcesso', tok(), aparelho, descricao)),
    statusAcesso: async () => parseStatusAcesso(await call('statusAcesso', tok())),
    presenca: async (tela: string) => { await call('presenca', tok(), tela); },
    acessosPendentes: async () => parseSessoes(await call('acessosPendentes', tok())),
    decidirAcesso: async (id: string, liberar: boolean, confiar: boolean) => { await call('decidirAcesso', tok(), id, liberar, confiar); },
    encerrarSessao: async (id: string) => { await call('encerrarSessao', tok(), id); },
    revogarAparelho: async (login: string, aparelho: string) => { await call('revogarAparelho', tok(), login, aparelho); },
    configAcesso: async (exigir: boolean) => { await call('configAcesso', tok(), exigir); },
    acessos: async (ini: string, fim: string) => parseAcessos(await call('acessos', tok(), ini, fim)),

    boot: async () => parseBoot(await call('dadosIniciais', tok(), await getIp())),
    painel: async () => parsePainel(await call('painel', tok())),
    relatorio: async (ini: string, fim: string) => parseRelatorio(await call('relatorio', tok(), ini, fim)),

    baterPonto: async (tipo: 'entrada' | 'saida') => str(await call('baterPonto', tok(), tipo, await getIp())),
    statusRede: async () => (await call('statusRede', tok(), await getIp())) === true,

    lancar: async (o: LancamentoInput): Promise<LancamentoResultado> => {
      const r = rec(await call('lancarVarios', tok(), {
        etapa: o.etapa, modelo: o.modelo, cor: o.cor, obs: o.obs,
        itens: o.itens.map(i => ({ tamanho: i.tamanho, qtd: String(i.qtd) })),
        ip: await getIp(),
      }));
      return { total: num(r.total), avisos: strings(r.avisos) };
    },
    editarLancamento: async (id: string, qtd: number) => { await call('editarLancamento', tok(), id, String(qtd)); },
    apagarLancamento: async (id: string) => { await call('apagarLancamento', tok(), id); },

    addEmFalta: async (o: FaltaInput) => parseFaltas(await call('addEmFalta', tok(), o)),
    statusEmFalta: async (id: string, status: string) => parseFaltas(await call('statusEmFalta', tok(), id, status)),

    listarUsuarios: async () => parseUsuarios(await call('listarUsuarios', tok())),
    salvarUsuario: async (u: UsuarioInput) => { await call('salvarUsuario', tok(), u); },
    salvarLista: async (nome: string, valores: string[]) => strings(await call('salvarLista', tok(), nome, valores)),

    criarChave: async (nome: string): Promise<string> => str(await call('criarChave', tok(), nome)),
    revogarChaves: async (): Promise<number> => num(await call('revogarChaves', tok())),
    /** Cópia de segurança de todos os dados da empresa (JSON). */
    exportar: async (): Promise<unknown> => call('exportar', tok()),
    /** Quando foi a última cópia de segurança da empresa (e por quem). */
    backupSituacao: async (): Promise<{ ultima: string | null; quem: string; dias: number | null }> => {
      const r = rec(await call('backupSituacao', tok()));
      return { ultima: r.ultima ? str(r.ultima) : null, quem: str(r.quem), dias: r.dias === null || r.dias === undefined ? null : num(r.dias) };
    },

    verWifi: async () => parseWifi(await call('verWifi', tok())),
    salvarWifi: async (exigir: boolean, ips: { nome: string; ip: string; em: string }[]) =>
      parseWifi(await call('salvarWifi', tok(), exigir, ips)),
    cadastrarRedeAtual: async (nome: string) =>
      parseWifi(await call('cadastrarRedeAtual', tok(), await getIp(), nome)),

    // ----- dono do sistema -----
    empresas: async () => parseEmpresas(await call('empresas', tok())),
    criarEmpresa: async (o: NovaEmpresaInput) => { await call('criarEmpresa', tok(), o); },
    bloquearEmpresa: async (id: string, bloquear: boolean, motivo: string) => { await call('bloquearEmpresa', tok(), id, bloquear, motivo); },
    // ----- links de teste -----
    convites: async () => parseConvites(await call('convites', tok())),
    criarConvite: async (tipo: 'teste' | 'pro', dias: number, usos: number, validadeDias: number, nota: string) => str(await call('criarConvite', tok(), tipo, dias, usos, validadeDias, nota)),
    empresaDetalhe: async (id: string) => parseEmpresaDetalhe(await call('empresaDetalhe', tok(), id)),
    revogarConvite: async (id: string) => { await call('revogarConvite', tok(), id); },
    ajustarTeste: async (empresaId: string, dias: number | null) => { await call('ajustarTeste', tok(), empresaId, dias); },
    meuTeste: async () => str(await call('meuTeste', tok())),
    vitrine: async (): Promise<Vitrine> => { const r = rec(await call('vitrine')); return { convite: r.convite ? str(r.convite) : null, dias: num(r.dias), whatsapp: r.whatsapp ? str(r.whatsapp) : null }; },
    vitrineAdmin: async (): Promise<VitrineAdmin> => parseVitrineAdmin(await call('vitrineAdmin', tok())),
    linkPublicoCriar: async (dias: number, usos: number, nota: string) => str(await call('linkPublicoCriar', tok(), dias, usos, nota)),
    linkPublicoDesativar: async () => { await call('linkPublicoDesativar', tok()); },
    salvarContatoVitrine: async (whatsapp: string) => { await call('salvarContatoVitrine', tok(), whatsapp); },
    validarConvite: async (convite: string) => { const r = rec(await call('validarConvite', convite)); return { valido: r.valido === true, tipo: (str(r.tipo) === 'pro' ? 'pro' : 'teste') as 'teste' | 'pro', dias: num(r.dias), ate: str(r.ate) }; },
    criarEmpresaTeste: async (o: NovaEmpresaTesteInput) => { await call('criarEmpresaTeste', o); },
    bloquearPessoa: async (login: string, bloquear: boolean) => { await call('bloquearPessoa', tok(), login, bloquear); },
    // ----- cadastros gerais -----
    registros: async (tipo: TipoRegistro) => parseRegistros(await call('registros', tok(), tipo)),
    salvarRegistro: async (o: RegistroInput) => str(await call('salvarRegistro', tok(), o)),
    apagarRegistro: async (id: string) => { await call('apagarRegistro', tok(), id); },
    dadosPessoas: async () => parseDadosPessoas(await call('dadosPessoas', tok())),
    salvarDadosPessoa: async (login: string, dados: DadosPessoa) => { await call('salvarDadosPessoa', tok(), login, dados); },
    // ----- mensagens -----
    minhasMensagens: async () => parseMensagens(await call('minhasMensagens', tok())),
    marcarLidas: async (ids: string[]) => { await call('marcarLidas', tok(), ids); },
    destinatarios: async () => parseDestinatarios(await call('destinatarios', tok())),
    enviarMensagem: async (para: string, titulo: string, texto: string, importante: boolean) => str(await call('enviarMensagem', tok(), para, titulo, texto, importante)),
    mensagensEnviadas: async () => parseEnviadas(await call('mensagensEnviadas', tok())),
    apagarMensagem: async (id: string) => { await call('apagarMensagem', tok(), id); },
    funcoesPessoa: async (login: string) => parseFuncoesPessoa(await call('funcoesPessoa', tok(), login)),
    salvarFuncoes: async (login: string, funcoes: Record<string, boolean>) => { await call('salvarFuncoes', tok(), login, funcoes); },
    renomearEmpresa: async (id: string, nome: string) => { await call('renomearEmpresa', tok(), id, nome); },

    // ----- pedidos -----
    pedidos: async (dias = 120) => parsePedidos(await call('pedidos', tok(), dias)),
    pedidoOpcoes: async () => parsePedidoOpcoes(await call('pedidoOpcoes', tok())),
    salvarPedido: async (o: PedidoInput) => { const r = rec(await call('salvarPedido', tok(), o)); return { id: str(r.id), numero: num(r.numero) }; },
    statusPedido: async (id: string, status: PedidoStatus, receber: PedidoReceber = null) => { await call('statusPedido', tok(), id, status, receber); },
    apagarPedido: async (id: string) => { await call('apagarPedido', tok(), id); },

    // ----- produtividade e lucro -----
    produtividade: async (ini: string, fim: string) => parseProdutividade(await call('produtividade', tok(), ini, fim)),
    salvarValoresPeca: async (valores: ValorPeca[]) => { await call('salvarValoresPeca', tok(), valores); },
    finFecharProducao: async (ini: string, fim: string, contaId: string, data: string, logins: string[]) => num(await call('finFecharProducao', tok(), ini, fim, contaId, data, logins)),
    finDesfazerFechamento: async (id: string) => { await call('finDesfazerFechamento', tok(), id); },
    dreLucroModelos: async (ini: string, fim: string) => parseLucroModelos(await call('dreLucroModelos', tok(), ini, fim)),

    // ----- matéria-prima -----
    materiais: async () => parseMateriais(await call('materiais', tok())),
    salvarMaterial: async (o: MaterialInput) => str(await call('salvarMaterial', tok(), o)),
    apagarMaterial: async (id: string) => { await call('apagarMaterial', tok(), id); },
    movimentarMaterial: async (o: MovMaterialInput) => str(await call('movimentarMaterial', tok(), o)),
    movsMaterial: async (id: string) => parseHistoricoMaterial(await call('movsMaterial', tok(), id)),
    apagarMovMaterial: async (id: string) => { await call('apagarMovMaterial', tok(), id); },
    materialOpcoes: async () => parseMaterialOpcoes(await call('materialOpcoes', tok())),

    // ----- avisos no celular -----
    pushInscrever: async (o: { endpoint: string; p256dh: string; auth: string; aparelho: string }) => { await call('pushInscrever', tok(), o); },
    pushCancelar: async (endpoint: string) => { await call('pushCancelar', tok(), endpoint); },
    pushStatus: async (endpoint: string) => { const r = rec(await call('pushStatus', tok(), endpoint)); return { esteAparelho: r.esteAparelho === true, aparelhos: num(r.aparelhos), configurado: r.configurado === true }; },

    // ----- oficinas e remessas -----
    remessas: async (dias = 120) => parseRemessasDados(await call('remessas', tok(), dias)),
    remessaOpcoes: async () => parseRemessaOpcoes(await call('remessaOpcoes', tok())),
    /** Link da oficina para a remessa (cria na primeira vez; novo = troca e o antigo para de funcionar). */
    remessaLink: async (id: string, novo = false): Promise<string> => str(await call('remessaLink', tok(), id, novo)),
    /** Sobra de tecido da ordem de corte que voltou ao estoque (0 = tira a sobra). */
    registrarSobra: async (ordemId: string, qtd: number, data: string | null) => { await call('registrarSobra', tok(), ordemId, qtd, data); },
    salvarLimitePerda: async (limite: number): Promise<number> => num(await call('salvarLimitePerda', tok(), limite)),
    /** Fecha a contestação da oficina registrando o que foi decidido (retornoId null = envio). */
    resolverContestacao: async (remessaId: string, retornoId: string | null, nota: string) => { await call('resolverContestacao', tok(), remessaId, retornoId, nota); },
    /** Página da oficina (sem login): o token do link é a autorização. */
    remessaPublica: async (token: string): Promise<RemessaPublica> => parseRemessaPublica(await call('remessaPublica', token)),
    remessaConfirmar: async (token: string, p: ConfirmarRemessaInput): Promise<ConfirmarRemessaResultado> => {
      const r = rec(await call('remessaConfirmar', token, p)); return { confere: r.confere === true, fabrica: num(r.fabrica), oficina: num(r.oficina) };
    },
    salvarOrdemCorte: async (o: OrdemCorteInput) => { const r = rec(await call('salvarOrdemCorte', tok(), o)); return { id: str(r.id), numero: num(r.numero), pecas: num(r.pecas) }; },
    apagarOrdemCorte: async (id: string) => { await call('apagarOrdemCorte', tok(), id); },
    salvarRemessa: async (o: RemessaInput) => { const r = rec(await call('salvarRemessa', tok(), o)); return { id: str(r.id), numero: num(r.numero), pecas: num(r.pecas) }; },
    apagarRemessa: async (id: string) => { await call('apagarRemessa', tok(), id); },
    registrarRetorno: async (o: RetornoInput) => str(await call('registrarRetorno', tok(), o)),
    apagarRetorno: async (id: string) => { await call('apagarRetorno', tok(), id); },
    fecharRemessa: async (id: string, pagar: { contaId: string; data: string } | null) => parseAcerto(await call('fecharRemessa', tok(), id, pagar)),
    reabrirRemessa: async (id: string) => { await call('reabrirRemessa', tok(), id); },
    lancarPor: async (por: QuemFez, o: LancamentoInput) => (r => ({ total: num(r.total), avisos: strings(r.avisos) }))(rec(await call('lancarPor', tok(), por, o))),

    // ----- Dani (assistente) -----
    /** Demonstração/Apps Script: sem IA — a Dani responde pelo manual (busca local). */
    daniPerguntar: async (_pergunta: string, _historico: DaniMsg[], _tela: string): Promise<DaniResposta> =>
      ({ erro: 'nao_configurado', mensagem: 'Na demonstração a Dani responde pelo manual.' }),
    daniConfig: async (): Promise<DaniConfig> => { const r = rec(await call('daniConfig', tok())); return { configurada: r.configurada === true, final: r.final ? str(r.final) : null, modelo: str(r.modelo), perguntasHoje: num(r.perguntasHoje) }; },
    salvarDani: async (chave: string, modelo: string) => { await call('salvarDani', tok(), chave, modelo); },
    /** Só o dono: modelos que a chave do Gemini aceita (não conta como pergunta). */
    daniModelos: async (): Promise<{ modelos: string[]; recomendados: string[] }> => { const r = rec(await call('daniModelos', tok())); return { modelos: strings(r.modelos), recomendados: strings(r.recomendados) }; },

    // ----- financeiro -----
    finDados: async () => parseFin(await call('finDados', tok())),
    finSalvarLancamento: async (o: FinLancamentoInput) => str(await call('finSalvarLancamento', tok(), o)),
    finContrapartes: async () => parseContrapartes(await call('finContrapartes', tok())),
    finContraparteLancamentos: async (id: string) => parseLancamentos(await call('finContraparteLancamentos', tok(), id)),
    finContrapartesTotais: async (ano: number) => parseContrapartesTotais(await call('finContrapartesTotais', tok(), ano)),
    finApagarLancamento: async (id: string) => { await call('finApagarLancamento', tok(), id); },
    finPagarParcela: async (id: string, data: string, valor: number, contaId: string | null) => { await call('finPagarParcela', tok(), id, data, valor, contaId); },
    finReceberParcela: async (id: string, data: string, valor: number, contaId: string | null) => { await call('finReceberParcela', tok(), id, data, valor, contaId); },
    finPagarFatura: async (cartaoId: string, vencimento: string, valor: number, contaId: string, data: string) => {
      await call('finPagarFatura', tok(), cartaoId, vencimento, valor, contaId, data);
    },
    finSalvarConta: async (o: { id?: string; nome: string; saldoInicial: number; ativa?: boolean }) => str(await call('finSalvarConta', tok(), o)),
    finSalvarCartao: async (o: { id?: string; nome: string; diaFechamento: number; diaVencimento: number; ativo?: boolean }) => str(await call('finSalvarCartao', tok(), o)),
    finSalvarMeta: async (o: { id?: string; nome: string; valorMeta: number; dataAlvo?: string | null; ativa?: boolean }) => str(await call('finSalvarMeta', tok(), o)),
    finMovimentarMeta: async (metaId: string, tipo: 'deposito' | 'retirada', valor: number, data: string, contaId: string) => {
      await call('finMovimentarMeta', tok(), metaId, tipo, valor, data, contaId);
    },
    finSalvarExpectativa: async (mes: string, entradas: number, saidas: Record<string, number>) => { await call('finSalvarExpectativa', tok(), mes, entradas, saidas); },
    finSalvarConfig: async (dataInicio: string) => { await call('finSalvarConfig', tok(), dataInicio); },
    finSalvarLista: async (tipo: FinListaTipo, valores: string[]) => { await call('finSalvarLista', tok(), tipo, valores); },

    // ----- resultado (DRE) -----
    dreDados: async () => parseDre(await call('dreDados', tok())),
    dreSalvarMes: async (mes: string, itens: DreItemInput[]) => (str(await call('dreSalvarMes', tok(), mes, itens)) === 'fechado' ? 'fechado' : 'pendente') as 'fechado' | 'pendente',
    dreApagarMes: async (mes: string) => { await call('dreApagarMes', tok(), mes); },
    dreSalvarCategoria: async (o: DreCategoriaInput) => str(await call('dreSalvarCategoria', tok(), o)),
    dreRestaurarCategorias: async () => { await call('dreRestaurarCategorias', tok()); },
  };
}

export type Api = ReturnType<typeof createApi>;
