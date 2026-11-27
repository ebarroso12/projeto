import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../app/auth';
import { features } from '../../app/registry';
import { useAction } from '../../app/useAction';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner } from '../../ui/primitives';

const DESCRICAO: Record<string, string> = {
  painel: 'Produção e presença do dia', dashboard: 'Gráficos e síntese do mês', relatorio: 'Produção, presença e horas por período',
  falta: 'Ver e cadastrar itens em falta', lancar: 'Lançar produção da sua etapa', ponto: 'Marcar entrada e saída',
  financeiro: 'Entradas, saídas, contas, cartões e metas', resultado: 'DRE: vendas, custos e lucro do mês',
  cadastros: 'Pessoas, listas, links e cópia de segurança', acessos: 'Liberar entradas, ver atividade e métricas',
  empresas: 'Empresas clientes, links TESTE/PRO e fichas (gestão do sistema)',
  remessas: 'Ordens de corte, remessas para oficinas/costureiras, retornos e acerto',
  pedidos: 'Pedidos dos clientes, andamento na produção e entrega',
  materiais: 'Estoque de matéria-prima: entradas, saídas e alertas',
  produtividade: 'Peças por pessoa e pagamento por produção',
  mensagens: 'Enviar mensagens para um funcionário ou para todos (libere para o gerente)',
};

/** O administrador liga/desliga cada função do sistema para uma pessoa. */
export function FuncoesDialog({ login, onClose }: { login: string; onClose: () => void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['funcoes', login], queryFn: () => api.funcoesPessoa(login) });
  const [f, setF] = useState<Record<string, boolean>>({});
  useEffect(() => { if (q.data) setF(q.data.funcoes); }, [q.data]);
  const salvar = useAction(() => api.salvarFuncoes(login, f), { // envia o mapa completo; o servidor também mescla
    success: 'Funções salvas. Valem na próxima ação da pessoa.', invalidate: [['funcoes', login], ['usuarios']], onSuccess: onClose,
  });

  return (
    <Dialog open onClose={onClose} title={q.data ? `Funções de ${q.data.nome}` : 'Funções'} variant="drawer"
      footer={q.data && !q.data.eu && !q.data.protegido ? <>
        <Button onClick={() => setF({ ...q.data.padrao, empresas: q.data.funcoes.empresas })}>Voltar ao padrão</Button>
        <Button variant="primary" loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>
      </> : <Button onClick={onClose}>Fechar</Button>}>
      <QueryView query={q}>
        {d => (
          <div className="stack" style={{ gap: 12 }}>
            {d.protegido ? <Banner tone="warn">Esta é a conta do responsável pelo sistema: só ele pode mudar as próprias funções.</Banner>
              : d.eu ? <Banner tone="warn">Estas são as suas funções. Para mudá-las, peça a outro administrador.</Banner>
              : <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                  {d.perfil === 'admin' ? 'Administrador' : 'Funcionário'}: ligue o que a pessoa pode usar. O que estiver desligado some do menu e é recusado pelo servidor.
                </p>}
            <ul className="funcoes">
              {[...features.filter(x => x.id !== 'empresas'), { id: 'mensagens', label: 'Enviar mensagens', icon: 'chat' as const }, ...features.filter(x => x.id === 'empresas' && d.possoEmpresas)].map(x => {
                const on = f[x.id] === true, mudou = x.id !== 'empresas' && on !== d.padrao[x.id];
                return (
                  <li key={x.id} className={on ? 'on' : ''}>
                    <span className="fn-ic"><Icon name={x.icon} size={17} /></span>
                    <span className="fn-txt"><b>{x.label} {mudou && <Badge tone="info">alterado</Badge>}{x.id === 'empresas' && <Badge tone="brand">só o dono libera</Badge>}</b><small>{DESCRICAO[x.id]}</small></span>
                    <button type="button" role="switch" aria-checked={on} aria-label={`${x.label}: ${on ? 'liberado' : 'bloqueado'}`} className="switch"
                      disabled={d.eu || d.protegido} onClick={() => setF(s => ({ ...s, [x.id]: !on }))}><span /></button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </QueryView>
    </Dialog>
  );
}
