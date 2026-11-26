import { useState } from 'react';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { Button } from '../../ui/Button';
import { useConfirm } from '../../ui/Dialog';
import { TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Banner, Card } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

/** Links "só ver" (TV, tablet): abrem o painel sem login. A chave só aparece na hora de gerar. */
export function AcessoTab() {
  const api = useApi();
  const toast = useToast();
  const confirm = useConfirm();
  const [nome, setNome] = useState('TV da fábrica');
  const [link, setLink] = useState('');

  const criar = useAction((n: string) => api.criarChave(n), {
    onSuccess: chave => setLink(`${window.location.origin}${window.location.pathname}?k=${chave}`),
  });
  const revogar = useAction(() => api.revogarChaves(), {
    success: n => (n ? `${n} link(s) revogado(s).` : 'Nenhum link ativo.'),
    onSuccess: () => setLink(''),
  });

  const copiar = async () => {
    try { await navigator.clipboard.writeText(link); toast.success('Link copiado.'); }
    catch { toast.info('Selecione o link e copie manualmente.'); }
  };

  return (
    <div className="grid-2">
      <Card title="Gerar link de acompanhamento" subtitle="Abre Painel, Relatório e Em falta, só para ver. Sem senha.">
        <div className="stack">
          <TextField label="Nome (para você lembrar onde está)" value={nome} onChange={e => setNome(e.target.value)} />
          <div><Button variant="primary" icon={<Icon name="plus" size={16} />} loading={criar.isPending} onClick={() => criar.mutate(nome)}>Gerar link</Button></div>
          {link && (
            <>
              <Banner tone="warn">Este link aparece <b>só agora</b>. Guarde-o: quem tiver o link vê os dados da fábrica.</Banner>
              <TextField label="Link" value={link} readOnly onFocus={e => e.currentTarget.select()} />
              <div><Button icon={<Icon name="copy" size={16} />} onClick={() => void copiar()}>Copiar link</Button></div>
            </>
          )}
        </div>
      </Card>
      <Card title="Revogar links" subtitle="Use se um link vazar. Todos os links deixam de funcionar; gere os novos em seguida.">
        <Button variant="danger" loading={revogar.isPending} onClick={async () => {
          if (await confirm({ title: 'Revogar todos os links?', message: 'TVs e tablets que usam um link "só ver" vão parar de abrir até você gerar um novo.', confirmLabel: 'Revogar', tone: 'danger' })) revogar.mutate();
        }}>Revogar todos os links</Button>
      </Card>
    </div>
  );
}
