import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Usuario, UsuarioInput } from '../../api/types';
import { useApi, useAuth } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { useBoot } from '../../app/boot';
import { FuncoesDialog } from './FuncoesDialog';
import { loginFromName } from '../../lib/format';
import { MIN_SENHA } from '../../lib/rules';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog } from '../../ui/Dialog';
import { SelectField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Card } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

const SETORES = ['Costureira', 'Cortador', 'Conferente', 'Estoque', 'Outra', 'Administração'];
const PERFIS = [{ value: 'funcionario', label: 'Funcionário' }, { value: 'admin', label: 'Administrador' }];
const SIM_NAO = ['Sim', 'Não'];

const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));

function UserDrawer({ user, onClose }: { user: Usuario | null; onClose: () => void }) {
  const api = useApi();
  const novo = user === null;
  const [f, setF] = useState<UsuarioInput>(() => ({
    novo, nome: user?.nome ?? '', login: user?.login ?? '', senha: novo ? randomPin() : '', setor: user?.setor ?? 'Costureira',
    perfil: user?.perfil ?? 'funcionario', ativo: user?.ativo === false ? 'Não' : 'Sim', podeFalta: user?.podeFalta ? 'Sim' : 'Não',
  }));
  const [error, setError] = useState('');
  const save = useAction(api.salvarUsuario, {
    success: (_d, v) => (v.senha ? `Salvo! Login: ${v.login.trim().toLowerCase()} · Senha: ${v.senha}` : 'Salvo!'),
    invalidate: [['usuarios']], onSuccess: onClose,
  });
  const set = <K extends keyof UsuarioInput>(k: K, v: UsuarioInput[K]) => setF(s => ({ ...s, [k]: v }));
  const setores = user && !SETORES.includes(user.setor) && user.setor ? [...SETORES, user.setor] : SETORES;

  const submit = () => {
    if (!f.nome.trim() || !f.login.trim()) { setError('Preencha o nome e o login.'); return; }
    if (novo && f.senha.length < MIN_SENHA) { setError(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`); return; }
    setError('');
    save.mutate(f);
  };

  return (
    <Dialog open onClose={onClose} title={novo ? 'Nova pessoa' : 'Editar pessoa'} variant="drawer"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Salvar</Button></>}>
      <TextField label="Nome" value={f.nome} autoFocus
        onChange={e => { set('nome', e.target.value); if (novo) set('login', loginFromName(e.target.value)); }} />
      <TextField label="Login (sem espaço)" value={f.login} readOnly={!novo} autoCapitalize="none" onChange={e => set('login', e.target.value)} />
      <TextField label="Senha" value={f.senha} autoComplete="off" autoCapitalize="none" onChange={e => set('senha', e.target.value)}
        placeholder={novo ? 'Crie uma senha' : 'Digite para trocar a senha'} hint={novo ? 'Sugestão gerada: anote e entregue à pessoa.' : 'Deixe vazio para manter a senha atual.'} />
      <SelectField label="Categoria" value={f.setor} onChange={e => set('setor', e.target.value)} options={setores} />
      <div className="form-grid">
        <SelectField label="Perfil" value={f.perfil} onChange={e => set('perfil', e.target.value)} options={PERFIS} />
        <SelectField label="Ativo" value={f.ativo} onChange={e => set('ativo', e.target.value as 'Sim' | 'Não')} options={SIM_NAO} />
      </div>
      <SelectField label="Pode colocar itens em falta?" value={f.podeFalta} onChange={e => set('podeFalta', e.target.value as 'Sim' | 'Não')} options={SIM_NAO} />
      {error && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </Dialog>
  );
}

export function PessoasTab() {
  const api = useApi();
  const toast = useToast();
  const q = useQuery({ queryKey: ['usuarios'], queryFn: () => api.listarUsuarios() });
  const [editing, setEditing] = useState<Usuario | null | undefined>(undefined); // undefined = fechado, null = novo
  const [funcoes, setFuncoes] = useState<string | null>(null);
  const { demo } = useAuth();
  const [shown, setShown] = useState<Set<string>>(new Set());

  const toggle = (login: string) => setShown(s => { const n = new Set(s); if (n.has(login)) n.delete(login); else n.add(login); return n; });
  const boot = useBoot();
  // Apps Script devolve um link pessoal; no Supabase o link é o endereço de entrada com a empresa já preenchida.
  const linkDe = (u: Usuario) => u.link || (api.precisaEmpresa && boot.empresa.codigo
    ? `${window.location.origin}${window.location.pathname}?e=${encodeURIComponent(boot.empresa.codigo)}` : '');
  const copyLink = async (u: Usuario) => {
    const link = linkDe(u);
    if (!link) { toast.info('Essa pessoa ainda não tem link de acesso.'); return; }
    const msg = u.link ? link : `${link}  (login: ${u.login})`;
    try { await navigator.clipboard.writeText(msg); toast.success(`Link de ${u.nome} copiado. Mande no WhatsApp.`); }
    catch { toast.info(`Link de ${u.nome}: ${msg}`); }
  };

  const cols: Column<Usuario>[] = [
    {
      id: 'nome', header: 'Nome', value: r => r.nome,
      cell: r => api.precisaEmpresa || demo
        ? <button type="button" className="link-empresa" onClick={() => setFuncoes(r.login)} title="Ver e mudar as funções desta pessoa"><b>{r.nome}</b><small>{r.setor} · funções</small></button>
        : <>{r.nome}<small>{r.setor}</small></>,
    },
    { id: 'login', header: 'Login', value: r => r.login, cell: r => <code>{r.login}</code> },
    { id: 'perfil', header: 'Perfil', value: r => r.perfil, cell: r => (r.perfil === 'admin' ? <Badge tone="brand">Administrador</Badge> : <Badge>Funcionário</Badge>) },
    { id: 'ativo', header: 'Situação', value: r => (r.ativo ? 'Ativo' : 'Inativo'), cell: r => (r.ativo ? <Badge tone="ok">Ativo</Badge> : <Badge tone="danger">Inativo</Badge>) },
    { id: 'falta', header: 'Lança em falta', value: r => (r.podeFalta ? 'Sim' : 'Não'), cell: r => (r.podeFalta ? 'Sim' : '—') },
    {
      id: 'senha', header: 'Senha',
      cell: r => r.senha ? (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <code>{shown.has(r.login) ? r.senha : '••••'}</code>
          <Button size="sm" variant="ghost" iconOnly aria-label={shown.has(r.login) ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => toggle(r.login)}><Icon name={shown.has(r.login) ? 'eyeOff' : 'eye'} size={15} /></Button>
        </span>
      ) : '—',
    },
    {
      id: 'acoes', header: '',
      cell: r => (
        <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          {linkDe(r) && <Button size="sm" icon={<Icon name="copy" size={14} />} onClick={() => void copyLink(r)}>Link</Button>}
          <Button size="sm" icon={<Icon name="pencil" size={14} />} onClick={() => setEditing(r)}>Editar</Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <Card title="Pessoas" flush actions={<Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setEditing(null)}>Nova pessoa</Button>}>
        <QueryView query={q}>
          {users => <DataTable label="Pessoas" columns={cols} rows={users} searchable rowKey={r => r.login} empty="Nenhuma pessoa cadastrada." initialSort={{ id: 'nome', dir: 1 }} />}
        </QueryView>
      </Card>
      {editing !== undefined && <UserDrawer user={editing} onClose={() => setEditing(undefined)} />}
      {funcoes && <FuncoesDialog login={funcoes} onClose={() => setFuncoes(null)} />}
    </>
  );
}
