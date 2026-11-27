import { useEffect, useState, type FormEvent } from 'react';
import { loginFromName } from '../lib/format';
import { MIN_SENHA } from '../lib/rules';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Banner } from '../ui/primitives';
import { useAuth } from './auth';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** Remove ?convite= do endereço (e volta para a tela de entrada). */
export function sairDoConvite() {
  const u = new URL(window.location.href);
  u.searchParams.delete('convite');
  window.history.replaceState(null, '', u.pathname + u.search + u.hash);
}

/** Página pública do link de teste: a pessoa cria a própria empresa e já entra como administradora. */
export function TestePage({ convite, onVoltar }: { convite: string; onVoltar: () => void }) {
  const { api, signIn } = useAuth();
  const [estado, setEstado] = useState<'checando' | 'valido' | 'invalido'>('checando');
  const [dias, setDias] = useState(7);
  const [tipo, setTipo] = useState<'teste' | 'pro'>('teste');
  const [ate, setAte] = useState('');
  const [f, setF] = useState({ nome: '', codigo: '', adminNome: '', adminLogin: '', adminSenha: '', confirma: '' });
  const [codigoManual, setCodigoManual] = useState(false);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));

  useEffect(() => {
    let vivo = true;
    api.validarConvite(convite)
      .then(r => { if (vivo) { setEstado(r.valido ? 'valido' : 'invalido'); setDias(r.dias || 7); setTipo(r.tipo); setAte(r.ate); } })
      .catch(() => { if (vivo) setEstado('invalido'); });
    return () => { vivo = false; };
  }, [api, convite]);

  const pro = tipo === 'pro';
  const ateTxt = ate ? `${ate.slice(8, 10)}/${ate.slice(5, 7)}` : '';
  const restam = ate ? Math.max(0, Math.ceil((Date.parse(ate) - Date.now()) / 86_400_000)) : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.nome.trim() || !f.codigo) return setErro('Informe o nome da empresa.');
    if (!f.adminNome.trim() || !f.adminLogin.trim()) return setErro('Informe seu nome e login.');
    if (f.adminSenha.length < MIN_SENHA) return setErro(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
    if (f.adminSenha !== f.confirma) return setErro('As senhas não conferem.');
    setErro(''); setBusy(true);
    try {
      await api.criarEmpresaTeste({ convite, codigo: f.codigo, nome: f.nome.trim(), adminNome: f.adminNome.trim(), adminLogin: f.adminLogin.trim().toLowerCase(), adminSenha: f.adminSenha });
      try { localStorage.setItem('fab_empresa', f.codigo); } catch { /* sem armazenamento */ }
      sairDoConvite();
      try {
        await signIn(f.adminLogin.trim().toLowerCase(), f.adminSenha, f.codigo);
      } finally {
        onVoltar(); // o link já foi usado: daqui em diante é a tela normal de entrada
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível criar a empresa.');
    } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <aside className="login-brand" aria-hidden="true">
        <div className="lb-top"><img src="marca/marca-96.webp" alt="" width={44} height={44} /><span>Fábrica</span></div>
        <div className="lb-mid">
          <div className="lb-selo">{pro ? 'Versão completa' : `Teste grátis${ateTxt ? ` até ${ateTxt}` : ''} · sem cartão`}</div>
          {pro ? <h2>Sua fábrica no controle,<br /><em>em tempo real.</em></h2> : <h2>Teste a gestão completa<br /><em>da sua fábrica.</em></h2>}
          <p>Em 1 minuto sua empresa está pronta: cadastre a equipe, lance a produção, controle o ponto, o estoque e o financeiro.</p>
          <ul className="lb-passos">
            <li><b>1</b>Crie a empresa e seu acesso</li>
            <li><b>2</b>Cadastre modelos e a equipe</li>
            <li><b>3</b>Acompanhe tudo no painel</li>
          </ul>
        </div>
        <div className="lb-foot">Seus dados ficam só na sua empresa</div>
      </aside>
      <main className="login-main">
        <form className="login-form" onSubmit={submit} noValidate>
          <div className="login-hello">
            <h1>{pro ? 'Ative sua versão completa' : 'Comece seu teste grátis'}</h1>
            <p className="muted">{pro ? 'Crie sua empresa e seu acesso de administrador. Tudo liberado, sem prazo.'
              : `Tudo liberado${ateTxt ? ` até ${ateTxt}${restam > 0 ? ` (${restam} dia${restam > 1 ? 's' : ''})` : ''}` : ` por ${dias} dias`}. Depois, é só falar com a gente para continuar.`}</p>
          </div>
          {estado === 'checando' && <Banner tone="info">Conferindo o link…</Banner>}
          {estado === 'invalido' && <Banner tone="warn">Este link não vale mais (venceu, foi revogado ou já foi usado). Peça um novo a quem enviou.</Banner>}
          {estado === 'valido' && <>
            <TextField label="Nome da empresa" value={f.nome} autoFocus
              onChange={e => { set('nome', e.target.value); if (!codigoManual) set('codigo', slug(e.target.value)); }} />
            <TextField label="Código da empresa" value={f.codigo} autoCapitalize="none" hint="Sua equipe digita isso para entrar. Letras, números e hífen."
              onChange={e => { setCodigoManual(true); set('codigo', slug(e.target.value)); }} />
            <div className="form-grid">
              <TextField label="Seu nome" value={f.adminNome} onChange={e => { set('adminNome', e.target.value); set('adminLogin', loginFromName(e.target.value)); }} />
              <TextField label="Seu login" value={f.adminLogin} autoCapitalize="none" autoComplete="username" onChange={e => set('adminLogin', e.target.value)} />
            </div>
            <div className="form-grid">
              <TextField label="Senha" type="password" value={f.adminSenha} autoComplete="new-password" onChange={e => set('adminSenha', e.target.value)} hint={`Mínimo ${MIN_SENHA} caracteres.`} />
              <TextField label="Repita a senha" type="password" value={f.confirma} autoComplete="new-password" onChange={e => set('confirma', e.target.value)} />
            </div>
            {erro && <p className="err" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{erro}</p>}
            <Button type="submit" variant="primary" size="lg" block loading={busy}>Criar minha empresa e entrar</Button>
          </>}
          <button type="button" className="link" style={{ alignSelf: 'center', fontSize: 13.5 }} onClick={() => { sairDoConvite(); onVoltar(); }}>Já tenho acesso: entrar</button>
        </form>
      </main>
    </div>
  );
}
