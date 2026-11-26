import { useEffect, useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '../api/transport';
import { Button } from './Button';
import { Icon } from './Icon';
import { Skeleton } from './primitives';

export function describeError(e: unknown): { title: string; detail: string } {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'TEMPO': return { title: 'O servidor está demorando demais', detail: `${e.message} Tente de novo em instantes; se persistir, o script precisa ser otimizado.` };
      case 'REDE': return { title: 'Sem conexão', detail: e.message };
      case 'WIFI': return { title: 'Fora do Wi-Fi da fábrica', detail: e.message };
      default: return { title: 'Não foi possível carregar', detail: e.message };
    }
  }
  return { title: 'Erro inesperado', detail: e instanceof Error ? e.message : String(e) };
}

export function ErrorState({ error, onRetry, retrying }: { error: unknown; onRetry?: () => void; retrying?: boolean }) {
  const { title, detail } = describeError(error);
  return (
    <div className="state error" role="alert">
      <div className="icon-wrap"><Icon name="alert" size={24} /></div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {onRetry && <Button variant="primary" icon={<Icon name="refresh" size={16} />} loading={retrying} onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

/** true depois de `ms` enquanto `active`: usado para avisar que o servidor está lento. */
function useSlow(active: boolean, ms: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}

export function LoadingBlock({ slow }: { slow?: boolean }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <div className="grid-kpi">{[0, 1, 2, 3].map(i => <Skeleton key={i} height={84} />)}</div>
      <Skeleton height={260} />
      <p className="muted" style={{ textAlign: 'center' }}>
        {slow ? 'O servidor está demorando mais que o normal… continue aguardando ou toque em atualizar.' : 'Carregando…'}
      </p>
    </div>
  );
}

/** Um único lugar decide como exibir carregando / lento / erro / dados. */
export function QueryView<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  const slow = useSlow(query.isPending, 8000);
  if (query.isPending) return <LoadingBlock slow={slow} />;
  if (query.isError && query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  return (
    <>
      {query.isError && (
        <div className="banner banner-warn" role="alert" style={{ marginBottom: 12 }}>
          <Icon name="alert" /><p>Não consegui atualizar agora; mostrando os últimos dados carregados.</p>
        </div>
      )}
      {children(query.data as T)}
    </>
  );
}
