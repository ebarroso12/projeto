/**
 * Função de borda "avisos": entrega os avisos do app no celular (Web Push, padrão VAPID).
 *
 *   POST { action: 'chave' }              -> público: chave pública VAPID (o navegador precisa dela para se inscrever)
 *   POST { action: 'enviar', id }         -> chamado pelo BANCO (pg_net), com o cabeçalho x-avisos-segredo
 *
 * O conteúdo e os aparelhos vêm do banco (fab_aviso_para_envio, só service_role); quem chama só informa o id.
 * Aparelhos que não existem mais (404/410) são removidos (fab_aviso_resultado).
 * Segredos: VAPID_PUBLIC, VAPID_PRIVATE, AVISOS_SEGREDO.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUB = Deno.env.get('VAPID_PUBLIC') ?? '';
const PRIV = Deno.env.get('VAPID_PRIVATE') ?? '';
const SEGREDO = Deno.env.get('AVISOS_SEGREDO') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Comparação em tempo constante (não vaza o segredo pelo tempo de resposta). */
function igual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }

  if (b.action === 'chave') return PUB ? json({ chave: PUB }) : json({ error: 'Avisos não configurados.' }, 503);

  if (b.action === 'enviar') {
    if (!SEGREDO || !igual(req.headers.get('x-avisos-segredo') ?? '', SEGREDO)) return json({ error: 'Não autorizado.' }, 403);
    if (!PUB || !PRIV) return json({ error: 'Avisos não configurados.' }, 503);
    const id = Number(b.id);
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Aviso inválido.' }, 400);
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('fab_aviso_para_envio', { p_id: id });
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ ok: true, enviado: false });   // já enviado ou não existe
    const a = data as { titulo: string; texto: string; url: string; tipo: string; destinos: { endpoint: string; p256dh: string; auth: string }[] };
    webpush.setVapidDetails('https://fabricapremium.vercel.app', PUB, PRIV);
    const carga = JSON.stringify({ titulo: a.titulo, texto: a.texto, url: a.url, tipo: a.tipo, tag: `${a.tipo}-${id}` });
    let entregues = 0;
    const expirados: string[] = [];
    const falhas: string[] = [];
    await Promise.all(a.destinos.map(async d => {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, carga, { TTL: 60 * 60 * 24, urgency: a.tipo === 'acesso' ? 'high' : 'normal' });
        entregues++;
      } catch (e) {
        const st = (e as { statusCode?: number }).statusCode;
        if (st === 404 || st === 410) expirados.push(d.endpoint);
        else falhas.push(`${st ?? '?'}`);
      }
    }));
    await admin.rpc('fab_aviso_resultado', { p_id: id, p_entregues: entregues, p_expirados: expirados });
    return json({ ok: true, entregues, expirados: expirados.length, falhas });
  }

  return json({ error: 'Ação desconhecida.' }, 400);
});
