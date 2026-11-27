/**
 * Painel do dono do sistema: funil de vendas (teste → cliente) e quem precisa de atenção.
 *  - "veio de teste": empresa criada por link TESTE (tipoLink = 'teste'), tenha virado cliente ou não;
 *  - convertida: veio de teste e hoje não tem prazo (testeAte vazio) e está ativa;
 *  - parada: ativa e sem acesso há `diasParada` dias (ou nunca acessou depois de 2 dias de criada).
 */
import type { Empresa } from '../../api/types';

const DIA = 864e5;
export const diasEntre = (de: number, ate: string) => (Date.parse(ate) - de) / DIA;

export interface Atencao { empresa: Empresa; motivo: 'vence' | 'vencido' | 'parada' | 'implantacao'; detalhe: string }
export interface PainelDono {
  vieramDeTeste: number; convertidas: number; conversao: number | null;
  emTeste: number; vencendo: number; vencidos: number; paradas: number;
  atencao: Atencao[];
}

export function painelDono(empresas: Empresa[], agora = Date.now(), diasParada = 7): PainelDono {
  const deTeste = empresas.filter(e => e.tipoLink === 'teste');
  const convertidas = deTeste.filter(e => e.ativa && !e.testeAte).length;
  const atencao: Atencao[] = [];
  let emTeste = 0, vencendo = 0, vencidos = 0, paradas = 0;
  for (const e of empresas) {
    if (!e.ativa) continue;
    if (e.testeAte) {
      const d = diasEntre(agora, e.testeAte);
      if (d > 0) {
        emTeste++;
        if (d <= 2) { vencendo++; atencao.push({ empresa: e, motivo: 'vence', detalhe: d < 1 ? 'teste acaba hoje' : `teste acaba em ${Math.ceil(d)} dia(s)` }); }
      } else {
        vencidos++;
        atencao.push({ empresa: e, motivo: 'vencido', detalhe: `teste venceu há ${Math.floor(-d)} dia(s) e não virou cliente` });
        continue;
      }
    }
    const semAcesso = e.ultimoAcesso ? -diasEntre(agora, e.ultimoAcesso) : -diasEntre(agora, e.criadaEm);
    if (semAcesso >= diasParada || (!e.ultimoAcesso && semAcesso >= 2)) {
      paradas++;
      atencao.push({ empresa: e, motivo: 'parada', detalhe: e.ultimoAcesso ? `sem acesso há ${Math.floor(semAcesso)} dia(s)` : 'nunca entrou depois do cadastro' });
    } else if (e.testeAte) {
      const feitos = Object.values(e.implantacao).filter(Boolean).length, total = Object.keys(e.implantacao).length;
      if (total && feitos <= total / 3) atencao.push({ empresa: e, motivo: 'implantacao', detalhe: `em teste com só ${feitos} de ${total} passos de implantação` });
    }
  }
  const ordem = { vence: 0, vencido: 1, parada: 2, implantacao: 3 };
  atencao.sort((a, b) => ordem[a.motivo] - ordem[b.motivo] || a.empresa.nome.localeCompare(b.empresa.nome));
  return {
    vieramDeTeste: deTeste.length, convertidas, conversao: deTeste.length ? Math.round((convertidas / deTeste.length) * 100) : null,
    emTeste, vencendo, vencidos, paradas, atencao,
  };
}
