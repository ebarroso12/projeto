import type { ComponentType, LazyExoticComponent } from 'react';
import { lazyPage } from './lazyPage';
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
  group: 'Acompanhar' | 'Operação' | 'Gestão' | 'Administração';
  icon: IconName;
  allowed: (eu: Eu) => boolean;
  badge?: (boot: Boot) => number;
  Page: LazyExoticComponent<ComponentType>;
}

const gestao = (eu: Eu) => eu.admin || eu.leitura;

export const features: Feature[] = [
  { id: 'dashboard', path: '/dashboard', label: 'Dashboard', title: 'Dashboard mensal', group: 'Acompanhar', icon: 'chart', allowed: gestao, Page: lazyPage(() => import('../features/dashboard/DashboardPage')) },
  { id: 'painel', path: '/painel', label: 'Painel', title: 'Painel', group: 'Acompanhar', icon: 'grid', allowed: gestao, Page: lazyPage(() => import('../features/painel/PainelPage')) },
  { id: 'relatorio', path: '/relatorio', label: 'Relatório', title: 'Relatório', group: 'Acompanhar', icon: 'report', allowed: gestao, Page: lazyPage(() => import('../features/relatorio/RelatorioPage')) },
  { id: 'fechamento', path: '/fechamento', label: 'Relatório do mês', title: 'Relatório do mês', group: 'Acompanhar', icon: 'printer', allowed: eu => eu.admin && !eu.leitura, Page: lazyPage(() => import('../features/fechamento/FechamentoPage')) },
  { id: 'falta', path: '/falta', label: 'Em falta', title: 'Em falta no estoque', group: 'Acompanhar', icon: 'alert', allowed: () => true, badge: b => b.emFalta.length, Page: lazyPage(() => import('../features/falta/FaltaPage')) },
  { id: 'lancar', path: '/lancar', label: 'Lançar', title: 'Lançar produção', group: 'Operação', icon: 'edit', allowed: eu => !eu.leitura, Page: lazyPage(() => import('../features/lancar/LancarPage')) },
  { id: 'ponto', path: '/ponto', label: 'Ponto', title: 'Ponto', group: 'Operação', icon: 'clock', allowed: eu => !eu.leitura, Page: lazyPage(() => import('../features/ponto/PontoPage')) },
  { id: 'pedidos', path: '/pedidos', label: 'Pedidos', title: 'Pedidos de clientes', group: 'Gestão', icon: 'box', allowed: eu => eu.admin && !eu.leitura, Page: lazyPage(() => import('../features/pedidos/PedidosPage')) },
  { id: 'produtividade', path: '/produtividade', label: 'Produtividade', title: 'Produtividade e pagamento', group: 'Gestão', icon: 'activity', allowed: eu => eu.admin && !eu.leitura, Page: lazyPage(() => import('../features/produtividade/ProdutividadePage')) },
  { id: 'remessas', path: '/remessas', label: 'Oficinas e remessas', title: 'Oficinas e remessas', group: 'Operação', icon: 'truck', allowed: eu => eu.admin && !eu.leitura, Page: lazyPage(() => import('../features/remessas/RemessasPage')) },
  { id: 'materiais', path: '/materiais', label: 'Matéria-prima', title: 'Matéria-prima', group: 'Operação', icon: 'layers', allowed: eu => eu.admin && !eu.leitura, Page: lazyPage(() => import('../features/materiais/MateriaisPage')) },
  { id: 'financeiro', path: '/financeiro', label: 'Financeiro', title: 'Financeiro', group: 'Gestão', icon: 'wallet', allowed: eu => eu.financeiro, Page: lazyPage(() => import('../features/financeiro/FinanceiroPage')) },
  { id: 'resultado', path: '/resultado', label: 'Resultado', title: 'Resultado da empresa', group: 'Gestão', icon: 'trend', allowed: eu => eu.financeiro, Page: lazyPage(() => import('../features/dre/DrePage')) },
  { id: 'cadastros', path: '/cadastros', label: 'Cadastros', title: 'Cadastros', group: 'Administração', icon: 'users', allowed: eu => eu.admin, Page: lazyPage(() => import('../features/cadastros/CadastrosPage')) },
  { id: 'acessos', path: '/acessos', label: 'Acessos', title: 'Acessos e atividade', group: 'Administração', icon: 'key', allowed: eu => eu.admin && !eu.leitura, Page: lazyPage(() => import('../features/acessos/AcessosPage')) },
  { id: 'empresas', path: '/empresas', label: 'Empresas', title: 'Empresas clientes', group: 'Administração', icon: 'building', allowed: eu => eu.dono, Page: lazyPage(() => import('../features/empresas/EmpresasPage')) },
];

const ORDER_GESTAO = ['painel', 'dashboard', 'relatorio', 'fechamento', 'falta', 'pedidos', 'produtividade', 'financeiro', 'resultado', 'lancar', 'ponto', 'remessas', 'materiais', 'cadastros', 'acessos', 'empresas'];
const ORDER_OPERACAO = ['ponto', 'lancar', 'remessas', 'materiais', 'falta', 'dashboard', 'painel', 'relatorio', 'fechamento', 'pedidos', 'produtividade', 'financeiro', 'resultado', 'cadastros', 'acessos', 'empresas'];

/** Módulos que o usuário pode ver, já na ordem do menu. */
/** A pessoa pode usar a função? Usa a liberação do servidor quando existe; senão, a regra padrão do módulo. */
export function pode(eu: Eu, id: string): boolean {
  if (eu.leitura || !eu.funcoes || !(id in eu.funcoes)) return features.find(f => f.id === id)?.allowed(eu) ?? false;
  return eu.funcoes[id] === true;
}

export function visibleFeatures(eu: Eu): Feature[] {
  const order = gestao(eu) ? ORDER_GESTAO : ORDER_OPERACAO;
  return features.filter(f => pode(eu, f.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

export const homePath = (eu: Eu): string => visibleFeatures(eu)[0]?.path ?? '/falta';
