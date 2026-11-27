import { useQuery } from '@tanstack/react-query';
import type { Empresa } from '../../api/types';
import { useApi } from '../../app/auth';
import { dataBR, tempo } from '../../lib/format';
import { BarrasComparadas } from '../../ui/charts';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Banner, Card, Stat } from '../../ui/primitives';
import { TABELAS, TIPOS, quando, resumoEvento } from '../acessos/eventos';

const PASSOS: [string, string][] = [
  ['listas', 'Cadastrou modelos, cores e tamanhos'], ['equipe', 'Cadastrou a equipe'], ['producao', 'Lançou produção'],
  ['ponto', 'Usou o ponto'], ['financeiro', 'Lançou no financeiro'], ['resultado', 'Preencheu o resultado (DRE)'],
];

/** Barrinha "3/6" de implantação, usada na lista e na ficha. */
export function ImplantacaoBarra({ i }: { i: Record<string, boolean> }) {
  const n = PASSOS.filter(([k]) => i[k]).length;
  return (
    <span className="impl" title={PASSOS.map(([k, t]) => `${i[k] ? '✓' : '✗'} ${t}`).join('\n')}>
      <span className="impl-barra">{PASSOS.map(([k]) => <span key={k} className={i[k] ? 'on' : ''} />)}</span>
      <small>{n}/6</small>
    </span>
  );
}

const diasSem = (iso: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null);

/** Ficha completa de uma empresa (vigilância do dono): uso por dia, pessoas, módulos, entradas e linha do tempo. */
export function Ficha({ empresa: e, onClose }: { empresa: Empresa; onClose: () => void }) {
  const api = useApi();
  const q = useQuery({ queryKey: ['empresa-detalhe', e.id], queryFn: () => api.empresaDetalhe(e.id), refetchInterval: 30_000 });
  const sem = diasSem(e.ultimoAcesso);
  const restam = e.testeAte ? Math.ceil((Date.parse(e.testeAte) - Date.now()) / 86_400_000) : null;
  return (
    <Dialog open onClose={onClose} title={`Ficha · ${e.nome}`} variant="drawer" wide>
      <QueryView query={q}>
        {d => {
          const soma = (k: 'entradas' | 'tempoSeg' | 'acoes') => d.dias.reduce((s, x) => s + x[k], 0);
          const feitos = PASSOS.filter(([k]) => d.implantacao[k]).length;
          return (
            <div className="stack ficha">
              <div className="row" style={{ gap: 8 }}>
                <code>{d.codigo}</code>
                {e.tipoLink && <span className={`link-tipo ${e.tipoLink}`}>{e.tipoLink === 'pro' ? 'PRO' : 'TESTE'}</span>}
                {!e.ativa ? <Badge tone="danger">Bloqueada</Badge> : restam === null ? <Badge tone="ok">Cliente</Badge>
                  : restam <= 0 ? <Badge tone="danger">Teste vencido</Badge> : <Badge tone="warn">Teste · faltam {restam} dia(s)</Badge>}
                {e.online > 0 && <Badge tone="ok">{e.online} online agora</Badge>}
              </div>

              {restam !== null && restam > 0 && sem !== null && sem >= 2 && <Banner tone="warn">Sem uso há {sem} dias e o teste acaba em {restam} dia(s). Bom momento para um contato.</Banner>}
              {restam !== null && feitos <= 2 && <Banner tone="info">Implantação baixa ({feitos}/6). Quem não cadastra a equipe e lança produção no teste costuma não continuar.</Banner>}

              <div className="grid-kpi">
                <Stat label="Entradas (14 dias)" value={soma('entradas')} />
                <Stat label="Tempo de uso (14 dias)" value={tempo(soma('tempoSeg'))} />
                <Stat label="Ações (14 dias)" value={soma('acoes')} hint="criar, editar, apagar" />
                <Stat label="Último acesso" value={sem === null ? '—' : sem === 0 ? 'hoje' : `há ${sem}d`} hint={e.ultimoAcesso ? quando(e.ultimoAcesso) : 'nunca entrou'} tone={sem !== null && sem >= 3 ? 'danger' : undefined} />
              </div>

              <div className="grid-2">
                <Card title="Uso por dia" subtitle="Minutos com o app aberto, últimos 14 dias">
                  <BarrasComparadas titulo="Minutos de uso por dia" altura={190} series={[{ label: 'Minutos de uso', color: 'var(--viz-1)' }]}
                    grupos={d.dias.map(x => ({ label: dataBR(x.dia), valores: [Math.round(x.tempoSeg / 60)] }))} />
                </Card>
                <Card title="Ações por dia" subtitle="Criações, edições e exclusões">
                  <BarrasComparadas titulo="Ações por dia" altura={190} series={[{ label: 'Ações', color: 'var(--viz-2)' }]}
                    grupos={d.dias.map(x => ({ label: dataBR(x.dia), valores: [x.acoes] }))} />
                </Card>
              </div>

              <div className="grid-2">
                <Card title={`Implantação · ${feitos}/6`} subtitle="O que a empresa já colocou para funcionar">
                  <ul className="checklist">
                    {PASSOS.map(([k, t]) => <li key={k} className={d.implantacao[k] ? 'on' : ''}><span><Icon name={d.implantacao[k] ? 'check' : 'x'} size={14} /></span>{t}</li>)}
                  </ul>
                </Card>
                <Card title="O que mais usam" subtitle="Ações por parte do sistema (desde o início)" flush>
                  {d.modulos.length === 0 ? <div className="table-empty">Nenhuma ação ainda.</div> : (
                    <div className="list">
                      {d.modulos.slice(0, 8).map(m => (
                        <div className="item" key={m.alvo}>
                          <div className="item-main"><b>{TABELAS[m.alvo] ?? m.alvo}</b><small>{m.criou} criou · {m.alterou} editou · {m.apagou} apagou</small></div>
                          <b className="tnum">{m.criou + m.alterou + m.apagou}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <Card title="Pessoas" subtitle="Todo o período" flush>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Pessoa</th><th className="num">Entradas</th><th className="num">Tempo logado</th><th className="num">Tempo ativo</th><th className="num">Ações</th><th className="num">Aparelhos</th><th>Último acesso</th></tr></thead>
                    <tbody>
                      {d.pessoas.map(p => (
                        <tr key={p.login}>
                          <td>{p.nome}<small>{p.perfil === 'admin' ? 'administrador' : p.setor}{p.ativo ? '' : ' · bloqueado'}</small></td>
                          <td className="num">{p.entradas}</td><td className="num">{tempo(p.logadoSeg)}</td><td className="num">{tempo(p.tempoSeg)}</td>
                          <td className="num">{p.acoes}</td><td className="num">{p.aparelhos}</td><td>{p.ultimo ? quando(p.ultimo) : 'nunca'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="grid-2">
                <Card title="Últimas entradas" subtitle="Aparelho, IP e quanto tempo ficou" flush>
                  {d.sessoes.length === 0 ? <div className="table-empty">Ninguém entrou ainda.</div> : (
                    <div className="list">
                      {d.sessoes.slice(0, 12).map(s => (
                        <div className="item" key={s.id}>
                          <div className="item-main"><b>{s.nome}</b><small>{quando(s.inicio)} · {s.aparelho || 'aparelho'}{s.ip ? ` · IP ${s.ip}` : ''}</small></div>
                          <span className="tnum" title="tempo logado / ativo">{tempo(s.logadoSeg)} <small className="muted">/ {tempo(s.ativoSeg)}</small></span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
                <Card title="Linha do tempo" subtitle="Tudo o que fizeram, do mais recente" flush>
                  {d.eventos.length === 0 ? <div className="table-empty">Nada registrado ainda.</div> : (
                    <ol className="timeline">
                      {d.eventos.slice(0, 40).map(v => (
                        <li key={v.id}>
                          <span className={`tl-dot ${TIPOS[v.tipo]?.tom ?? 'neutral'}`} />
                          <div><b>{v.quem}</b> {TIPOS[v.tipo]?.rotulo.toLowerCase() ?? v.tipo} {TABELAS[v.alvo] ?? v.alvo}
                            <small>{quando(v.em)}{resumoEvento(v) ? ` · ${resumoEvento(v)}` : ''}</small></div>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </div>
            </div>
          );
        }}
      </QueryView>
    </Dialog>
  );
}
