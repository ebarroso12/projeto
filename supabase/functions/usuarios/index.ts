/**
 * Função de borda "usuarios": criar pessoas, redefinir senhas e criar empresas
 * (tudo que precisa da API administrativa do Auth).
 *
 *   POST { action: 'criar', login, nome, senha, setor, perfil, podeFalta }     -> administrador da empresa
 *   POST { action: 'senha', login, senha }                                    -> administrador da empresa
 *   POST { action: 'criar_empresa', codigo, nome, adminLogin, adminNome, adminSenha } -> dono do sistema
 *   POST { action: 'bootstrap', codigo, nome, login, adminNome, senha, token } -> só enquanto NÃO existe nenhum perfil
 *
 * Multiempresa: o e-mail interno do Auth é  <codigo-da-empresa>.<login>@fabrica.local,
 * então o mesmo login pode existir em empresas diferentes.
 * Quem chama é validado pelo próprio banco com o token da pessoa (fab_minha_empresa / fab_sou_dono).
 * Segredo necessário só para a 1ª instalação: BOOTSTRAP_TOKEN (defina e apague depois de usar).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

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

const emailDe = (empresa: string, login: string) => `${empresa}.${login}@fabrica.local`;
const LOGIN_OK = /^[a-z0-9._-]{2,32}$/;
const CODIGO_OK = /^[a-z0-9-]{2,30}$/;
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

function validarLogin(login: string, senha: unknown): string | null {
  if (!LOGIN_OK.test(login)) return 'Login inválido: use 2 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.';
  if (String(senha ?? '').length < MIN_SENHA) return `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`;
  return null;
}

/** Erro do banco ao validar quem chama -> mensagem e status adequados (não esconde bloqueio/sessão). */
function negado(msg: string | undefined, padrao: string) {
  const m = msg ?? '';
  if (m.includes('EMPRESA_BLOQUEADA')) return fail('O acesso desta empresa está suspenso. Fale com o responsável pelo sistema.', 403);
  if (m.includes('SESSAO') || /jwt|token/i.test(m)) return fail('Sua sessão expirou. Entre novamente.', 401);
  return fail(padrao, 403);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Método não permitido.', 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail('Corpo inválido.'); }

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // ----- primeira instalação: cria a 1ª empresa, o 1º administrador e o marca como dono -----
  if (b.action === 'bootstrap') {
    if (!BOOTSTRAP || b.token !== BOOTSTRAP) return fail('Não autorizado.', 403);
    const { data: total } = await admin.rpc('fab_total_perfis');
    if (total !== 0) return fail('O sistema já foi instalado.', 403);
    return await novaEmpresa(admin, b, true);
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const comoUsuario = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });

  // ----- dono do sistema: criar empresa cliente -----
  if (b.action === 'criar_empresa') {
    const { data: dono, error } = await comoUsuario.rpc('fab_sou_dono');
    if (error || dono !== true) return negado(error?.message, 'Apenas o responsável pelo sistema pode criar empresas.');
    return await novaEmpresa(admin, b, false);
  }

  // ----- demais ações: administrador da própria empresa -----
  const { data: emp, error: nao } = await comoUsuario.rpc('fab_minha_empresa');
  if (nao || !emp) return negado(nao?.message, 'Apenas o administrador pode fazer isto.');
  const empresa = emp as { id: string; codigo: string };

  if (b.action === 'criar') {
    const login = norm(b.login);
    const erro = validarLogin(login, b.senha);
    if (erro) return fail(erro);
    if (!['admin', 'funcionario'].includes(String(b.perfil))) return fail('Perfil inválido.');
    const r = await criarPessoa(admin, empresa, { ...b, login });
    return r ? fail(r) : json({ ok: true });
  }

  if (b.action === 'senha') {
    const login = norm(b.login);
    const erro = validarLogin(login, b.senha);
    if (erro) return fail(erro);
    const { data: id } = await admin.rpc('fab_id_por_login', { p_empresa: empresa.id, p_login: login });
    if (!id) return fail('Pessoa não encontrada.', 404);
    const { error } = await admin.auth.admin.updateUserById(id as string, { password: String(b.senha) });
    if (error) return fail(error.message);
    return json({ ok: true });
  }

  return fail('Ação desconhecida.');
});

/** Cria a pessoa no Auth e o perfil na empresa; desfaz o usuário se o perfil falhar. Retorna a mensagem de erro, ou null. */
async function criarPessoa(admin: SupabaseClient, empresa: { id: string; codigo: string }, b: Record<string, unknown>): Promise<string | null> {
  const login = norm(b.login);
  const { data, error } = await admin.auth.admin.createUser({
    email: emailDe(empresa.codigo, login), password: String(b.senha), email_confirm: true,
  });
  if (error || !data.user) {
    const jaExiste = /already|registered|exists/i.test(error?.message ?? '');
    return jaExiste ? 'Esse login já existe nesta empresa.' : (error?.message ?? 'Não foi possível criar o usuário.');
  }
  const { error: erroPerfil } = await admin.rpc('fab_criar_perfil', {
    p_id: data.user.id, p_empresa: empresa.id, p_login: login, p_nome: String(b.nome ?? ''), p_setor: String(b.setor ?? ''),
    p_perfil: String(b.perfil ?? 'funcionario'), p_pode_falta: b.podeFalta === true || b.podeFalta === 'Sim',
  });
  if (erroPerfil) {
    await admin.auth.admin.deleteUser(data.user.id); // nunca deixa usuário sem perfil
    return erroPerfil.message;
  }
  return null;
}

async function novaEmpresa(admin: SupabaseClient, b: Record<string, unknown>, primeiroDono: boolean) {
  const codigo = norm(b.codigo);
  const nome = String(b.nome ?? '').trim();
  const login = norm(b.adminLogin ?? b.login);
  const senha = b.adminSenha ?? b.senha;
  if (!CODIGO_OK.test(codigo)) return fail('Código inválido: use 2 a 30 letras minúsculas, números ou hífen.');
  if (!nome) return fail('Informe o nome da empresa.');
  const erro = validarLogin(login, senha);
  if (erro) return fail(erro);

  const { data: id, error } = await admin.rpc('fab_criar_empresa', { p_codigo: codigo, p_nome: nome });
  if (error || !id) return fail(error?.message ?? 'Não foi possível criar a empresa.');
  const empresa = { id: id as string, codigo };

  const r = await criarPessoa(admin, empresa, {
    login, senha, nome: String(b.adminNome ?? login), setor: 'Administração', perfil: 'admin', podeFalta: true,
  });
  if (r) {
    await admin.rpc('fab_apagar_empresa_vazia', { p_id: empresa.id }); // desfaz a empresa sem ninguém
    return fail(r);
  }
  if (primeiroDono) {
    const { data: uid } = await admin.rpc('fab_id_por_login', { p_empresa: empresa.id, p_login: login });
    if (uid) await admin.rpc('fab_tornar_dono', { p_user: uid });
  }
  return json({ ok: true, codigo });
}
