/**
 * Formatação leve das respostas da Dani: **negrito**, *itálico* e `código`.
 * Só vira estilo o que a expressão realmente reconheceu (posições ímpares do split),
 * e o itálico exige asterisco "solto" (sem letra/número colado por fora), para não pegar contas como 2*3.
 */
export type Peca = { tipo: 'texto' | 'b' | 'i' | 'code'; texto: string; filhos?: Peca[] };

const PARTES = [
  String.raw`\*\*(?=\S)(?:[^*\n]|\*(?!\*))+?(?<=\S)\*\*`,            // **negrito** (pode ter *itálico* dentro)
  String.raw`(?<![\p{L}\p{N}*])\*(?=[^\s*])[^*\n]+?(?<=[^\s*])\*(?![\p{L}\p{N}*])`, // *itálico*
  String.raw`\x60[^\x60\n]+\x60`,                                           // `código`
];
// um grupo de captura em volta de tudo: no split, os trechos reconhecidos ficam nas posições ímpares
const RE = new RegExp(`(${PARTES.map(p => `(?:${p})`).join('|')})`, 'gu');

export function pecas(s: string): Peca[] {
  return s.split(RE).flatMap((p, i): Peca[] => {
    if (!p) return [];
    if (i % 2 === 0) return [{ tipo: 'texto', texto: p }];
    if (p.startsWith('**')) { const dentro = p.slice(2, -2); return [{ tipo: 'b', texto: dentro, filhos: pecas(dentro) }]; }
    if (p.startsWith('`')) return [{ tipo: 'code', texto: p.slice(1, -1) }];
    return [{ tipo: 'i', texto: p.slice(1, -1) }];
  });
}
