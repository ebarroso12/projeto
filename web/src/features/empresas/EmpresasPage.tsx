import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Convite, Empresa, NovaEmpresaInput } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { dataBR, dataCompleta, loginFromName, tempo } from '../../lib/format';
import { SelectField } from '../../ui/Field';
import { useToast } from '../../ui/Toast';
import { MIN_SENHA } from '../../lib/rules';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { Ficha, ImplantacaoBarra } from './Ficha';
import { TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { DaniCard, PainelDonoCard, VitrineCard } from './PainelDono';
import { Badge, Banner, Card, PageHeader, Stat } from '../../ui/primitives';

const KEY = ['empresas'];
const KEY_CONV = ['convites'];
const diasAte = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
const linkDe = (token: string) => `${window.location.origin}${window.location.pathname}?convite=${token}`;
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

function GerarLink({ tipo, onClose }: { tipo: 'teste' | 'pro'; onClose: () => void }) {
  const api = useApi();
  const toast = useToast();
  const pro = tipo === 'pro';
  const [dias, setDias] = useState('7');
  const [usos, setUsos] = useState('1');
  const [validade, setValidade] = useState('30');
  const [nota, setNota] = useState('');
  const [link, setLink] = useState('');
  const gerar = useAction(() => api.criarConvite(tipo, Number(dias), Number(usos), Number(validade), nota), {
    invalidate: [KEY_CONV], onSuccess: t => setLink(linkDe(t)),
  });
  const ate = new Date(Date.now() + Number(dias) * 86_400_000).toLocaleDateString('pt-BR');
  const msg = pro
    ? `Olá! Aqui está o acesso à versão completa do sistema Fábrica (produção, ponto, estoque e financeiro). Crie sua empresa por este link: ${link}`
    : `Olá! Teste grátis o sistema Fábrica (produção, ponto, estoque e financeiro) até ${ate}. Crie sua empresa aqui: ${link}`;
  const copiar = async () => { try { await navigator.clipboard.writeText(link); toast.success('Link copiado.'); } catch { toast.info('Selecione o link e copie.'); } };
  if (link) {
    return (
      <Dialog open onClose={onClose} title={pro ? 'Link PRO pronto' : 'Link de teste pronto'} footer={<Button variant="primary" onClick={onClose}>Concluir</Button>}>
        <Banner tone="info">{pro ? 'Quem abrir cria a empresa já na versão completa, sem prazo.' : `O teste vale até ${ate} (7 dias a partir de agora), não importa o dia em que a pessoa se cadastrar.`} O link aparece só agora.</Banner>
        <div className="link-box"><span className={`link-tipo ${tipo}`}>{pro ? 'PRO' : 'TESTE'}</span><code>{link}</code></div>
        <div className="row">
          <Button icon={<Icon name="copy" size={15} />} onClick={() => void copiar()}>Copiar link</Button>
          <a className="btn btn-success btn-md" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">Enviar no WhatsApp</a>
          {'share' in navigator && <Button onClick={() => void navigator.share({ title: pro ? 'Fábrica · versão completa' : 'Teste grátis · Fábrica', text: msg, url: link }).catch(() => {})}>Compartilhar…</Button>}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={pro ? 'Gerar link PRO (versão completa)' : 'Gerar link de teste'}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={gerar.isPending} onClick={() => gerar.mutate()}>Gerar link</Button></>}>
      {pro
        ? <Banner tone="info">Para quem já é cliente: a empresa nasce na versão completa, <b>sem prazo de teste</b>. Você pode bloquear quando quiser em Empresas.</Banner>
        : <Banner tone="info">O prazo conta a partir de <b>agora</b>: o link e o teste vencem juntos daqui a {dias} dias, mesmo que a pessoa se cadastre depois.</Banner>}
      <div className="form-grid">
        {!pro && <SelectField label="Dias de teste" value={dias} onChange={e => setDias(e.target.value)} options={['7', '14', '30'].map(v => ({ value: v, label: `${v} dias` }))} />}
        <SelectField label="Quantas empresas podem usar" value={usos} onChange={e => setUsos(e.target.value)}
          options={[{ value: '1', label: '1 (uma pessoa)' }, { value: '5', label: 'até 5' }, { value: '20', label: 'até 20' }, { value: '100', label: 'até 100' }]} />
        {pro && <SelectField label="O link vale por" value={validade} onChange={e => setValidade(e.target.value)} options={[{ value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }]} />}
      </div>
      <TextField label="Para quem (anotação)" value={nota} onChange={e => setNota(e.target.value)} placeholder={pro ? 'Ex.: Malharia do João (contrato assinado)' : 'Ex.: Malharia do João, feira de outubro'} />
    </Dialog>
  );
}

function LinksTeste() {
  const api = useApi();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: KEY_CONV, queryFn: () => api.convites() });
  const [gerar, setGerar] = useState<'teste' | 'pro' | null>(null);
  const revogar = useAction((id: string) => api.revogarConvite(id), { success: 'Link revogado.', invalidate: [KEY_CONV] });
  const situacao = (c: Convite) => (!c.ativo ? <Badge>Revogado</Badge> : c.usos >= c.usosMax ? <Badge>Esgotado</Badge> : diasAte(c.expiraEm) <= 0 ? <Badge tone="danger">Vencido</Badge> : <Badge tone="ok">Valendo</Badge>);
  return (
    <Card title="Links para enviar" subtitle="TESTE: 7 dias contados do envio. PRO: versão completa, sem prazo." flush
      actions={<span className="row">
        <Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setGerar('teste')}>Gerar link TESTE</Button>
        <Button variant="success" icon={<Icon name="plus" size={16} />} onClick={() => setGerar('pro')}>Gerar link PRO</Button>
      </span>}>
      <QueryView query={q}>{lista => lista.length === 0 ? <div className="table-empty">Nenhum link gerado ainda.</div> : (
        <div className="list">
          {lista.map(c => (
            <div className="item" key={c.id}>
              <span className={`link-tipo ${c.tipo}`}>{c.tipo === 'pro' ? 'PRO' : 'TESTE'}</span>
              <div className="item-main">
                <b>{c.nota || (c.tipo === 'pro' ? 'Link PRO' : 'Link de teste')} {situacao(c)}</b>
                <small>{c.tipo === 'teste' ? `teste até ${dataCompleta(c.expiraEm)} · ` : `link vale até ${dataCompleta(c.expiraEm)} · `}usado {c.usos} de {c.usosMax} · enviado {dataBR(c.criadoEm)}{c.empresas.length ? ` · ${c.empresas.join(', ')}` : ''}</small>
              </div>
              {c.ativo && c.usos < c.usosMax && diasAte(c.expiraEm) > 0 && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (await confirm({ title: 'Revogar este link?', message: 'Ninguém mais consegue criar empresa por ele. As empresas já criadas continuam.', confirmLabel: 'Revogar', tone: 'danger' })) revogar.mutate(c.id);
                }}>Revogar</Button>
              )}
            </div>
          ))}
        </div>
      )}</QueryView>
      {gerar && <GerarLink tipo={gerar} onClose={() => setGerar(null)} />}
    </Card>
  );
}

function Lista({ empresas }: { empresas: Empresa[] }) {
  const api = useApi();
  const confirm = useConfirm();
  const [nova, setNova] = useState(false);
  const bloquear = useAction((v: { id: string; bloquear: boolean; motivo: string }) => api.bloquearEmpresa(v.id, v.bloquear, v.motivo), {
    success: (_d, v) => (v.bloquear ? 'Empresa bloqueada.' : 'Empresa liberada.'), invalidate: [KEY],
  });

  const [ficha, setFicha] = useState<Empresa | null>(null);
  const ajustar = useAction((v: { id: string; dias: number | null }) => api.ajustarTeste(v.id, v.dias), {
    success: (_d, v) => (v.dias === null ? 'Agora é cliente: sem prazo.' : 'Teste estendido por mais 7 dias.'), invalidate: [KEY],
  });
  const ativas = empresas.filter(e => e.ativa);
  const emTeste = ativas.filter(e => e.testeAte && diasAte(e.testeAte) > 0);
  const cols: Column<Empresa>[] = [
    {
      id: 'nome', header: 'Empresa', value: e => e.nome,
      cell: e => <button type="button" className="link-empresa" onClick={() => setFicha(e)}>
        {e.online > 0 && <span className="online-dot" title={`${e.online} online agora`} />}<b>{e.nome}</b>
        {e.tipoLink && <span className={`link-tipo ${e.tipoLink}`}>{e.tipoLink === 'pro' ? 'PRO' : 'TESTE'}</span>}
        <small>desde {dataBR(e.criadaEm)} · ver ficha</small></button>,
    },
    { id: 'codigo', header: 'Código', value: e => e.codigo, cell: e => <code>{e.codigo}</code> },
    { id: 'usuarios', header: 'Usuários', numeric: true, value: e => e.usuarios, cell: e => e.usuarios },
    { id: 'admins', header: 'Admins', numeric: true, value: e => e.admins, cell: e => e.admins },
    { id: 'acesso', header: 'Último acesso', value: e => e.ultimoAcesso, cell: e => (e.ultimoAcesso ? dataBR(e.ultimoAcesso) : '—'), nowrap: true },
    {
      id: 'sit', header: 'Situação', value: e => (!e.ativa ? 'Bloqueada' : e.testeAte ? `Teste ${e.testeAte}` : 'Cliente'),
      cell: e => !e.ativa ? <><Badge tone="danger">Bloqueada</Badge>{e.motivo && <small>{e.motivo}</small>}</>
        : !e.testeAte ? <Badge tone="ok">Cliente</Badge>
        : diasAte(e.testeAte) <= 0 ? <><Badge tone="danger">Teste vencido</Badge><small>em {dataBR(e.testeAte)}</small></>
        : <><Badge tone="warn">Teste · {diasAte(e.testeAte)} dia(s)</Badge><small>até {dataBR(e.testeAte)}{e.porLink ? ' · veio pelo link' : ''}</small></>,
    },
    { id: 'uso', header: 'Uso (7 dias)', numeric: true, value: e => e.tempo7d, cell: e => <>{tempo(e.tempo7d)}<small>{e.pessoas7d} pessoa(s) · {e.entradas7d} entradas · {e.acoes7d} ações</small></> },
    { id: 'impl', header: 'Implantação', value: e => Object.values(e.implantacao).filter(Boolean).length, cell: e => <ImplantacaoBarra i={e.implantacao} /> },
    {
      id: 'acoes', header: '',
      cell: e => (
        <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          {e.testeAte && <Button size="sm" onClick={() => ajustar.mutate({ id: e.id, dias: 7 })}>+7 dias</Button>}
          {e.testeAte && <Button size="sm" variant="success" onClick={async () => {
            if (await confirm({ title: `Tornar ${e.nome} cliente?`, message: 'O período de teste acaba e o acesso fica liberado sem prazo.', confirmLabel: 'Tornar cliente' })) ajustar.mutate({ id: e.id, dias: null });
          }}>Tornar cliente</Button>}
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
        <Stat label="Clientes" value={ativas.filter(e => !e.testeAte).length} tone="ok" />
        <Stat label="Em teste" value={emTeste.length} hint={`${ativas.filter(e => e.testeAte && diasAte(e.testeAte) <= 0).length} vencido(s)`} />
        <Stat label="Usuários ativos" value={ativas.reduce((s, e) => s + e.usuarios, 0)} hint="nas empresas ativas" />
        <Stat label="Uso nos últimos 7 dias" value={tempo(empresas.reduce((s, e) => s + e.tempo7d, 0))} hint={`${empresas.reduce((s, e) => s + e.acoes7d, 0)} ações`} />
      </div>
      <PainelDonoCard empresas={empresas} onAjustar={(id, dias) => ajustar.mutate({ id, dias })} onFicha={setFicha} />
      <Card title="Empresas clientes" subtitle="Cada empresa só enxerga os próprios dados." flush
        actions={<Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setNova(true)}>Nova empresa</Button>}>
        <DataTable label="Empresas" columns={cols} rows={empresas} searchable rowKey={e => e.id} empty="Nenhuma empresa ainda." initialSort={{ id: 'nome', dir: 1 }} />
      </Card>
      <VitrineCard />
      <DaniCard />
      <LinksTeste />
      {ficha && <Ficha empresa={ficha} onClose={() => setFicha(null)} />}
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
