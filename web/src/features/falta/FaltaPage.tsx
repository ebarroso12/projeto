import { useState } from 'react';
import { useApi } from '../../app/auth';
import { BOOT_KEY, useBoot } from '../../app/boot';
import { useAction } from '../../app/useAction';
import { Button } from '../../ui/Button';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Card, EmptyState, PageHeader } from '../../ui/primitives';
import { FaltaItem } from '../shared/parts';

function AddDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { modelos, cores, tamanhos } = useBoot();
  const [f, setF] = useState({ modelo: '', cor: '', tamanho: '', qtd: '', obs: '' });
  const [error, setError] = useState('');
  const add = useAction(api.addEmFalta, { success: 'Colocado na lista!', invalidate: [BOOT_KEY], onSuccess: onClose });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));

  const submit = () => {
    if (!f.modelo) { setError('Escolha o modelo.'); return; }
    setError('');
    add.mutate(f);
  };

  return (
    <Dialog open onClose={onClose} title="Colocar item em falta" variant="drawer"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="danger" loading={add.isPending} onClick={submit}>Colocar na frente da produção</Button></>}>
      <SelectField label="Modelo" value={f.modelo} onChange={set('modelo')} options={modelos} placeholder="Escolha…" error={error} />
      <div className="form-grid">
        <SelectField label="Cor" value={f.cor} onChange={set('cor')} options={cores} placeholder="Todas" />
        <SelectField label="Tamanho" value={f.tamanho} onChange={set('tamanho')} options={tamanhos} placeholder="Todos" />
      </div>
      <TextField label="Quantidade" type="number" inputMode="numeric" min={0} value={f.qtd} onChange={set('qtd')}
        hint="Opcional. Com quantidade, a lista mostra o progresso e dá baixa sozinha." />
      <TextField label="Observação" value={f.obs} onChange={set('obs')} />
      <p className="muted" style={{ fontSize: 13 }}>A lista dá baixa sozinha conforme a conferência lança as peças prontas. Quando completar, o item sai da lista.</p>
    </Dialog>
  );
}

export default function FaltaPage() {
  const api = useApi();
  const { eu, emFalta } = useBoot();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const setStatus = useAction((v: { id: string; status: string }) => api.statusEmFalta(v.id, v.status), { invalidate: [BOOT_KEY] });
  const canAdd = eu.admin || eu.podeFalta;

  const markDone = async (id: string, nome: string) => {
    if (await confirm({ title: 'Dar baixa no item?', message: `"${nome}" sai da lista de itens em falta.`, confirmLabel: 'Feito' })) {
      setStatus.mutate({ id, status: 'Feito' });
    }
  };

  return (
    <>
      <PageHeader title="Em falta no estoque" subtitle="Produzir primeiro"
        actions={canAdd && <Button variant="danger" icon={<Icon name="plus" size={16} />} onClick={() => setAdding(true)}>Colocar item em falta</Button>} />
      <Card flush>
        {emFalta.length === 0 ? (
          <EmptyState title="Nada em falta agora">Quando um item faltar no estoque, ele aparece aqui para a produção priorizar.</EmptyState>
        ) : (
          <div className="list">
            {emFalta.map(f => (
              <FaltaItem key={f.id} f={f} actions={
                <>
                  {f.status === 'Urgente' && !eu.leitura && !eu.demo && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: f.id, status: 'Em produção' })}>Em produção</Button>
                  )}
                  {eu.admin && <Button size="sm" variant="success" icon={<Icon name="check" size={14} />} onClick={() => void markDone(f.id, `${f.modelo} ${f.cor} ${f.tamanho}`)}>Feito</Button>}
                </>
              } />
            ))}
          </div>
        )}
      </Card>
      {adding && <AddDialog onClose={() => setAdding(false)} />}
    </>
  );
}
