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
/** programada = a empresa vai pagar em parcelas; receber = venda a prazo, o cliente vai pagar em parcelas. */
export type FinTipo = 'entrada' | 'saida' | 'programada' | 'receber';

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
/** Totais do ano de um cliente/fornecedor (lista de Cadastros). `ultimo` = data do último lançamento realizado (qualquer ano). */
export interface FinContraparteTotal { id: string; recebido: number; pago: number; qtd: number; ultimo: string | null; aReceber: number }
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
export type TipoRegistro = 'produto' | 'cliente' | 'fornecedor' | 'banco' | 'oficina';
export interface Registro2 {
  id: string; tipo: TipoRegistro; nome: string; documento: string; telefone: string; email: string; cidade: string; obs: string;
  dados: Record<string, string>; ativo: boolean; criadoEm: string;
}
export type RegistroInput = Omit<Registro2, 'id' | 'criadoEm'> & { id?: string };
export type DadosPessoa = Record<string, string>;
export interface Mensagem { id: string; autor: string; para: string; titulo: string; texto: string; importante: boolean; em: string; lida: boolean }
export interface MensagemEnviada extends Omit<Mensagem, 'lida'> { leram: string[]; faltam: string[] }
export interface Destinatario { login: string; nome: string; setor: string }

// =====================================================================
// Pedidos de clientes (andamento vem da produção lançada)
// =====================================================================
export type PedidoStatus = 'aberto' | 'entregue' | 'cancelado';
export interface PedidoItem {
  id?: string; modelo: string; cor: string; tamanho: string; qtd: number; preco: number;
  /** Peças desta linha já feitas em cada etapa (Corte, Costura, Conferência). */
  feito: Record<string, number>;
}
export interface Pedido {
  id: string; numero: number; clienteId: string | null; cliente: string;
  dataPedido: string; entrega: string | null; status: PedidoStatus; entregueEm: string | null; obs: string;
  finLancamentoId: string | null; criadoPor: string; itens: PedidoItem[];
}
export interface PedidoInput {
  id?: string; clienteId?: string | null; clienteNome?: string; dataPedido: string; entrega: string | null; obs: string;
  itens: { modelo: string; cor: string; tamanho: string; qtd: number; preco: number }[];
}
export interface PedidoOpcoes { clientes: { id: string; nome: string; prazo: string }[]; precos: Record<string, number> }
/** Ao entregar: nada, entrada à vista, ou conta a receber em parcelas. */
export type PedidoReceber = null | { contaId: string; avista: true } | { contaId: string; parcelas: number; diaVencimento: number };

// =====================================================================
// Produtividade, pagamento por produção e lucro por modelo
// =====================================================================
export interface ValorPeca { etapa: string; modelo: string; valor: number }
export interface ProdPessoa {
  login: string; nome: string; setor: string; ativo: boolean; porEtapa: Record<string, number>;
  pecas: number; valor: number; diasProducao: number; diasPonto: number; minutosPonto: number;
  fechado: { id: string; ini: string; fim: string; valor: number } | null;
}
export interface FechamentoProducao { id: string; nome: string; ini: string; fim: string; pecas: number; valor: number; pago: boolean }
export interface Produtividade { pessoas: ProdPessoa[]; porDia: { dia: string; pecas: number }[]; valores: ValorPeca[]; fechamentos: FechamentoProducao[] }
export interface LucroModelo {
  modelo: string; produzidas: number; maoDeObra: number; maoDeObraPeca: number;
  preco: number | null; custo: number | null; cadastrado: boolean; entreguesPecas: number; entreguesValor: number;
}

// =====================================================================
// Estoque de matéria-prima
// =====================================================================
export interface RegraConsumo { etapa: string; modelo: string; qtdPorPeca: number }
export interface Material {
  id: string; nome: string; unidade: string; minimo: number; inicio: string; ativo: boolean; obs: string;
  entradas: number; saidas: number; ajustes: number; consumo: number; consumo30: number; saldo: number;
  custoMedio: number | null; ultimaEntrada: string | null; regras: RegraConsumo[];
}
export interface MaterialInput { id?: string; nome: string; unidade: string; minimo: number; inicio?: string; ativo?: boolean; obs: string; regras: RegraConsumo[] }
export interface MovMaterial { id: string; tipo: 'entrada' | 'saida' | 'ajuste'; qtd: number; data: string; valor: number | null; fornecedor: string; noFinanceiro: boolean; obs: string; por: string }
export interface MovMaterialInput { materialId: string; tipo: 'entrada' | 'saida' | 'ajuste'; qtd?: number; contado?: number; data: string; valor?: number | null; fornecedorId?: string | null; contaId?: string | null; obs: string }
export interface HistoricoMaterial { movimentos: MovMaterial[]; consumoMensal: { mes: string; qtd: number }[] }
export interface MaterialOpcoes { fornecedores: { id: string; nome: string }[]; contas: { id: string; nome: string }[] }

// =====================================================================
// Página de apresentação (vitrine) e link público de teste
// =====================================================================
export interface Vitrine { convite: string | null; dias: number; whatsapp: string | null }
export interface VitrineAdmin {
  link: { token: string; dias: number; usos: number; usosMax: number; valido: boolean; empresas: number } | null;
  whatsapp: string | null;
}

// =====================================================================
// Oficinas e remessas (facção)
// =====================================================================
/** Quem fez: funcionário (login) ou oficina de fora (id do cadastro). */
export type QuemFez = { login: string } | { oficinaId: string };
export interface OrdemCorte {
  id: string; numero: number; data: string; quem: string; modelo: string; cor: string; obs: string;
  material: string | null; unidade: string | null; materialQtd: number | null; consumoPeca: number | null;
  itens: Record<string, number>; remetido: number;
}
export interface OrdemCorteInput { quem: QuemFez; data: string; modelo: string; cor: string; materialId?: string | null; materialQtd?: number | null; obs: string; itens: { tamanho: string; qtd: number }[] }
export interface RemessaItem { id: string; modelo: string; cor: string; tamanho: string; qtd: number; boas: number; defeito: number }
/** Resposta da oficina pelo link: confere, ou a contagem dela nos itens em que discorda. */
export interface ConfirmacaoOficina {
  confere: boolean; em: string; nome: string; obs: string; itens: { itemId: string; qtd: number }[];
  /** contestação resolvida pela fábrica (quem, quando e o que foi decidido) */
  resolvida: { em: string; por: string; nota: string } | null;
}
export interface RetornoRemessa { id: string; data: string; obs: string; boas: number; defeito: number; cega: boolean; itens: { itemId: string; boas: number; defeito: number }[]; confirmacao: ConfirmacaoOficina | null }
export interface Remessa {
  id: string; numero: number; quem: string; login: string | null; oficinaId: string | null; telefone: string | null; etapa: string;
  dataEnvio: string; prazo: string | null; valorPeca: number; descontoFaltante: number; ordemId: string | null; ordemNumero: number | null;
  status: 'aberta' | 'fechada'; fechadaEm: string | null; valorPago: number | null; noFinanceiro: boolean; obs: string;
  /** link da oficina (null = ainda não gerado) */
  token: string | null; confirmacaoEnvio: ConfirmacaoOficina | null;
  /** respostas antigas (envio refeito ou retorno excluído), guardadas como histórico */
  historico: (ConfirmacaoOficina & { etapa: 'envio' | 'retorno'; substituidaEm: string })[];
  itens: RemessaItem[]; retornos: RetornoRemessa[];
}
/** O que a oficina vê pelo link (sem login). */
export interface RemessaPublica {
  empresa: string; numero: number; quem: string; etapa: string; dataEnvio: string; prazo: string | null; valorPeca: number; descontoFaltante: number;
  status: 'aberta' | 'fechada'; fechadaEm: string | null; valorPago: number | null; enviadas: number; boas: number; defeito: number;
  itens: RemessaItem[]; confirmacaoEnvio: ConfirmacaoOficina | null;
  retornos: { id: string; data: string; itens: { itemId: string; boas: number; defeito: number }[]; confirmacao: ConfirmacaoOficina | null }[];
}
export interface ConfirmarRemessaInput { retornoId: string | null; confere: boolean; itens: { itemId: string; qtd: number }[]; nome: string; obs: string }
export interface ConfirmarRemessaResultado { confere: boolean; fabrica: number; oficina: number }
export interface RemessaInput {
  id?: string; quem: QuemFez; etapa: string; dataEnvio: string; prazo: string | null; valorPeca: number; descontoFaltante: number;
  ordemId?: string | null; obs: string; itens: { modelo: string; cor: string; tamanho: string; qtd: number }[];
}
export interface RetornoInput { remessaId: string; data: string; obs: string; cega?: boolean; itens: { itemId: string; boas: number; defeito: number }[] }
export interface RemessasDados { remessas: Remessa[]; ordens: OrdemCorte[]; limitePerda: number }
export interface RemessaOpcoes {
  oficinas: { id: string; nome: string; telefone: string; etapa: string; valorPeca: number | null }[];
  pessoas: { login: string; nome: string; setor: string }[];
  materiais: { id: string; nome: string; unidade: string }[];
  contas: { id: string; nome: string }[];
}
export interface AcertoRemessa { enviadas: number; boas: number; defeito: number; faltando: number; valor: number; noFinanceiro: boolean }

// =====================================================================
// Dani (assistente de IA)
// =====================================================================
export interface DaniMsg { de: 'eu' | 'dani'; texto: string; local?: boolean }
export type DaniResposta = { resposta: string } | { erro: 'nao_configurado' | 'limite' | 'limite_gemini' | 'sessao' | 'falha'; mensagem: string };
export interface DaniConfig { configurada: boolean; final: string | null; modelo: string; perguntasHoje: number }
