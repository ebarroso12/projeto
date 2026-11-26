import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Boot, Eu } from '../api/types';
import type { IconName } from '../ui/Icon';

/**
 * Registro central de módulos. Para criar uma tela nova:
 *   1) crie src/features/<modulo>/<Modulo>Page.tsx com `export default`;
 *   2) adicione UMA entrada aqui. Menu, rota, permissão e divisão de código vêm de graça.
 */
export interface Feature {
  id: string;
  path: string;
  label: string;
  title: string;
  group: 'Acompanhar' | 'Operação' | 'Administração';
  icon: IconName;
  allowed: (eu: Eu) => boolean;
  badge?: (boot: Boot) => number;
  Page: LazyExoticComponent<ComponentType>;
}

const gestao = (eu: Eu) => eu.admin || eu.leitura;

export const features: Feature[] = [
  { id: 'painel', path: '/painel', label: 'Painel', title: 'Painel', group: 'Acompanhar', icon: 'grid', allowed: gestao, Page: lazy(() => import('../features/painel/PainelPage')) },
  { id: 'relatorio', path: '/relatorio', label: 'Relatório', title: 'Relatório', group: 'Acompanhar', icon: 'report', allowed: gestao, Page: lazy(() => import('../features/relatorio/RelatorioPage')) },
  { id: 'falta', path: '/falta', label: 'Em falta', title: 'Em falta no estoque', group: 'Acompanhar', icon: 'alert', allowed: () => true, badge: b => b.emFalta.length, Page: lazy(() => import('../features/falta/FaltaPage')) },
  { id: 'lancar', path: '/lancar', label: 'Lançar', title: 'Lançar produção', group: 'Operação', icon: 'edit', allowed: eu => !eu.leitura, Page: lazy(() => import('../features/lancar/LancarPage')) },
  { id: 'ponto', path: '/ponto', label: 'Ponto', title: 'Ponto', group: 'Operação', icon: 'clock', allowed: eu => !eu.leitura, Page: lazy(() => import('../features/ponto/PontoPage')) },
  { id: 'cadastros', path: '/cadastros', label: 'Cadastros', title: 'Cadastros', group: 'Administração', icon: 'users', allowed: eu => eu.admin, Page: lazy(() => import('../features/cadastros/CadastrosPage')) },
];

const ORDER_GESTAO = ['painel', 'relatorio', 'falta', 'lancar', 'ponto', 'cadastros'];
const ORDER_OPERACAO = ['ponto', 'lancar', 'falta', 'painel', 'relatorio', 'cadastros'];

/** Módulos que o usuário pode ver, já na ordem do menu. */
export function visibleFeatures(eu: Eu): Feature[] {
  const order = gestao(eu) ? ORDER_GESTAO : ORDER_OPERACAO;
  return features.filter(f => f.allowed(eu)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

export const homePath = (eu: Eu): string => visibleFeatures(eu)[0]?.path ?? '/falta';
