import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from './auth';
import { useBoot } from './boot';
import { pode } from './registry';
import { aoMudarInstalacao, desligarAvisos, ehIphone, estadoAvisos, inscricaoAtual, instalado, instalar, ligarAvisos, podeInstalar, type EstadoAvisos } from '../lib/avisos';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Badge, Banner } from '../ui/primitives';
import { useToast } from '../ui/Toast';

const descricaoAparelho = () => {
  const ua = navigator.userAgent;
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const so = /Android/.test(ua) ? 'Android' : ehIphone() ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Linux';
  return `${nav} · ${so}`;
};

/** Sino no topo: instalar o app na tela inicial e ligar os avisos neste aparelho. */
export function AvisosBotao() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variant="ghost" iconOnly className="btn-sino" aria-label="Avisos e instalar app" onClick={() => setAberto(true)}><Icon name="bell" /></Button>
      {aberto && <AvisosDialog onClose={() => setAberto(false)} />}
    </>
  );
}

function AvisosDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { eu } = useBoot();
  const toast = useToast();
  const qc = useQueryClient();
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [instalavel, setInstalavel] = useState(podeInstalar());
  const [endpoint, setEndpoint] = useState('');
  useEffect(() => aoMudarInstalacao(() => setInstalavel(podeInstalar())), []);
  useEffect(() => { void estadoAvisos().then(setEstado); void inscricaoAtual().then(s => setEndpoint(s?.endpoint ?? '')); }, []);
  const status = useQuery({ queryKey: ['push-status', endpoint], queryFn: () => api.pushStatus(endpoint) });

  const ligar = async () => {
    setOcupado(true);
    try {
      const sub = await ligarAvisos();
      await api.pushInscrever({ ...sub, aparelho: descricaoAparelho() });
      setEndpoint(sub.endpoint);
      setEstado('ligado');
      toast.success('Avisos ligados neste aparelho.');
      void qc.invalidateQueries({ queryKey: ['push-status'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível ligar os avisos.');
      setEstado(await estadoAvisos());
    } finally { setOcupado(false); }
  };
  const desligar = async () => {
    setOcupado(true);
    try {
      const ep = await desligarAvisos();
      if (ep) await api.pushCancelar(ep);
      setEndpoint('');
      setEstado('desligado');
      toast.success('Avisos desligados neste aparelho.');
      void qc.invalidateQueries({ queryKey: ['push-status'] });
    } finally { setOcupado(false); }
  };

  const recebe = [
    'Mensagens da administração',
    ...(pode(eu, 'acessos') ? ['Pedidos de acesso para liberar'] : []),
    ...(pode(eu, 'financeiro') ? ['Contas a pagar e faturas vencendo; parcelas a receber atrasadas'] : []),
    ...(pode(eu, 'pedidos') ? ['Pedidos atrasados ou com entrega próxima'] : []),
    ...(pode(eu, 'materiais') ? ['Matéria-prima abaixo do mínimo'] : []),
  ];
  const ligado = estado === 'ligado' && (status.data?.esteAparelho ?? true);

  return (
    <Dialog open onClose={onClose} title="Avisos e app" footer={<Button onClick={onClose}>Fechar</Button>}>
      <section className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b><Icon name="bell" size={16} /> Avisos neste aparelho</b>
          {estado && <Badge tone={ligado ? 'ok' : undefined}>{ligado ? 'ligados' : 'desligados'}</Badge>}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Chegam no celular mesmo com o app fechado. Você recebe:</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>{recebe.map(r => <li key={r}>{r}</li>)}</ul>
        {status.data && !status.data.configurado && <Banner tone="info">Disponível na versão conectada ao servidor (na demonstração não há envio).</Banner>}
        {estado === 'iphone-instalar' && <Banner tone="info">No iPhone, primeiro instale o app: toque em <b>Compartilhar</b> <span aria-hidden="true">⎋</span> e depois em <b>Adicionar à Tela de Início</b>. Abra pelo ícone e ligue os avisos aqui.</Banner>}
        {estado === 'sem-suporte' && <Banner tone="warn">Este navegador não recebe avisos. Use o Chrome (Android/computador), o Edge ou o Safari com o app instalado (iPhone).</Banner>}
        {estado === 'bloqueado' && <Banner tone="warn">As notificações deste site estão bloqueadas. Libere em: cadeado ao lado do endereço → Notificações → Permitir. Depois toque em Ligar.</Banner>}
        {(estado === 'desligado' || estado === 'bloqueado') && <Button variant="primary" loading={ocupado} onClick={ligar} icon={<Icon name="bell" size={16} />}>Ligar avisos</Button>}
        {estado === 'ligado' && <Button loading={ocupado} onClick={desligar}>Desligar avisos neste aparelho</Button>}
        {status.data && status.data.aparelhos > 0 && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{status.data.aparelhos} aparelho(s) seu(s) recebem avisos.</p>}
      </section>
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '6px 0' }} />
      <section className="stack" style={{ gap: 10 }}>
        <b><Icon name="download" size={16} /> Instalar o app</b>
        {instalado() ? <p className="muted" style={{ margin: 0 }}>O app já está instalado neste aparelho.</p>
          : instalavel ? <>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Fica com ícone na tela inicial, abre em tela cheia e funciona mesmo sem internet para consultar.</p>
            <Button variant="primary" onClick={() => void instalar()} icon={<Icon name="download" size={16} />}>Instalar o Fábrica</Button>
          </>
          : ehIphone() ? <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>No Safari: <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>
          : <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>No menu do navegador (⋮), escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p>}
      </section>
    </Dialog>
  );
}
