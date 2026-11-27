import { useState } from 'react';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { ApiError } from '../../api/transport';
import { isoDay } from '../../lib/format';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Banner, Card } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { textoSituacao } from './backup';

/** Cópia de segurança: baixa todos os dados da empresa num arquivo que fica no computador do administrador. */
export function BackupTab() {
  const api = useApi();
  const boot = useBoot();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sit = useQuery({ queryKey: ['backup-situacao'], queryFn: () => api.backupSituacao() });

  const baixar = async () => {
    setBusy(true);
    try {
      const dados = await api.exportar() as { contagem?: Record<string, number>; parcial?: boolean };
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `backup-${boot.empresa.codigo || 'fabrica'}-${isoDay(new Date())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      const linhas = Object.values(dados?.contagem ?? {}).reduce((s, n) => s + n, 0);
      toast.success(linhas ? `Cópia baixada: ${linhas.toLocaleString('pt-BR')} registros.` : 'Cópia de segurança baixada.');
      if (dados?.parcial) toast.info('Sua cópia não inclui Financeiro e/ou Resultado, porque essas funções não estão liberadas para você.');
      void sit.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível gerar a cópia.');
    } finally {
      setBusy(false);
    }
  };

  const s = textoSituacao(sit.data);
  return (
    <Card title="Cópia de segurança" subtitle="Baixa um arquivo com todos os dados da empresa: pessoas, produção, ponto, pedidos, oficinas e remessas, matéria-prima, itens em falta, financeiro e resultado.">
      <div className="stack" style={{ gap: 12 }}>
        {sit.data !== undefined && <Banner tone={s.tom === 'ok' ? 'info' : s.tom}>{s.texto}</Banner>}
        <Banner tone="info">Guarde o arquivo no computador ou no Google Drive. Recomendado: uma vez por semana e antes de mudanças grandes. Toda segunda-feira às 8h, quem administra recebe um aviso se a última cópia tiver mais de 7 dias. Senhas e chaves de acesso não vão no arquivo.</Banner>
        <div><Button variant="primary" icon={<Icon name="download" size={16} />} loading={busy} onClick={() => void baixar()}>Baixar cópia de segurança</Button></div>
      </div>
    </Card>
  );
}
