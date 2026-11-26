/**
 * Função de borda "usuarios": criar pessoas e redefinir senhas (precisa da API administrativa do Auth).
 *
 *   POST { action: 'criar',  login, nome, senha, setor, perfil, podeFalta }   -> administrador logado
 *   POST { action: 'senha',  login, senha }                                  -> administrador logado
 *   POST { action: 'bootstrap', login, nome, senha, token }                  -> só enquanto NÃO existe nenhum perfil
 *
 * Segredo necessário só para o 1º administrador:  BOOTSTRAP_TOKEN (defina e apague depois de usar).
 * Quem chama é validado pelo próprio banco: a função tenta fab_listar_usuarios() com o token da pessoa,
 * que só funciona para administrador ativo.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BOOTSTRAP = Deno.env.get('BOOTSTRAP_TOKEN') ?? '';

const MIN_SENHA = 6; // mínimo do Supabase Auth
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ error: message }, status);

const emailDe = (login: string) => `${login}@fabrica.local`;
const LOGIN_OK = /^[a-z0-9._-]{2,32}$/;

function validar(b: Record<string, unknown>, comSenha: boolean): string | null {
  const login = String(b.login ?? '').trim().toLowerCase();
  if (!LOGIN_OK.test(login)) return 'Login inválido: use 2 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.';
  if (comSenha && String(b.senha ?? '').length < MIN_SENHA) return `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Método não permitido.', 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail('Corpo inválido.'); }

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // ----- primeiro administrador -----
  if (b.action === 'bootstrap') {
    if (!BOOTSTRAP || b.token !== BOOTSTRAP) return fail('Não autorizado.', 403);
    const { data: total } = await admin.rpc('fab_total_perfis');
    if (total !== 0) return fail('O sistema já tem administrador.', 403);
    const erro = validar(b, true);
    if (erro) return fail(erro);
    return await criar(admin, { ...b, perfil: 'admin', podeFalta: true });
  }

  // ----- demais ações: só administrador -----
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const comoUsuario = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { error: nao } = await comoUsuario.rpc('fab_listar_usuarios');
  if (nao) return fail('Apenas o administrador pode fazer isto.', 403);

  if (b.action === 'criar') {
    const erro = validar(b, true);
    if (erro) return fail(erro);
    if (!['admin', 'funcionario'].includes(String(b.perfil))) return fail('Perfil inválido.');
    return await criar(admin, b);
  }

  if (b.action === 'senha') {
    const erro = validar(b, true);
    if (erro) return fail(erro);
    const { data: id } = await admin.rpc('fab_id_por_login', { p_login: b.login });
    if (!id) return fail('Pessoa não encontrada.', 404);
    const { error } = await admin.auth.admin.updateUserById(id as string, { password: String(b.senha) });
    if (error) return fail(error.message);
    return json({ ok: true });
  }

  return fail('Ação desconhecida.');
});

async function criar(admin: ReturnType<typeof createClient>, b: Record<string, unknown>) {
  const login = String(b.login).trim().toLowerCase();
  const { data, error } = await admin.auth.admin.createUser({
    email: emailDe(login), password: String(b.senha), email_confirm: true,
  });
  if (error || !data.user) {
    const jaExiste = /already|registered|exists/i.test(error?.message ?? '');
    return fail(jaExiste ? 'Esse login já existe.' : (error?.message ?? 'Não foi possível criar o usuário.'));
  }
  const { error: erroPerfil } = await admin.rpc('fab_criar_perfil', {
    p_id: data.user.id, p_login: login, p_nome: String(b.nome ?? ''), p_setor: String(b.setor ?? ''),
    p_perfil: String(b.perfil ?? 'funcionario'), p_pode_falta: b.podeFalta === true || b.podeFalta === 'Sim',
  });
  if (erroPerfil) {
    await admin.auth.admin.deleteUser(data.user.id); // desfaz: nunca deixa usuário sem perfil
    return fail(erroPerfil.message);
  }
  return json({ ok: true });
}
