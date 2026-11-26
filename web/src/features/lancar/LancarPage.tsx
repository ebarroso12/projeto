import { useState } from 'react';
import type { Disponivel, Lancamento } from '../../api/types';
import { useApi } from '../../app/auth';
import { BOOT_KEY, useBoot } from '../../app/boot';
import { useAction } from '../../app/useAction';
import { formatNumber } from '../../lib/format';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Badge, Banner, Card, EmptyState, PageHeader } from '../../ui/primitives';
import { etapaDoSetor } from './etapas';

function EditQty({ l, onClose }: { l: Lancamento; onClose: () => void }) {
  const api = useApi();
  const [qtd, setQtd] = useState(String(l.qtd));
  const n = parseInt(qtd, 10);
  const save = useAction((q: number) => api.editarLancamento(l.id, q), { success: 'Alterado.', invalidate: [BOOT_KEY, ['painel']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="Editar quantidade"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!(n >= 0)} onClick={() => save.mutate(n)}>Salvar</Button></>}>
      <p className="muted"><b>{l.modelo}</b> · {l.cor} · {l.tamanho} · {l.etapa}</p>
      <TextField label="Nova quantidade" type="number" inputMode="numeric" min={0} value={qtd} onChange={e => setQtd(e.target.value)} autoFocus
        hint="Edições ficam registradas e o administrador é avisado." />
    </Dialog>
  );
}

type Esperando = Disponivel & { q: number };

export default function LancarPage() {
  const api = useApi();
  const boot = useBoot();
  const confirm = useConfirm();
  const { eu, etapas, modelos, cores, tamanhos, meusHoje } = boot;

  const [etapaSel, setEtapaSel] = useState(etapas[0] ?? 'Corte');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [obs, setObs] = useState('');
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  const [editing, setEditing] = useState<Lancamento | null>(null);

  const etapa = eu.admin ? etapaSel : etapaDoSetor(eu.setor);

  const lancar = useAction(api.lancar, {
    success: r => `${r.total} peças lançadas!`,
    invalidate: [BOOT_KEY, ['painel']],
    onSuccess: r => { setQtds({}); setObs(''); setAvisos(r.avisos); },
  });
  const apagar = useAction((id: string) => api.apagarLancamento(id), { success: 'Apagado.', invalidate: [BOOT_KEY, ['painel']] });

  if (!etapa) {
    return <EmptyState icon="alert" title="Seu setor não lança produção">Fale com o administrador.</EmptyState>;
  }

  const submit = async () => {
    const itens = tamanhos.map(t => ({ tamanho: t, qtd: parseInt(qtds[t] ?? '', 10) })).filter(i => i.qtd > 0);
    if (!modelo || !cor) { setErro('Escolha o modelo e a cor.'); return; }
    if (!itens.length) { setErro('Coloque a quantidade em pelo menos um tamanho.'); return; }
    setErro('');
    const total = itens.reduce((s, i) => s + i.qtd, 0);
    const ok = await confirm({
      title: `Lançar ${etapa}`,
      confirmLabel: 'Lançar',
      message: (
        <div className="stack" style={{ gap: 8 }}>
          <p><b>{modelo}</b> · {cor}</p>
          <p>{itens.map(i => `${i.tamanho}: ${i.qtd}`).join(' · ')}</p>
          <p className="muted">Total: <b>{total}</b> peças</p>
        </div>
      ),
    });
    if (ok) lancar.mutate({ etapa, modelo, cor, obs, itens });
  };

  const i = etapas.indexOf(etapa);
  const anterior = i > 0 ? etapas[i - 1] : undefined;
  const esperando: Esperando[] = eu.admin && anterior
    ? boot.disponivel.map(s => ({ ...s, q: (s.valores[anterior] ?? 0) - (s.valores[etapa] ?? 0) })).filter(x => x.q > 0)
    : [];

  const esperandoCols: Column<Esperando>[] = [
    { id: 'modelo', header: 'Modelo', value: r => r.modelo, cell: r => r.modelo },
    { id: 'cor', header: 'Cor', value: r => r.cor, cell: r => r.cor },
    { id: 'tam', header: 'Tam.', value: r => r.tamanho, cell: r => r.tamanho },
    { id: 'q', header: 'Qtd', numeric: true, value: r => r.q, cell: r => formatNumber(r.q) },
    { id: 'a', header: '', cell: r => <Button size="sm" onClick={() => { setModelo(r.modelo); setCor(r.cor); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Usar</Button> },
  ];

  return (
    <>
      <PageHeader title="Lançar produção" subtitle={eu.admin ? 'Escolha a etapa e informe as quantidades' : <>Etapa: <Badge tone="brand">{etapa}</Badge></>} />
      <div className="grid-2">
        <Card title="Novo lançamento">
          <div className="stack">
            {eu.admin && <SelectField label="Etapa" value={etapaSel} onChange={e => setEtapaSel(e.target.value)} options={etapas} />}
            <div className="form-grid">
              <SelectField label="Modelo" value={modelo} onChange={e => setModelo(e.target.value)} options={modelos} placeholder="Escolha…" />
              <SelectField label="Cor" value={cor} onChange={e => setCor(e.target.value)} options={cores} placeholder="Escolha…" />
            </div>
            <div>
              <p className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Quantidade por tamanho</p>
              <div className="size-grid">
                {tamanhos.map(t => (
                  <TextField key={t} label={t} type="number" inputMode="numeric" min={0} value={qtds[t] ?? ''} onChange={e => setQtds(s => ({ ...s, [t]: e.target.value }))} />
                ))}
              </div>
            </div>
            <TextField label="Observação (opcional)" value={obs} onChange={e => setObs(e.target.value)} />
            {erro && <Banner tone="danger">{erro}</Banner>}
            <Button variant="primary" size="lg" block loading={lancar.isPending} onClick={() => void submit()}>Lançar</Button>
            {avisos.map((a, k) => <Banner key={k} tone="warn">{a}</Banner>)}
          </div>
        </Card>

        <div className="stack">
          {eu.admin && anterior && (
            <Card title={`Esperando ${etapa.toLowerCase()}`} subtitle={`Veio do ${anterior.toLowerCase()}`} flush>
              <DataTable label="Esperando" columns={esperandoCols} rows={esperando} rowKey={(r, k) => `${r.modelo}${r.cor}${r.tamanho}${k}`} empty="Nada esperando agora." pageSize={8} maxHeight={320} />
            </Card>
          )}
          <Card title="Meus lançamentos de hoje" flush>
            {meusHoje.length === 0 ? <div className="table-empty">Nenhum lançamento hoje.</div> : (
              <div className="list">
                {meusHoje.map(l => (
                  <div key={l.id} className={`item${l.edicoes ? ` edit${Math.min(3, l.edicoes)}` : ''}`}>
                    <div className="item-main">
                      <div><b>{l.modelo}</b> · {l.cor} · {l.tamanho}</div>
                      <small>{l.hora} · {l.etapa}{l.edicoes ? <> · <Badge tone="warn">editado {l.edicoes}x</Badge></> : null}</small>
                    </div>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <b className="tnum" style={{ fontSize: 17 }}>{l.qtd}</b>
                      <Button size="sm" iconOnly aria-label="Editar" onClick={() => setEditing(l)}><Icon name="pencil" size={15} /></Button>
                      <Button size="sm" iconOnly aria-label="Apagar" onClick={async () => {
                        if (await confirm({ title: 'Apagar este lançamento?', message: `${l.modelo} ${l.cor} ${l.tamanho}: ${l.qtd} peças`, confirmLabel: 'Apagar', tone: 'danger' })) apagar.mutate(l.id);
                      }}><Icon name="trash" size={15} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
      {editing && <EditQty l={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
