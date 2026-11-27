/**
 * Busca no manual (sem IA): usada na demonstração, quando a chave do Gemini não está configurada,
 * quando a cota gratuita acaba ou quando a IA falha. Pontua cada seção pelas palavras da pergunta
 * (sem acento, sem palavras vazias), com peso maior no título; sinônimos simples aproximam o vocabulário da fábrica.
 */
import conhecimento from './conhecimento.json';

export interface Secao { id: string; titulo: string; rota: string; funcao: string; texto: string }
export const SECOES = conhecimento as Secao[];

const VAZIAS = new Set('a o os as de da do das dos e é em no na nos nas um uma uns umas para pra por com como que qual quais quando onde eu meu minha me se ao à é ser ter tem fazer faço faz posso pode consigo quero app fabrica sobre isso esse essa este esta'.split(' '));
const SINONIMOS: Record<string, string> = {
  costureira: 'oficina', faccao: 'oficina', faccionista: 'oficina', cortador: 'corte', bobina: 'corte', tecido: 'material', malha: 'material',
  enviar: 'remessa', mandar: 'remessa', mandei: 'remessa', devolver: 'retorno', voltou: 'retorno', voltaram: 'retorno', pagar: 'pagamento', paguei: 'pagamento',
  acertar: 'acerto', senha: 'senha', entrar: 'entrar', login: 'entrar', liberar: 'acesso', liberacao: 'acesso', notificacao: 'avisos', notificacoes: 'avisos',
  aviso: 'avisos', instalar: 'instalar', celular: 'instalar', estoque: 'material', venda: 'pedidos', cliente: 'pedidos', lucro: 'lucro', margem: 'lucro',
  pdf: 'relatorio', imprimir: 'relatorio', funcionario: 'funcionarios', funcionarios: 'funcionarios', cadastrar: 'cadastros', boleto: 'financeiro',
  receber: 'receber', prazo: 'receber', parcela: 'parcelas', parcelas: 'parcelas', producao: 'lancar', lancamento: 'lancar', ponto: 'ponto', saida: 'ponto',
};

export const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const termos = (s: string) => normalizar(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !VAZIAS.has(t)).map(t => SINONIMOS[t] ?? t);

const indice = SECOES.map(s => ({ s, titulo: termos(s.titulo), corpo: termos(`${s.titulo} ${s.texto}`) }));

export function buscar(pergunta: string, limite = 2): Secao[] {
  const q = [...new Set(termos(pergunta))];
  if (!q.length) return [];
  const pont = indice.map(({ s, titulo, corpo }) => {
    let p = 0;
    for (const t of q) {
      const raiz = t.slice(0, Math.max(4, t.length - 2));   // remessa ~ remessas, cortar ~ corte
      if (titulo.some(x => x.startsWith(raiz))) p += 3;
      p += Math.min(3, corpo.filter(x => x.startsWith(raiz)).length);
    }
    return { s, p };
  }).filter(x => x.p > 0).sort((a, b) => b.p - a.p);
  if (!pont.length) return [];
  const melhor = pont[0]!.p;
  return pont.filter(x => x.p >= melhor * 0.6).slice(0, limite).map(x => x.s);
}

/** Resposta montada pelo manual, com atalho para a tela. */
export function respostaDoManual(pergunta: string): string {
  const achadas = buscar(pergunta);
  if (!achadas.length) return 'Não achei isso no manual. Tente com outras palavras (ex.: “como registrar uma remessa”) ou fale com o administrador.';
  const [melhor, ...outras] = achadas;
  const tela = (s: Secao) => s.titulo.split(/[:(,]/)[0]!.trim();
  return `**${melhor!.titulo}**\n${melhor!.texto}${melhor!.rota ? `\n[[ir:${melhor!.rota}|Abrir ${tela(melhor!)}]]` : ''}`
    + (outras.length ? `\n\nVeja também: ${outras.map(s => `**${s.titulo}**`).join(', ')}.` : '');
}
