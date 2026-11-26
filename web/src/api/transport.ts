export type ErrorCode = 'WIFI' | 'SESSAO' | 'PENDENTE' | 'REDE' | 'TEMPO' | 'RESPOSTA' | 'SERVIDOR';

export class ApiError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/** Chamada genérica: nome da função do servidor + argumentos. */
export type Transport = (fn: string, args: unknown[]) => Promise<unknown>;

/** O Apps Script devolve só o texto do erro; "WIFI" e "SESSAO" são códigos do servidor. */
export function fromServerMessage(raw: string): ApiError {
  if (raw.includes('ACESSO_PENDENTE')) return new ApiError('PENDENTE', 'Aguardando o administrador liberar seu acesso.');
  if (raw.includes('ACESSO_NEGADO')) return new ApiError('SESSAO', 'O administrador não liberou este acesso. Fale com ele e tente de novo.');
  if (raw.includes('WIFI')) return new ApiError('WIFI', 'Conecte-se ao Wi-Fi da fábrica.');
  if (raw.includes('EMPRESA_BLOQUEADA')) return new ApiError('SESSAO', 'O acesso desta empresa está suspenso. Fale com o responsável pelo sistema.');
  if (raw.includes('SESSAO')) return new ApiError('SESSAO', 'Sua sessão expirou. Entre de novo.');
  return new ApiError('SERVIDOR', raw.replace(/^Error:\s*/, '').trim() || 'O servidor recusou a operação.');
}

export function httpTransport(url: string, timeoutMs = 45_000): Transport {
  return async (fn, args) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let text: string;
    try {
      // text/plain evita o preflight CORS, que o Apps Script não responde.
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ fn, args }),
        signal: ctrl.signal,
        credentials: 'omit',
        redirect: 'follow',
      });
      text = await res.text();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new ApiError('TEMPO', `O servidor demorou mais de ${Math.round(timeoutMs / 1000)} s para responder.`);
      }
      throw new ApiError('REDE', 'Não foi possível falar com o servidor. Confira a internet.');
    } finally {
      clearTimeout(timer);
    }

    const t = text.trim();
    if (t.startsWith('<')) {
      throw new ApiError('RESPOSTA', 'O endereço devolveu uma página, não dados. Confira se o Api.gs foi implantado.');
    }
    let body: unknown;
    try { body = JSON.parse(t); } catch { throw new ApiError('RESPOSTA', 'Resposta inválida do servidor.'); }
    if (!body || typeof body !== 'object') throw new ApiError('RESPOSTA', 'Resposta inválida do servidor.');
    const b = body as { ok?: unknown; data?: unknown; error?: unknown };
    if (b.ok !== true) throw fromServerMessage(String(b.error ?? ''));
    return b.data;
  };
}
