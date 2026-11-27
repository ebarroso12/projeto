import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrdemCorte, QuemFez, Remessa, RemessaInput, RemessaOpcoes } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { useAction } from '../../app/useAction';
import { dataBR, dataHoraBR, formatBRL, formatNumber, isoDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner, Card, EmptyState, PageHeader, Segmented, Stat } from '../../ui/primitives';
import { parseValor, valorTexto } from '../financeiro/LancamentoForm';
import { useToast } from '../../ui/Toast';
import { balancoOrdem, conferenciaCega, rankingCortadores, rankingOficinas, contaRemessa, contestacoes, divergencias, painelOficinas, rendimento, respostaOficina, textoComprovante } from './calc';

const KEY = ['remessas'] as const;
type Aba = 'oficinas' | 'remessas' | 'ordens' | 'balanco' | 'ranking';
const hoje = () => isoDay(new Date());
const erroEl = (m: string) => (m ? <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{m}</p> : null);

// ---------------------------------------------------------------- quem fez (oficina ou funcionário)
const quemDe = (v: string): QuemFez | null => (v.startsWith('p:') ? { login: v.slice(2) } : v.startsWith('o:') ? { oficinaId: v.slice(2) } : null);
function QuemSelect({ label, valor, onChange, opc, etapa }: { label: string; valor: string; onChange: (v: string) => void; opc?: RemessaOpcoes; etapa?: string }) {
  const ofs = (opc?.oficinas ?? []).slice().sort((a, b) => Number(!etapa || b.etapa === etapa) - Number(!etapa || a.etapa === etapa) || a.nome.localeCompare(b.nome));
  return (
    <div className="field">
      <label htmlFor="quem-sel">{label}</label>
      <select id="quem-sel" value={valor} onChange={e => onChange(e.target.value)}>
        <option value="">{opc ? 'Escolha' : 'Carregando…'}</option>
        {ofs.length > 0 && <optgroup label="Oficinas (de fora)">{ofs.map(o => <option key={o.id} value={`o:${o.id}`}>{o.nome}{o.etapa ? ` · ${o.etapa}` : ''}</option>)}</optgroup>}
        {(opc?.pessoas.length ?? 0) > 0 && <optgroup label="Funcionários">{opc!.pessoas.map(p => <option key={p.login} value={`p:${p.login}`}>{p.nome} · {p.setor}</option>)}</optgroup>}
      </select>
      {opc && !opc.oficinas.length && <p className="hint">Cadastre as oficinas de fora em Cadastros → Oficinas.</p>}
    </div>
  );
}

function Grade({ tamanhos, valores, onChange, prefixo }: { tamanhos: string[]; valores: Record<string, string>; onChange: (v: Record<string, string>) => void; prefixo: string }) {
  return (
    <div className="ped-grade" role="group" aria-label={`Quantidades por tamanho ${prefixo}`}>
      {tamanhos.map(t => (
        <label key={t}><span>{t}</span>
          <input inputMode="numeric" value={valores[t] ?? ''} aria-label={`${prefixo}, tamanho ${t}`}
            onChange={e => onChange({ ...valores, [t]: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- ordem de corte
function OrdemForm({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const boot = useBoot();
  const opc = useQuery({ queryKey: [...KEY, 'opcoes'], queryFn: () => api.remessaOpcoes() });
  const [quem, setQuem] = useState('');
  const [data, setData] = useState(hoje());
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [mat, setMat] = useState('');
  const [matQtd, setMatQtd] = useState('');
  const [grade, setGrade] = useState<Record<string, string>>({});
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const unidade = opc.data?.materiais.find(m => m.id === mat)?.unidade ?? '';
  const total = Object.values(grade).reduce((s, q) => s + (Number(q) || 0), 0);
  const salvar = useAction(() => api.salvarOrdemCorte({
    quem: quemDe(quem)!, data, modelo, cor, materialId: mat || null, materialQtd: mat && matQtd ? parseValor(matQtd) : null, obs: obs.trim(),
    itens: boot.tamanhos.filter(t => Number(grade[t]) > 0).map(t => ({ tamanho: t, qtd: Number(grade[t]) })),
  }), { success: r => `Ordem de corte #${r.numero}: ${formatNumber(r.pecas)} peça(s) lançadas no corte.`, invalidate: [KEY, ['materiais']], onSuccess: onClose });
  const submit = () => {
    if (!quemDe(quem)) return setErro('Escolha quem cortou.');
    if (!modelo || !cor) return setErro('Escolha o modelo e a cor.');
    if (mat && matQtd && !(parseValor(matQtd) > 0)) return setErro('Quantidade de material inválida.');
    if (!total) return setErro('Informe quantas peças foram cortadas em cada tamanho.');
    setErro('');
    salvar.mutate();
  };
  return (
    <Dialog open onClose={onClose} title="Nova ordem de corte" variant="drawer" wide
      footer={<><span className="muted tnum" style={{ marginRight: 'auto' }}>{formatNumber(total)} peça(s)</span><Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={salvar.isPending} onClick={submit}>Registrar corte</Button></>}>
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Registre a bobina que foi para o corte e o que voltou cortado. As peças entram no Corte (no nome de quem cortou) e o tecido sai do estoque pelo peso real.</p>
      <div className="form-grid">
        <QuemSelect label="Quem cortou" valor={quem} onChange={setQuem} opc={opc.data} etapa="Corte" />
        <TextField label="Data do corte" type="date" value={data} onChange={e => setData(e.target.value)} />
      </div>
      <div className="form-grid">
        <SelectField label="Modelo" value={modelo} placeholder="Escolha" options={boot.modelos} onChange={e => setModelo(e.target.value)} />
        <SelectField label="Cor" value={cor} placeholder="Escolha" options={boot.cores} onChange={e => setCor(e.target.value)} />
      </div>
      <div className="form-grid">
        <SelectField label="Bobina / tecido (opcional)" value={mat} placeholder="—" options={(opc.data?.materiais ?? []).map(m => ({ value: m.id, label: m.nome }))} onChange={e => setMat(e.target.value)}
          hint={opc.data && !opc.data.materiais.length ? 'Cadastre o tecido em Matéria-prima para medir o rendimento.' : undefined} />
        {mat && <TextField label={`Quanto foi usado (${unidade})`} inputMode="decimal" value={matQtd} onChange={e => setMatQtd(e.target.value)} hint="Peso ou metragem da bobina usada no corte." />}
      </div>
      <b>Cortado por tamanho</b>
      <Grade tamanhos={boot.tamanhos} valores={grade} onChange={setGrade} prefixo="Corte" />
      <TextField label="Observação" value={obs} onChange={e => setObs(e.target.value)} />
      {erroEl(erro)}
    </Dialog>
  );
}

// ---------------------------------------------------------------- remessa (envio)
interface GrupoR { modelo: string; cor: string; qtds: Record<string, string> }
function RemessaForm({ inicial, ordens, onClose }: { inicial?: Remessa; ordens: OrdemCorte[]; onClose: () => void }) {
  const api = useApi();
  const boot = useBoot();
  const opc = useQuery({ queryKey: [...KEY, 'opcoes'], queryFn: () => api.remessaOpcoes() });
  const etapasRemessa = boot.etapas.slice(1);
  const [quem, setQuem] = useState(inicial ? (inicial.login ? `p:${inicial.login}` : `o:${inicial.oficinaId ?? ''}`) : '');
  const [etapa, setEtapa] = useState(inicial?.etapa ?? etapasRemessa[0] ?? 'Costura');
  const [dataEnvio, setDataEnvio] = useState(inicial?.dataEnvio ?? hoje());
  const [prazo, setPrazo] = useState(inicial?.prazo ?? '');
  const [valor, setValor] = useState(inicial ? valorTexto(inicial.valorPeca) : '');
  const [desconto, setDesconto] = useState(inicial ? valorTexto(inicial.descontoFaltante) : '');
  const [ordemId, setOrdemId] = useState('');
  const [obs, setObs] = useState(inicial?.obs ?? '');
  const [grupos, setGrupos] = useState<GrupoR[]>(() => {
    if (!inicial) return [{ modelo: '', cor: '', qtds: {} }];
    const m = new Map<string, GrupoR>();
    for (const i of inicial.itens) { const k = `${i.modelo}|${i.cor}`; const g = m.get(k) ?? { modelo: i.modelo, cor: i.cor, qtds: {} }; g.qtds[i.tamanho] = String(i.qtd); m.set(k, g); }
    return [...m.values()];
  });
  const [erro, setErro] = useState('');
  const escolherQuem = (v: string) => {
    setQuem(v);
    const of = opc.data?.oficinas.find(o => `o:${o.id}` === v);
    if (of?.valorPeca && !valor) setValor(valorTexto(of.valorPeca));
  };
  const usarOrdem = (id: string) => {
    setOrdemId(id);
    const o = ordens.find(x => x.id === id);
    if (o) setGrupos([{ modelo: o.modelo, cor: o.cor, qtds: Object.fromEntries(Object.entries(o.itens).map(([t, q]) => [t, String(q)])) }]);
  };
  const total = grupos.reduce((s, g) => s + Object.values(g.qtds).reduce((a, q) => a + (Number(q) || 0), 0), 0);
  const salvar = useAction((o: RemessaInput) => api.salvarRemessa(o), {
    success: r => `Remessa #${r.numero} registrada: ${formatNumber(r.pecas)} peça(s).`, invalidate: [KEY], onSuccess: onClose,
  });
  const submit = () => {
    const q = quemDe(quem);
    if (!q) return setErro('Escolha para quem vai a remessa.');
    if (grupos.some(g => !g.modelo || !g.cor)) return setErro('Escolha modelo e cor em cada item.');
    const itens = grupos.flatMap(g => boot.tamanhos.filter(t => Number(g.qtds[t]) > 0).map(t => ({ modelo: g.modelo, cor: g.cor, tamanho: t, qtd: Number(g.qtds[t]) })));
    if (!itens.length) return setErro('Informe as quantidades enviadas.');
    if (prazo && prazo < dataEnvio) return setErro('O prazo não pode ser antes do envio.');
    const v = valor.trim() ? parseValor(valor) : 0, d = desconto.trim() ? parseValor(desconto) : 0;
    if (!(v >= 0) || !(d >= 0)) return setErro('Valor inválido.');
    setErro('');
    salvar.mutate({ id: inicial?.id, quem: q, etapa, dataEnvio, prazo: prazo || null, valorPeca: v, descontoFaltante: d, ordemId: ordemId || null, obs: obs.trim(), itens });
  };
  const ordensAbertas = ordens.filter(o => rendimento(o).cortadas > o.remetido);
  return (
    <Dialog open onClose={onClose} title={inicial ? `Editar remessa #${inicial.numero}` : 'Nova remessa'} variant="drawer" wide
      footer={<><span className="muted tnum" style={{ marginRight: 'auto' }}>{formatNumber(total)} peça(s){parseValor(valor) > 0 ? ` · ${formatBRL(total * parseValor(valor))}` : ''}</span>
        <Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Registrar envio</Button></>}>
      <div className="form-grid">
        <QuemSelect label="Para quem vai" valor={quem} onChange={escolherQuem} opc={opc.data} etapa={etapa} />
        <SelectField label="Para fazer" value={etapa} options={etapasRemessa} onChange={e => setEtapa(e.target.value)} />
      </div>
      <div className="form-grid">
        <TextField label="Data do envio" type="date" value={dataEnvio} onChange={e => setDataEnvio(e.target.value)} />
        <TextField label="Devolver até" type="date" value={prazo} min={dataEnvio} onChange={e => setPrazo(e.target.value)} hint="Prazo combinado (opcional)." />
      </div>
      <div className="form-grid">
        <TextField label="Valor por peça (R$)" inputMode="decimal" value={valor} placeholder="0,00" onChange={e => setValor(e.target.value)} hint="O que a oficina recebe por peça boa." />
        <TextField label="Desconto por peça faltando (R$)" inputMode="decimal" value={desconto} placeholder="0,00" onChange={e => setDesconto(e.target.value)} hint="Cobrado no acerto por peça que não voltou." />
      </div>
      {!inicial && ordensAbertas.length > 0 && (
        <SelectField label="Peças de uma ordem de corte (opcional)" value={ordemId} placeholder="—" onChange={e => usarOrdem(e.target.value)}
          options={ordensAbertas.map(o => ({ value: o.id, label: `#${o.numero} · ${o.modelo} ${o.cor} · ${formatNumber(rendimento(o).cortadas - o.remetido)} sem remessa` }))} />
      )}
      {grupos.map((g, i) => (
        <fieldset key={i} className="ped-grupo">
          <legend>Item {i + 1}</legend>
          <div className="form-grid">
            <SelectField label="Modelo" value={g.modelo} placeholder="Escolha" options={boot.modelos} onChange={e => setGrupos(gs => gs.map((x, j) => (j === i ? { ...x, modelo: e.target.value } : x)))} />
            <SelectField label="Cor" value={g.cor} placeholder="Escolha" options={boot.cores} onChange={e => setGrupos(gs => gs.map((x, j) => (j === i ? { ...x, cor: e.target.value } : x)))} />
          </div>
          <Grade tamanhos={boot.tamanhos} valores={g.qtds} prefixo={`Item ${i + 1}`} onChange={v => setGrupos(gs => gs.map((x, j) => (j === i ? { ...x, qtds: v } : x)))} />
          {grupos.length > 1 && <Button variant="ghost" onClick={() => setGrupos(gs => gs.filter((_, j) => j !== i))}><Icon name="trash" size={15} /> Remover item</Button>}
        </fieldset>
      ))}
      <Button icon={<Icon name="plus" size={16} />} onClick={() => setGrupos(gs => [...gs, { modelo: '', cor: '', qtds: {} }])}>Adicionar modelo / cor</Button>
      <TextAreaField label="Observação" rows={2} value={obs} onChange={e => setObs(e.target.value)} />
      {erroEl(erro)}
    </Dialog>
  );
}

// ---------------------------------------------------------------- retorno
const CHAVE_CEGA = 'fab_retorno_cega';
const lerCega = () => { try { return localStorage.getItem(CHAVE_CEGA) !== '0'; } catch { return true; } };

function RetornoDialog({ r, viuNumeros, onClose }: { r: Remessa; viuNumeros: boolean; onClose: () => void }) {
  const api = useApi();
  const [data, setData] = useState(hoje());
  const [obs, setObs] = useState('');
  const [v, setV] = useState<Record<string, { boas: string; defeito: string }>>({});
  const [erro, setErro] = useState('');
  // às cegas (padrão): quem confere não vê quanto era esperado; o resultado aparece só depois de salvar
  const [cega, setCegaSt] = useState(lerCega);
  const setCega = (x: boolean) => { setCegaSt(x); try { localStorage.setItem(CHAVE_CEGA, x ? '1' : '0'); } catch { /* sem armazenamento */ } };
  const [resultado, setResultado] = useState<ReturnType<typeof conferenciaCega> | null>(null);
  const pend = (i: Remessa['itens'][number]) => i.qtd - i.boas - i.defeito;
  const itens = r.itens;   // todos os itens: a lista não entrega quais ainda faltam
  const cegaDeVerdade = cega && !viuNumeros;
  const num = (x: string | undefined) => Number(x) || 0;
  const contagem = () => Object.fromEntries(itens.map(i => [i.id, { boas: num(v[i.id]?.boas), defeito: num(v[i.id]?.defeito) }]));
  const salvar = useAction((snap: { cont: Record<string, { boas: number; defeito: number }>; antes: Remessa['itens'] }) => api.registrarRetorno({ remessaId: r.id, data, obs: obs.trim(), cega: cegaDeVerdade,
    itens: Object.entries(snap.cont).map(([itemId, c]) => ({ itemId, ...c })).filter(i => i.boas + i.defeito > 0) }),
  { success: 'Retorno registrado. As peças boas entraram na produção.', invalidate: [KEY], onSuccess: (_d, snap) => setResultado(conferenciaCega(snap.antes, snap.cont)) });
  const set = (id: string, k: 'boas' | 'defeito', x: string) => setV(s => ({ ...s, [id]: { boas: s[id]?.boas ?? '', defeito: s[id]?.defeito ?? '', [k]: x.replace(/\D/g, '').slice(0, 6) } }));
  const submit = () => {
    for (const i of itens) {
      const b = num(v[i.id]?.boas), d = num(v[i.id]?.defeito);
      if (b + d > pend(i)) return setErro(cega ? `${i.modelo} ${i.cor} ${i.tamanho}: a contagem passa do que foi enviado. Reconte essas peças.` : `${i.modelo} ${i.cor} ${i.tamanho}: só faltam voltar ${pend(i)}.`);
    }
    if (!itens.some(i => num(v[i.id]?.boas) + num(v[i.id]?.defeito) > 0)) return setErro('Informe quantas peças voltaram.');
    setErro('');
    salvar.mutate({ cont: contagem(), antes: r.itens.map(i => ({ ...i })) });
  };
  const tudo = () => setV(Object.fromEntries(itens.map(i => [i.id, { boas: String(pend(i)), defeito: '' }])));

  if (resultado) {
    return (
      <Dialog open onClose={onClose} title={`Conferência da remessa #${r.numero}`} wide footer={<Button variant="primary" onClick={onClose}>Concluir</Button>}>
        {resultado.continua === 0
          ? <Banner tone="info">A contagem bate: as {formatNumber(resultado.contado)} peça(s) que estavam com {r.quem} voltaram.</Banner>
          : <Banner tone="warn">Voltaram {formatNumber(resultado.contado)} de {formatNumber(resultado.esperado)} peça(s). <b>{formatNumber(resultado.continua)} continuam com {r.quem}.</b> Se a oficina diz que entregou tudo, reconte agora, antes de guardar as peças.</Banner>}
        <div className="table-wrap">
          <table className="table" aria-label="Resultado da conferência">
            <thead><tr><th>Item</th><th className="num">Estava com a oficina</th><th className="num">Vocês contaram</th><th className="num">Continua com a oficina</th></tr></thead>
            <tbody>{resultado.linhas.map(l => (
              <tr key={l.itemId}><td>{l.descricao}</td><td className="num tnum">{l.esperado}</td><td className="num tnum">{l.contado}</td>
                <td className={`num tnum${l.continua ? ' valor-neg' : ''}`}>{l.continua}</td></tr>))}</tbody>
          </table>
        </div>
        <p className="muted" style={{ margin: 0 }}>Peça para a oficina confirmar esta devolução pelo link da remessa (botão WhatsApp). Se ela discordar, você recebe um aviso na hora.</p>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={`Retorno da remessa #${r.numero}`} wide
      footer={<>{!cega && <Button onClick={tudo} variant="ghost">Voltou tudo bom</Button>}<span style={{ marginRight: 'auto' }} />
        <Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Registrar retorno</Button></>}>
      <label className="check-linha">
        <input type="checkbox" checked={cega} onChange={e => setCega(e.target.checked)} />
        <span><b>Contagem às cegas</b> (recomendado): conte as peças sem ver quantas deveriam voltar. A diferença aparece depois de registrar.</span>
      </label>
      {cega && viuNumeros && <Banner tone="warn">Os números desta remessa foram abertos antes da contagem, então este retorno não fica marcado como “às cegas”. Para valer, peça a outra pessoa para contar.</Banner>}
      <p className="muted" style={{ margin: 0 }}>{r.quem} · {r.etapa}. Conte o que voltou: peças boas (entram na produção e são pagas) e com defeito.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Item</th>{!cega && <th className="num">Faltam voltar</th>}<th className="num">Boas</th><th className="num">Com defeito</th></tr></thead>
          <tbody>
            {itens.map(i => (
              <tr key={i.id}>
                <td>{i.modelo} · {i.cor} · <b>{i.tamanho}</b></td>
                {!cega && <td className="num tnum">{pend(i)}</td>}
                <td className="num"><input className="inp-num" inputMode="numeric" aria-label={`Boas ${i.modelo} ${i.cor} ${i.tamanho}`} value={v[i.id]?.boas ?? ''} disabled={!cega && !pend(i)} onChange={e => set(i.id, 'boas', e.target.value)} /></td>
                <td className="num"><input className="inp-num" inputMode="numeric" aria-label={`Defeito ${i.modelo} ${i.cor} ${i.tamanho}`} value={v[i.id]?.defeito ?? ''} disabled={!cega && !pend(i)} onChange={e => set(i.id, 'defeito', e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <TextField label="Data do retorno" type="date" value={data} min={r.dataEnvio} onChange={e => setData(e.target.value)} />
        <TextField label="Observação" value={obs} onChange={e => setObs(e.target.value)} />
      </div>
      {erroEl(erro)}
    </Dialog>
  );
}

// ---------------------------------------------------------------- acerto
function AcertoDialog({ r, onClose }: { r: Remessa; onClose: () => void }) {
  const api = useApi();
  const opc = useQuery({ queryKey: [...KEY, 'opcoes'], queryFn: () => api.remessaOpcoes() });
  const c = contaRemessa(r, hoje());
  const [conta, setConta] = useState('');
  const [data, setData] = useState(hoje());
  const [lancar, setLancar] = useState(true);
  const contas = opc.data?.contas ?? [];
  const contaSel = conta || contas[0]?.id || '';
  const fechar = useAction(() => api.fecharRemessa(r.id, lancar && contas.length && c.valorAcerto > 0 ? { contaId: contaSel, data } : null), {
    success: a => `Remessa #${r.numero} acertada: ${formatBRL(a.valor)}${a.noFinanceiro ? ' lançado no Financeiro' : ''}.`, invalidate: [KEY, ['financeiro']], onSuccess: onClose,
  });
  return (
    <Dialog open onClose={onClose} title={`Acerto da remessa #${r.numero}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={fechar.isPending} onClick={() => fechar.mutate()}>Fechar e acertar</Button></>}>
      <div className="acerto">
        <div><span>Enviadas</span><b>{c.enviadas}</b></div>
        <div><span>Voltaram boas</span><b className="valor-pos">{c.boas}</b></div>
        <div><span>Com defeito</span><b>{c.defeito}</b></div>
        <div><span>Faltando</span><b className={c.pendentes ? 'valor-neg' : ''}>{c.pendentes}</b></div>
      </div>
      <p style={{ margin: 0 }}>{c.boas} × {formatBRL(r.valorPeca)}{c.pendentes && r.descontoFaltante ? ` − ${c.pendentes} faltando × ${formatBRL(r.descontoFaltante)}` : ''} = <b>{formatBRL(c.valorAcerto)}</b></p>
      {c.pendentes > 0 && <Banner tone="warn">Ainda faltam {c.pendentes} peça(s). Se elas ainda vão voltar, registre o retorno antes de fechar.</Banner>}
      {contas.length > 0 && c.valorAcerto > 0 ? <>
        <label className="check"><input type="checkbox" checked={lancar} onChange={e => setLancar(e.target.checked)} /> Lançar o pagamento no Financeiro (saída “Facção”)</label>
        {lancar && <div className="form-grid">
          <SelectField label="Sai da conta" value={contaSel} onChange={e => setConta(e.target.value)} options={contas.map(x => ({ value: x.id, label: x.nome }))} />
          <TextField label="Data do pagamento" type="date" value={data} onChange={e => setData(e.target.value)} />
        </div>}
      </> : c.valorAcerto > 0 && <p className="muted" style={{ margin: 0 }}>O pagamento é lançado por quem tem acesso ao Financeiro.</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- comprovante para imprimir
function imprimirComprovante(r: Remessa, empresa: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const c = contaRemessa(r, hoje());
  const linhas = r.itens.map(i => `<tr><td>${esc(i.modelo)}</td><td>${esc(i.cor)}</td><td>${esc(i.tamanho)}</td><td class="n">${i.qtd}</td><td class="n">${i.boas || ''}</td><td class="n">${i.defeito || ''}</td></tr>`).join('');
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Remessa #${r.numero}</title><style>
    body{font-family:system-ui,Arial,sans-serif;margin:28px;color:#111} h1{font-size:20px;margin:0 0 4px} .m{color:#555;margin:0 0 16px}
    table{width:100%;border-collapse:collapse;font-size:14px} th,td{border:1px solid #bbb;padding:6px 8px;text-align:left} .n{text-align:right}
    .ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:60px} .ass div{border-top:1px solid #333;padding-top:6px;font-size:13px;text-align:center}
  </style></head><body>
    <h1>${esc(empresa)} · Remessa #${r.numero}</h1>
    <p class="m">Para: <b>${esc(r.quem)}</b> (${esc(r.etapa)}) · Enviada em ${dataBR(r.dataEnvio)}${r.prazo ? ` · Devolver até ${dataBR(r.prazo)}` : ''}${r.valorPeca ? ` · ${formatBRL(r.valorPeca)} por peça` : ''}</p>
    <table><thead><tr><th>Modelo</th><th>Cor</th><th>Tam.</th><th class="n">Enviadas</th><th class="n">Voltaram boas</th><th class="n">Defeito</th></tr></thead>
    <tbody>${linhas}</tbody><tfoot><tr><th colspan="3">Total</th><th class="n">${c.enviadas}</th><th class="n">${c.boas}</th><th class="n">${c.defeito}</th></tr></tfoot></table>
    ${r.obs ? `<p>Obs.: ${esc(r.obs)}</p>` : ''}
    <div class="ass"><div>Entregue por (${esc(empresa)})</div><div>Recebido por (${esc(r.quem)})</div></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function DetalheRemessa({ r, ordens, onClose }: { r: Remessa; ordens: OrdemCorte[]; onClose: () => void }) {
  const api = useApi();
  const boot = useBoot();
  const confirm = useConfirm();
  const [modal, setModal] = useState<'retorno' | 'acerto' | 'editar' | null>(null);
  const [resolvendo, setResolvendo] = useState<{ id: string | null; nome: string } | null>(null);
  // às cegas: quem vai conferir não vê os números antes de contar; abrir os números tira a marca "às cegas" do retorno
  const [verNumeros, setVerNumeros] = useState(() => !(r.status === 'aberta' && lerCega()));
  const [viuNumeros, setViuNumeros] = useState(false);
  const c = contaRemessa(r, hoje());
  const apagarRet = useAction((id: string) => api.apagarRetorno(id), { success: 'Retorno excluído.', invalidate: [KEY] });
  const reabrir = useAction(() => api.reabrirRemessa(r.id), { success: 'Remessa reaberta.', invalidate: [KEY, ['financeiro']] });
  const apagar = useAction(() => api.apagarRemessa(r.id), { success: 'Remessa excluída.', invalidate: [KEY], onSuccess: onClose });
  const toast = useToast();
  // link da oficina: ela confere e confirma (ou contesta) pelo celular, sem login
  const link = useAction((novo: boolean) => api.remessaLink(r.id, novo), { invalidate: [KEY] });
  const urlDo = (tok: string) => `${window.location.origin}${window.location.pathname}?r=${tok}`;
  const zap = async () => {
    const w = window.open('', '_blank');   // abre já no clique (senão o navegador bloqueia a janela depois da espera)
    try {
      const tok = r.token ?? await link.mutateAsync(false);
      const fone = (r.telefone ?? '').replace(/\D/g, '');
      const t = encodeURIComponent(textoComprovante(r, boot.empresa.nome || 'Fábrica', urlDo(tok)));
      const url = fone.length >= 10 ? `https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${t}` : `https://wa.me/?text=${t}`;
      if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
    } catch { w?.close(); }
  };
  // copiar no próprio clique (o iPhone só deixa copiar durante o toque); sem link ainda, primeiro "Gerar link"
  const copiarLink = (tok: string) => {
    navigator.clipboard.writeText(urlDo(tok)).then(() => toast.success('Link copiado. Mande para a oficina.'), () => toast.error('Não foi possível copiar. Use o botão WhatsApp.'));
  };
  const trocarLink = async () => {
    if (await confirm({ title: 'Trocar o link desta remessa?', message: 'O link antigo para de funcionar. Use se o link foi parar com outra pessoa.', confirmLabel: 'Trocar o link' })) {
      link.mutate(true, { onSuccess: () => toast.success('Link trocado. Mande o novo para a oficina.') });
    }
  };
  const etapas = [
    { id: null as string | null, nome: `Recebimento (${dataBR(r.dataEnvio)})`, conf: r.confirmacaoEnvio },
    ...r.retornos.map(t => ({ id: t.id as string | null, nome: `Devolução de ${dataBR(t.data)}`, conf: t.confirmacao })),
  ];
  const nCont = contestacoes(r);
  if (modal === 'retorno') return <RetornoDialog r={r} viuNumeros={viuNumeros} onClose={() => setModal(null)} />;
  if (resolvendo) return <ResolverDialog r={r} retornoId={resolvendo.id} etapa={resolvendo.nome} onClose={() => setResolvendo(null)} />;
  if (modal === 'acerto') return <AcertoDialog r={r} onClose={() => { setModal(null); onClose(); }} />;
  if (modal === 'editar') return <RemessaForm inicial={r} ordens={ordens} onClose={() => { setModal(null); onClose(); }} />;
  return (
    <Dialog open onClose={onClose} title={`Remessa #${r.numero} · ${r.quem}`} variant="drawer" wide
      footer={<>
        {r.status === 'aberta' && !r.retornos.length && <Button variant="ghost" onClick={async () => {
          if (await confirm({ title: `Excluir a remessa #${r.numero}?`, message: 'Fica registrado na Atividade.', confirmLabel: 'Excluir', tone: 'danger' })) apagar.mutate();
        }}><Icon name="trash" size={15} /> Excluir</Button>}
        <span style={{ marginRight: 'auto' }} />
        <Button onClick={() => imprimirComprovante(r, boot.empresa.nome || 'Fábrica')} icon={<Icon name="printer" size={15} />}>Comprovante</Button>
        <Button onClick={() => void zap()} icon={<Icon name="send" size={15} />}>WhatsApp + link</Button>
        {r.status === 'aberta' && !r.retornos.length && <Button onClick={() => setModal('editar')} icon={<Icon name="pencil" size={15} />}>Editar</Button>}
        {r.status === 'aberta' && c.pendentes > 0 && <Button onClick={() => setModal('retorno')}>Registrar retorno</Button>}
        {r.status === 'aberta' && <Button variant="primary" disabled={nCont > 0} title={nCont > 0 ? 'Resolva a contestação da oficina antes de acertar' : undefined} onClick={() => setModal('acerto')}>Acertar</Button>}
        {r.status === 'fechada' && <Button onClick={() => reabrir.mutate()} loading={reabrir.isPending}>Reabrir</Button>}
      </>}>
      <div className="row" style={{ gap: 8 }}>
        {r.status === 'fechada' ? <Badge tone="ok">Acertada em {dataBR(r.fechadaEm)}</Badge> : c.atraso !== null && c.atraso > 0 ? <Badge tone="danger">Atrasada {c.atraso} dia(s)</Badge> : <Badge tone="info">Aberta</Badge>}
        <span className="muted">{r.etapa} · enviada {dataBR(r.dataEnvio)}{r.prazo ? ` · devolver até ${dataBR(r.prazo)}` : ''}{r.ordemNumero ? ` · da ordem de corte #${r.ordemNumero}` : ''}</span>
      </div>
      {nCont > 0 && <Banner tone="danger">A oficina contestou {nCont === 1 ? 'uma contagem' : `${nCont} contagens`}. Confira a diferença em “Resposta da oficina” e toque em <b>Resolver</b> com o que foi decidido. O acerto fica liberado depois.</Banner>}
      {!verNumeros ? (
        <div className="numeros-ocultos">
          <p><b>Contagem às cegas ligada.</b> Os números desta remessa ficam escondidos para quem vai conferir o retorno.</p>
          <Button size="sm" onClick={() => { setVerNumeros(true); setViuNumeros(true); }}>Ver números</Button>
        </div>
      ) : <>
      <div className="acerto">
        <div><span>Enviadas</span><b>{c.enviadas}</b></div>
        <div><span>Voltaram boas</span><b className="valor-pos">{c.boas}</b></div>
        <div><span>Com defeito</span><b>{c.defeito}</b></div>
        <div><span>{r.status === 'fechada' ? 'Faltaram' : 'Ainda com a oficina'}</span><b className={c.pendentes ? 'valor-neg' : ''}>{c.pendentes}</b></div>
        <div><span>{r.status === 'fechada' ? 'Pago' : 'Peças boas × valor'}</span><b>{formatBRL(c.aPagar)}</b></div>
      </div>
      {r.noFinanceiro && <p className="muted" style={{ margin: 0 }}><Icon name="wallet" size={14} /> Pagamento lançado no Financeiro.</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Item</th><th className="num">Enviadas</th><th className="num">Boas</th><th className="num">Defeito</th><th className="num">Faltam</th></tr></thead>
          <tbody>{r.itens.map(i => { const f = i.qtd - i.boas - i.defeito; return (
            <tr key={i.id}><td>{i.modelo} · {i.cor} · <b>{i.tamanho}</b></td><td className="num tnum">{i.qtd}</td><td className="num tnum valor-pos">{i.boas}</td>
              <td className="num tnum">{i.defeito}</td><td className={`num tnum${f ? ' valor-neg' : ''}`}>{f}</td></tr>); })}</tbody>
        </table>
      </div>
      </>}
      <b>Retornos</b>
      {r.retornos.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nada voltou ainda.</p> : (
        <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          {r.retornos.map(t => (
            <div className="item" key={t.id}>
              <div className="item-main"><b>{dataBR(t.data)}{t.cega && <span className="selo-cega" title="Contada sem ver o número esperado">às cegas</span>}</b><small>{t.boas} boa(s){t.defeito ? ` · ${t.defeito} com defeito` : ''}{t.obs ? ` · ${t.obs}` : ''}</small></div>
              {r.status === 'aberta' && <Button size="sm" variant="ghost" iconOnly aria-label="Excluir retorno" onClick={async () => {
                if (await confirm({ title: 'Excluir este retorno?', message: 'As peças boas saem da produção.', confirmLabel: 'Excluir', tone: 'danger' })) apagarRet.mutate(t.id);
              }}><Icon name="trash" size={15} /></Button>}
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ marginRight: 'auto' }}>Resposta da oficina (pelo link)</b>
        {r.token
          ? <Button size="sm" variant="ghost" onClick={() => copiarLink(r.token!)}><Icon name="copy" size={14} /> Copiar link</Button>
          : <Button size="sm" variant="ghost" loading={link.isPending} onClick={() => link.mutate(false, { onSuccess: () => toast.success('Link criado. Toque em “Copiar link” ou use o WhatsApp.') })}>Gerar link</Button>}
        {r.token && <Button size="sm" variant="ghost" onClick={() => void trocarLink()}>Trocar link</Button>}
      </div>
      {!r.token ? <p className="muted" style={{ margin: 0 }}>Ainda não foi mandado. Use “WhatsApp + link”: a oficina confere as peças e confirma, ou informa a contagem dela. Se ela discordar, você recebe um aviso.</p> : (
        <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          {etapas.map(e => {
            const sit = respostaOficina(e.conf);
            const dif = divergencias(r, e.id);
            return (
              <div className="item" key={e.id ?? 'envio'} style={{ alignItems: 'flex-start' }}>
                <div className="item-main">
                  <b>{e.nome}</b>
                  <small>{sit === 'aguardando' ? 'A oficina ainda não respondeu.' : `${e.conf!.nome || r.quem} respondeu em ${dataHoraBR(e.conf!.em)}${e.conf!.obs ? ` · “${e.conf!.obs}”` : ''}`}</small>
                  {dif.length > 0 && <ul className="lista-dif">{dif.map(d => <li key={d.itemId}>{d.descricao}: fábrica <b>{d.fabrica}</b> · oficina <b className="valor-neg">{d.oficina}</b></li>)}</ul>}
                  {e.conf?.resolvida && <small>Resolvida por {e.conf.resolvida.por} em {dataHoraBR(e.conf.resolvida.em)}: “{e.conf.resolvida.nota}”</small>}
                </div>
                {sit === 'contestou' && <Button size="sm" onClick={() => setResolvendo({ id: e.id, nome: e.nome })}>Resolver</Button>}
                {sit === 'confirmou' ? <Badge tone="ok">Confirmou</Badge> : sit === 'contestou' ? <Badge tone="danger">Contestou</Badge> : sit === 'resolvida' ? <Badge tone="info">Resolvida</Badge> : <Badge>Aguardando</Badge>}
              </div>
            );
          })}
        </div>
      )}
      {r.historico.length > 0 && (
        <details className="historico-resp">
          <summary>Respostas anteriores ({r.historico.length})</summary>
          <ul>{r.historico.map((h, k) => (
            <li key={k}>{h.etapa === 'envio' ? 'Recebimento' : 'Devolução excluída'} · {dataHoraBR(h.em)} · {h.confere ? 'confirmou' : 'contestou'}
              {h.resolvida ? ` · resolvida: “${h.resolvida.nota}”` : ''} · substituída em {dataHoraBR(h.substituidaEm)}</li>))}</ul>
        </details>
      )}
      {r.obs && <p style={{ margin: 0 }}><b>Obs.:</b> {r.obs}</p>}
    </Dialog>
  );
}

function ResolverDialog({ r, retornoId, etapa, onClose }: { r: Remessa; retornoId: string | null; etapa: string; onClose: () => void }) {
  const api = useApi();
  const [nota, setNota] = useState('');
  const dif = divergencias(r, retornoId);
  const salvar = useAction(() => api.resolverContestacao(r.id, retornoId, nota.trim()), { success: 'Contestação resolvida. A oficina vê a resposta pelo link.', invalidate: [KEY], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={`Resolver contestação · ${etapa}`}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} disabled={nota.trim().length < 3} onClick={() => salvar.mutate()}>Resolver</Button></>}>
      {dif.length > 0 && <ul className="lista-dif" style={{ marginTop: 0 }}>{dif.map(d => <li key={d.itemId}>{d.descricao}: fábrica <b>{d.fabrica}</b> · oficina <b className="valor-neg">{d.oficina}</b></li>)}</ul>}
      <TextAreaField label="O que foi decidido" value={nota} maxLength={300} onChange={e => setNota(e.target.value)}
        placeholder="Ex.: recontamos juntas, eram 88; vamos corrigir o envio." />
      <p className="muted" style={{ margin: 0 }}>Fica registrado com seu nome e a hora, na remessa e na Atividade. Se for preciso mudar os itens enviados, edite a remessa depois de resolver.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- página
export default function RemessasPage() {
  const api = useApi();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.remessas(120) });
  const [aba, setAba] = useState<Aba>('oficinas');
  const [nova, setNova] = useState<'ordem' | 'remessa' | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Oficinas e remessas" subtitle="Bobina → corte → costura: o que foi cortado, enviado, devolvido e quanto pagar a cada oficina"
        actions={<>
          <Button icon={<Icon name="plus" size={16} />} onClick={() => setNova('ordem')}>Ordem de corte</Button>
          <Button variant="primary" icon={<Icon name="truck" size={16} />} onClick={() => setNova('remessa')}>Nova remessa</Button>
        </>} />
      <QueryView query={q}>
        {d => <>
          <Conteudo remessas={d.remessas} ordens={d.ordens} limitePerda={d.limitePerda} aba={aba} setAba={setAba} onVer={setVendo} />
          {nova === 'ordem' && <OrdemForm onClose={() => setNova(null)} />}
          {nova === 'remessa' && <RemessaForm ordens={d.ordens} onClose={() => setNova(null)} />}
          {vendo && (() => { const r = d.remessas.find(x => x.id === vendo); return r ? <DetalheRemessa r={r} ordens={d.ordens} onClose={() => setVendo(null)} /> : null; })()}
        </>}
      </QueryView>
    </>
  );
}

function Conteudo({ remessas, ordens, limitePerda, aba, setAba, onVer }: { remessas: Remessa[]; ordens: OrdemCorte[]; limitePerda: number; aba: Aba; setAba: (a: Aba) => void; onVer: (id: string) => void }) {
  const api = useApi();
  const confirm = useConfirm();
  const h = hoje();
  const painel = useMemo(() => painelOficinas(remessas, h), [remessas, h]);
  const abertas = remessas.filter(r => r.status === 'aberta');
  const contestadas = remessas.filter(r => contestacoes(r) > 0).length;
  const pend = painel.reduce((s, l) => s + l.pendentes, 0), atras = painel.reduce((s, l) => s + l.atrasadas, 0), acertar = painel.reduce((s, l) => s + l.aAcertar, 0);
  const apagarOrdem = useAction((id: string) => api.apagarOrdemCorte(id), { success: 'Ordem de corte excluída.', invalidate: [KEY, ['materiais']] });
  type LR = { r: Remessa; c: ReturnType<typeof contaRemessa> };
  const linhas = useMemo(() => remessas.map(r => ({ r, c: contaRemessa(r, h) })), [remessas, h]);
  const cols: Column<LR>[] = [
    { id: 'num', header: 'Remessa', value: x => x.r.numero, nowrap: true,
      cell: x => <button type="button" className="link-empresa" onClick={() => onVer(x.r.id)}><b>#{x.r.numero} · {x.r.quem}</b><small>{x.r.etapa} · enviada {dataBR(x.r.dataEnvio)}</small></button> },
    { id: 'sit', header: 'Situação', value: x => (contestacoes(x.r) > 0 ? -1 : x.r.status === 'fechada' ? 3 : x.c.atraso && x.c.atraso > 0 ? 0 : x.c.pendentes ? 1 : 2),
      cell: x => contestacoes(x.r) > 0 ? <><Badge tone="danger">Contestada</Badge><small>pela oficina</small></> : x.r.status === 'fechada' ? <Badge tone="ok">Acertada</Badge> : x.c.atraso !== null && x.c.atraso > 0 ? <><Badge tone="danger">Atrasada</Badge><small>{x.c.atraso} dia(s)</small></>
        : x.c.pendentes ? <><Badge tone="info">Com a oficina</Badge>{x.r.prazo && <small>até {dataBR(x.r.prazo)}</small>}</> : <Badge tone="warn">Voltou tudo · acertar</Badge> },
    { id: 'env', header: 'Enviadas', numeric: true, value: x => x.c.enviadas, cell: x => formatNumber(x.c.enviadas) },
    { id: 'vol', header: 'Voltaram', numeric: true, value: x => x.c.boas + x.c.defeito, cell: x => <>{formatNumber(x.c.boas)}<small>{x.c.defeito ? `${x.c.defeito} defeito` : 'boas'}</small></> },
    { id: 'pend', header: 'Faltam', numeric: true, value: x => x.c.pendentes, cell: x => <b className={x.c.pendentes ? 'valor-neg tnum' : 'tnum'}>{formatNumber(x.c.pendentes)}</b> },
    { id: 'val', header: 'A pagar', numeric: true, value: x => x.c.aPagar, cell: x => formatBRL(x.c.aPagar) },
  ];
  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Peças com as oficinas" value={formatNumber(pend)} hint={`${abertas.length} remessa(s) aberta(s)`} />
        <Stat label="Remessas atrasadas" value={atras} tone={atras ? 'danger' : undefined} />
        <Stat label="A acertar" value={formatBRL(acertar)} hint="peças boas já devolvidas" />
      </div>
      {atras > 0 && <Banner tone="danger">{atras} remessa(s) passaram do prazo. Cobre as oficinas marcadas em vermelho.</Banner>}
      {contestadas > 0 && <Banner tone="danger">{contestadas} remessa(s) com contagem contestada pela oficina. Abra a remessa para ver a diferença por peça.</Banner>}
      <Segmented<Aba> label="Seções" value={aba} onChange={setAba} options={[
        { value: 'oficinas', label: 'Quem está com o quê' }, { value: 'remessas', label: `Remessas (${remessas.length})` }, { value: 'ordens', label: `Ordens de corte (${ordens.length})` },
        { value: 'balanco', label: 'Balanço' }, { value: 'ranking', label: 'Ranking' },
      ]} />
      {aba === 'oficinas' && (
        <Card title="Quem está com o quê" subtitle="Peças que saíram e ainda não voltaram, por oficina ou costureira." flush>
          {painel.length === 0 ? <EmptyState icon="truck" title="Nada com as oficinas">Quando você enviar uma remessa, ela aparece aqui até voltar.</EmptyState> : (
            <div className="list">
              {painel.map(l => (
                <div className="item" key={l.quem}>
                  <div className="item-main"><b>{l.quem}</b><small>{l.remessas} remessa(s){l.telefone ? ` · ${l.telefone}` : ''}{l.atrasadas ? ` · ${l.atrasadas} atrasada(s), até ${l.maiorAtraso} dia(s)` : ''}</small></div>
                  {l.atrasadas > 0 && <Badge tone="danger">Atrasada</Badge>}
                  <span className="tnum" style={{ textAlign: 'right' }}><b>{formatNumber(l.pendentes)}</b> peça(s)<br /><small className="muted">{formatBRL(l.aAcertar)} a acertar</small></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {aba === 'remessas' && (
        <Card title="Remessas" subtitle="Clique para registrar o retorno, acertar ou imprimir o comprovante." flush>
          <DataTable label="Remessas" columns={cols} rows={linhas} rowKey={x => x.r.id} searchable exportName="remessas" initialSort={{ id: 'sit', dir: 1 }}
            empty="Nenhuma remessa ainda. Clique em “Nova remessa”." />
        </Card>
      )}
      {aba === 'balanco' && <BalancoAba ordens={ordens} remessas={remessas} limite={limitePerda} />}
      {aba === 'ranking' && <RankingAba ordens={ordens} remessas={remessas} limite={limitePerda} />}
      {aba === 'ordens' && (
        <Card title="Ordens de corte" subtitle="Rendimento de cada bobina: peças esperadas pela regra do tecido × peças cortadas." flush>
          {ordens.length === 0 ? <EmptyState icon="layers" title="Nenhuma ordem de corte">Registre a bobina que foi para o corte e o que voltou cortado.</EmptyState> : (
            <div className="list">
              {ordens.map(o => {
                const rd = rendimento(o);
                return (
                  <div className="item" key={o.id}>
                    <div className="item-main">
                      <b>#{o.numero} · {o.modelo} {o.cor} · {o.quem}</b>
                      <small>{dataBR(o.data)} · {Object.entries(o.itens).map(([t, q]) => `${t}: ${q}`).join(' · ')}
                        {o.material && o.materialQtd ? ` · ${o.material} ${formatNumber(o.materialQtd)} ${o.unidade}` : ''}{o.remetido ? ` · ${formatNumber(o.remetido)} em remessa` : ''}</small>
                    </div>
                    <span style={{ textAlign: 'right' }}>
                      <b className="tnum">{formatNumber(rd.cortadas)} peça(s)</b><br />
                      {rd.esperadas !== null ? <small className={rd.perdaPct! > 5 ? 'valor-neg' : 'muted'}>esperadas {formatNumber(rd.esperadas)} · {rd.perdaPct! > 0 ? `perda ${formatNumber(rd.perdaPct!)}%` : 'sem perda'}</small>
                        : <small className="muted">{o.material ? 'sem regra de consumo' : 'sem bobina informada'}</small>}
                    </span>
                    {!o.remetido && <Button size="sm" variant="ghost" iconOnly aria-label={`Excluir ordem ${o.numero}`} onClick={async () => {
                      if (await confirm({ title: `Excluir a ordem de corte #${o.numero}?`, message: 'O corte sai da produção e o tecido volta ao estoque.', confirmLabel: 'Excluir', tone: 'danger' })) apagarOrdem.mutate(o.id);
                    }}><Icon name="trash" size={15} /></Button>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- balanço por ordem de corte
const pctTxt = (n: number | null) => (n === null ? '—' : `${formatNumber(n)}%`);
function BalancoAba({ ordens, remessas, limite }: { ordens: OrdemCorte[]; remessas: Remessa[]; limite: number }) {
  const api = useApi();
  const [lim, setLim] = useState(String(limite).replace('.', ','));
  const salvarLim = useAction((n: number) => api.salvarLimitePerda(n), { success: 'Limite salvo. Os avisos de perda usam o novo valor.', invalidate: [KEY] });
  const lista = useMemo(() => ordens.map(o => ({ o, b: balancoOrdem(o, remessas, limite) })), [ordens, remessas, limite]);
  const sumiram = lista.reduce((s, x) => s + x.b.total.sumiram, 0), enviadas = lista.reduce((s, x) => s + x.b.total.enviadas, 0);
  const comCorte = lista.filter(x => x.b.perdaCortePct !== null);
  const perdaMedia = comCorte.length ? Math.round((comCorte.reduce((s, x) => s + x.b.perdaCortePct!, 0) / comCorte.length) * 10) / 10 : null;
  const comAlerta = lista.filter(x => x.b.acimaDoLimite).length;
  const nLim = parseValor(lim);
  return (
    <div className="stack">
      <div className="grid-kpi">
        <Stat label="Peças sumidas nas oficinas" value={formatNumber(sumiram)} hint={enviadas ? `${pctTxt(Math.round((sumiram / enviadas) * 1000) / 10)} do que foi enviado` : 'nada enviado no período'} tone={sumiram ? 'danger' : undefined} />
        <Stat label="Perda média no corte" value={pctTxt(perdaMedia)} hint={comCorte.length ? `${comCorte.length} ordem(ns) com bobina informada` : 'informe a bobina na ordem de corte'} />
        <Stat label="Ordens com alerta" value={comAlerta} tone={comAlerta ? 'danger' : undefined} hint={`acima de ${pctTxt(limite)} ou com contestação`} />
      </div>
      <Card title="Limite de perda" subtitle="Acima deste percentual a ordem fica vermelha e quem cuida das remessas recebe aviso na hora (corte que rendeu menos e remessa fechada com peças faltando).">
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <TextField label="Avisar acima de (%)" inputMode="decimal" value={lim} onChange={e => setLim(e.target.value.replace(/[^0-9,.]/g, '').slice(0, 6))} style={{ maxWidth: 140 }} />
          <Button loading={salvarLim.isPending} disabled={nLim === null || nLim < 0 || nLim > 100 || nLim === limite} onClick={() => nLim !== null && salvarLim.mutate(nLim)}>Salvar</Button>
        </div>
      </Card>
      <Card title="Balanço por ordem de corte" subtitle="Do tecido à peça devolvida: quanto foi cortado, enviado, voltou, está com a oficina e sumiu, por tamanho." flush>
        {lista.length === 0 ? <EmptyState icon="layers" title="Nenhuma ordem de corte no período">O balanço aparece quando há ordem de corte e remessas feitas a partir dela.</EmptyState> : (
          <div className="list">
            {lista.map(({ o, b }) => (
              <details key={o.id} className={`balanco${b.acimaDoLimite ? ' balanco-alerta' : ''}`}>
                <summary>
                  <span className="item-main">
                    <b>#{o.numero} · {o.modelo} {o.cor} · {o.quem}</b>
                    <small>{dataBR(o.data)} · cortadas {formatNumber(b.total.cortadas)} → enviadas {formatNumber(b.total.enviadas)} → voltaram {formatNumber(b.total.boas + b.total.defeito)}
                      {b.total.comOficina ? ` · ${formatNumber(b.total.comOficina)} com a oficina` : ''}{b.total.naFabrica ? ` · ${formatNumber(b.total.naFabrica)} na fábrica` : ''}</small>
                  </span>
                  <span className="balanco-selos">
                    {b.total.sumiram > 0 && <Badge tone="danger">{formatNumber(b.total.sumiram)} sumiram</Badge>}
                    {b.contestacoes > 0 && <Badge tone="danger">Contestada</Badge>}
                    {b.perdaCortePct !== null && b.perdaCortePct > limite && <Badge tone="warn">Corte {pctTxt(b.perdaCortePct)}</Badge>}
                    {!b.acimaDoLimite && <Badge tone="ok">Dentro do limite</Badge>}
                  </span>
                </summary>
                <div className="balanco-corpo">
                  {b.alertas.length > 0 && <Banner tone="danger"><ul style={{ margin: 0, paddingLeft: 18 }}>{b.alertas.map(a => <li key={a}>{a}</li>)}</ul></Banner>}
                  <p className="muted" style={{ margin: 0 }}>
                    Tecido: {b.esperadas !== null ? `${formatNumber(o.materialQtd ?? 0)} ${o.unidade ?? ''} dava ${formatNumber(b.esperadas)} peças, saíram ${formatNumber(b.total.cortadas)} (perda ${pctTxt(b.perdaCortePct)})` : o.material ? 'sem regra de consumo para este modelo' : 'bobina não informada'}
                    {' · '}{b.remessas} remessa(s) · defeito {pctTxt(b.defeitoPct)}
                  </p>
                  <div className="table-wrap">
                    <table className="table" aria-label={`Balanço da ordem ${o.numero}`}>
                      <thead><tr><th>Tamanho</th><th className="num">Cortadas</th><th className="num">Enviadas</th><th className="num">Na fábrica</th><th className="num">Boas</th><th className="num">Defeito</th><th className="num">Com a oficina</th><th className="num">Sumiram</th>{b.total.excedente > 0 && <th className="num">Enviou a mais</th>}</tr></thead>
                      <tbody>{b.linhas.map(l => (
                        <tr key={l.tamanho}><td><b>{l.tamanho}</b></td><td className="num tnum">{l.cortadas}</td><td className="num tnum">{l.enviadas}</td><td className="num tnum">{l.naFabrica}</td>
                          <td className="num tnum valor-pos">{l.boas}</td><td className="num tnum">{l.defeito}</td><td className="num tnum">{l.comOficina}</td>
                          <td className={`num tnum${l.sumiram ? ' valor-neg' : ''}`}>{l.sumiram}</td>{b.total.excedente > 0 && <td className={`num tnum${l.excedente ? ' valor-neg' : ''}`}>{l.excedente}</td>}</tr>))}</tbody>
                      <tfoot><tr><td>Total</td><td className="num tnum">{b.total.cortadas}</td><td className="num tnum">{b.total.enviadas}</td><td className="num tnum">{b.total.naFabrica}</td>
                        <td className="num tnum">{b.total.boas}</td><td className="num tnum">{b.total.defeito}</td><td className="num tnum">{b.total.comOficina}</td><td className="num tnum">{b.total.sumiram}</td>{b.total.excedente > 0 && <td className="num tnum">{b.total.excedente}</td>}</tr></tfoot>
                    </table>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- ranking de oficinas e cortadores
const pct1 = (n: number | null) => (n === null ? '—' : `${formatNumber(n)}%`);
function RankingAba({ ordens, remessas, limite }: { ordens: OrdemCorte[]; remessas: Remessa[]; limite: number }) {
  const of = useMemo(() => rankingOficinas(remessas, hoje(), limite), [remessas, limite]);
  const co = useMemo(() => rankingCortadores(ordens, limite), [ordens, limite]);
  return (
    <div className="stack">
      <Card title="Oficinas e costureiras" subtitle={`Últimos 120 dias. Melhor primeiro: menos peças faltando, menos defeito e menos atraso. Atenção acima de ${pct1(limite)} (limite do Balanço).`} flush>
        {of.length === 0 ? <EmptyState icon="truck" title="Nenhuma remessa no período">O ranking aparece quando houver remessas.</EmptyState> : (
          <div className="table-wrap">
            <table className="table" aria-label="Ranking de oficinas">
              <thead><tr><th>#</th><th>Oficina</th><th className="num">Remessas</th><th className="num">Enviadas</th><th className="num">Falta</th><th className="num">Defeito</th>
                <th className="num">Atraso médio</th><th className="num">Custo por peça boa</th><th>Situação</th></tr></thead>
              <tbody>{of.map((l, i) => (
                <tr key={l.quem}>
                  <td className="tnum">{l.acertadas ? i + 1 : '—'}</td>
                  <td><b>{l.quem}</b>{l.comOficina > 0 && <small className="muted" style={{ display: 'block' }}>{formatNumber(l.comOficina)} peça(s) com ela agora</small>}</td>
                  <td className="num tnum">{l.remessas}<small className="muted" style={{ display: 'block' }}>{l.acertadas} acertada(s)</small></td>
                  <td className="num tnum">{formatNumber(l.enviadas)}</td>
                  <td className={`num tnum${l.faltaPct !== null && l.faltaPct > limite ? ' valor-neg' : ''}`}>{pct1(l.faltaPct)}{l.falta > 0 && <small className="muted" style={{ display: 'block' }}>{formatNumber(l.falta)} peça(s)</small>}</td>
                  <td className={`num tnum${l.defeitoPct !== null && l.defeitoPct > limite ? ' valor-neg' : ''}`}>{pct1(l.defeitoPct)}</td>
                  <td className="num tnum">{l.atrasoMedio === null ? '—' : `${formatNumber(l.atrasoMedio)} dia(s)`}</td>
                  <td className="num tnum">{l.custoPecaBoa === null ? '—' : formatBRL(l.custoPecaBoa)}</td>
                  <td>{l.acertadas === 0 ? <Badge>Sem acerto ainda</Badge> : l.atencao.length ? <><Badge tone="danger">Atenção</Badge><small className="muted" style={{ display: 'block' }}>{l.atencao.join(' · ')}</small></>
                    : <>{i === 0 ? <Badge tone="ok">Melhor</Badge> : <Badge tone="ok">Boa</Badge>}{l.contestacoes > 0 && <small className="muted" style={{ display: 'block' }}>{l.contestacoes} contestação(ões) resolvida(s)</small>}</>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Cortadores" subtitle="Perda no corte: peças que o tecido dava pela regra de consumo × peças cortadas (só ordens com a bobina informada)." flush>
        {co.length === 0 ? <EmptyState icon="layers" title="Nenhuma ordem de corte no período">Registre as ordens de corte com a bobina usada.</EmptyState> : (
          <div className="table-wrap">
            <table className="table" aria-label="Ranking de cortadores">
              <thead><tr><th>#</th><th>Quem cortou</th><th className="num">Ordens</th><th className="num">Peças cortadas</th><th className="num">O tecido dava</th><th className="num">Perda</th><th>Situação</th></tr></thead>
              <tbody>{co.map((l, i) => (
                <tr key={l.quem}>
                  <td className="tnum">{l.perdaPct === null ? '—' : i + 1}</td>
                  <td><b>{l.quem}</b>{l.semBobina > 0 && <small className="muted" style={{ display: 'block' }}>{l.semBobina} ordem(ns) sem bobina</small>}</td>
                  <td className="num tnum">{l.ordens}</td><td className="num tnum">{formatNumber(l.cortadas)}</td>
                  <td className="num tnum">{l.esperadas ? formatNumber(l.esperadas) : '—'}</td>
                  <td className={`num tnum${l.atencao ? ' valor-neg' : ''}`}>{pct1(l.perdaPct)}</td>
                  <td>{l.perdaPct === null ? <Badge>Sem bobina</Badge> : l.atencao ? <Badge tone="danger">Atenção</Badge> : <Badge tone="ok">{i === 0 ? 'Melhor' : 'Boa'}</Badge>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
