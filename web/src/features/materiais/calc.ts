/**
 * Situação de cada material: saldo × mínimo e quantos dias o saldo dura no ritmo dos últimos 30 dias.
 */
import type { Material } from '../../api/types';

export type SituacaoMaterial = 'zerado' | 'abaixo' | 'acabando' | 'ok' | 'sem consumo';

export interface Cobertura { porDia: number; dias: number | null; situacao: SituacaoMaterial; valorEstoque: number | null }

/** `acabando` = o saldo dura menos de `alerta` dias no ritmo atual (padrão: 7). */
export function cobertura(m: Material, alerta = 7): Cobertura {
  const porDia = m.consumo30 / 30;
  const dias = porDia > 0 ? Math.max(0, Math.floor(m.saldo / porDia)) : null;
  const situacao: SituacaoMaterial =
    m.saldo <= 0 ? 'zerado' : m.saldo < m.minimo ? 'abaixo' : dias !== null && dias < alerta ? 'acabando' : porDia > 0 ? 'ok' : 'sem consumo';
  return {
    porDia: Math.round(porDia * 1000) / 1000, dias, situacao,
    valorEstoque: m.custoMedio !== null && m.saldo > 0 ? Math.round(m.saldo * m.custoMedio * 100) / 100 : null,
  };
}

export function resumoMateriais(lista: Material[]) {
  const ativos = lista.filter(m => m.ativo);
  const cs = ativos.map(m => ({ m, c: cobertura(m) }));
  return {
    ativos: ativos.length,
    alerta: cs.filter(x => ['zerado', 'abaixo', 'acabando'].includes(x.c.situacao)).length,
    valorEstoque: Math.round(cs.reduce((s, x) => s + (x.c.valorEstoque ?? 0), 0) * 100) / 100,
    criticos: cs.filter(x => x.c.situacao === 'zerado' || x.c.situacao === 'abaixo').map(x => x.m.nome),
  };
}
