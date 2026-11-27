import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { PageHeader, Segmented } from '../../ui/primitives';
import { ListasTab } from './ListasTab';
import { PessoasTab } from './PessoasTab';
import { AcessoTab } from './AcessoTab';
import { BackupTab } from './BackupTab';
import { RegistrosTab } from './RegistrosTab';

type Tab = 'pessoas' | 'produto' | 'cliente' | 'fornecedor' | 'banco' | 'oficina' | 'listas' | 'acesso' | 'backup';

export default function CadastrosPage() {
  const { api, demo } = useAuth();
  const completo = api.precisaEmpresa || demo; // cadastros gerais: servidor Supabase ou demonstração
  const [tab, setTab] = useState<Tab>('pessoas');
  const abas: { value: Tab; label: string }[] = [
    { value: 'pessoas', label: 'Funcionários' },
    ...(completo ? [{ value: 'produto' as Tab, label: 'Produtos' }, { value: 'cliente' as Tab, label: 'Clientes' }, { value: 'fornecedor' as Tab, label: 'Fornecedores' }, { value: 'oficina' as Tab, label: 'Oficinas' }, { value: 'banco' as Tab, label: 'Bancos' }] : []),
    { value: 'listas', label: 'Modelos, cores e tamanhos' }, { value: 'acesso', label: 'Links de acompanhamento' }, { value: 'backup', label: 'Cópia de segurança' },
  ];
  return (
    <>
      <PageHeader title="Cadastros" subtitle="Funcionários, produtos, clientes, fornecedores, oficinas, bancos e listas de produção" />
      <div className="stack">
        <div style={{ overflowX: 'auto' }}>
          <Segmented<Tab> label="Cadastros" value={tab} onChange={setTab} options={abas} />
        </div>
        {tab === 'pessoas' && <PessoasTab />}
        {(tab === 'produto' || tab === 'cliente' || tab === 'fornecedor' || tab === 'banco' || tab === 'oficina') && <RegistrosTab key={tab} tipo={tab} />}
        {tab === 'listas' && <ListasTab />}
        {tab === 'acesso' && <AcessoTab />}
        {tab === 'backup' && <BackupTab />}
      </div>
    </>
  );
}
