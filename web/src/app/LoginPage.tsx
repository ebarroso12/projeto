import { useState, type FormEvent } from 'react';
import { storage } from '../lib/storage';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Banner } from '../ui/primitives';
import { normalizar } from '../lib/rules';
import { useAuth } from './auth';

const EMPRESA_KEY = 'fab_empresa';

export function LoginPage() {
  const { signIn, notice, demo, api } = useAuth();
  const precisaEmpresa = api.precisaEmpresa;
  // ?e=codigo no endereço já preenche a empresa (útil para mandar o link aos funcionários)
  const [empresa, setEmpresa] = useState(() => new URLSearchParams(window.location.search).get('e') ?? storage.get(EMPRESA_KEY) ?? '');
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (precisaEmpresa && !empresa.trim()) { setError('Informe o código da empresa.'); return; }
    if (!login.trim() || !senha) { setError('Preencha login e senha.'); return; }
    setBusy(true);
    setError('');
    try {
      await signIn(login, senha, precisaEmpresa ? empresa : undefined);
      if (precisaEmpresa) storage.set(EMPRESA_KEY, normalizar(empresa));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  const modulos: [string, string][] = [['lancar', 'Produção'], ['ponto', 'Equipe e ponto'], ['falta', 'Estoque'], ['financeiro', 'Financeiro'], ['resultado', 'Resultado'], ['dashboard', 'Dashboard']];
  return (
    <div className="login">
      <aside className="login-brand" aria-hidden="true">
        <div className="lb-top"><img src="marca/marca-96.webp" alt="" width={44} height={44} /><span>Fábrica</span></div>
        <div className="lb-mid">
          <h2>Sua fábrica inteira<br /><em>na palma da mão.</em></h2>
          <p>Produção por etapa, ponto da equipe, estoque, financeiro e resultado do mês, em tempo real e no celular de cada um.</p>
          <ul className="lb-mods">
            {modulos.map(([id, nome]) => <li key={id}><img src={`marca/${id}.webp`} alt="" width={40} height={40} loading="lazy" /><span>{nome}</span></li>)}
          </ul>
        </div>
        <div className="lb-foot">Acesso protegido · cada entrada liberada pelo administrador</div>
      </aside>
      <main className="login-main">
      <form className="login-form" onSubmit={submit} noValidate>
          <div className="auth-logo"><img src="marca/logo-horizontal.webp" alt="Fábrica · Gestão da produção e do financeiro" width={960} height={356} /></div>
          <div className="login-hello"><h1>Entrar</h1><p className="muted">{precisaEmpresa ? 'Use o código da empresa, seu login e sua senha.' : 'Use seu login e sua senha.'}</p></div>
          {notice && <Banner tone="warn">{notice}</Banner>}
          {demo && <Banner tone="info">Modo demonstração: dados fictícios. Teste com admin / admin.</Banner>}
          {precisaEmpresa && (
            <TextField label="Empresa" value={empresa} onChange={e => setEmpresa(e.target.value)} autoCapitalize="none"
              autoComplete="organization" placeholder="código da empresa" hint={empresa ? undefined : 'Peça o código ao administrador.'} />
          )}
          <TextField label="Login" value={login} onChange={e => setLogin(e.target.value)} autoCapitalize="none"
            autoComplete="username" autoFocus={!precisaEmpresa || Boolean(empresa)} />
          <TextField label="Senha" type="password" value={senha} onChange={e => setSenha(e.target.value)}
            autoComplete="current-password" error={error} />
          <Button type="submit" variant="primary" size="lg" block loading={busy}>Entrar</Button>
          <p className="login-legal">Ao entrar, seu acesso fica registrado (data, hora e aparelho).</p>
          <p className="login-legal"><a href="?conheca">Conheça o Fábrica e teste grátis →</a></p>
      </form>
      </main>
    </div>
  );
}
