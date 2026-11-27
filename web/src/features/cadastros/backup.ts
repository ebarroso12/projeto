/** Texto da situação: "hoje", "ontem", "há N dias" ou nunca. */
export function textoSituacao(s: { ultima: string | null; quem: string; dias: number | null } | undefined): { texto: string; tom: 'ok' | 'warn' | 'danger' } {
  if (!s || !s.ultima || s.dias === null) return { texto: 'A empresa ainda não tem nenhuma cópia de segurança.', tom: 'danger' };
  const quando = s.dias <= 0 ? 'hoje' : s.dias === 1 ? 'ontem' : `há ${s.dias} dias`;
  const quem = s.quem ? ` por ${s.quem}` : '';
  if (s.dias > 7) return { texto: `A última cópia foi feita ${quando}${quem}. Faça uma nova: o recomendado é uma por semana.`, tom: 'warn' };
  return { texto: `Última cópia feita ${quando}${quem}.`, tom: 'ok' };
}
