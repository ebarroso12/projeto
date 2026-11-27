import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dataCompleta } from '../lib/format';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { VERSAO, VERSOES, atualizarApp, versaoPublicada } from '../versao';

/** Confere a cada 3 min (e ao voltar para a aba) se foi publicada uma versão nova. */
export function useVersaoNova() {
  const q = useQuery({ queryKey: ['versao-publicada'], queryFn: versaoPublicada, refetchInterval: 3 * 60_000, refetchOnWindowFocus: 'always', staleTime: 60_000, retry: false });
  const pub = q.data;
  return { nova: Boolean(pub && pub.build !== VERSAO.build && VERSAO.build !== 'dev'), publicada: pub?.versao ?? VERSAO.versao, novidades: pub?.novidades ?? [] };
}

/** Botão "Atualizar" (ao lado do nome do usuário): leva para a versão mais nova. */
export function BotaoAtualizar() {
  const { nova, publicada } = useVersaoNova();
  const [indo, setIndo] = useState(false);
  return (
    <button type="button" className={`btn-atualizar${nova ? ' nova' : ''}`} disabled={indo}
      onClick={() => { setIndo(true); void atualizarApp(); }}
      title={nova ? `Versão ${publicada} disponível: clique para atualizar` : `Você está na versão ${VERSAO.versao}. Clique para recarregar.`}
      aria-label={nova ? `Atualizar para a versão ${publicada}` : 'Atualizar'}>
      <Icon name="refresh" size={16} className={indo ? 'girando' : undefined} />
      <span>{nova ? `Atualizar para ${publicada}` : 'Atualizar'}</span>
      {nova && <i className="ponto-novo" aria-hidden="true" />}
    </button>
  );
}

/** Rodapé com a versão; "Novidades" mostra o histórico. */
export function Rodape() {
  const [aberto, setAberto] = useState(false);
  const { nova, publicada } = useVersaoNova();
  return (
    <footer className="app-rodape">
      <span>Fábrica · versão <b>{VERSAO.versao}</b>{VERSAO.data ? ` de ${dataCompleta(VERSAO.data)}` : ''}</span>
      {nova && <span className="rodape-nova">nova versão {publicada} disponível</span>}
      <button type="button" className="link" onClick={() => setAberto(true)}>Novidades</button>
      <Dialog open={aberto} onClose={() => setAberto(false)} title="Novidades do sistema" footer={<>
        {nova && <Button variant="primary" icon={<Icon name="refresh" size={16} />} onClick={() => void atualizarApp()}>Atualizar para {publicada}</Button>}
        <Button onClick={() => setAberto(false)}>Fechar</Button></>}>
        <ol className="versoes">
          {VERSOES.map(v => (
            <li key={v.versao} className={v.versao === VERSAO.versao ? 'atual' : ''}>
              <div className="v-cab"><b>Versão {v.versao}</b><small>{dataCompleta(v.data)}</small>{v.versao === VERSAO.versao && <span className="v-tag">em uso</span>}</div>
              <ul>{v.novidades.map(n => <li key={n}>{n}</li>)}</ul>
            </li>
          ))}
        </ol>
      </Dialog>
    </footer>
  );
}
