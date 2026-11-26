/**
 * Contrato de dados entre o front-end e o Apps Script.
 * Tudo que chega do servidor passa por normalize.ts antes de virar um destes tipos.
 */
export interface Eu {
  nome: string;
  setor: string;
  admin: boolean;
  leitura: boolean;   // usuário "só ver"
  podeFalta: boolean; // pode colocar itens em falta
  demo: boolean;
}

export interface Ponto { entrada: string; saida: string; extra: string }

export interface Falta {
  id: string; modelo: string; cor: string; tamanho: string;
  qtd: number; falta: number; feito: number; criado: string; obs: string; status: string;
}

export interface Lancamento {
  id: string; modelo: string; cor: string; tamanho: string;
  hora: string; etapa: string; qtd: number; edicoes: number; hist: string;
}

/** Totais acumulados por etapa de uma combinação modelo/cor/tamanho. */
export interface Disponivel { modelo: string; cor: string; tamanho: string; valores: Record<string, number> }

export interface Boot {
  eu: Eu;
  hoje: string;
  ponto: Ponto;
  horaFim: string;
  exigirWifi: boolean;
  etapas: string[];
  modelos: string[];
  cores: string[];
  tamanhos: string[];
  disponivel: Disponivel[];
  meusHoje: Lancamento[];
  emFalta: Falta[];
}

export interface Presenca { nome: string; setor: string; entrada: string; saida: string; extra: string }

export interface Editado {
  nome: string; etapa: string; modelo: string; cor: string; tamanho: string;
  qtd: number; edicoes: number; hist: string; data: string;
}

export interface Saldo {
  modelo: string; cor: string; tamanho: string;
  corte: number; costura: number; conf: number; naCostura: number; naConf: number; erro: boolean;
}

export interface Painel {
  presenca: Presenca[];
  prodHoje: Record<string, number>;
  editados: Editado[];
  saldo: Saldo[];
}

export interface LinhaModelo { modelo: string; cor: string; tamanho: string; valores: Record<string, number> }
export interface PorPessoa { nome: string; etapa: string; qtd: number }
export interface Pessoa { nome: string; diasTrab: number; horas: string; extras: string; faltas: string[]; semSaida: number }
export interface Registro { data: string; nome: string; entrada: string; saida: string; extra: string; auto: boolean }

export interface Relatorio {
  porEtapa: Record<string, number>;
  porModelo: LinhaModelo[];
  porPessoa: PorPessoa[];
  diasUteis: number;
  pessoas: Pessoa[];
  registros: Registro[];
  editados: Editado[];
}

export interface Usuario {
  login: string; nome: string; setor: string; perfil: string;
  ativo: boolean; podeFalta: boolean; senha: string; link: string;
}

export interface UsuarioInput {
  novo: boolean; nome: string; login: string; senha: string; setor: string;
  perfil: string; ativo: 'Sim' | 'Não'; podeFalta: 'Sim' | 'Não';
}

export interface Rede { nome: string; ip: string; em: string }
export interface Wifi { exigir: boolean; ips: Rede[] }

export interface LancamentoInput {
  etapa: string; modelo: string; cor: string; obs: string;
  itens: { tamanho: string; qtd: number }[];
}
export interface LancamentoResultado { total: number; avisos: string[] }

export interface FaltaInput { modelo: string; cor: string; tamanho: string; qtd: string; obs: string }
