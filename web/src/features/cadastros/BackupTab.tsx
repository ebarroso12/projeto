import { useState } from 'react';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { ApiError } from '../../api/transport';
import { isoDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Banner, Card } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

/** Cópia de segurança: baixa todos os dados da empresa num arquivo que fica no computador do administrador. */
export function BackupTab() {
  const api = useApi();
  const boot = useBoot();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const baixar = async () => {
    setBusy(true);
    try {
      const dados = await api.exportar();
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `backup-${boot.empresa.codigo || 'fabrica'}-${isoDay(new Date())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast.success('Cópia de segurança baixada.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível gerar a cópia.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Cópia de segurança" subtitle="Baixa um arquivo com todos os dados da empresa: pessoas, produção, ponto, itens em falta, financeiro e resultado.">
      <div className="stack" style={{ gap: 12 }}>
        <Banner tone="info">Guarde o arquivo no computador ou no Google Drive. Recomendado: uma vez por semana e antes de mudanças grandes. Senhas não vão no arquivo.</Banner>
        <div><Button variant="primary" icon={<Icon name="download" size={16} />} loading={busy} onClick={() => void baixar()}>Baixar cópia de segurança</Button></div>
      </div>
    </Card>
  );
}
