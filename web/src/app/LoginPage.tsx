import { useState, type FormEvent } from 'react';
import { storage } from '../lib/storage';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Banner } from '../ui/primitives';
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
      if (precisaEmpresa) storage.set(EMPRESA_KEY, empresa.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <div className="card-body">
          <div className="auth-brand">
            <div className="brand-mark" aria-hidden="true">F</div>
            <div className="brand-name">Fábrica<small>Gestão da produção e financeiro</small></div>
          </div>
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
        </div>
      </form>
    </div>
  );
}
