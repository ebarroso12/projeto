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
  financeiro: boolean; // pode usar o Financeiro
  dono: boolean;       // responsável pelo sistema (gerencia empresas)
  /** Funções liberadas para a pessoa (servidor Supabase); ausente = regras padrão por perfil. */
  funcoes?: Record<string, boolean>;
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
  empresa: EmpresaInfo;
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

// =====================================================================
// Multiempresa
// =====================================================================
export interface EmpresaInfo { codigo: string; nome: string }

export interface Empresa {
  id: string; codigo: string; nome: string; ativa: boolean; motivo: string;
  criadaEm: string; usuarios: number; admins: number; ultimoAcesso: string;
  /** "" = cliente; senão data/hora em que o teste termina */
  testeAte: string; porLink: boolean; tempo7d: number; entradas7d: number; acoes7d: number;
  tipoLink: '' | 'teste' | 'pro'; pessoas7d: number; online: number; implantacao: Record<string, boolean>;
}
export interface EmpresaDetalhe {
  nome: string; codigo: string; implantacao: Record<string, boolean>;
  dias: { dia: string; entradas: number; tempoSeg: number; acoes: number; pessoas: number }[];
  pessoas: { nome: string; login: string; perfil: string; setor: string; ativo: boolean; entradas: number; tempoSeg: number; logadoSeg: number; acoes: number; ultimo: string; aparelhos: number }[];
  modulos: { alvo: string; criou: number; alterou: number; apagou: number }[];
  sessoes: SessaoAcesso[]; eventos: EventoAcesso[];
}
export interface Convite {
  id: string; tipo: 'teste' | 'pro'; nota: string; diasTeste: number; usosMax: number; usos: number; ativo: boolean;
  expiraEm: string; criadoEm: string; empresas: string[];
}
export interface NovaEmpresaTesteInput { convite: string; codigo: string; nome: string; adminNome: string; adminLogin: string; adminSenha: string }
export interface NovaEmpresaInput { codigo: string; nome: string; adminLogin: string; adminNome: string; adminSenha: string }

// =====================================================================
// Financeiro
// =====================================================================
export type FinTipo = 'entrada' | 'saida' | 'programada';

export interface FinConta { id: string; nome: string; saldoInicial: number; ativa: boolean }
export interface FinCartao { id: string; nome: string; diaFechamento: number; diaVencimento: number; ativo: boolean }
export interface FinLancamento {
  id: string; tipo: FinTipo; data: string; descricao: string; valor: number;
  contaId: string | null; cartaoId: string | null;
  forma: string; categoria: string; responsavel: string; centro: string;
  parcelas: number | null; valorParcela: number | null; diaVencimento: number | null; parcelasPagas: number;
  vencimentoFatura: string | null; origemId: string | null; obs: string;
  /** Cliente (entrada) ou fornecedor (saída) ligado ao lançamento; nome fica mesmo se o cadastro for excluído. */
  contraparteId: string | null; contraparte: string;
}
/** Cliente ou fornecedor ativo, para escolher no lançamento. */
export interface FinContraparte { id: string; tipo: 'cliente' | 'fornecedor'; nome: string; documento: string }
export interface FinPagamentoFatura { id: string; cartaoId: string; vencimento: string; valor: number; contaId: string; data: string }
export interface FinMeta { id: string; nome: string; valorMeta: number; dataAlvo: string | null; ativa: boolean }
export interface FinMovimentoMeta { id: string; metaId: string; tipo: 'deposito' | 'retirada'; valor: number; data: string; contaId: string }
export interface FinExpectativa { mes: string; entradas: number; saidas: Record<string, number> }
export interface FinListas { categorias: string[]; responsaveis: string[]; centros: string[]; formas: string[] }
export type FinListaTipo = 'categoria' | 'responsavel' | 'centro' | 'forma';

export interface FinDados {
  hoje: string; dataInicio: string; listas: FinListas;
  contas: FinConta[]; cartoes: FinCartao[]; lancamentos: FinLancamento[];
  pagamentosFatura: FinPagamentoFatura[]; metas: FinMeta[]; movimentosMeta: FinMovimentoMeta[];
  expectativas: FinExpectativa[];
}

export interface FinLancamentoInput {
  id?: string; tipo: FinTipo; data: string; descricao: string; valor: number;
  contaId?: string | null; cartaoId?: string | null;
  forma?: string; categoria?: string; responsavel?: string; centro?: string;
  parcelas?: number | null; valorParcela?: number | null; diaVencimento?: number | null; obs?: string;
  contraparteId?: string | null;
}

// =====================================================================
// Resultado da empresa (DRE gerencial)
// =====================================================================
export type DreGrupo = 'sales' | 'direct' | 'selling' | 'admin' | 'finance';
export type DreMarca = 'valor' | 'na' | 'depois';

export interface DreCategoria {
  id: string; chave: string; grupo: DreGrupo; nome: string; tipo: 'plus' | 'minus';
  variabilidade: 'variable' | 'fixed'; essencial: boolean; nota: string; ativa: boolean; ordem: number;
}
export interface DreValor { marca: DreMarca; valor: number | null }
export interface DreMes { mes: string; status: 'pendente' | 'fechado'; atualizadoEm: string; valores: Record<string, DreValor> }
export interface DreDados { hoje: string; categorias: DreCategoria[]; meses: DreMes[] }
export interface DreItemInput { categoriaId: string; marca: DreMarca; valor: number | null }
export interface DreCategoriaInput {
  id?: string; grupo?: DreGrupo; nome: string; tipo?: 'plus' | 'minus'; variabilidade: 'variable' | 'fixed'; nota?: string; ativa?: boolean;
}

// =====================================================================
// Controle de acesso e auditoria
// =====================================================================
export type StatusAcesso = 'aprovada' | 'pendente' | 'negada' | 'encerrada' | 'nenhuma';

export interface SessaoAcesso {
  id: string; nome: string; login: string; setor: string; perfil: string;
  aparelho: string; ip: string; status: StatusAcesso; tela: string; ativoSeg: number; logadoSeg: number;
  inicio: string; ultimo: string; decididoPor: string; confiavel: boolean;
}
export interface EventoAcesso { id: number; quem: string; tipo: string; alvo: string; detalhe: Record<string, unknown>; em: string }
export interface AparelhoConfiavel { login: string; nome: string; aparelho: string; descricao: string; desde: string; por: string }
export interface MetricaPessoa {
  nome: string; login: string; perfil: string; ativo: boolean; eu: boolean;
  entradas: number; logadoSeg: number; negados: number; tempoSeg: number; criou: number; alterou: number; apagou: number; ultimo: string;
}
export interface AcessosDados {
  exigir: boolean; pendentes: SessaoAcesso[]; online: SessaoAcesso[]; sessoes: SessaoAcesso[];
  eventos: EventoAcesso[]; aparelhos: AparelhoConfiavel[]; metricas: MetricaPessoa[];
}

export interface FuncoesPessoa { nome: string; perfil: string; eu: boolean; protegido: boolean; possoEmpresas: boolean; funcoes: Record<string, boolean>; padrao: Record<string, boolean> }

// =====================================================================
// Cadastros gerais e mensagens
// =====================================================================
export type TipoRegistro = 'produto' | 'cliente' | 'fornecedor' | 'banco';
export interface Registro2 {
  id: string; tipo: TipoRegistro; nome: string; documento: string; telefone: string; email: string; cidade: string; obs: string;
  dados: Record<string, string>; ativo: boolean; criadoEm: string;
}
export type RegistroInput = Omit<Registro2, 'id' | 'criadoEm'> & { id?: string };
export type DadosPessoa = Record<string, string>;
export interface Mensagem { id: string; autor: string; para: string; titulo: string; texto: string; importante: boolean; em: string; lida: boolean }
export interface MensagemEnviada extends Omit<Mensagem, 'lida'> { leram: string[]; faltam: string[] }
export interface Destinatario { login: string; nome: string; setor: string }
