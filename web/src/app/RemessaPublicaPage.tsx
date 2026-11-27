import { useCallback, useEffect, useState } from 'react';
import type { ConfirmacaoOficina, RemessaPublica } from '../api/types';
import { ApiError } from '../api/transport';
import { dataBR, formatBRL, formatNumber } from '../lib/format';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Badge, Banner } from '../ui/primitives';
import { useApi } from './auth';

/**
 * Página da oficina/costureira (link da remessa, sem login).
 * Ela vê o que recebeu, o que devolveu e quanto vai receber, e confirma ou contesta cada etapa.
 * A fábrica é avisada na hora quando ela contesta. Cada etapa só pode ser respondida uma vez.
 */
const CHAVE_NOME = 'fab_oficina_nome';
const lerNome = () => { try { return localStorage.getItem(CHAVE_NOME) ?? ''; } catch { return ''; } };
const quando = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };

type Linha = { itemId: string; descricao: string; fabrica: number; detalhe?: string };

function Resposta({ titulo, pergunta, linhas, conf, onEnviar }: {
  titulo: string; pergunta: string; linhas: Linha[]; conf: ConfirmacaoOficina | null;
  onEnviar: (p: { confere: boolean; itens: { itemId: string; qtd: number }[]; obs: string }) => Promise<void>;
}) {
  const [modo, setModo] = useState<'pergunta' | 'diferente'>('pergunta');
  const [cont, setCont] = useState<Record<string, string>>({});
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const enviar = async (confere: boolean) => {
    setErro('');
    const itens = confere ? [] : linhas.map(l => ({ itemId: l.itemId, qtd: cont[l.itemId] === undefined || cont[l.itemId] === '' ? l.fabrica : Number(cont[l.itemId]) }));
    if (!confere && itens.some(i => !Number.isInteger(i.qtd) || i.qtd < 0)) return setErro('Confira os números: use só números inteiros.');
    setEnviando(true);
    try { await onEnviar({ confere, itens, obs: obs.trim() }); } catch (e) { setErro(e instanceof ApiError ? e.message : 'Não foi possível enviar. Tente de novo.'); } finally { setEnviando(false); }
  };
  const total = linhas.reduce((s, l) => s + l.fabrica, 0);
  return (
    <section className="rp-card">
      <h2>{titulo}</h2>
      <table className="rp-tabela">
        <thead><tr><th>Peça</th><th className="num">{modo === 'diferente' && !conf ? 'Fábrica' : 'Quantidade'}</th>{modo === 'diferente' && !conf && <th className="num">Você contou</th>}</tr></thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.itemId}>
              <td>{l.descricao}{l.detalhe && <small>{l.detalhe}</small>}</td>
              <td className="num">{formatNumber(l.fabrica)}</td>
              {modo === 'diferente' && !conf && (
                <td className="num"><input inputMode="numeric" aria-label={`Você contou: ${l.descricao}`} placeholder={String(l.fabrica)} value={cont[l.itemId] ?? ''}
                  onChange={e => setCont(s => ({ ...s, [l.itemId]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} /></td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Total</td><td className="num">{formatNumber(total)}</td>{modo === 'diferente' && !conf && <td />}</tr></tfoot>
      </table>
      {conf ? (
        conf.confere
          ? <p className="rp-ok"><Icon name="check" size={18} /> Você confirmou em {quando(conf.em)}.</p>
          : <div className="rp-dif"><b>Você informou diferença em {quando(conf.em)}.</b>
              <ul>{conf.itens.map(d => { const l = linhas.find(x => x.itemId === d.itemId); return <li key={d.itemId}>{l?.descricao ?? 'Peça'}: você contou {d.qtd}, a fábrica {l?.fabrica ?? '—'}</li>; })}</ul>
              {conf.obs && <p>“{conf.obs}”</p>}<p>A fábrica foi avisada.</p></div>
      ) : modo === 'pergunta' ? (
        <div className="rp-pergunta">
          <p>{pergunta}</p>
          <div className="rp-botoes">
            <Button variant="primary" size="lg" loading={enviando} onClick={() => void enviar(true)} icon={<Icon name="check" size={18} />}>Está tudo certo</Button>
            <Button size="lg" onClick={() => setModo('diferente')}>Contei diferente</Button>
          </div>
        </div>
      ) : (
        <div className="rp-pergunta">
          <p>Digite quantas peças <b>você contou</b> nas linhas diferentes. Linha em branco = igual à fábrica.</p>
          <label className="rp-campo">Explique, se quiser
            <textarea rows={2} maxLength={300} value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex.: contei na frente do motoboy" />
          </label>
          <div className="rp-botoes">
            <Button variant="primary" size="lg" loading={enviando} onClick={() => void enviar(false)}>Enviar minha contagem</Button>
            <Button size="lg" variant="ghost" onClick={() => { setModo('pergunta'); setCont({}); }}>Voltar</Button>
          </div>
        </div>
      )}
      {erro && <p className="rp-erro" role="alert">{erro}</p>}
    </section>
  );
}

export function RemessaPublicaPage({ token }: { token: string }) {
  const api = useApi();
  const [d, setD] = useState<RemessaPublica | null>(null);
  const [erro, setErro] = useState('');
  const [nome, setNomeSt] = useState(lerNome);
  const setNome = (x: string) => { setNomeSt(x); try { localStorage.setItem(CHAVE_NOME, x); } catch { /* sem armazenamento */ } };
  const carregar = useCallback(() => api.remessaPublica(token).then(x => { setD(x); setErro(''); }).catch(e => setErro(e instanceof ApiError ? e.message : 'Não foi possível abrir a remessa. Confira a internet e tente de novo.')), [api, token]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { document.title = d ? `Remessa #${d.numero} · ${d.empresa}` : 'Remessa'; }, [d]);

  if (erro) return <main className="rp"><section className="rp-card"><h1>Remessa</h1><Banner tone="warn">{erro}</Banner></section></main>;
  if (!d) return <main className="rp"><p className="muted" style={{ textAlign: 'center', marginTop: 48 }}>Abrindo a remessa…</p></main>;

  const desc = (id: string) => { const i = d.itens.find(x => x.id === id); return i ? `${i.modelo} · ${i.cor} · ${i.tamanho}` : 'Peça'; };
  const comVoce = Math.max(0, d.enviadas - d.boas - d.defeito);
  const responder = (retornoId: string | null) => async (p: { confere: boolean; itens: { itemId: string; qtd: number }[]; obs: string }) => {
    await api.remessaConfirmar(token, { retornoId, nome: nome.trim(), ...p });
    await carregar();
  };
  return (
    <main className="rp">
      <header className="rp-topo">
        <img src="marca/marca-96.webp" alt="" width={40} height={40} />
        <div><small>{d.empresa}</small><h1>Remessa #{d.numero}</h1></div>
        {d.status === 'fechada' ? <Badge tone="ok">Acertada</Badge> : <Badge tone="info">Aberta</Badge>}
      </header>
      <section className="rp-card rp-resumo">
        <p><b>{d.quem}</b> · {d.etapa}</p>
        <p className="muted">Enviada em {dataBR(d.dataEnvio)}{d.prazo ? ` · devolver até ${dataBR(d.prazo)}` : ''}</p>
        <div className="rp-numeros">
          <div><span>Enviadas</span><b>{formatNumber(d.enviadas)}</b></div>
          <div><span>Devolvidas</span><b>{formatNumber(d.boas + d.defeito)}</b></div>
          <div><span>{d.status === 'fechada' ? 'Faltaram' : 'Com você'}</span><b>{formatNumber(comVoce)}</b></div>
        </div>
        <label className="rp-campo">Seu nome (aparece para a fábrica junto com a sua resposta)
          <input value={nome} maxLength={60} onChange={e => setNome(e.target.value)} placeholder={d.quem} autoComplete="name" />
        </label>
      </section>

      <Resposta titulo="1. O que você recebeu" pergunta="Conferiu as peças que chegaram? Confirme ou informe a sua contagem."
        linhas={d.itens.map(i => ({ itemId: i.id, descricao: desc(i.id), fabrica: i.qtd }))} conf={d.confirmacaoEnvio} onEnviar={responder(null)} />

      {d.retornos.map((t, k) => (
        <Resposta key={t.id} titulo={`${k + 2}. Devolução de ${dataBR(t.data)}`} pergunta="A fábrica contou estas peças na sua devolução. Está certo?"
          linhas={t.itens.map(i => ({ itemId: i.itemId, descricao: desc(i.itemId), fabrica: i.boas + i.defeito, detalhe: i.defeito ? `${i.boas} boa(s) · ${i.defeito} com defeito` : undefined }))}
          conf={t.confirmacao} onEnviar={responder(t.id)} />
      ))}

      <section className="rp-card">
        <h2>Acerto</h2>
        {d.status === 'fechada' && d.valorPago !== null ? (
          <p>Acertado em {dataBR(d.fechadaEm)}: <b>{formatBRL(d.valorPago)}</b>.</p>
        ) : (
          <>
            <p>Peças boas até agora: <b>{formatNumber(d.boas)} × {formatBRL(d.valorPeca)} = {formatBRL(Math.round(d.boas * d.valorPeca * 100) / 100)}</b>.</p>
            {d.descontoFaltante > 0 && <p className="muted">Peça que não voltar até o acerto tem desconto de {formatBRL(d.descontoFaltante)}. Peça com defeito não é paga nem descontada.</p>}
          </>
        )}
      </section>
      <p className="rp-rodape">Dúvidas? Fale com a {d.empresa}. Este link é só seu: não compartilhe.</p>
    </main>
  );
}
