import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Wifi } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { dataBR } from '../../lib/format';
import { Button } from '../../ui/Button';
import { SelectField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Banner, Card } from '../../ui/primitives';

const KEY = ['wifi'];

function WifiView({ w }: { w: Wifi }) {
  const api = useApi();
  const qc = useQueryClient();
  const update = (data: Wifi) => qc.setQueryData(KEY, data);
  const save = useAction((v: { exigir: boolean; ips: Wifi['ips'] }) => api.salvarWifi(v.exigir, v.ips), { onSuccess: update });
  const add = useAction(() => api.cadastrarRedeAtual('Wi-Fi da fábrica'), { success: 'Rede cadastrada! Ponto liberado só nela.', onSuccess: update });

  return (
    <Card title="Wi-Fi da fábrica" subtitle="Ligado: o funcionário só abre o app conectado ao Wi-Fi da fábrica. Administradores abrem de qualquer lugar.">
      <div className="stack">
        <div style={{ maxWidth: 360 }}>
          <SelectField label="Exigir Wi-Fi da fábrica no ponto" value={w.exigir ? 'Sim' : 'Não'} options={['Não', 'Sim']}
            onChange={e => save.mutate({ exigir: e.target.value === 'Sim', ips: w.ips })} />
        </div>
        {w.exigir && w.ips.length === 0 && <Banner tone="warn">Nenhuma rede cadastrada: ninguém, além do administrador, conseguirá entrar. Cadastre a rede abaixo.</Banner>}
        <div>
          <p className="muted" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Redes cadastradas</p>
          {w.ips.length === 0 ? <p className="muted">Nenhuma rede cadastrada.</p> : (
            <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
              {w.ips.map((r, i) => (
                <div className="item" key={`${r.ip}${i}`}>
                  <div className="item-main"><b>{r.nome}</b><small>{r.ip} · {dataBR(r.em)}</small></div>
                  <Button size="sm" onClick={() => save.mutate({ exigir: w.exigir, ips: w.ips.filter((_, j) => j !== i) })}>Remover</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <Button variant="success" icon={<Icon name="wifi" size={16} />} loading={add.isPending} onClick={() => add.mutate()}>
            Estou no Wi-Fi da fábrica: cadastrar esta rede
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function WifiTab() {
  const api = useApi();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.verWifi() });
  return <QueryView query={q}>{w => <WifiView w={w} />}</QueryView>;
}
