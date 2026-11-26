let cached: { ip: string; at: number } | null = null;

/**
 * IP público do aparelho, usado pelo servidor para conferir o Wi-Fi da fábrica.
 * Tem limite de tempo (o app antigo ficava preso se o serviço de IP não respondesse)
 * e devolve '' em qualquer falha: quem decide se isso bloqueia é o servidor.
 */
export async function getIp(timeoutMs = 4000): Promise<string> {
  if (cached && Date.now() - cached.at < 60_000) return cached.ip;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store', signal: ctrl.signal });
    const body = (await res.json()) as { ip?: unknown };
    const ip = typeof body.ip === 'string' ? body.ip : '';
    if (ip) cached = { ip, at: Date.now() };
    return ip;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
