import { useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Boot, DreDados, FinDados, Relatorio } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { pode } from '../../app/registry';
import { formatBRL, formatNumber, isoDay, nomeDoMes, somarMes } from '../../lib/format';
import { Button } from '../../ui/Button';
import { BarrasComparadas, BarrasHorizontais, Donut, OUTROS, SERIES, Variacao, pct, type Fatia } from '../../ui/charts';
import { Icon, type IconName } from '../../ui/Icon';
import { Card, PageHeader, Skeleton, Stat } from '../../ui/primitives';
import { calcularDre } from '../dre/calc';
import { fluxoMes, gastosPorCategoria } from '../financeiro/calc';
import { FIN_KEY, MesPicker } from '../financeiro/shared';

/** "1:30" -> 90 minutos. */
const hm = (s: string) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fmtHoras = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const abrev = (mes: string) => nomeDoMes(mes).slice(0, 3) + '/' + mes.slice(2, 4);

function faixaDoMes(mes: string): { ini: string; fim: string } {
  const [y, m] = mes.split('-').map(Number);
  const ultimo = isoDay(new Date(y!, m!, 0));
  const hoje = isoDay(new Date());
  return { ini: `${mes}-01`, fim: ultimo > hoje && mes === hoje.slice(0, 7) ? hoje : ultimo };
}

/** Top N + "Outros" (cores na ordem fixa; "Outros" sempre cinza). */
function topFatias(pares: [string, number][], n = 3): Fatia[] {
  const ord = [...pares].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = ord.slice(0, n).map(([label, value], i) => ({ label, value, color: SERIES[i]! }));
  const resto = ord.slice(n).reduce((s, [, v]) => s + v, 0);
  return resto > 0 ? [...top, { label: 'Outros', value: resto, color: OUTROS }] : top;
}

interface Destaque { tom: 'ok' | 'warn' | 'info'; icone: IconName; titulo: string; texto: string }

function montar(boot: Boot, mes: string, rel: Relatorio, ant: Relatorio[], fin?: FinDados, dre?: DreDados) {
  const etapas = boot.etapas.length ? boot.etapas : Object.keys(rel.porEtapa);
  const ultima = etapas[etapas.length - 1] ?? '', primeira = etapas[0] ?? '';
  const prod = (r: Relatorio, e: string) => r.porEtapa[e] ?? 0;
  const concluidas = prod(rel, ultima), cortadas = prod(rel, primeira);
  const mediaConcl = media(ant.map(r => prod(r, ultima)));
  const porDia = rel.diasUteis ? concluidas / rel.diasUteis : 0;

  const faltas = rel.pessoas.reduce((s, p) => s + p.faltas.length, 0);
  const extrasMin = rel.pessoas.reduce((s, p) => s + hm(p.extras), 0);
  const horasMin = rel.pessoas.reduce((s, p) => s + hm(p.horas), 0);
  const semSaida = rel.pessoas.reduce((s, p) => s + p.semSaida, 0);
  const presencaPossivel = rel.pessoas.length * rel.diasUteis;
  const presenca = presencaPossivel ? (rel.pessoas.reduce((s, p) => s + p.diasTrab, 0) / presencaPossivel) * 100 : NaN;

  const porModelo = new Map<string, number>();
  for (const l of rel.porModelo) porModelo.set(l.modelo, (porModelo.get(l.modelo) ?? 0) + (l.valores[ultima] ?? 0));
  const modelos = topFatias([...porModelo.entries()]);

  const pessoas = [...rel.porPessoa].sort((a, b) => b.qtd - a.qtd).slice(0, 8).map(p => ({ label: p.nome, value: p.qtd, detalhe: p.etapa }));
  const faltosos = [...rel.pessoas].filter(p => p.faltas.length).sort((a, b) => b.faltas.length - a.faltas.length).slice(0, 6)
    .map(p => ({ label: p.nome, value: p.faltas.length }));

  const emFalta = boot.emFalta.length, pecasFalta = boot.emFalta.reduce((s, f) => s + f.falta, 0);
  const editados = rel.editados.length;

  const flux = fin ? fluxoMes(fin, mes) : null;
  const fluxAnt = fin ? [1, 2, 3].map(i => fluxoMes(fin, somarMes(mes, -i))) : [];
  const gastos = fin ? topFatias(gastosPorCategoria(fin, mes)) : [];
  const dreMes = dre?.meses.find(m => m.mes === mes);
  const resultado = dre && dreMes ? calcularDre(dre.categorias.filter(c => c.ativa), dreMes.valores) : null;

  // ---------- destaques do mês (regras simples e explicáveis) ----------
  const d: Destaque[] = [];
  if (mediaConcl) {
    const v = ((concluidas - mediaConcl) / mediaConcl) * 100;
    d.push({ tom: v >= 0 ? 'ok' : 'warn', icone: v >= 0 ? 'trend' : 'arrowDown', titulo: `${ultima}: ${formatNumber(concluidas)} peças`,
      texto: `${v >= 0 ? 'Alta' : 'Queda'} de ${Math.abs(Math.round(v * 10) / 10).toLocaleString('pt-BR')}% sobre a média dos 3 meses anteriores (${formatNumber(Math.round(mediaConcl))}/mês).` });
  } else if (concluidas) {
    d.push({ tom: 'info', icone: 'trend', titulo: `${ultima}: ${formatNumber(concluidas)} peças`, texto: `Média de ${formatNumber(Math.round(porDia))} por dia útil.` });
  }
  const gargalo = etapas.slice(1).map((e, i) => ({ e, antes: etapas[i]!, dif: prod(rel, etapas[i]!) - prod(rel, e) })).sort((a, b) => b.dif - a.dif)[0];
  if (gargalo && gargalo.dif > 0) d.push({ tom: 'warn', icone: 'alert', titulo: `Acúmulo entre ${gargalo.antes} e ${gargalo.e}`, texto: `${formatNumber(gargalo.dif)} peças passaram por ${gargalo.antes.toLowerCase()} e ainda não por ${gargalo.e.toLowerCase()} no mês.` });
  if (faltas) d.push({ tom: 'warn', icone: 'alert', titulo: `Faltas: ${faltas}`, texto: `${faltosos[0] ? `${faltosos[0].label} soma ${faltosos[0].value}.` : ''} Presença média de ${Number.isFinite(presenca) ? Math.round(presenca) : '—'}%.` });
  else if (rel.pessoas.length) d.push({ tom: 'ok', icone: 'check', titulo: 'Sem faltas no mês', texto: `${rel.pessoas.length} pessoas com presença completa nos dias úteis.` });
  if (extrasMin) d.push({ tom: 'info', icone: 'clock', titulo: `Horas extras: ${fmtHoras(extrasMin)}`, texto: `${pct(extrasMin, horasMin)} das horas trabalhadas.` });
  if (emFalta) d.push({ tom: 'warn', icone: 'alert', titulo: `Em falta no estoque: ${emFalta} item(ns)`, texto: `${formatNumber(pecasFalta)} peças ainda a produzir (situação de agora).` });
  if (editados) d.push({ tom: 'warn', icone: 'edit', titulo: `Lançamentos editados: ${editados}`, texto: 'Confira no Relatório quem alterou e por quê.' });
  if (semSaida) d.push({ tom: 'warn', icone: 'clock', titulo: `Saída não marcada: ${semSaida}x`, texto: 'O sistema fechou o ponto automaticamente nesses dias.' });
  if (resultado && Number.isFinite(resultado.margemOperacional)) d.push({ tom: resultado.final >= 0 ? 'ok' : 'warn', icone: 'wallet', titulo: `Resultado: ${formatBRL(resultado.final)}`, texto: `Margem operacional de ${Math.round(resultado.margemOperacional * 10) / 10}%.` });
  else if (flux && (flux.entradas || flux.saidas)) d.push({ tom: flux.entradas >= flux.saidas ? 'ok' : 'warn', icone: 'wallet', titulo: `Caixa do mês: ${formatBRL(flux.entradas - flux.saidas)}`, texto: `Entraram ${formatBRL(flux.entradas)} e saíram ${formatBRL(flux.saidas)}.` });

  // ---------- síntese gerencial ----------
  const partes: string[] = [];
  if (concluidas) partes.push(`${nomeDoMes(mes)} fechou com ${formatNumber(concluidas)} peças em ${ultima.toLowerCase()}${mediaConcl ? ` (${concluidas >= mediaConcl ? 'acima' : 'abaixo'} da média dos 3 meses anteriores)` : ''}, média de ${formatNumber(Math.round(porDia))} por dia útil.`);
  else partes.push(`Ainda não há produção lançada em ${nomeDoMes(mes).toLowerCase()}.`);
  const prioridades = [
    gargalo && gargalo.dif > 0 && `destravar ${gargalo.e.toLowerCase()}`,
    faltas > 0 && 'reduzir faltas',
    emFalta > 0 && `repor ${emFalta} item(ns) em falta`,
    editados > 0 && 'revisar lançamentos editados',
    resultado && resultado.final < 0 && 'recuperar o resultado do mês',
  ].filter(Boolean) as string[];
  partes.push(prioridades.length ? `Prioridades: ${prioridades.join(', ')}.` : 'Sem pontos de atenção relevantes.');

  return {
    etapas, ultima, primeira, concluidas, cortadas, mediaConcl, porDia, faltas, extrasMin, presenca, modelos, pessoas, faltosos,
    emFalta, pecasFalta, editados, flux, fluxAnt, gastos, resultado, destaques: d.slice(0, 6), sintese: partes.join(' '),
  };
}

function Destaques({ itens }: { itens: Destaque[] }) {
  return (
    <ul className="dash-destaques">
      {itens.map((d, i) => (
        <li key={i}><span className={`ic ${d.tom}`}><Icon name={d.icone} size={15} /></span><div><b>{d.titulo}</b><small>{d.texto}</small></div></li>
      ))}
    </ul>
  );
}

const Carregando = () => (
  <div className="stack"><div className="dash-hero">{[1, 2, 3, 4].map(i => <Skeleton key={i} height={110} />)}</div><Skeleton height={320} /></div>
);

export default function DashboardPage() {
  const api = useApi();
  const boot = useBoot();
  const [mes, setMes] = useState(() => isoDay(new Date()).slice(0, 7));
  const meses = [0, 1, 2, 3].map(i => somarMes(mes, -i));
  const rels = useQueries({
    queries: meses.map(m => { const f = faixaDoMes(m); return { queryKey: ['relatorio', f.ini, f.fim], queryFn: () => api.relatorio(f.ini, f.fim), staleTime: 60_000 }; }),
  });
  const fin = useQuery({ queryKey: FIN_KEY, queryFn: () => api.finDados(), enabled: pode(boot.eu, 'financeiro') });
  const dre = useQuery({ queryKey: ['dre'], queryFn: () => api.dreDados(), enabled: pode(boot.eu, 'resultado') });

  const erro = rels.find(r => r.error)?.error;
  const pronto = rels.every(r => r.data);
  const x = pronto ? montar(boot, mes, rels[0]!.data!, rels.slice(1).map(r => r.data!), fin.data, dre.data) : null;
  const anteriores = meses.slice(1).map(abrev).reverse().join(', ');

  let corpo: ReactNode;
  if (erro) corpo = <Card><p className="err" role="alert">Não foi possível carregar: {erro instanceof Error ? erro.message : 'erro'}. <Button size="sm" onClick={() => rels.forEach(r => void r.refetch())}>Tentar de novo</Button></p></Card>;
  else if (!x) corpo = <Carregando />;
  else {
    const relAnt = rels.slice(1).map(r => r.data!);
    corpo = (
      <div className="stack">
        <div className="dash-hero">
          <Stat label={`Peças · ${x.ultima}`} value={formatNumber(x.concluidas)} hint={`Média por dia útil: ${formatNumber(Math.round(x.porDia))}`} />
          <Stat label={`Peças · ${x.primeira}`} value={formatNumber(x.cortadas)} hint={<Variacao atual={x.cortadas} base={media(relAnt.map(r => r.porEtapa[x.primeira] ?? 0))} />} />
          <Stat label="Presença média" value={Number.isFinite(x.presenca) ? `${Math.round(x.presenca)}%` : '—'} hint={`${x.faltas} falta(s) no mês`} tone={x.faltas ? undefined : 'ok'} />
          <Stat label="Horas extras" value={fmtHoras(x.extrasMin)} hint="somadas no mês" />
          <Stat label="Em falta (agora)" value={x.emFalta} hint={`${formatNumber(x.pecasFalta)} peças a produzir`} tone={x.emFalta ? 'danger' : 'ok'} />
        </div>

        <div className="dash-grid">
          <Card title="Produção por etapa" subtitle={`${nomeDoMes(mes)} × média de ${anteriores}`}
            actions={<Variacao atual={x.concluidas} base={x.mediaConcl} />}>
            <BarrasComparadas titulo="Produção por etapa: mês × média dos 3 meses anteriores"
              series={[{ label: 'Média 3 meses', color: 'var(--viz-base-cmp)' }, { label: abrev(mes), color: 'var(--viz-1)' }]}
              grupos={x.etapas.map(e => ({ label: e, valores: [Math.round(media(relAnt.map(r => r.porEtapa[e] ?? 0))), rels[0]!.data!.porEtapa[e] ?? 0] }))} />
          </Card>
          <Card title={`Peças por modelo · ${x.ultima}`} subtitle="Os 3 modelos que mais saíram e o restante">
            {x.modelos.length ? <Donut titulo="Peças por modelo" fatias={x.modelos} centro={formatNumber(x.concluidas)} sub="peças" />
              : <p className="table-empty" style={{ padding: 24 }}>Sem produção no mês.</p>}
          </Card>
          <Card title="Destaques do mês" subtitle="Gerados a partir dos números do mês" flush>
            {x.destaques.length ? <Destaques itens={x.destaques} /> : <p className="table-empty" style={{ padding: 24 }}>Nada a destacar ainda.</p>}
          </Card>
        </div>

        <div className="dash-grid">
          <Card title={`Tendência · ${x.ultima}`} subtitle="Peças concluídas nos últimos 4 meses">
            <BarrasComparadas titulo="Peças concluídas por mês" series={[{ label: `Peças · ${x.ultima}`, color: 'var(--viz-1)' }]}
              grupos={[...meses].reverse().map((m, i) => ({ label: abrev(m), valores: [rels[3 - i]!.data!.porEtapa[x.ultima] ?? 0] }))} altura={200} />
          </Card>
          <Card title="Quem mais produziu" subtitle="Peças lançadas no mês, por pessoa">
            <BarrasHorizontais titulo="Peças por pessoa" itens={x.pessoas} />
          </Card>
          <Card title="Faltas por pessoa" subtitle="Dias úteis sem ponto (feriados cadastrados não contam)">
            {x.faltosos.length ? <BarrasHorizontais titulo="Faltas por pessoa" itens={x.faltosos} cor="var(--viz-2)" formato={n => `${n} dia(s)`} />
              : <p className="table-empty" style={{ padding: 24 }}>Nenhuma falta no mês.</p>}
          </Card>
        </div>

        {boot.eu.financeiro && x.flux && (
          <div className="dash-grid">
            <Card title="Entradas × saídas" subtitle={`${nomeDoMes(mes)} × média de ${anteriores}`}
              actions={<Variacao atual={x.flux.saidas} base={media(x.fluxAnt.map(f => f.saidas))} inverso />}>
              <BarrasComparadas titulo="Entradas e saídas: mês × média dos 3 meses anteriores" formato={n => formatBRL(n).replace(',00', '')}
                series={[{ label: 'Média 3 meses', color: 'var(--viz-base-cmp)' }, { label: abrev(mes), color: 'var(--viz-1)' }]}
                grupos={[
                  { label: 'Entradas', valores: [media(x.fluxAnt.map(f => f.entradas)), x.flux.entradas] },
                  { label: 'Saídas', valores: [media(x.fluxAnt.map(f => f.saidas)), x.flux.saidas] },
                ]} />
            </Card>
            <Card title="Para onde foi o dinheiro" subtitle="Saídas do mês por categoria">
              {x.gastos.length ? <Donut titulo="Saídas por categoria" fatias={x.gastos} centro={formatBRL(x.flux.saidas).replace(/,\d\d$/, '')} sub="saídas" />
                : <p className="table-empty" style={{ padding: 24 }}>Nenhuma saída lançada.</p>}
            </Card>
            <Card title="Resultado do mês" subtitle="Do módulo Resultado (DRE)">
              {x.resultado ? (
                <div className="grid-kpi" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Stat label="Receita líquida" value={formatBRL(x.resultado.liquida)} />
                  <Stat label="Resultado final" value={formatBRL(x.resultado.final)} tone={x.resultado.final < 0 ? 'danger' : 'ok'} />
                  <Stat label="Margem bruta" value={Number.isFinite(x.resultado.margemBruta) ? `${Math.round(x.resultado.margemBruta)}%` : '—'} />
                  <Stat label="Margem operacional" value={Number.isFinite(x.resultado.margemOperacional) ? `${Math.round(x.resultado.margemOperacional)}%` : '—'} />
                </div>
              ) : <p className="table-empty" style={{ padding: 24 }}>Mês ainda não preenchido em Resultado.</p>}
            </Card>
          </div>
        )}

        <div className="dash-sintese">
          <Icon name="report" size={22} />
          <div><h3>Síntese gerencial</h3><p>{x.sintese}</p></div>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard mensal" subtitle={`${boot.empresa.nome || 'Fábrica'} · produção, equipe e financeiro do mês`}
        actions={<>
          <MesPicker mes={mes} onChange={setMes} />
          <Button icon={<Icon name="printer" size={16} />} onClick={() => window.print()} className="no-print">Imprimir</Button>
        </>} />
      {corpo}
    </>
  );
}
