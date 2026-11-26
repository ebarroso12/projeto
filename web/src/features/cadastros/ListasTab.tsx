import { useState } from 'react';
import { useApi } from '../../app/auth';
import { BOOT_KEY, useBoot } from '../../app/boot';
import { useAction } from '../../app/useAction';
import { Button } from '../../ui/Button';
import { TextAreaField } from '../../ui/Field';
import { Card } from '../../ui/primitives';

const LISTS = [
  { nome: 'Modelos', key: 'modelos' },
  { nome: 'Cores', key: 'cores' },
  { nome: 'Tamanhos', key: 'tamanhos' },
] as const;

function ListEditor({ nome, initial }: { nome: string; initial: string[] }) {
  const api = useApi();
  const [text, setText] = useState(initial.join('\n'));
  const save = useAction((v: string[]) => api.salvarLista(nome, v), { success: `${nome} salvos!`, invalidate: [BOOT_KEY], onSuccess: r => setText(r.join('\n')) });
  const lines = text.split('\n');
  const count = lines.map(l => l.trim()).filter(Boolean).length;
  return (
    <Card title={nome} subtitle="Um por linha." actions={<span className="muted">{count} itens</span>}>
      <div className="stack">
        <TextAreaField label={`Lista de ${nome.toLowerCase()}`} value={text} onChange={e => setText(e.target.value)} rows={8} />
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(lines)}>Salvar {nome.toLowerCase()}</Button>
      </div>
    </Card>
  );
}

export function ListasTab() {
  const boot = useBoot();
  return (
    <div className="grid-2">
      {LISTS.map(l => <ListEditor key={l.key} nome={l.nome} initial={boot[l.key]} />)}
    </div>
  );
}
