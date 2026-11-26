/** Etapa de produção que o setor do funcionário lança (regra herdada do sistema anterior). */
export function etapaDoSetor(setor: string): string {
  const s = setor.toLowerCase();
  if (s.includes('cort')) return 'Corte';
  if (s.includes('costur') || s.includes('produ')) return 'Costura';
  if (s.includes('confer') || s.includes('estoque')) return 'Conferência';
  return '';
}
