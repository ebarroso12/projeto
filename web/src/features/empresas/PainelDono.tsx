import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Empresa } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Badge, Banner, Card } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { painelDono } from './painel';

const MOTIVO = { vence: { rot: 'Teste acabando', tom: 'warn' }, vencido: { rot: 'Teste vencido', tom: 'danger' }, parada: { rot: 'Parada', tom: 'neutral' }, implantacao: { rot: 'Implantação fraca', tom: 'info' } } as const;

/** Funil teste → cliente e a lista de empresas que pedem uma ação do dono. */
export function PainelDonoCard({ empresas, onAjustar, onFicha }: { empresas: Empresa[]; onAjustar: (id: string, dias: number | null) => void; onFicha: (e: Empresa) => void }) {
  const p = painelDono(empresas);
  return (
    <Card title="Funil e atenção" subtitle="Quem entrou pelo link de teste, quantos viraram cliente e quem precisa de uma ação sua agora.">
      <div className="funil">
        <div><span>Vieram pelo link de teste</span><b>{p.vieramDeTeste}</b></div>
        <div><span>Ainda em teste</span><b>{p.emTeste}</b></div>
        <div><span>Viraram cliente</span><b className="valor-pos">{p.convertidas}</b></div>
        <div><span>Conversão</span><b>{p.conversao === null ? '—' : `${p.conversao}%`}</b></div>
      </div>
      {p.atencao.length === 0 ? <p className="muted" style={{ margin: '12px 0 0' }}>Nada pedindo atenção agora.</p> : (
        <div className="list" style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12 }}>
          {p.atencao.map(a => (
            <div className="item" key={`${a.empresa.id}-${a.motivo}`}>
              <div className="item-main">
                <b><button type="button" className="link" onClick={() => onFicha(a.empresa)}>{a.empresa.nome}</button> <Badge tone={MOTIVO[a.motivo].tom === 'neutral' ? undefined : MOTIVO[a.motivo].tom}>{MOTIVO[a.motivo].rot}</Badge></b>
                <small>{a.detalhe}</small>
              </div>
              {(a.motivo === 'vence' || a.motivo === 'vencido') && <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <Button size="sm" onClick={() => onAjustar(a.empresa.id, 7)}>+7 dias</Button>
                <Button size="sm" variant="success" onClick={() => onAjustar(a.empresa.id, null)}>Tornar cliente</Button>
              </span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Página de apresentação: link público de teste e WhatsApp de contato. */
export function VitrineCard() {
  const api = useApi();
  const toast = useToast();
  const q = useQuery({ queryKey: ['vitrine-admin'], queryFn: () => api.vitrineAdmin() });
  const [dias, setDias] = useState('7');
  const [usos, setUsos] = useState('50');
  const [zap, setZap] = useState<string | null>(null);
  const pagina = `${window.location.origin}${window.location.pathname}?conheca`;
  const criar = useAction(() => api.linkPublicoCriar(Number(dias), Number(usos), 'Página de apresentação'), { success: 'Link de teste publicado na página.', invalidate: [['vitrine-admin']] });
  const tirar = useAction(() => api.linkPublicoDesativar(), { success: 'Link retirado da página.', invalidate: [['vitrine-admin']] });
  const salvarZap = useAction((w: string) => api.salvarContatoVitrine(w), { success: 'WhatsApp salvo.', invalidate: [['vitrine-admin']], onSuccess: () => setZap(null) });
  const copiar = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success('Endereço copiado.'); } catch { toast.info(t); } };
  const l = q.data?.link;
  return (
    <Card title="Página de apresentação" subtitle="Página pública do app com o botão “Testar grátis”. Divulgue o endereço nas redes e no WhatsApp."
      actions={<Button icon={<Icon name="copy" size={16} />} onClick={() => void copiar(pagina)}>Copiar endereço</Button>}>
      <div className="stack" style={{ gap: 12 }}>
        <p style={{ margin: 0 }}><a href={pagina} target="_blank" rel="noopener">{pagina}</a></p>
        {l ? (
          <Banner tone={l.valido ? 'info' : 'warn'}>
            {l.valido ? <>Teste grátis <b>ativo</b>: {l.dias} dias contados do cadastro de cada empresa · {l.usos} de {l.usosMax} cadastros usados · {l.empresas} empresa(s) criada(s).</>
              : <>O link público <b>esgotou</b> ({l.usos} de {l.usosMax}). Publique um novo.</>}
          </Banner>
        ) : <Banner tone="warn">Sem link publicado: a página mostra só o contato.</Banner>}
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', alignItems: 'end' }}>
          <TextField label="Dias de teste" type="number" min={1} max={90} value={dias} onChange={e => setDias(e.target.value)} />
          <TextField label="Limite de cadastros" type="number" min={1} max={500} value={usos} onChange={e => setUsos(e.target.value)} />
          <Button variant="primary" loading={criar.isPending} onClick={() => criar.mutate()}>{l ? 'Publicar novo link' : 'Publicar link de teste'}</Button>
          {l && <Button loading={tirar.isPending} onClick={() => tirar.mutate()}>Tirar da página</Button>}
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
          <TextField label="WhatsApp de contato (aparece na página)" inputMode="tel" placeholder="(16) 99999-0000"
            value={zap ?? (q.data?.whatsapp ? q.data.whatsapp.replace(/^55/, '') : '')} onChange={e => setZap(e.target.value)} />
          <Button loading={salvarZap.isPending} disabled={zap === null} onClick={() => salvarZap.mutate(zap ?? '')}>Salvar</Button>
        </div>
      </div>
    </Card>
  );
}

/** Assistente Dani: chave gratuita do Gemini (Google AI Studio). A chave nunca volta para a tela. */
export function DaniCard() {
  const api = useApi();
  const q = useQuery({ queryKey: ['dani-config'], queryFn: () => api.daniConfig() });
  const [chave, setChave] = useState('');
  const [modelo, setModelo] = useState<string | null>(null);
  const salvar = useAction((v: { chave: string; modelo: string }) => api.salvarDani(v.chave, v.modelo), {
    success: (_d, v) => (v.chave === '-' ? 'Chave removida: a Dani responde pelo manual.' : 'Dani configurada.'), invalidate: [['dani-config']], onSuccess: () => setChave(''),
  });
  const [lista, setLista] = useState<{ modelos: string[]; recomendados: string[] } | null>(null);
  const verModelos = useAction(() => api.daniModelos(), { onSuccess: d => setLista(d) });
  const c = q.data;
  return (
    <Card title="Assistente Dani (IA)" subtitle="A Dani responde dúvidas de uso no canto da tela. Com a chave gratuita do Gemini ela conversa; sem a chave, responde pelo manual.">
      <div className="stack" style={{ gap: 12 }}>
        {c && (c.configurada
          ? <Banner tone="info">IA ligada · chave terminando em <b>{c.final}</b> · modelo {c.modelo || 'automático'} · {c.perguntasHoje} pergunta(s) nas últimas 24h.</Banner>
          : <Banner tone="warn">IA desligada: a Dani está respondendo pelo manual.</Banner>)}
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
          <li>Abra <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a> com uma conta Google.</li>
          <li>Toque em <b>Create API key</b> (gratuita) e copie a chave (começa com <code>AQ.</code> ou <code>AIza</code>).</li>
          <li>Cole abaixo e salve. A chave fica guardada no servidor e não aparece mais na tela.</li>
        </ol>
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr auto', alignItems: 'end' }}>
          <TextField label={c?.configurada ? 'Nova chave do Gemini (para trocar)' : 'Chave do Gemini'} type="password" autoComplete="off" value={chave} onChange={e => setChave(e.target.value.trim())} placeholder="AQ.… ou AIza…" />
          <TextField label="Modelo (opcional)" value={modelo ?? c?.modelo ?? ''} onChange={e => setModelo(e.target.value)} placeholder="automático" hint="Vazio = automático (gemini-3.5-flash-lite, rápido)" />
          <Button variant="primary" loading={salvar.isPending} disabled={!chave && modelo === null} onClick={() => salvar.mutate({ chave, modelo: (modelo ?? c?.modelo ?? '').trim() })}>Salvar</Button>
        </div>
        {c?.configurada && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" loading={verModelos.isPending} onClick={() => verModelos.mutate(undefined)}>Ver modelos que a chave aceita</Button>
            <Button size="sm" variant="ghost" onClick={() => salvar.mutate({ chave: '-', modelo: c.modelo })}>Remover chave</Button>
          </div>
        )}
        {lista && (
          <div className="stack" style={{ gap: 6 }}>
            <small className="muted">Toque num modelo para usá-lo e depois em Salvar. Recomendados (rápidos): {lista.recomendados.join(', ') || 'nenhum desta lista'}. Deixe o campo vazio para o automático.</small>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {lista.modelos.map(m => (
                <Button key={m} size="sm" variant={lista.recomendados.includes(m) ? 'primary' : 'ghost'} onClick={() => setModelo(m)}>{m}</Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
