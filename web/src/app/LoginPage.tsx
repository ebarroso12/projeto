import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Banner } from '../ui/primitives';
import { useAuth } from './auth';

export function LoginPage() {
  const { signIn, notice, demo } = useAuth();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !senha) { setError('Preencha login e senha.'); return; }
    setBusy(true);
    setError('');
    try { await signIn(login, senha); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="center-screen">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <div className="card-body">
          <div className="auth-brand">
            <div className="brand-mark" aria-hidden="true">F</div>
            <div className="brand-name">Fábrica<small>Entre com seu login e senha</small></div>
          </div>
          {notice && <Banner tone="warn">{notice}</Banner>}
          {demo && <Banner tone="info">Modo demonstração: dados fictícios. Teste com admin / admin.</Banner>}
          <TextField label="Login" value={login} onChange={e => setLogin(e.target.value)} autoCapitalize="none"
            autoComplete="username" autoFocus />
          <TextField label="Senha" type="password" value={senha} onChange={e => setSenha(e.target.value)}
            autoComplete="current-password" error={error} />
          <Button type="submit" variant="primary" size="lg" block loading={busy}>Entrar</Button>
        </div>
      </form>
    </div>
  );
}
