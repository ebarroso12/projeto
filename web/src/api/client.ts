import { getIp } from '../lib/network';
import {
  parseBoot, parseDre, parseEmpresas, parseFaltas, parseFin, parsePainel, parseRelatorio, parseUsuarios, parseWifi,
  rec, str, strings, num,
} from './normalize';
import type { Transport } from './transport';
import type {
  DreCategoriaInput, DreItemInput, FaltaInput, FinLancamentoInput, FinListaTipo, LancamentoInput, LancamentoResultado,
  NovaEmpresaInput, UsuarioInput,
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

    verWifi: async () => parseWifi(await call('verWifi', tok())),
    salvarWifi: async (exigir: boolean, ips: { nome: string; ip: string; em: string }[]) =>
      parseWifi(await call('salvarWifi', tok(), exigir, ips)),
    cadastrarRedeAtual: async (nome: string) =>
      parseWifi(await call('cadastrarRedeAtual', tok(), await getIp(), nome)),

    // ----- dono do sistema -----
    empresas: async () => parseEmpresas(await call('empresas', tok())),
    criarEmpresa: async (o: NovaEmpresaInput) => { await call('criarEmpresa', tok(), o); },
    bloquearEmpresa: async (id: string, bloquear: boolean, motivo: string) => { await call('bloquearEmpresa', tok(), id, bloquear, motivo); },
    renomearEmpresa: async (id: string, nome: string) => { await call('renomearEmpresa', tok(), id, nome); },

    // ----- financeiro -----
    finDados: async () => parseFin(await call('finDados', tok())),
    finSalvarLancamento: async (o: FinLancamentoInput) => str(await call('finSalvarLancamento', tok(), o)),
    finApagarLancamento: async (id: string) => { await call('finApagarLancamento', tok(), id); },
    finPagarParcela: async (id: string, data: string, valor: number, contaId: string | null) => { await call('finPagarParcela', tok(), id, data, valor, contaId); },
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
