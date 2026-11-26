import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '../api/transport';
import { useToast } from '../ui/Toast';

interface Options<V, D> {
  /** Mensagem de sucesso (ou função que a monta). */
  success?: string | ((data: D, vars: V) => string);
  /** Consultas a refazer depois do sucesso. */
  invalidate?: QueryKey[];
  onSuccess?: (data: D, vars: V) => void;
}

/**
 * Toda gravação passa por aqui: mesma mensagem de sucesso, mesmo tratamento de erro
 * (sessão/Wi-Fi são tratados globalmente em auth.tsx) e atualização das consultas afetadas.
 */
export function useAction<V = void, D = unknown>(fn: (vars: V) => Promise<D>, opts: Options<V, D> = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<D, unknown, V>({
    mutationFn: fn,
    // Devolver a promessa mantém a ação "pendente" (botão em carregando) até os dados refeitos chegarem.
    // Com o Apps Script lento, isso impede o toque duplo (ex.: marcar a entrada duas vezes).
    onSuccess: async (data, vars) => {
      const msg = typeof opts.success === 'function' ? opts.success(data, vars) : opts.success;
      if (msg) toast.success(msg);
      await Promise.all((opts.invalidate ?? []).map(queryKey => qc.invalidateQueries({ queryKey })));
      opts.onSuccess?.(data, vars);
    },
    onError: e => {
      if (e instanceof ApiError && (e.code === 'SESSAO' || e.code === 'WIFI')) return;
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir a operação.');
    },
  });
}
