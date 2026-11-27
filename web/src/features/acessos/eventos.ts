import type { EventoAcesso } from '../../api/types';
import { dataBR } from '../../lib/format';

/** "2026-11-27T10:05:00" -> "27/11 10:05". */
export const quando = (iso: string) => (iso ? `${dataBR(iso.slice(0, 10))} ${iso.slice(11, 16)}` : '—');

export const TABELAS: Record<string, string> = {
  lancamentos: 'lançamento de produção', ponto: 'ponto', em_falta: 'item em falta', perfis: 'pessoa', itens_lista: 'lista de produção',
  redes: 'rede Wi-Fi', chaves_acesso: 'link de acompanhamento', configuracao: 'configuração', dias_sem_expediente: 'feriado',
  fin_lancamentos: 'lançamento financeiro', fin_contas: 'conta', fin_cartoes: 'cartão', fin_pagamentos_fatura: 'pagamento de fatura',
  fin_metas: 'meta', fin_movimentos_meta: 'movimento de meta', fin_expectativas: 'planejamento', fin_listas: 'lista do financeiro',
  fin_config: 'configuração do financeiro', dre_categorias: 'categoria do resultado', dre_meses: 'mês do resultado',
};
export const TIPOS: Record<string, { rotulo: string; tom: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  entrada: { rotulo: 'Entrou', tom: 'ok' }, saida: { rotulo: 'Saiu', tom: 'neutral' },
  acesso_pedido: { rotulo: 'Pediu acesso', tom: 'warn' }, acesso_liberado: { rotulo: 'Liberou acesso de', tom: 'ok' },
  acesso_negado: { rotulo: 'Negou acesso de', tom: 'danger' }, sessao_encerrada: { rotulo: 'Derrubou a sessão de', tom: 'danger' },
  aparelho_revogado: { rotulo: 'Revogou aparelho de', tom: 'warn' },
  pessoa_bloqueada: { rotulo: 'Bloqueou', tom: 'danger' }, pessoa_desbloqueada: { rotulo: 'Desbloqueou', tom: 'ok' },
  criou: { rotulo: 'Criou', tom: 'info' }, alterou: { rotulo: 'Alterou', tom: 'warn' }, apagou: { rotulo: 'Apagou', tom: 'danger' },
};
const ROTULOS: Record<string, string> = {
  qtd: 'qtd', valor: 'valor', descricao: 'descrição', modelo: 'modelo', cor: 'cor', tamanho: 'tamanho', etapa: 'etapa', nome: 'nome',
  login: 'login', perfil: 'perfil', ativo: 'ativo', entrada: 'entrada', saida: 'saída', dia: 'dia', status: 'situação', tipo: 'tipo',
  falta: 'falta', exigir_liberacao: 'exigir liberação', exigir_wifi: 'exigir Wi-Fi', apagado: 'apagado', aparelho: 'aparelho', ip: 'IP', automatico: 'entrou sem pedir (aparelho confiável)', confiar: 'confiar no aparelho',
};
const fmt = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Resumo legível do que aconteceu: "qtd: 30 → 35 · Camisa Polo Preto M". */
export function resumoEvento(e: EventoAcesso): string {
  const d = e.detalhe;
  const campos = (o: Record<string, unknown>, max = 4) => Object.entries(o)
    .filter(([k, v]) => v !== null && v !== '' && typeof v !== 'object' && !/(_id|^id$|hist|hash)/.test(k)).slice(0, max)
    .map(([k, v]) => `${ROTULOS[k] ?? k.replace(/_/g, ' ')}: ${fmt(v)}`).join(' · ');
  if (d.mudou && typeof d.mudou === 'object') {
    const mud = Object.entries(d.mudou as Record<string, unknown[]>).filter(([k]) => !(e.tipo === 'apagou' && k === 'apagado')).map(([k, [a, b]]) => `${ROTULOS[k] ?? k.replace(/_/g, ' ')}: ${fmt(a)} → ${fmt(b)}`).join(' · ');
    const item = d.item && typeof d.item === 'object' ? campos(d.item as Record<string, unknown>, 3) : '';
    return [mud, item].filter(Boolean).join(' — ');
  }
  return campos(d);
}

