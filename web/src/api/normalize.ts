/**
 * Camada defensiva: o servidor é uma planilha com scripts escritos ao longo do tempo,
 * então campos podem faltar ou vir com outro tipo. Nenhum componente recebe `undefined`.
 */
import type {
  AcessosDados, Convite, DadosPessoa, Destinatario, EmpresaDetalhe, FuncoesPessoa, Mensagem, MensagemEnviada, Registro2, TipoRegistro, SessaoAcesso, StatusAcesso,
  Boot, DreCategoria, DreDados, DreMes, Disponivel, Editado, Empresa, Eu, Falta, FinContraparte, FinContraparteTotal, FinDados, LucroModelo, Produtividade, Pedido, PedidoItem, PedidoOpcoes, PedidoStatus, FinLancamento, Lancamento,
  LinhaModelo, Painel, Pessoa, PorPessoa, Presenca, Registro, Relatorio, Saldo, Usuario, Wifi,
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
  podeFalta: bool(r.podeFalta), demo: bool(r.demo), financeiro: bool(r.financeiro), dono: bool(r.dono),
  ...(r.funcoes && typeof r.funcoes === 'object' ? { funcoes: Object.fromEntries(Object.entries(rec(r.funcoes)).map(([k, v]) => [k, bool(v)])) } : {}),
});
export const parseFuncoesPessoa = (v: unknown): FuncoesPessoa => {
  const r = rec(v);
  const mapa = (x: unknown) => Object.fromEntries(Object.entries(rec(x)).map(([k, b]) => [k, bool(b)]));
  return { nome: str(r.nome), perfil: str(r.perfil), eu: bool(r.eu), protegido: bool(r.protegido), possoEmpresas: bool(r.possoEmpresas), funcoes: mapa(r.funcoes), padrao: mapa(r.padrao) };
};

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
    empresa: { codigo: str(rec(r.empresa).codigo), nome: str(rec(r.empresa).nome, 'Fábrica') },
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

// =====================================================================
// Multiempresa, Financeiro e Resultado
// =====================================================================
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const parseEmpresas = (v: unknown): Empresa[] =>
  list(v, r => ({
    id: str(r.id), codigo: str(r.codigo), nome: str(r.nome), ativa: bool(r.ativa, true), motivo: str(r.motivo),
    criadaEm: str(r.criadaEm), usuarios: num(r.usuarios), admins: num(r.admins), ultimoAcesso: str(r.ultimoAcesso),
    testeAte: str(r.testeAte), porLink: bool(r.porLink), tempo7d: num(r.tempo7d), entradas7d: num(r.entradas7d), acoes7d: num(r.acoes7d),
    tipoLink: (['teste', 'pro'].includes(str(r.tipoLink)) ? str(r.tipoLink) : '') as Empresa['tipoLink'],
    pessoas7d: num(r.pessoas7d), online: num(r.online),
    implantacao: Object.fromEntries(Object.entries(rec(r.implantacao)).map(([k, v]) => [k, bool(v)])),
  }));
export const parseConvites = (v: unknown): Convite[] =>
  list(v, r => ({
    id: str(r.id), tipo: (str(r.tipo) === 'pro' ? 'pro' : 'teste') as Convite['tipo'], nota: str(r.nota), diasTeste: num(r.diasTeste, 7), usosMax: num(r.usosMax, 1), usos: num(r.usos), ativo: bool(r.ativo, true),
    expiraEm: str(r.expiraEm), criadoEm: str(r.criadoEm), empresas: strings(r.empresas),
  }));

export const finLancamento = (r: R): FinLancamento => ({
  id: str(r.id), tipo: (['entrada', 'saida', 'programada', 'receber'].includes(str(r.tipo)) ? str(r.tipo) : 'saida') as FinLancamento['tipo'],
  data: str(r.data), descricao: str(r.descricao), valor: num(r.valor),
  contaId: strOrNull(r.contaId), cartaoId: strOrNull(r.cartaoId),
  forma: str(r.forma), categoria: str(r.categoria), responsavel: str(r.responsavel), centro: str(r.centro),
  parcelas: numOrNull(r.parcelas), valorParcela: numOrNull(r.valorParcela), diaVencimento: numOrNull(r.diaVencimento),
  parcelasPagas: num(r.parcelasPagas), vencimentoFatura: strOrNull(r.vencimentoFatura), origemId: strOrNull(r.origemId), obs: str(r.obs),
  contraparteId: strOrNull(r.contraparteId), contraparte: str(r.contraparte),
});

export const parseLancamentos = (v: unknown): FinLancamento[] => (Array.isArray(v) ? v : []).map(rec).map(finLancamento);
export const parseContrapartesTotais = (v: unknown): FinContraparteTotal[] =>
  (Array.isArray(v) ? v : []).map(rec).map(r => ({ id: str(r.id), recebido: num(r.recebido), pago: num(r.pago), qtd: num(r.qtd), ultimo: strOrNull(r.ultimo), aReceber: num(r.aReceber) }));
export const parseContrapartes = (v: unknown): FinContraparte[] =>
  (Array.isArray(v) ? v : []).map(rec).map(r => ({
    id: str(r.id), tipo: (str(r.tipo) === 'fornecedor' ? 'fornecedor' : 'cliente') as FinContraparte['tipo'], nome: str(r.nome), documento: str(r.documento),
  }));

export function parseFin(v: unknown): FinDados {
  const r = rec(v);
  const l = rec(r.listas);
  return {
    hoje: str(r.hoje), dataInicio: str(r.dataInicio, '2000-01-01'),
    listas: { categorias: strings(l.categorias), responsaveis: strings(l.responsaveis), centros: strings(l.centros), formas: strings(l.formas) },
    contas: list(r.contas, x => ({ id: str(x.id), nome: str(x.nome), saldoInicial: num(x.saldoInicial), ativa: bool(x.ativa, true) })),
    cartoes: list(r.cartoes, x => ({ id: str(x.id), nome: str(x.nome), diaFechamento: num(x.diaFechamento, 1), diaVencimento: num(x.diaVencimento, 10), ativo: bool(x.ativo, true) })),
    lancamentos: list(r.lancamentos, finLancamento),
    pagamentosFatura: list(r.pagamentosFatura, x => ({ id: str(x.id), cartaoId: str(x.cartaoId), vencimento: str(x.vencimento), valor: num(x.valor), contaId: str(x.contaId), data: str(x.data) })),
    metas: list(r.metas, x => ({ id: str(x.id), nome: str(x.nome), valorMeta: num(x.valorMeta), dataAlvo: strOrNull(x.dataAlvo), ativa: bool(x.ativa, true) })),
    movimentosMeta: list(r.movimentosMeta, x => ({ id: str(x.id), metaId: str(x.metaId), tipo: str(x.tipo) === 'retirada' ? 'retirada' : 'deposito', valor: num(x.valor), data: str(x.data), contaId: str(x.contaId) })),
    expectativas: list(r.expectativas, x => ({ mes: str(x.mes), entradas: num(x.entradas), saidas: numbers(x.saidas) })),
  };
}

const GRUPOS = ['sales', 'direct', 'selling', 'admin', 'finance'];
const dreCategoria = (r: R): DreCategoria => ({
  id: str(r.id), chave: str(r.chave), grupo: (GRUPOS.includes(str(r.grupo)) ? str(r.grupo) : 'admin') as DreCategoria['grupo'],
  nome: str(r.nome), tipo: str(r.tipo) === 'plus' ? 'plus' : 'minus', variabilidade: str(r.variabilidade) === 'variable' ? 'variable' : 'fixed',
  essencial: bool(r.essencial), nota: str(r.nota), ativa: bool(r.ativa, true), ordem: num(r.ordem),
});
const dreMes = (r: R): DreMes => ({
  mes: str(r.mes), status: str(r.status) === 'fechado' ? 'fechado' : 'pendente', atualizadoEm: str(r.atualizadoEm),
  valores: Object.fromEntries(Object.entries(rec(r.valores)).map(([k, x]) => {
    const o = rec(x);
    const marca = ['valor', 'na', 'depois'].includes(str(o.marca)) ? (str(o.marca) as 'valor' | 'na' | 'depois') : 'depois';
    return [k, { marca, valor: numOrNull(o.valor) }];
  })),
});
export const parseDre = (v: unknown): DreDados => {
  const r = rec(v);
  return { hoje: str(r.hoje), categorias: list(r.categorias, dreCategoria), meses: list(r.meses, dreMes) };
};

// ---------------------------------------------------------------- acessos e auditoria
const STATUS = ['aprovada', 'pendente', 'negada', 'encerrada', 'nenhuma'] as const;
export const parseStatusAcesso = (v: unknown): StatusAcesso => {
  const s = str(v) as StatusAcesso;
  return (STATUS as readonly string[]).includes(s) ? s : 'nenhuma';
};
const sessao = (r: R): SessaoAcesso => ({
  id: str(r.id), nome: str(r.nome), login: str(r.login), setor: str(r.setor), perfil: str(r.perfil),
  aparelho: str(r.aparelho), ip: str(r.ip), status: parseStatusAcesso(r.status), tela: str(r.tela), ativoSeg: num(r.ativoSeg), logadoSeg: num(r.logadoSeg),
  inicio: str(r.inicio), ultimo: str(r.ultimo), decididoPor: str(r.decididoPor), confiavel: bool(r.confiavel),
});
export const parseSessoes = (v: unknown): SessaoAcesso[] => list(v, sessao);
export const parseAcessos = (v: unknown): AcessosDados => {
  const r = rec(v);
  return {
    exigir: bool(r.exigir, true), pendentes: parseSessoes(r.pendentes), online: parseSessoes(r.online), sessoes: parseSessoes(r.sessoes),
    eventos: list(r.eventos, e => ({ id: num(e.id), quem: str(e.quem), tipo: str(e.tipo), alvo: str(e.alvo), detalhe: rec(e.detalhe), em: str(e.em) })),
    aparelhos: list(r.aparelhos, a => ({ login: str(a.login), nome: str(a.nome), aparelho: str(a.aparelho), descricao: str(a.descricao), desde: str(a.desde), por: str(a.por) })),
    metricas: list(r.metricas, m => ({
      nome: str(m.nome), login: str(m.login), perfil: str(m.perfil), ativo: bool(m.ativo, true), eu: bool(m.eu),
      entradas: num(m.entradas), logadoSeg: num(m.logadoSeg), negados: num(m.negados), tempoSeg: num(m.tempoSeg), criou: num(m.criou), alterou: num(m.alterou), apagou: num(m.apagou), ultimo: str(m.ultimo),
    })),
  };
};

export const parseEmpresaDetalhe = (v: unknown): EmpresaDetalhe => {
  const r = rec(v);
  return {
    nome: str(r.nome), codigo: str(r.codigo),
    implantacao: Object.fromEntries(Object.entries(rec(r.implantacao)).map(([k, x]) => [k, bool(x)])),
    dias: list(r.dias, d => ({ dia: str(d.dia), entradas: num(d.entradas), tempoSeg: num(d.tempoSeg), acoes: num(d.acoes), pessoas: num(d.pessoas) })),
    pessoas: list(r.pessoas, p => ({
      nome: str(p.nome), login: str(p.login), perfil: str(p.perfil), setor: str(p.setor), ativo: bool(p.ativo, true),
      entradas: num(p.entradas), tempoSeg: num(p.tempoSeg), logadoSeg: num(p.logadoSeg), acoes: num(p.acoes), ultimo: str(p.ultimo), aparelhos: num(p.aparelhos),
    })),
    modulos: list(r.modulos, m => ({ alvo: str(m.alvo), criou: num(m.criou), alterou: num(m.alterou), apagou: num(m.apagou) })),
    sessoes: parseSessoes(r.sessoes),
    eventos: parseAcessos({ eventos: r.eventos }).eventos,
  };
};

// ---------------------------------------------------------------- cadastros gerais e mensagens
const TIPOS_REG = ['produto', 'cliente', 'fornecedor', 'banco'];
export const parseRegistros = (v: unknown): Registro2[] => list(v, r => ({
  id: str(r.id), tipo: (TIPOS_REG.includes(str(r.tipo)) ? str(r.tipo) : 'cliente') as TipoRegistro, nome: str(r.nome),
  documento: str(r.documento), telefone: str(r.telefone), email: str(r.email), cidade: str(r.cidade), obs: str(r.obs),
  dados: Object.fromEntries(Object.entries(rec(r.dados)).map(([k, x]) => [k, str(x)])), ativo: bool(r.ativo, true), criadoEm: str(r.criadoEm),
}));
export const parseDadosPessoas = (v: unknown): Record<string, DadosPessoa> =>
  Object.fromEntries(Object.entries(rec(v)).map(([login, d]) => [login, Object.fromEntries(Object.entries(rec(d)).map(([k, x]) => [k, str(x)]))]));
const msg = (r: R) => ({ id: str(r.id), autor: str(r.autor), para: str(r.para, 'Todos'), titulo: str(r.titulo), texto: str(r.texto), importante: bool(r.importante), em: str(r.em) });
export const parseMensagens = (v: unknown): Mensagem[] => list(v, r => ({ ...msg(r), lida: bool(r.lida) }));
export const parseEnviadas = (v: unknown): MensagemEnviada[] => list(v, r => ({ ...msg(r), leram: strings(r.leram), faltam: strings(r.faltam) }));
export const parseDestinatarios = (v: unknown): Destinatario[] => list(v, r => ({ login: str(r.login), nome: str(r.nome), setor: str(r.setor) }));

const pedidoItem = (r: R): PedidoItem => ({
  id: str(r.id), modelo: str(r.modelo), cor: str(r.cor), tamanho: str(r.tamanho), qtd: num(r.qtd), preco: num(r.preco),
  feito: Object.fromEntries(Object.entries(rec(r.feito)).map(([k, v]) => [k, num(v)])),
});
export const parsePedidos = (v: unknown): Pedido[] =>
  (Array.isArray(v) ? v : []).map(rec).map(r => ({
    id: str(r.id), numero: num(r.numero), clienteId: strOrNull(r.clienteId), cliente: str(r.cliente),
    dataPedido: str(r.dataPedido), entrega: strOrNull(r.entrega),
    status: (['aberto', 'entregue', 'cancelado'].includes(str(r.status)) ? str(r.status) : 'aberto') as PedidoStatus,
    entregueEm: strOrNull(r.entregueEm), obs: str(r.obs), finLancamentoId: strOrNull(r.finLancamentoId), criadoPor: str(r.criadoPor),
    itens: (Array.isArray(r.itens) ? r.itens : []).map(rec).map(pedidoItem),
  }));
export function parsePedidoOpcoes(v: unknown): PedidoOpcoes {
  const r = rec(v);
  return {
    clientes: (Array.isArray(r.clientes) ? r.clientes : []).map(rec).map(c => ({ id: str(c.id), nome: str(c.nome), prazo: str(c.prazo) })),
    precos: Object.fromEntries(Object.entries(rec(r.precos)).map(([k, x]) => [k, num(x)])),
  };
}

export function parseProdutividade(v: unknown): Produtividade {
  const r = rec(v);
  const arr = (x: unknown) => (Array.isArray(x) ? x : []).map(rec);
  return {
    pessoas: arr(r.pessoas).map(p => {
      const f = p.fechado ? rec(p.fechado) : null;
      return {
        login: str(p.login), nome: str(p.nome), setor: str(p.setor), ativo: bool(p.ativo, true),
        porEtapa: Object.fromEntries(Object.entries(rec(p.porEtapa)).map(([k, x]) => [k, num(x)])),
        pecas: num(p.pecas), valor: num(p.valor), diasProducao: num(p.diasProducao), diasPonto: num(p.diasPonto), minutosPonto: num(p.minutosPonto),
        fechado: f ? { id: str(f.id), ini: str(f.ini), fim: str(f.fim), valor: num(f.valor) } : null,
      };
    }),
    porDia: arr(r.porDia).map(d => ({ dia: str(d.dia), pecas: num(d.pecas) })),
    valores: arr(r.valores).map(x => ({ etapa: str(x.etapa), modelo: str(x.modelo), valor: num(x.valor) })),
    fechamentos: arr(r.fechamentos).map(f => ({ id: str(f.id), nome: str(f.nome), ini: str(f.ini), fim: str(f.fim), pecas: num(f.pecas), valor: num(f.valor), pago: bool(f.pago) })),
  };
}
export const parseLucroModelos = (v: unknown): LucroModelo[] =>
  (Array.isArray(v) ? v : []).map(rec).map(r => ({
    modelo: str(r.modelo), produzidas: num(r.produzidas), maoDeObra: num(r.maoDeObra), maoDeObraPeca: num(r.maoDeObraPeca),
    preco: numOrNull(r.preco), custo: numOrNull(r.custo), cadastrado: bool(r.cadastrado), entreguesPecas: num(r.entreguesPecas), entreguesValor: num(r.entreguesValor),
  }));
