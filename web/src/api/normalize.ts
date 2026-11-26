/**
 * Camada defensiva: o servidor é uma planilha com scripts escritos ao longo do tempo,
 * então campos podem faltar ou vir com outro tipo. Nenhum componente recebe `undefined`.
 */
import type {
  Boot, Disponivel, Editado, Eu, Falta, Lancamento, LinhaModelo, Painel, Pessoa,
  PorPessoa, Presenca, Registro, Relatorio, Saldo, Usuario, Wifi,
} from './types';

type R = Record<string, unknown>;

export const rec = (v: unknown): R => (v && typeof v === 'object' && !Array.isArray(v) ? (v as R) : {});
export const str = (v: unknown, d = ''): string => (v === null || v === undefined ? d : String(v));
export const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
export const bool = (v: unknown, d = false): boolean => {
  if (v === true || v === 'true' || v === 'Sim' || v === 1) return true;
  if (v === false || v === 'false' || v === 'Não' || v === 0) return false;
  return d;
};
const list = <T>(v: unknown, f: (x: R) => T): T[] => (Array.isArray(v) ? v.map(x => f(rec(x))) : []);
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => str(x)) : []);
const numbers = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(rec(v)).map(([k, x]) => [k, num(x)]));
const numbersExcept = (r: R, skip: string[]): Record<string, number> =>
  numbers(Object.fromEntries(Object.entries(r).filter(([k]) => !skip.includes(k))));

const eu = (r: R): Eu => ({
  nome: str(r.nome, 'Usuário'), setor: str(r.setor), admin: bool(r.admin), leitura: bool(r.leitura),
  podeFalta: bool(r.podeFalta), demo: bool(r.demo),
});

export const parseFalta = (r: R): Falta => ({
  id: str(r.id), modelo: str(r.modelo), cor: str(r.cor), tamanho: str(r.tamanho),
  qtd: num(r.qtd), falta: num(r.falta), feito: num(r.feito), criado: str(r.criado), obs: str(r.obs),
  status: str(r.status, 'Urgente'),
});
export const parseFaltas = (v: unknown): Falta[] => list(v, parseFalta);

const lancamento = (r: R): Lancamento => ({
  id: str(r.id), modelo: str(r.modelo), cor: str(r.cor), tamanho: str(r.tamanho), hora: str(r.hora),
  etapa: str(r.etapa), qtd: num(r.qtd), edicoes: num(r.edicoes), hist: str(r.hist),
});

const disponivel = (r: R): Disponivel => ({
  modelo: str(r.modelo), cor: str(r.cor), tamanho: str(r.tamanho),
  valores: numbersExcept(r, ['modelo', 'cor', 'tamanho']),
});

export function parseBoot(v: unknown): Boot {
  const r = rec(v);
  const p = rec(r.ponto);
  return {
    eu: eu(rec(r.eu)),
    hoje: str(r.hoje),
    ponto: { entrada: str(p.entrada), saida: str(p.saida), extra: str(p.extra) },
    horaFim: str(r.horaFim, '17:30'),
    exigirWifi: bool(r.exigirWifi),
    etapas: strings(r.etapas),
    modelos: strings(r.modelos),
    cores: strings(r.cores),
    tamanhos: strings(r.tamanhos),
    disponivel: list(r.disponivel, disponivel),
    meusHoje: list(r.meusHoje, lancamento),
    emFalta: parseFaltas(r.emFalta),
  };
}

const presenca = (r: R): Presenca => ({
  nome: str(r.nome), setor: str(r.setor), entrada: str(r.entrada), saida: str(r.saida), extra: str(r.extra),
});
const editado = (r: R): Editado => ({
  nome: str(r.nome), etapa: str(r.etapa), modelo: str(r.modelo), cor: str(r.cor), tamanho: str(r.tamanho),
  qtd: num(r.qtd), edicoes: num(r.edicoes), hist: str(r.hist), data: str(r.data),
});
const saldo = (r: R): Saldo => ({
  modelo: str(r.modelo), cor: str(r.cor), tamanho: str(r.tamanho), corte: num(r.corte), costura: num(r.costura),
  conf: num(r.conf), naCostura: num(r.naCostura), naConf: num(r.naConf), erro: bool(r.erro),
});

export const parsePainel = (v: unknown): Painel => {
  const r = rec(v);
  return {
    presenca: list(r.presenca, presenca), prodHoje: numbers(r.prodHoje),
    editados: list(r.editados, editado), saldo: list(r.saldo, saldo),
  };
};

const linhaModelo = (r: R): LinhaModelo => ({
  modelo: str(r.modelo), cor: str(r.cor), tamanho: str(r.tamanho),
  valores: numbersExcept(r, ['modelo', 'cor', 'tamanho']),
});
const porPessoa = (r: R): PorPessoa => ({ nome: str(r.nome), etapa: str(r.etapa), qtd: num(r.qtd) });
const pessoa = (r: R): Pessoa => ({
  nome: str(r.nome), diasTrab: num(r.diasTrab), horas: str(r.horas), extras: str(r.extras),
  faltas: strings(r.faltas), semSaida: num(r.semSaida),
});
const registro = (r: R): Registro => ({
  data: str(r.data), nome: str(r.nome), entrada: str(r.entrada), saida: str(r.saida), extra: str(r.extra),
  auto: bool(r.auto),
});

export const parseRelatorio = (v: unknown): Relatorio => {
  const r = rec(v);
  return {
    porEtapa: numbers(r.porEtapa), porModelo: list(r.porModelo, linhaModelo), porPessoa: list(r.porPessoa, porPessoa),
    diasUteis: num(r.diasUteis), pessoas: list(r.pessoas, pessoa), registros: list(r.registros, registro),
    editados: list(r.editados, editado),
  };
};

export const parseUsuarios = (v: unknown): Usuario[] =>
  list(v, r => ({
    login: str(r.login), nome: str(r.nome), setor: str(r.setor), perfil: str(r.perfil, 'funcionario'),
    ativo: str(r.ativo) !== 'Não', podeFalta: str(r.podeFalta) === 'Sim', senha: str(r.senha), link: str(r.link),
  }));

export const parseWifi = (v: unknown): Wifi => {
  const r = rec(v);
  return { exigir: bool(r.exigir), ips: list(r.ips, x => ({ nome: str(x.nome), ip: str(x.ip), em: str(x.em) })) };
};
