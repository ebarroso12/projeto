import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Empresa, NovaEmpresaInput } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { dataBR, loginFromName } from '../../lib/format';
import { MIN_SENHA } from '../../lib/rules';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner, Card, PageHeader, Stat } from '../../ui/primitives';

const KEY = ['empresas'];
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const senhaAleatoria = () => Math.random().toString(36).slice(2, 6) + Math.floor(1000 + Math.random() * 9000);

function NovaEmpresa({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [f, setF] = useState<NovaEmpresaInput>({ codigo: '', nome: '', adminNome: '', adminLogin: '', adminSenha: senhaAleatoria() });
  const [codigoManual, setCodigoManual] = useState(false);
  const [erro, setErro] = useState('');
  const [criada, setCriada] = useState<NovaEmpresaInput | null>(null);
  const salvar = useAction((o: NovaEmpresaInput) => api.criarEmpresa(o), { invalidate: [KEY], onSuccess: (_d, v) => setCriada(v) });
  const set = <K extends keyof NovaEmpresaInput>(k: K, v: string) => setF(s => ({ ...s, [k]: v }));

  const submit = () => {
    if (!f.nome.trim() || !f.codigo.trim()) { setErro('Preencha o nome e o código da empresa.'); return; }
    if (!f.adminNome.trim() || !f.adminLogin.trim()) { setErro('Preencha o nome e o login do administrador.'); return; }
    if (f.adminSenha.length < MIN_SENHA) { setErro(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`); return; }
    setErro('');
    salvar.mutate({ ...f, codigo: f.codigo.trim().toLowerCase(), adminLogin: f.adminLogin.trim().toLowerCase() });
  };

  if (criada) {
    return (
      <Dialog open onClose={onClose} title="Empresa criada" footer={<>
        <Button icon={<Icon name="copy" size={15} />} onClick={() => {
          const url = `${window.location.origin}${window.location.pathname}?e=${encodeURIComponent(criada.codigo)}`;
          void navigator.clipboard?.writeText(`Acesso ao sistema da ${criada.nome}\n${url}\nEmpresa: ${criada.codigo}\nLogin: ${criada.adminLogin}\nSenha: ${criada.adminSenha}`).catch(() => {});
        }}>Copiar dados</Button>
        <Button variant="primary" onClick={onClose}>Concluir</Button></>}>
        <Banner tone="info">Envie estes dados ao administrador da <b>{criada.nome}</b>. A senha aparece só agora.</Banner>
        <div className="grid-kpi" style={{ gridTemplateColumns: '1fr' }}>
          <Stat label="Empresa (código)" value={<code style={{ fontSize: 22 }}>{criada.codigo}</code>} />
          <Stat label="Login" value={<code style={{ fontSize: 22 }}>{criada.adminLogin}</code>} />
          <Stat label="Senha" value={<code style={{ fontSize: 22 }}>{criada.adminSenha}</code>} hint="Peça para trocar no primeiro acesso." />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title="Nova empresa" variant="drawer"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Criar empresa</Button></>}>
      <TextField label="Nome da empresa" value={f.nome} autoFocus
        onChange={e => { set('nome', e.target.value); if (!codigoManual) set('codigo', slug(e.target.value)); }} />
      <TextField label="Código de acesso" value={f.codigo} autoCapitalize="none" hint="Digitado no login. Letras minúsculas, números e hífen."
        onChange={e => { setCodigoManual(true); set('codigo', slug(e.target.value)); }} />
      <p className="muted" style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>Primeiro administrador</p>
      <TextField label="Nome" value={f.adminNome} onChange={e => { set('adminNome', e.target.value); set('adminLogin', loginFromName(e.target.value)); }} />
      <TextField label="Login" value={f.adminLogin} autoCapitalize="none" onChange={e => set('adminLogin', e.target.value)} />
      <TextField label="Senha inicial" value={f.adminSenha} autoComplete="off" onChange={e => set('adminSenha', e.target.value)} hint="Gerada automaticamente; pode trocar." />
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}

function Lista({ empresas }: { empresas: Empresa[] }) {
  const api = useApi();
  const confirm = useConfirm();
  const [nova, setNova] = useState(false);
  const bloquear = useAction((v: { id: string; bloquear: boolean; motivo: string }) => api.bloquearEmpresa(v.id, v.bloquear, v.motivo), {
    success: (_d, v) => (v.bloquear ? 'Empresa bloqueada.' : 'Empresa liberada.'), invalidate: [KEY],
  });

  const ativas = empresas.filter(e => e.ativa);
  const cols: Column<Empresa>[] = [
    { id: 'nome', header: 'Empresa', value: e => e.nome, cell: e => <>{e.nome}<small>desde {dataBR(e.criadaEm)}</small></> },
    { id: 'codigo', header: 'Código', value: e => e.codigo, cell: e => <code>{e.codigo}</code> },
    { id: 'usuarios', header: 'Usuários', numeric: true, value: e => e.usuarios, cell: e => e.usuarios },
    { id: 'admins', header: 'Admins', numeric: true, value: e => e.admins, cell: e => e.admins },
    { id: 'acesso', header: 'Último acesso', value: e => e.ultimoAcesso, cell: e => (e.ultimoAcesso ? dataBR(e.ultimoAcesso) : '—'), nowrap: true },
    { id: 'sit', header: 'Situação', value: e => (e.ativa ? 'Ativa' : 'Bloqueada'), cell: e => (e.ativa ? <Badge tone="ok">Ativa</Badge> : <><Badge tone="danger">Bloqueada</Badge>{e.motivo && <small>{e.motivo}</small>}</>) },
    {
      id: 'acoes', header: '',
      cell: e => (
        <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {e.ativa
            ? <Button size="sm" onClick={async () => {
                if (await confirm({ title: `Bloquear ${e.nome}?`, message: 'Todos os usuários dessa empresa perdem o acesso na hora. Os dados ficam guardados.', confirmLabel: 'Bloquear', tone: 'danger' }))
                  bloquear.mutate({ id: e.id, bloquear: true, motivo: 'Bloqueada pelo responsável do sistema' });
              }}>Bloquear</Button>
            : <Button size="sm" variant="success" onClick={() => bloquear.mutate({ id: e.id, bloquear: false, motivo: '' })}>Liberar</Button>}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Empresas ativas" value={ativas.length} hint={`${empresas.length - ativas.length} bloqueada(s)`} />
        <Stat label="Usuários ativos" value={ativas.reduce((s, e) => s + e.usuarios, 0)} hint="nas empresas ativas" />
      </div>
      <Card title="Empresas clientes" subtitle="Cada empresa só enxerga os próprios dados." flush
        actions={<Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setNova(true)}>Nova empresa</Button>}>
        <DataTable label="Empresas" columns={cols} rows={empresas} searchable rowKey={e => e.id} empty="Nenhuma empresa ainda." initialSort={{ id: 'nome', dir: 1 }} />
      </Card>
      {nova && <NovaEmpresa onClose={() => setNova(false)} />}
    </div>
  );
}

export default function EmpresasPage() {
  const api = useApi();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.empresas() });
  return (
    <>
      <PageHeader title="Empresas clientes" subtitle="Crie empresas, entregue o acesso do administrador e bloqueie quem não estiver em dia." />
      <QueryView query={q}>{e => <Lista empresas={e} />}</QueryView>
    </>
  );
}
