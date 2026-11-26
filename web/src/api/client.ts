import { getIp } from '../lib/network';
import {
  parseBoot, parseFaltas, parsePainel, parseRelatorio, parseUsuarios, parseWifi, rec, str, strings, num,
} from './normalize';
import type { Transport } from './transport';
import type { FaltaInput, LancamentoInput, LancamentoResultado, UsuarioInput } from './types';

/**
 * Cliente tipado do servidor. Cada método corresponde a uma função do Apps Script
 * (lista fechada em apps-script/Api.gs). O token é lido na hora da chamada.
 */
export function createApi(transport: Transport, getToken: () => string | null) {
  const tok = () => getToken() ?? '';
  const call = (fn: string, ...args: unknown[]) => transport(fn, args);

  return {
    login: async (login: string, senha: string) => str(await call('login', login, senha)),
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

    verWifi: async () => parseWifi(await call('verWifi', tok())),
    salvarWifi: async (exigir: boolean, ips: { nome: string; ip: string; em: string }[]) =>
      parseWifi(await call('salvarWifi', tok(), exigir, ips)),
    cadastrarRedeAtual: async (nome: string) =>
      parseWifi(await call('cadastrarRedeAtual', tok(), await getIp(), nome)),
  };
}

export type Api = ReturnType<typeof createApi>;
