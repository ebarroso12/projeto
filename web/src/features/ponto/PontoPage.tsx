import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../app/auth';
import { BOOT_KEY, useBoot } from '../../app/boot';
import { useAction } from '../../app/useAction';
import { dataBR, hmToMin, nowMin } from '../../lib/format';
import { Button } from '../../ui/Button';
import { useConfirm } from '../../ui/Dialog';
import { Badge, Banner, Card, PageHeader } from '../../ui/primitives';

function useClock(ms = 5000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export default function PontoPage() {
  const api = useApi();
  const confirm = useConfirm();
  const { ponto: p, hoje, horaFim, exigirWifi } = useBoot();
  const now = useClock();
  const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const rede = useQuery({ queryKey: ['rede'], queryFn: () => api.statusRede(), enabled: exigirWifi, staleTime: 15_000 });
  const bater = useAction((tipo: 'entrada' | 'saida') => api.baterPonto(tipo), {
    success: (h, tipo) => `${tipo === 'entrada' ? 'Entrada' : 'Saída'} marcada às ${h}`,
    invalidate: [BOOT_KEY],
  });

  const podeEntrar = !p.entrada;
  const podeSair = Boolean(p.entrada) && !p.saida;
  const passouDoFim = nowMin(now) >= hmToMin(horaFim);

  const marcar = async (tipo: 'entrada' | 'saida') => {
    const nome = tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA';
    if (await confirm({ title: `Marcar ${nome}`, message: `Confirmar ${nome.toLowerCase()} agora, às ${hora}?`, confirmLabel: `Marcar ${nome}` })) bater.mutate(tipo);
  };

  return (
    <div className="narrow">
      <PageHeader title="Ponto" subtitle={dataBR(hoje)} />
      <Card>
        <div className="stack">
          <div className="clock" aria-live="off" aria-label={`Agora são ${hora}`}>{hora}</div>

          {exigirWifi && (
            <div style={{ textAlign: 'center' }}>
              {rede.isPending ? <Badge>Verificando a rede…</Badge>
                : rede.data ? <Badge tone="ok">Conectado no Wi-Fi da fábrica ✓</Badge>
                : <Badge tone="danger">Fora do Wi-Fi da fábrica: conecte para bater o ponto</Badge>}
            </div>
          )}

          <div className="punch-grid">
            <div className="punch-box"><small className="muted">Entrada</small><b>{p.entrada || '--:--'}</b></div>
            <div className="punch-box"><small className="muted">Saída</small><b>{p.saida || '--:--'}</b></div>
          </div>

          <Button variant="success" size="lg" block disabled={!podeEntrar} loading={bater.isPending && bater.variables === 'entrada'} onClick={() => void marcar('entrada')}>Marcar ENTRADA</Button>
          <Button variant="danger" size="lg" block disabled={!podeSair} loading={bater.isPending && bater.variables === 'saida'} onClick={() => void marcar('saida')}>Marcar SAÍDA</Button>

          {p.saida && p.extra && <Banner tone="info">Hora extra hoje: <b>{p.extra}</b></Banner>}
          {p.entrada && !p.saida && passouDoFim && <Banner tone="warn">Passou das {horaFim}: contando <b>hora extra</b>. Marque a SAÍDA quando for embora.</Banner>}
          {p.entrada && !p.saida && <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>Se esquecer de marcar a saída, o ponto fecha às {horaFim} sem hora extra.</p>}
          {p.saida && <p className="muted" style={{ textAlign: 'center' }}>Ponto de hoje completo. Bom descanso!</p>}
        </div>
      </Card>
    </div>
  );
}
