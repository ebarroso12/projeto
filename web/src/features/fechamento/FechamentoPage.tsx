import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { pode } from '../../app/registry';
import { dataBR, formatBRL, formatNumber, nomeDoMes } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { PageHeader } from '../../ui/primitives';
import { calcularDre } from '../dre/calc';
import { compromissos, fluxoMes, gastosPorCategoria, porContraparte, recebimentos, saldoTotal } from '../financeiro/calc';
import { MesPicker, nomeCartao } from '../financeiro/shared';
import { cobertura } from '../materiais/calc';
import { andamento } from '../pedidos/calc';
import { indicadores, totaisLucro } from '../produtividade/calc';
import { resumoTexto, type DadosResumo } from './resumo';

const fimDoMes = (mes: string) => { const [y, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(y!, m!, 0).getDate()).padStart(2, '0')}`; };

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <section className="rm-secao"><h2>{titulo}</h2>{children}</section>;
}
function Numeros({ itens }: { itens: [string, ReactNode][] }) {
  return <div className="rm-numeros">{itens.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>;
}
function Tabela({ cab, linhas, num = [] }: { cab: string[]; linhas: ReactNode[][]; num?: number[] }) {
  if (!linhas.length) return <p className="muted">Nada no período.</p>;
  return (
    <table className="rm-tabela">
      <thead><tr>{cab.map((c, i) => <th key={c} className={num.includes(i) ? 'num' : undefined}>{c}</th>)}</tr></thead>
      <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j} className={num.includes(j) ? 'num' : undefined}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** Relatório do mês: uma página pronta para imprimir / salvar em PDF e mandar ao contador ou sócio. */
export default function FechamentoPage() {
  const api = useApi();
  const boot = useBoot();
  const { eu } = boot;
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const ini = `${mes}-01`, fim = fimDoMes(mes);
  const vRel = pode(eu, 'relatorio'), vFin = pode(eu, 'financeiro'), vDre = pode(eu, 'resultado'), vPed = pode(eu, 'pedidos'), vProd = pode(eu, 'produtividade'), vMat = pode(eu, 'materiais');
  const rel = useQuery({ queryKey: ['relatorio', ini, fim], queryFn: () => api.relatorio(ini, fim), enabled: vRel });
  const fin = useQuery({ queryKey: ['financeiro'], queryFn: () => api.finDados(), enabled: vFin });
  const dre = useQuery({ queryKey: ['dre'], queryFn: () => api.dreDados(), enabled: vDre });
  const lucro = useQuery({ queryKey: ['lucro-modelos', mes], queryFn: () => api.dreLucroModelos(ini, fim), enabled: vDre });
  const ped = useQuery({ queryKey: ['pedidos'], queryFn: () => api.pedidos(400), enabled: vPed });
  const prod = useQuery({ queryKey: ['produtividade', ini, fim], queryFn: () => api.produtividade(ini, fim), enabled: vProd });
  const mat = useQuery({ queryKey: ['materiais'], queryFn: () => api.materiais(), enabled: vMat });
  const carregando = [rel, fin, dre, lucro, ped, prod, mat].some(q => q.isLoading);
  const erro = [rel, fin, dre, lucro, ped, prod, mat].find(q => q.isError);

  // ---------------- números do mês
  const fl = fin.data ? fluxoMes(fin.data, mes) : null;
  const rec = fin.data ? recebimentos(fin.data) : [];
  const pag = fin.data ? compromissos(fin.data, id => nomeCartao(fin.data!, id)) : [];
  const aReceber = rec.reduce((s, p) => s + p.valor, 0), aPagar = pag.reduce((s, c) => s + c.valor, 0);
  const mesDre = dre.data?.meses.find(m => m.mes === mes);
  const resDre = dre.data && mesDre ? calcularDre(dre.data.categorias, mesDre.valores) : null;
  const tl = lucro.data ? totaisLucro(lucro.data) : null;
  const hoje = new Date().toISOString().slice(0, 10);
  const entregues = (ped.data ?? []).filter(p => p.status === 'entregue' && p.entregueEm && p.entregueEm >= ini && p.entregueEm <= fim);
  const atrasados = (ped.data ?? []).filter(p => p.status === 'aberto' && andamento(p, hoje, boot.etapas).situacao === 'atrasado');
  const comprar = (mat.data ?? []).filter(m => m.ativo && ['zerado', 'abaixo'].includes(cobertura(m).situacao)).map(m => m.nome);
  const pecas = rel.data ? Object.values(rel.data.porEtapa).reduce((s, q) => s + q, 0) : undefined;

  const dadosResumo: DadosResumo = {
    empresa: boot.empresa.nome || 'Fábrica', mes: nomeDoMes(mes),
    ...(rel.data ? { pecas: rel.data.porEtapa[boot.etapas[boot.etapas.length - 1] ?? 'Conferência'] ?? pecas, porEtapa: rel.data.porEtapa } : {}),
    ...(fl ? { entradas: fl.entradas, saidas: fl.saidas, aReceber, aPagar } : {}),
    ...(vDre ? { resultado: mesDre ? resDre?.final ?? null : null, lucroModelos: tl?.lucro ?? null } : {}),
    ...(ped.data ? { pedidosEntregues: entregues.length, pedidosAtrasados: atrasados.length } : {}),
    ...(mat.data ? { comprar } : {}),
  };
  const enviar = async () => {
    const texto = resumoTexto(dadosResumo);
    if (navigator.share) { try { await navigator.share({ title: `Resumo de ${nomeDoMes(mes)}`, text: texto }); return; } catch { /* cancelou */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };

  return (
    <>
      <PageHeader title="Relatório do mês" subtitle="Produção, pedidos, financeiro e resultado em uma página: salve em PDF ou envie o resumo"
        actions={<>
          <MesPicker mes={mes} onChange={setMes} />
          <Button icon={<Icon name="send" size={16} />} onClick={() => void enviar()} disabled={carregando}>Enviar resumo</Button>
          <Button variant="primary" icon={<Icon name="printer" size={16} />} onClick={() => window.print()} disabled={carregando}>Salvar em PDF</Button>
        </>} />
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>Parte dos dados não carregou. Tente “Atualizar”.</p>}
      <article className="rm" aria-busy={carregando}>
        <header className="rm-cab">
          <img src="marca/logo-horizontal.webp" alt="Fábrica" height={40} />
          <div><h1>{boot.empresa.nome}</h1><p>Relatório de {nomeDoMes(mes)} · emitido em {dataBR(hoje)} pelo app Fábrica</p></div>
        </header>
        {carregando && <p className="muted no-print">Carregando…</p>}

        {rel.data && (
          <Secao titulo="Produção">
            <Numeros itens={[...boot.etapas.map(e => [e, formatNumber(rel.data!.porEtapa[e] ?? 0)] as [string, ReactNode]), ['Dias úteis', rel.data.diasUteis]]} />
            <Tabela cab={['Modelo', 'Cor', 'Tamanho', ...boot.etapas]} num={boot.etapas.map((_, i) => i + 3)}
              linhas={rel.data.porModelo.slice(0, 25).map(l => [l.modelo, l.cor, l.tamanho, ...boot.etapas.map(e => formatNumber(l.valores[e] ?? 0))])} />
            {rel.data.porModelo.length > 25 && <p className="muted">+ {rel.data.porModelo.length - 25} combinação(ões) no Relatório.</p>}
          </Secao>
        )}

        {ped.data && (
          <Secao titulo="Pedidos">
            <Numeros itens={[['Entregues no mês', entregues.length], ['Valor entregue', formatBRL(entregues.reduce((s, p) => s + andamento(p, hoje).valor, 0))],
              ['Em aberto', (ped.data ?? []).filter(p => p.status === 'aberto').length], ['Atrasados', atrasados.length]]} />
            <Tabela cab={['Pedido', 'Cliente', 'Entregue em', 'Peças', 'Valor']} num={[3, 4]}
              linhas={entregues.map(p => { const a = andamento(p, hoje); return [`#${p.numero}`, p.cliente, dataBR(p.entregueEm), formatNumber(a.total), formatBRL(a.valor)]; })} />
          </Secao>
        )}

        {fin.data && fl && (
          <Secao titulo="Financeiro">
            <Numeros itens={[['Entradas', formatBRL(fl.entradas)], ['Saídas', formatBRL(fl.saidas)], ['Saldo do mês', formatBRL(fl.entradas - fl.saidas)],
              ['Saldo em contas hoje', formatBRL(saldoTotal(fin.data))], ['A receber (total)', formatBRL(aReceber)], ['A pagar (total)', formatBRL(aPagar)]]} />
            <div className="rm-duas">
              <div><h3>Saídas por categoria</h3><Tabela cab={['Categoria', 'Valor']} num={[1]} linhas={gastosPorCategoria(fin.data, mes).map(([c, v]) => [c, formatBRL(v)])} /></div>
              <div><h3>Entradas por cliente</h3><Tabela cab={['Cliente', 'Valor']} num={[1]} linhas={porContraparte(fin.data, mes, 'entrada').map(([c, v]) => [c, formatBRL(v)])} /></div>
            </div>
          </Secao>
        )}

        {vDre && (
          <Secao titulo="Resultado (DRE)">
            {resDre ? <Numeros itens={[['Receita líquida', formatBRL(resDre.liquida)], ['Lucro bruto', formatBRL(resDre.lucroBruto)], ['Resultado operacional', formatBRL(resDre.operacional)],
              ['Resultado final', formatBRL(resDre.final)], ['Margem operacional', Number.isFinite(resDre.margemOperacional) ? `${formatNumber(Math.round(resDre.margemOperacional * 10) / 10)}%` : '—']]} />
              : <p className="muted">O mês ainda não foi preenchido em Resultado → Preencher mês.</p>}
            {tl && tl.pecas > 0 && <>
              <h3>Lucro estimado por modelo (peças prontas)</h3>
              <Numeros itens={[['Receita', formatBRL(tl.receita)], ['Material', formatBRL(tl.custoMaterial)], ['Mão de obra', formatBRL(tl.maoDeObra)], ['Lucro', formatBRL(tl.lucro)]]} />
            </>}
          </Secao>
        )}

        {prod.data && prod.data.pessoas.length > 0 && (
          <Secao titulo="Produtividade">
            <Tabela cab={['Pessoa', 'Peças', 'Peças/dia', 'Pagamento por produção']} num={[1, 2, 3]}
              linhas={prod.data.pessoas.map(p => [p.nome, formatNumber(p.pecas), formatNumber(indicadores(p).pecasPorDia), p.valor ? formatBRL(p.valor) : '—'])} />
          </Secao>
        )}

        {mat.data && mat.data.length > 0 && (
          <Secao titulo="Matéria-prima">
            <Tabela cab={['Material', 'Saldo', 'Mínimo', 'Situação']} num={[1, 2]}
              linhas={mat.data.filter(m => m.ativo).map(m => [m.nome, `${formatNumber(Math.round(m.saldo * 100) / 100)} ${m.unidade}`, `${formatNumber(m.minimo)} ${m.unidade}`,
                ['zerado', 'abaixo'].includes(cobertura(m).situacao) ? 'Comprar' : cobertura(m).situacao === 'acabando' ? 'Acabando' : 'OK'])} />
          </Secao>
        )}
      </article>
    </>
  );
}
