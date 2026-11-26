import { useState } from 'react';
import { PageHeader, Segmented } from '../../ui/primitives';
import { ListasTab } from './ListasTab';
import { PessoasTab } from './PessoasTab';
import { AcessoTab } from './AcessoTab';
import { WifiTab } from './WifiTab';

type Tab = 'pessoas' | 'listas' | 'wifi' | 'acesso';

export default function CadastrosPage() {
  const [tab, setTab] = useState<Tab>('pessoas');
  return (
    <>
      <PageHeader title="Cadastros" subtitle="Pessoas, listas de produção e regras de acesso" />
      <div className="stack">
        <div>
          <Segmented<Tab> label="Cadastros" value={tab} onChange={setTab}
            options={[{ value: 'pessoas', label: 'Pessoas' }, { value: 'listas', label: 'Modelos, cores e tamanhos' }, { value: 'wifi', label: 'Wi-Fi da fábrica' }, { value: 'acesso', label: 'Links de acompanhamento' }]} />
        </div>
        {tab === 'pessoas' && <PessoasTab />}
        {tab === 'listas' && <ListasTab />}
        {tab === 'wifi' && <WifiTab />}
        {tab === 'acesso' && <AcessoTab />}
      </div>
    </>
  );
}
