import { getIp } from '../lib/network';
import {
  parseAcessos, parseConvites, parseDadosPessoas, parseDestinatarios, parseEmpresaDetalhe, parseEnviadas, parseFuncoesPessoa, parseMensagens, parseRegistros, parseSessoes, parseStatusAcesso,
  parseBoot, parseContrapartes, parseHistoricoMaterial, parseMateriais, parseMaterialOpcoes, parseLucroModelos, parseProdutividade, parsePedidoOpcoes, parsePedidos, parseContrapartesTotais, parseLancamentos, parseDre, parseEmpresas, parseFaltas, parseFin, parsePainel, parseRelatorio, parseUsuarios, parseWifi,
  rec, str, strings, num,
} from './normalize';
import type { Transport } from './transport';
import type {
  DreCategoriaInput, DreItemInput, FaltaInput, FinLancamentoInput, FinListaTipo, LancamentoInput, LancamentoResultado,
  DadosPessoa, NovaEmpresaInput, NovaEmpresaTesteInput, MaterialInput, MovMaterialInput, PedidoInput, PedidoReceber, PedidoStatus, ValorPeca, RegistroInput, TipoRegistro, UsuarioInput,
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
