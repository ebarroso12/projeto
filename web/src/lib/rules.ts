/** Mínimo de caracteres da senha. É o piso do Supabase Auth (6); vale para todos os servidores, por consistência. */
export const MIN_SENHA = 6;

/** "Fábrica " -> "fabrica": códigos e logins não têm acento nem maiúscula, então aceitamos do jeito que a pessoa digitar. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
