import { useState } from 'react';
import { PageHeader, Segmented } from '../../ui/primitives';
import { ListasTab } from './ListasTab';
import { PessoasTab } from './PessoasTab';
import { AcessoTab } from './AcessoTab';
import { BackupTab } from './BackupTab';

type Tab = 'pessoas' | 'listas' | 'acesso' | 'backup';

export default function CadastrosPage() {
  const [tab, setTab] = useState<Tab>('pessoas');
  return (
    <>
      <PageHeader title="Cadastros" subtitle="Pessoas, listas de produção, links de acompanhamento e cópia de segurança" />
      <div className="stack">
        <div style={{ overflowX: 'auto' }}>
          <Segmented<Tab> label="Cadastros" value={tab} onChange={setTab}
            options={[{ value: 'pessoas', label: 'Pessoas' }, { value: 'listas', label: 'Modelos, cores e tamanhos' }, { value: 'acesso', label: 'Links de acompanhamento' }, { value: 'backup', label: 'Cópia de segurança' }]} />
        </div>
        {tab === 'pessoas' && <PessoasTab />}
        {tab === 'listas' && <ListasTab />}
        {tab === 'acesso' && <AcessoTab />}
        {tab === 'backup' && <BackupTab />}
      </div>
    </>
  );
}
