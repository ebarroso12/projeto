/**
 * Servidor de demonstração em memória. Implementa o mesmo contrato do Api.gs, com dados fictícios.
 * Serve para: modo demonstração (config.js sem apiUrl), desenvolvimento e testes automáticos.
 *
 * Logins de teste: admin/admin · ana/1234 (costura) · bruno/1234 (corte) · carla/1234 (conferência)
 * Chave "só ver": ?k=demo-key
 */
import { hmToMin, isoDay } from '../lib/format';
import { MIN_SENHA } from '../lib/rules';
import { ApiError, fromServerMessage, type Transport } from './transport';
import type { LancamentoInput } from './types';

const ETAPAS = ['Corte', 'Costura', 'Conferência'];
const HORA_FIM = '17:30';

interface MUser {
  login: string; nome: string; setor: string; perfil: 'admin' | 'funcionario';
  ativo: boolean; podeFalta: boolean; senha: string; leitura?: boolean;
}
interface MLanc {
  id: string; login: string; nome: string; etapa: string; modelo: string; cor: string; tamanho: string;
  qtd: number; data: string; hora: string; edicoes: number; hist: string;
}
interface MPonto { login: string; data: string; entrada: string; saida: string; extra: string; auto: boolean }
interface MFalta {
  id: string; modelo: string; cor: string; tamanho: string; qtd: number; feito: number;
  criado: string; obs: string; status: string;
}

// ---------- estado ----------
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)] as T;
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtMin = (m: number) => `${Math.floor(m / 60)}:${pad(m % 60)}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isWeekday = (iso: string) => { const d = new Date(`${iso}T12:00`).getDay(); return d !== 0 && d !== 6; };
const rangeDays = (ini: string, fim: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(`${ini}T12:00`); isoDay(d) <= fim && out.length < 400; d = addDays(d, 1)) out.push(isoDay(d));
  return out;
};

const state = {
  modelos: ['Camisa Polo', 'Calça Jeans', 'Bermuda Tactel', 'Jaqueta Corta-vento'],
  cores: ['Preto', 'Branco', 'Azul Marinho', 'Cinza'],
  tamanhos: ['P', 'M', 'G', 'GG', 'EG', 'G1'],
  exigirWifi: false,
  redes: [{ nome: 'Wi-Fi da fábrica', ip: '200.100.50.25', em: '2026-10-02T08:10' }],
  users: [
    { login: 'admin', nome: 'Edson', setor: 'Administração', perfil: 'admin', ativo: true, podeFalta: true, senha: 'admin' },
    { login: 'ana', nome: 'Ana Souza', setor: 'Costureira', perfil: 'funcionario', ativo: true, podeFalta: false, senha: '1234' },
    { login: 'bruno', nome: 'Bruno Lima', setor: 'Cortador', perfil: 'funcionario', ativo: true, podeFalta: false, senha: '1234' },
    { login: 'carla', nome: 'Carla Dias', setor: 'Conferente', perfil: 'funcionario', ativo: true, podeFalta: true, senha: '1234' },
    { login: 'doris', nome: 'Dóris Prado', setor: 'Costureira', perfil: 'funcionario', ativo: true, podeFalta: false, senha: '1234' },
    { login: 'leitura', nome: 'Acompanhamento (só ver)', setor: 'Administração', perfil: 'funcionario', ativo: true, podeFalta: false, senha: 'x', leitura: true },
  ] as MUser[],
  lancs: [] as MLanc[],
  pontos: [] as MPonto[],
  faltas: [] as MFalta[],
  sessions: new Map<string, string>(),
  nextId: 1000,
};

function seedData() {
  const hoje = new Date();
  const etapaUser: Record<string, MUser | undefined> = {
    Corte: state.users[2], Costura: state.users[1], Conferência: state.users[3],
  };
  const combos: [string, string, string][] = [];
  for (const m of state.modelos) for (const c of state.cores.slice(0, 3)) combos.push([m, c, pick(state.tamanhos)]);
  combos.forEach(([modelo, cor, tamanho], i) => {
    const corte = 60 + Math.floor(rnd() * 140);
    const costura = Math.floor(corte * (0.5 + rnd() * 0.4));
    const conf = Math.floor(costura * (0.4 + rnd() * 0.5));
    const parts: [string, number][] = [['Corte', corte], ['Costura', costura], ['Conferência', conf]];
    for (const [etapa, qtd] of parts) {
      const u = etapaUser[etapa]!;
      const dia = isoDay(addDays(hoje, -Math.floor(rnd() * 6)));
      state.lancs.push({ id: `L${state.nextId++}`, login: u.login, nome: u.nome, etapa, modelo, cor, tamanho, qtd, data: dia, hora: `${pad(8 + Math.floor(rnd() * 8))}:${pad(Math.floor(rnd() * 60))}`, edicoes: 0, hist: '' });
      if (i % 3 === 0) state.lancs.push({ id: `L${state.nextId++}`, login: u.login, nome: u.nome, etapa, modelo, cor, tamanho, qtd: 10 + Math.floor(rnd() * 20), data: isoDay(hoje), hora: `0${8 + Math.floor(rnd() * 2)}:${pad(Math.floor(rnd() * 60))}`, edicoes: 0, hist: '' });
    }
  });
  // um erro de propósito: conferiu mais do que costurou
  state.lancs.push({ id: `L${state.nextId++}`, login: 'carla', nome: 'Carla Dias', etapa: 'Conferência', modelo: 'Jaqueta Corta-vento', cor: 'Cinza', tamanho: 'GG', qtd: 40, data: isoDay(hoje), hora: '10:12', edicoes: 2, hist: '10:20 30→35; 10:41 35→40' });
  state.lancs.push({ id: `L${state.nextId++}`, login: 'ana', nome: 'Ana Souza', etapa: 'Costura', modelo: 'Jaqueta Corta-vento', cor: 'Cinza', tamanho: 'GG', qtd: 12, data: isoDay(hoje), hora: '09:02', edicoes: 0, hist: '' });

  // histórico de ~4 meses (para o Dashboard comparar o mês com a média dos anteriores)
  for (let k = 120; k >= 7; k--) {
    const d = isoDay(addDays(hoje, -k));
    if (!isWeekday(d)) continue;
    const [modelo, cor, tamanho] = pick(combos);
    const ritmo = 0.8 + 0.25 * Math.sin(k / 9) + rnd() * 0.2;
    const corte = Math.round((70 + rnd() * 40) * ritmo), costura = Math.round(corte * (0.85 + rnd() * 0.1)), conf = Math.round(costura * (0.85 + rnd() * 0.1));
    for (const [etapa, qtd] of [['Corte', corte], ['Costura', costura], ['Conferência', conf]] as [string, number][]) {
      const u = etapaUser[etapa]!;
      state.lancs.push({ id: `L${state.nextId++}`, login: u.login, nome: u.nome, etapa, modelo, cor, tamanho, qtd, data: d, hora: `${pad(9 + Math.floor(rnd() * 7))}:${pad(Math.floor(rnd() * 60))}`, edicoes: 0, hist: '' });
    }
  }

  for (let k = 120; k >= 1; k--) {
    const d = isoDay(addDays(hoje, -k));
    if (!isWeekday(d)) continue;
    for (const u of state.users.filter(x => x.perfil === 'funcionario' && !x.leitura)) {
      if (rnd() < 0.08) continue; // falta
      const sai = 17 * 60 + Math.floor(rnd() * 80);
      const extra = sai > hmToMin(HORA_FIM) ? sai - hmToMin(HORA_FIM) : 0;
      const semSaida = rnd() < 0.05;
      state.pontos.push({ login: u.login, data: d, entrada: `07:${pad(40 + Math.floor(rnd() * 20))}`, saida: semSaida ? HORA_FIM : fmtMin(sai), extra: extra ? fmtMin(extra) : '', auto: semSaida });
    }
  }
  const hojeIso = isoDay(hoje);
  state.pontos.push({ login: 'ana', data: hojeIso, entrada: '07:52', saida: '', extra: '', auto: false });
  state.pontos.push({ login: 'bruno', data: hojeIso, entrada: '07:48', saida: '', extra: '', auto: false });

  state.faltas.push(
    { id: 'F1', modelo: 'Camisa Polo', cor: 'Preto', tamanho: 'M', qtd: 80, feito: 32, criado: `${hojeIso}T08:05`, obs: 'Pedido da loja Centro', status: 'Urgente' },
    { id: 'F2', modelo: 'Calça Jeans', cor: 'Azul Marinho', tamanho: 'G', qtd: 50, feito: 50 - 18, criado: `${isoDay(addDays(hoje, -1))}T15:30`, obs: '', status: 'Em produção' },
    { id: 'F3', modelo: 'Bermuda Tactel', cor: 'Cinza', tamanho: 'Todos', qtd: 0, feito: 12, criado: `${isoDay(addDays(hoje, -2))}T10:00`, obs: 'Reposição', status: 'Urgente' },
  );
}
seedData();

// ---------- regras ----------
const userOf = (token: string): MUser => {
  const login = state.sessions.get(token);
  const u = state.users.find(x => x.login === login);
  if (!u || !u.ativo) throw fromServerMessage('SESSAO');
  return u;
};
const newSession = (u: MUser) => { const t = `t_${u.login}_${Math.random().toString(36).slice(2)}`; state.sessions.set(t, u.login); return t; };
/** Função do sistema da chamada atual (igual ao servidor: fin* = financeiro, dre* = resultado…). */
let funcaoAtual: string | null = null;
/** Rotas dos módulos novos (igual à tabela fab.rotas do banco). */
const ROTAS_MOCK: Record<string, string> = {
  pedidos: 'pedidos', pedidoOpcoes: 'pedidos', salvarPedido: 'pedidos', statusPedido: 'pedidos', apagarPedido: 'pedidos',
};
const funcaoDaChamada = (fn: string): string | null =>
  ROTAS_MOCK[fn] ? ROTAS_MOCK[fn]!
  : fn.startsWith('fin') ? 'financeiro' : fn.startsWith('dre') ? 'resultado'
  : ['listarUsuarios', 'salvarUsuario', 'salvarListas', 'criarChave', 'revogarChaves', 'exportar', 'backupSituacao', 'funcoesPessoa', 'salvarFuncoes', 'verWifi', 'salvarWifi', 'registros', 'salvarRegistro', 'apagarRegistro', 'dadosPessoas', 'salvarDadosPessoa'].includes(fn) ? 'cadastros'
  : ['enviarMensagem', 'mensagensEnviadas', 'apagarMensagem', 'destinatarios'].includes(fn) ? 'mensagens'
  : ['acessos', 'acessosPendentes', 'decidirAcesso', 'encerrarSessao', 'revogarAparelho', 'configAcesso', 'bloquearPessoa'].includes(fn) ? 'acessos'
  : fn === 'relatorio' ? 'relatorio' : fn === 'painel' ? 'painel' : null;
/** Administrador passa; não-admin só passa se a função desta chamada foi liberada para ele. */
const requireAdmin = (u: MUser) => {
  if (u.perfil === 'admin') return;
  if (funcaoAtual && extras[u.login]?.[funcaoAtual] === true) return;
  throw fromServerMessage('Apenas o administrador pode fazer isto.');
};
const today = () => isoDay(new Date());

function saldoRows() {
  const map = new Map<string, { modelo: string; cor: string; tamanho: string } & Record<string, number>>();
  for (const l of state.lancs) {
    const k = `${l.modelo}|${l.cor}|${l.tamanho}`;
    const row = map.get(k) ?? ({ modelo: l.modelo, cor: l.cor, tamanho: l.tamanho, Corte: 0, Costura: 0, Conferência: 0 } as never);
    (row as Record<string, number>)[l.etapa] = ((row as Record<string, number>)[l.etapa] ?? 0) + l.qtd;
    map.set(k, row);
  }
  return [...map.values()];
}

const faltaOut = (f: MFalta) => {
  const falta = Math.max(0, f.qtd - f.feito);
  return { ...f, falta };
};

function bootFor(u: MUser) {
  const meusHoje = state.lancs.filter(l => l.login === u.login && l.data === today()).map(l => ({ ...l }));
  const p = state.pontos.find(x => x.login === u.login && x.data === today());
  return {
    eu: { nome: u.nome, setor: u.setor, admin: u.perfil === 'admin', leitura: !!u.leitura, podeFalta: u.podeFalta, demo: false, financeiro: funcoesDe(u).financeiro, dono: u.login === 'admin', ...(u.leitura ? {} : { funcoes: funcoesDe(u) }) },
    empresa: { codigo: 'demo', nome: 'Confecção Demonstração' },
    hoje: today(), ponto: p ?? { entrada: '', saida: '', extra: '' }, horaFim: HORA_FIM, exigirWifi: state.exigirWifi,
    etapas: ETAPAS, modelos: state.modelos, cores: state.cores, tamanhos: state.tamanhos,
    disponivel: saldoRows(), meusHoje, emFalta: state.faltas.map(faltaOut),
  };
}

const handlers: Record<string, (a: unknown[]) => unknown> = {
  login: ([login, senha]) => {
    const u = state.users.find(x => x.login === String(login).trim().toLowerCase() && !x.leitura);
    if (!u || u.senha !== senha || !u.ativo) throw fromServerMessage('Login ou senha incorretos.');
    return newSession(u);
  },
  loginChave: ([k]) => {
    if (k !== 'demo-key') throw fromServerMessage('Link de acesso inválido.');
    return newSession(state.users.find(x => x.leitura)!);
  },
  sair: ([t]) => { state.sessions.delete(String(t)); return null; },
  trocarSenha: ([t, atual, nova]) => {
    const u = userOf(String(t));
    if (u.senha !== atual) throw fromServerMessage('Senha atual incorreta.');
    if (String(nova).length < MIN_SENHA) throw fromServerMessage(`A nova senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
    u.senha = String(nova);
    return null;
  },
  dadosIniciais: ([t, ip]) => {
    const u = userOf(String(t));
    if (state.exigirWifi && u.perfil !== 'admin' && !state.redes.some(r => r.ip === ip)) throw fromServerMessage('WIFI');
    return bootFor(u);
  },
  statusRede: ([t, ip]) => { userOf(String(t)); return !state.exigirWifi || state.redes.some(r => r.ip === ip); },
  baterPonto: ([t, tipo]) => {
    const u = userOf(String(t));
    let p = state.pontos.find(x => x.login === u.login && x.data === today());
    const h = hhmm();
    if (tipo === 'entrada') {
      if (p) throw fromServerMessage('Entrada já marcada hoje.');
      p = { login: u.login, data: today(), entrada: h, saida: '', extra: '', auto: false };
      state.pontos.push(p);
    } else {
      if (!p || p.saida) throw fromServerMessage('Marque a entrada primeiro.');
      p.saida = h;
      const extra = hmToMin(h) - hmToMin(HORA_FIM);
      p.extra = extra > 0 ? fmtMin(extra) : '';
    }
    return h;
  },
  lancarVarios: ([t, o]) => {
    const u = userOf(String(t));
    if (u.leitura) throw fromServerMessage('Usuário só pode ver.');
    const r = o as { etapa: string; modelo: string; cor: string; obs: string; itens: { tamanho: string; qtd: string }[] };
    const i = ETAPAS.indexOf(r.etapa);
    let total = 0;
    const avisos: string[] = [];
    for (const it of r.itens) {
      const qtd = parseInt(it.qtd, 10);
      if (!(qtd > 0)) continue;
      const row = saldoRows().find(s => s.modelo === r.modelo && s.cor === r.cor && s.tamanho === it.tamanho);
      const anterior = i > 0 ? (row?.[ETAPAS[i - 1]!] ?? 0) : Infinity;
      const atual = row?.[r.etapa] ?? 0;
      if (atual + qtd > anterior) avisos.push(`${it.tamanho}: você lançou mais do que a etapa anterior entregou.`);
      state.lancs.push({ id: `L${state.nextId++}`, login: u.login, nome: u.nome, etapa: r.etapa, modelo: r.modelo, cor: r.cor, tamanho: it.tamanho, qtd, data: today(), hora: hhmm(), edicoes: 0, hist: '' });
      total += qtd;
    }
    return { total, avisos };
  },
  editarLancamento: ([t, id, qtd]) => {
    const u = userOf(String(t));
    const l = state.lancs.find(x => x.id === id && (x.login === u.login || u.perfil === 'admin'));
    if (!l) throw fromServerMessage('Lançamento não encontrado.');
    const n = parseInt(String(qtd), 10);
    if (!(n >= 0)) throw fromServerMessage('Quantidade inválida.');
    l.hist = (l.hist ? l.hist + '; ' : '') + `${hhmm()} ${l.qtd}→${n}`;
    l.qtd = n; l.edicoes += 1;
    return null;
  },
  apagarLancamento: ([t, id]) => {
    const u = userOf(String(t));
    const i = state.lancs.findIndex(x => x.id === id && (x.login === u.login || u.perfil === 'admin'));
    if (i < 0) throw fromServerMessage('Lançamento não encontrado.');
    state.lancs.splice(i, 1);
    return null;
  },
  addEmFalta: ([t, o]) => {
    const u = userOf(String(t));
    if (u.perfil !== 'admin' && !u.podeFalta) throw fromServerMessage('Sem permissão para colocar item em falta.');
    const r = o as { modelo: string; cor: string; tamanho: string; qtd: string; obs: string };
    state.faltas.unshift({ id: `F${state.nextId++}`, modelo: r.modelo, cor: r.cor, tamanho: r.tamanho || 'Todos', qtd: parseInt(r.qtd, 10) || 0, feito: 0, criado: `${today()}T${hhmm()}`, obs: r.obs, status: 'Urgente' });
    return state.faltas.map(faltaOut);
  },
  statusEmFalta: ([t, id, st]) => {
    const u = userOf(String(t));
    const i = state.faltas.findIndex(f => f.id === id);
    if (i < 0) throw fromServerMessage('Item não encontrado.');
    if (st === 'Feito') { requireAdmin(u); state.faltas.splice(i, 1); } else state.faltas[i]!.status = String(st);
    return state.faltas.map(faltaOut);
  },
  painel: ([t]) => {
    userOf(String(t));
    const hoje = today();
    const prodHoje = Object.fromEntries(ETAPAS.map(e => [e, state.lancs.filter(l => l.etapa === e && l.data === hoje).reduce((s, l) => s + l.qtd, 0)]));
    const presenca = state.users.filter(u => u.ativo && !u.leitura && u.perfil === 'funcionario').map(u => {
      const p = state.pontos.find(x => x.login === u.login && x.data === hoje);
      return { nome: u.nome, setor: u.setor, entrada: p?.entrada ?? '', saida: p?.saida ?? '', extra: p?.extra ?? '' };
    });
    const saldo = saldoRows().map(s => {
      const corte = s.Corte ?? 0, costura = s.Costura ?? 0, conf = s['Conferência'] ?? 0;
      return { modelo: s.modelo, cor: s.cor, tamanho: s.tamanho, corte, costura, conf, naCostura: Math.max(0, corte - costura), naConf: Math.max(0, costura - conf), erro: costura > corte || conf > costura };
    });
    return { presenca, prodHoje, saldo, editados: state.lancs.filter(l => l.data === hoje && l.edicoes > 0) };
  },
  relatorio: ([t, ini, fim]) => {
    userOf(String(t));
    const dias = rangeDays(String(ini), String(fim));
    const doPeriodo = state.lancs.filter(l => l.data >= String(ini) && l.data <= String(fim));
    const porEtapa = Object.fromEntries(ETAPAS.map(e => [e, doPeriodo.filter(l => l.etapa === e).reduce((s, l) => s + l.qtd, 0)]));
    const modelos = new Map<string, Record<string, unknown>>();
    for (const l of doPeriodo) {
      const k = `${l.modelo}|${l.cor}|${l.tamanho}`;
      const r = modelos.get(k) ?? { modelo: l.modelo, cor: l.cor, tamanho: l.tamanho, Corte: 0, Costura: 0, Conferência: 0 };
      r[l.etapa] = (r[l.etapa] as number) + l.qtd;
      modelos.set(k, r);
    }
    const pessoasMap = new Map<string, { nome: string; etapa: string; qtd: number }>();
    for (const l of doPeriodo) {
      const k = `${l.login}|${l.etapa}`;
      const r = pessoasMap.get(k) ?? { nome: l.nome, etapa: l.etapa, qtd: 0 };
      r.qtd += l.qtd; pessoasMap.set(k, r);
    }
    const uteis = dias.filter(d => isWeekday(d) && d <= today());
    const regs = state.pontos.filter(p => p.data >= String(ini) && p.data <= String(fim));
    const pessoas = state.users.filter(u => u.perfil === 'funcionario' && !u.leitura).map(u => {
      const rs = regs.filter(p => p.login === u.login);
      const horas = rs.reduce((s, p) => s + (p.saida ? Math.max(0, hmToMin(p.saida) - hmToMin(p.entrada)) : 0), 0);
      const extras = rs.reduce((s, p) => s + (p.extra ? hmToMin(p.extra) : 0), 0);
      return { nome: u.nome, diasTrab: rs.length, horas: fmtMin(horas), extras: fmtMin(extras), faltas: uteis.filter(d => !rs.some(p => p.data === d)), semSaida: rs.filter(p => p.auto).length };
    });
    const nomeDe = (login: string) => state.users.find(u => u.login === login)?.nome ?? login;
    return {
      porEtapa, porModelo: [...modelos.values()], porPessoa: [...pessoasMap.values()], diasUteis: uteis.length, pessoas,
      registros: regs.map(p => ({ data: p.data, nome: nomeDe(p.login), entrada: p.entrada, saida: p.saida, extra: p.extra, auto: p.auto })).sort((a, b) => b.data.localeCompare(a.data)),
      editados: doPeriodo.filter(l => l.edicoes > 0),
    };
  },
  listarUsuarios: ([t]) => {
    requireAdmin(userOf(String(t)));
    return state.users.filter(u => !u.leitura).map(u => ({ login: u.login, nome: u.nome, setor: u.setor, perfil: u.perfil, ativo: u.ativo ? 'Sim' : 'Não', podeFalta: u.podeFalta ? 'Sim' : 'Não', senha: u.senha, link: `https://exemplo.local/?k=${u.login}` }));
  },
  salvarUsuario: ([t, o]) => {
    requireAdmin(userOf(String(t)));
    const r = o as { novo: boolean; nome: string; login: string; senha: string; setor: string; perfil: 'admin' | 'funcionario'; ativo: string; podeFalta: string };
    const login = r.login.trim().toLowerCase();
    if (!r.nome.trim() || !login) throw fromServerMessage('Preencha nome e login.');
    const ex = state.users.find(u => u.login === login);
    if (r.novo && ex) throw fromServerMessage('Esse login já existe.');
    if (r.novo && r.senha.length < MIN_SENHA) throw fromServerMessage(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
    const u = ex ?? ({ login } as MUser);
    Object.assign(u, { nome: r.nome.trim(), setor: r.setor, perfil: r.perfil, ativo: r.ativo !== 'Não', podeFalta: r.podeFalta === 'Sim' });
    if (r.senha) u.senha = r.senha;
    if (!ex) state.users.push(u);
    return null;
  },
  salvarLista: ([t, nome, valores]) => {
    requireAdmin(userOf(String(t)));
    const v = (valores as string[]).map(x => x.trim()).filter(Boolean);
    const key = ({ Modelos: 'modelos', Cores: 'cores', Tamanhos: 'tamanhos' } as const)[String(nome) as 'Modelos'];
    if (!key) throw fromServerMessage('Lista inválida.');
    state[key] = v;
    return v;
  },
  verWifi: ([t]) => { requireAdmin(userOf(String(t))); return { exigir: state.exigirWifi, ips: state.redes }; },
  salvarWifi: ([t, exigir, ips]) => {
    requireAdmin(userOf(String(t)));
    state.exigirWifi = exigir === true; state.redes = ips as typeof state.redes;
    return { exigir: state.exigirWifi, ips: state.redes };
  },
  cadastrarRedeAtual: ([t, ip, nome]) => {
    requireAdmin(userOf(String(t)));
    const addr = String(ip) || '203.0.113.7';
    if (!state.redes.some(r => r.ip === addr)) state.redes.push({ nome: String(nome), ip: addr, em: `${today()}T${hhmm()}` });
    return { exigir: state.exigirWifi, ips: state.redes };
  },
};


// =====================================================================
// Demonstração: empresas, financeiro e resultado (DRE)
// =====================================================================
let uidN = 1;
const uid = () => `x${Date.now().toString(36)}${(uidN++).toString(36)}`;
const mesAtual = () => today().slice(0, 7);
const mesMenos = (n: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return isoDay(d).slice(0, 7); };

function vencFatura(data: string, fech: number, venc: number): string {
  const [y, m, d] = data.split('-').map(Number) as [number, number, number];
  const last = (yy: number, mm0: number) => new Date(yy, mm0 + 1, 0).getDate();
  const cm = new Date(y, m - 1 + (d > fech ? 1 : 0), 1);
  const cl = last(cm.getFullYear(), cm.getMonth());
  const closeDate = new Date(cm.getFullYear(), cm.getMonth(), Math.min(fech, cl));
  const sameDue = new Date(cm.getFullYear(), cm.getMonth(), Math.min(venc, cl));
  const dm = sameDue > closeDate ? cm : new Date(cm.getFullYear(), cm.getMonth() + 1, 1);
  return isoDay(new Date(dm.getFullYear(), dm.getMonth(), Math.min(venc, last(dm.getFullYear(), dm.getMonth()))));
}

const empresasDemo = [
  { id: 'e1', codigo: 'demo', nome: 'Confecção Demonstração', ativa: true, motivo: '', criadaEm: '2026-09-01', usuarios: 6, admins: 1, ultimoAcesso: `${today()}T08:10`, testeAte: '', porLink: false, tempo7d: 86400, entradas7d: 41, acoes7d: 312, tipoLink: '', pessoas7d: 5, online: 3, implantacao: { listas: true, equipe: true, producao: true, ponto: true, financeiro: true, resultado: true } },
  { id: 'e2', codigo: 'malharia-sul', nome: 'Malharia Sul', ativa: true, motivo: '', criadaEm: '2026-10-12', usuarios: 14, admins: 2, ultimoAcesso: `${today()}T07:55`, testeAte: '', porLink: false, tempo7d: 151200, entradas7d: 88, acoes7d: 640, tipoLink: 'pro', pessoas7d: 12, online: 4, implantacao: { listas: true, equipe: true, producao: true, ponto: true, financeiro: true, resultado: true } },
  { id: 'e3', codigo: 'jeans-norte', nome: 'Jeans Norte', ativa: false, motivo: 'Mensalidade em atraso', criadaEm: '2026-08-03', usuarios: 9, admins: 1, ultimoAcesso: '2026-11-02T17:20', testeAte: '', porLink: false, tempo7d: 0, entradas7d: 0, acoes7d: 0, tipoLink: '', pessoas7d: 0, online: 0, implantacao: { listas: true, equipe: true, producao: true, ponto: true, financeiro: false, resultado: false } },
  { id: 'e4', codigo: 'estamparia-leste', nome: 'Estamparia Leste', ativa: true, motivo: '', criadaEm: isoDay(addDays(new Date(), -3)), usuarios: 3, admins: 1, ultimoAcesso: `${today()}T09:40`, testeAte: `${isoDay(addDays(new Date(), 4))}T09:00`, porLink: true, tempo7d: 12600, entradas7d: 9, acoes7d: 57, tipoLink: 'teste', pessoas7d: 2, online: 1, implantacao: { listas: true, equipe: true, producao: true, ponto: false, financeiro: false, resultado: false } },
] as Record<string, unknown>[];
const convitesDemo: Record<string, unknown>[] = [
  { id: 'c1', tipo: 'teste', nota: 'Feira de confecção', diasTeste: 7, usosMax: 10, usos: 1, ativo: true, expiraEm: `${isoDay(addDays(new Date(), 2))}T10:00`, criadoEm: `${isoDay(addDays(new Date(), -5))}T10:00`, empresas: ['Estamparia Leste'] },
  { id: 'c2', tipo: 'pro', nota: 'Malharia Sul (contrato assinado)', diasTeste: 7, usosMax: 1, usos: 1, ativo: true, expiraEm: `${isoDay(addDays(new Date(), 20))}T10:00`, criadoEm: `${isoDay(addDays(new Date(), -46))}T10:00`, empresas: ['Malharia Sul'] },
];

const fin = {
  dataInicio: `${new Date().getFullYear()}-01-01`,
  listas: {
    categorias: ['Matéria-prima', 'Folha de pagamento', 'Aluguel', 'Energia e água', 'Impostos', 'Frete e transporte', 'Manutenção', 'Marketing', 'Vendas', 'Outros'],
    responsaveis: ['Edson', 'Financeiro'], centros: ['Produção', 'Administrativo', 'Comercial'],
    formas: ['PIX', 'Boleto', 'Débito automático', 'Cartão de débito', 'Transferência', 'Dinheiro'],
  } as Record<string, string[]>,
  contas: [{ id: 'cc', nome: 'Conta corrente', saldoInicial: 18000, ativa: true }, { id: 'cx', nome: 'Caixa', saldoInicial: 1500, ativa: true }],
  cartoes: [{ id: 'visa', nome: 'Visa Empresa', diaFechamento: 25, diaVencimento: 5, ativo: true }],
  lancamentos: [] as Record<string, unknown>[],
  pagamentosFatura: [] as Record<string, unknown>[],
  metas: [{ id: 'm1', nome: 'Reserva de emergência', valorMeta: 30000, dataAlvo: null as string | null, ativa: true }, { id: 'm2', nome: 'Máquina nova', valorMeta: 12000, dataAlvo: `${new Date().getFullYear() + 1}-03-31`, ativa: true }],
  movimentosMeta: [] as Record<string, unknown>[],
  expectativas: [] as { mes: string; entradas: number; saidas: Record<string, number> }[],
};
(function seedFin() {
  const m = mesAtual(), p = mesMenos(1);
  const L = (o: Record<string, unknown>) => fin.lancamentos.push({ id: uid(), forma: '', categoria: '', responsavel: 'Edson', centro: 'Produção', parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0, vencimentoFatura: null, contraparteId: null, contraparte: '', origemId: null, obs: '', contaId: null, cartaoId: null, ...o });
  L({ tipo: 'entrada', data: `${p}-08`, descricao: 'Venda lote 118 · Loja Centro', valor: 14800, contaId: 'cc', categoria: 'Vendas', centro: 'Comercial', contraparteId: 'r3', contraparte: 'Loja Centro Modas' });
  L({ tipo: 'saida', data: `${p}-10`, descricao: 'Tecido malha 300 kg', valor: 6200, contaId: 'cc', categoria: 'Matéria-prima', forma: 'Boleto', contraparteId: 'r5', contraparte: 'Tecelagem Sul' });
  L({ tipo: 'saida', data: `${p}-05`, descricao: 'Folha de pagamento', valor: 9200, contaId: 'cc', categoria: 'Folha de pagamento', centro: 'Administrativo', forma: 'Transferência' });
  L({ tipo: 'entrada', data: `${m}-06`, descricao: 'Venda lote 121 · Atacado', valor: 21400, contaId: 'cc', categoria: 'Vendas', centro: 'Comercial', forma: 'PIX', contraparteId: 'r4', contraparte: 'Atacado Bom Preço' });
  L({ tipo: 'saida', data: `${m}-05`, descricao: 'Folha de pagamento', valor: 9350, contaId: 'cc', categoria: 'Folha de pagamento', centro: 'Administrativo', forma: 'Transferência' });
  L({ tipo: 'saida', data: `${m}-10`, descricao: 'Aluguel do galpão', valor: 4800, contaId: 'cc', categoria: 'Aluguel', centro: 'Administrativo', forma: 'Boleto' });
  L({ tipo: 'saida', data: `${m}-12`, descricao: 'Energia elétrica', valor: 1730, contaId: 'cc', categoria: 'Energia e água', forma: 'Débito automático' });
  L({ tipo: 'saida', data: `${m}-14`, descricao: 'Linhas e aviamentos', valor: 860, cartaoId: 'visa', categoria: 'Matéria-prima', vencimentoFatura: vencFatura(`${m}-14`, 25, 5) });
  L({ tipo: 'saida', data: `${m}-18`, descricao: 'Anúncios Instagram', valor: 450, cartaoId: 'visa', categoria: 'Marketing', centro: 'Comercial', vencimentoFatura: vencFatura(`${m}-18`, 25, 5) });
  L({ tipo: 'programada', data: `${p}-20`, descricao: 'Máquina overloque', valor: 7200, contaId: 'cc', parcelas: 6, valorParcela: 1200, diaVencimento: 20, parcelasPagas: 1, categoria: 'Manutenção', forma: 'Boleto' });
  L({ tipo: 'programada', data: `${m}-02`, descricao: 'Contador (mensal)', valor: 900, contaId: 'cc', parcelas: 12, valorParcela: 900, diaVencimento: 15, categoria: 'Outros', centro: 'Administrativo', forma: 'PIX' });
  // vendas a prazo (contas a receber)
  L({ tipo: 'receber', data: `${p}-25`, descricao: 'Pedido 118 a prazo · Loja Centro', valor: 9000, contaId: 'cc', parcelas: 3, valorParcela: 3000, diaVencimento: 5, parcelasPagas: 1, categoria: 'Vendas', centro: 'Comercial', forma: 'Boleto', contraparteId: 'r3', contraparte: 'Loja Centro Modas' });
  L({ tipo: 'receber', data: `${mesMenos(2)}-15`, descricao: 'Pedido 112 · Atacado Bom Preço', valor: 4800, contaId: 'cc', parcelas: 2, valorParcela: 2400, diaVencimento: 20, parcelasPagas: 0, categoria: 'Vendas', centro: 'Comercial', forma: 'Boleto', contraparteId: 'r4', contraparte: 'Atacado Bom Preço' });
  // histórico de clientes e fornecedores (ficha em Cadastros)
  const p2 = mesMenos(2), p3 = mesMenos(3);
  L({ tipo: 'entrada', data: `${p3}-12`, descricao: 'Venda lote 109 · Loja Centro', valor: 9600, contaId: 'cc', categoria: 'Vendas', centro: 'Comercial', forma: 'Boleto', contraparteId: 'r3', contraparte: 'Loja Centro Modas' });
  L({ tipo: 'entrada', data: `${p2}-09`, descricao: 'Venda lote 113 · Loja Centro', valor: 12300, contaId: 'cc', categoria: 'Vendas', centro: 'Comercial', forma: 'Boleto', contraparteId: 'r3', contraparte: 'Loja Centro Modas' });
  L({ tipo: 'entrada', data: `${m}-03`, descricao: 'Venda lote 120 · Loja Centro', valor: 11250, contaId: 'cc', categoria: 'Vendas', centro: 'Comercial', forma: 'PIX', contraparteId: 'r3', contraparte: 'Loja Centro Modas' });
  L({ tipo: 'saida', data: `${p3}-04`, descricao: 'Malha piquet 200 kg', valor: 5400, contaId: 'cc', categoria: 'Matéria-prima', forma: 'Boleto', contraparteId: 'r5', contraparte: 'Tecelagem Sul' });
  L({ tipo: 'saida', data: `${p2}-06`, descricao: 'Ribana e malha 150 kg', valor: 3900, contaId: 'cc', categoria: 'Matéria-prima', forma: 'Boleto', contraparteId: 'r5', contraparte: 'Tecelagem Sul' });
  L({ tipo: 'saida', data: `${m}-08`, descricao: 'Zíperes e botões', valor: 640, contaId: 'cc', categoria: 'Matéria-prima', forma: 'PIX', contraparteId: 'r6', contraparte: 'Aviamentos Franca' });
  fin.movimentosMeta.push({ id: uid(), metaId: 'm1', tipo: 'deposito', valor: 3000, data: `${p}-28`, contaId: 'cc' });
  fin.expectativas.push({ mes: m, entradas: 32000, saidas: { 'Folha de pagamento': 9500, Aluguel: 4800, 'Matéria-prima': 8000, 'Energia e água': 1600, Marketing: 600 } });
})();
const finSnapshot = () => structuredClone({ hoje: today(), ...fin, lancamentos: fin.lancamentos.filter(l => !l.apagado) });
const conta = (id: unknown) => { if (!fin.contas.some(c => c.id === id)) throw fromServerMessage('Conta inválida.'); };

const dreCats = [
  ['gross', 'sales', 'Faturamento bruto', 'plus', 'variable', true], ['returns', 'sales', 'Devoluções e descontos', 'minus', 'variable', true],
  ['tax', 'sales', 'Impostos sobre vendas', 'minus', 'variable', true], ['cmv', 'direct', 'CMV / custo dos produtos vendidos', 'minus', 'variable', true],
  ['labor', 'direct', 'Mão de obra direta (se fora do CMV)', 'minus', 'fixed', false], ['marketplace', 'selling', 'Taxas de marketplace', 'minus', 'variable', false],
  ['ads', 'selling', 'Anúncios e publicidade', 'minus', 'fixed', false], ['packing', 'selling', 'Embalagens de envio', 'minus', 'variable', false],
  ['shipping', 'selling', 'Fretes pagos pela empresa', 'minus', 'variable', false], ['commission', 'selling', 'Comissões de vendas', 'minus', 'variable', false],
  ['rent', 'admin', 'Aluguel', 'minus', 'fixed', false], ['accountant', 'admin', 'Contador', 'minus', 'fixed', false],
  ['electricity', 'admin', 'Energia e água administrativas', 'minus', 'fixed', false], ['internet', 'admin', 'Internet e telefone', 'minus', 'fixed', false],
  ['prolabore', 'admin', 'Pró-labore', 'minus', 'fixed', false], ['cleaning', 'admin', 'Limpeza e escritório', 'minus', 'fixed', false],
  ['interest', 'finance', 'Juros recebidos', 'plus', 'fixed', false], ['dividend', 'finance', 'Dividendos recebidos', 'plus', 'fixed', false],
].map(([chave, grupo, nome, tipo, variabilidade, essencial], i) => ({ id: `d-${chave}`, chave, grupo, nome, tipo, variabilidade, essencial, nota: '', ativa: true, ordem: i + 1 })) as Record<string, unknown>[];
const dreMeses: { mes: string; status: string; atualizadoEm: string; valores: Record<string, { marca: string; valor: number | null }> }[] = [];
let ultimoBackupDemo: string | null = null;
(function seedDre() {
  const vals = (o: Record<string, number>) => Object.fromEntries(dreCats.map(c => [c.id as string, c.chave as string in o ? { marca: 'valor', valor: o[c.chave as string]! } : { marca: 'na', valor: null }]));
  dreMeses.push({ mes: mesMenos(1), status: 'fechado', atualizadoEm: `${today()}T09:00`, valores: vals({ gross: 52000, returns: 1300, tax: 4700, cmv: 21500, ads: 900, shipping: 1600, commission: 1250, rent: 4800, accountant: 900, electricity: 650, prolabore: 6000, interest: 180 }) });
  dreMeses.push({ mes: mesMenos(2), status: 'fechado', atualizadoEm: `${today()}T09:00`, valores: vals({ gross: 47500, returns: 900, tax: 4300, cmv: 20100, ads: 900, shipping: 1450, commission: 1100, rent: 4800, accountant: 900, electricity: 610, prolabore: 6000 }) });
  dreMeses.push({ mes: mesMenos(3), status: 'fechado', atualizadoEm: `${today()}T09:00`, valores: vals({ gross: 39800, returns: 1500, tax: 3600, cmv: 19800, ads: 1400, shipping: 1300, commission: 900, rent: 4800, accountant: 900, electricity: 640, prolabore: 6000 }) });
})();

Object.assign(handlers, {
  criarChave: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return 'demo-key'; },
  revogarChaves: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return 0; },
  backupSituacao: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return ultimoBackupDemo ? { ultima: ultimoBackupDemo, quem: 'Demonstração', dias: 0 } : { ultima: null, quem: '', dias: null }; },
  exportar: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); ultimoBackupDemo = new Date().toISOString(); return { formato: 'fabrica-backup-2', contagem: { financeiro: 1, dre_meses: dreMeses.length }, geradoEm: `${today()}T12:00:00`, empresa: { codigo: 'demo', nome: 'Confecção Demonstração' }, tabelas: { financeiro: finSnapshot(), dre_meses: dreMeses } }; },

  empresas: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return empresasDemo; },
  criarEmpresa: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const r = o as { codigo: string; nome: string; adminLogin: string; adminSenha: string };
    if (!/^[a-z0-9-]{2,30}$/.test(r.codigo)) throw fromServerMessage('Código inválido: use 2 a 30 letras minúsculas, números ou hífen.');
    if (empresasDemo.some(e => e.codigo === r.codigo)) throw fromServerMessage('Já existe uma empresa com esse código.');
    if (!r.adminLogin || (r.adminSenha ?? '').length < MIN_SENHA) throw fromServerMessage(`Informe o login e uma senha de pelo menos ${MIN_SENHA} caracteres.`);
    empresasDemo.push({ id: uid(), codigo: r.codigo, nome: r.nome, ativa: true, motivo: '', criadaEm: today(), usuarios: 1, admins: 1, ultimoAcesso: '' });
    return null;
  },
  bloquearEmpresa: ([t, id, bloquear, motivo]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const e = empresasDemo.find(x => x.id === id);
    if (!e) throw fromServerMessage('Empresa não encontrada.');
    if (e.id === 'e1' && bloquear) throw fromServerMessage('Você não pode bloquear a sua própria empresa.');
    e.ativa = !bloquear; e.motivo = bloquear ? String(motivo ?? '') : '';
    return null;
  },
  renomearEmpresa: ([t, id, nome]: unknown[]) => { requireAdmin(userOf(String(t))); const e = empresasDemo.find(x => x.id === id); if (e) e.nome = String(nome); return null; },

  finDados: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return finSnapshot(); },
  finSalvarLancamento: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const r = o as Record<string, unknown>;
    if (!r.descricao || !(Number(r.valor) > 0)) throw fromServerMessage('Preencha a descrição e um valor maior que zero.');
    const cartao = r.tipo !== 'entrada' && r.tipo !== 'receber' && r.cartaoId ? fin.cartoes.find(c => c.id === r.cartaoId) : undefined;
    if (!cartao) conta(r.contaId);
    if (r.tipo === 'receber' && r.cartaoId && !r.contaId) throw fromServerMessage('Escolha a conta ou o cartão.');
    if ((r.tipo === 'programada' || r.tipo === 'receber') && !cartao && !(Number(r.diaVencimento) >= 1)) throw fromServerMessage('Informe o dia do vencimento (1 a 31).');
    const cp = r.contraparteId ? registrosDemo.find(x => x.id === r.contraparteId && (x.tipo === 'cliente' || x.tipo === 'fornecedor')) : undefined;
    if (r.contraparteId && !cp) throw fromServerMessage('Cliente ou fornecedor inválido.');
    const item = { forma: '', categoria: '', responsavel: '', centro: '', obs: '', parcelasPagas: 0, origemId: null, parcelas: null, valorParcela: null, diaVencimento: null, ...r,
      contraparteId: cp ? cp.id : null, contraparte: cp ? String(cp.nome) : '',
      contaId: cartao ? null : r.contaId, cartaoId: cartao ? cartao.id : null,
      vencimentoFatura: cartao ? vencFatura(String(r.data), cartao.diaFechamento, cartao.diaVencimento) : null } as Record<string, unknown>;
    const i = fin.lancamentos.findIndex(l => l.id === r.id);
    if (i >= 0) { item.parcelasPagas = fin.lancamentos[i]!.parcelasPagas; fin.lancamentos[i] = item; } else { item.id = uid(); fin.lancamentos.push(item); }
    return item.id;
  },
  finApagarLancamento: ([t, id]: unknown[]) => { requireAdmin(userOf(String(t))); const l = fin.lancamentos.find(x => x.id === id); if (!l) throw fromServerMessage('Lançamento não encontrado.'); l.apagado = true; return null; },
  finPagarParcela: ([t, id, data, valor, contaId]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const l = fin.lancamentos.find(x => x.id === id && x.tipo === 'programada') as Record<string, unknown> | undefined;
    if (!l) throw fromServerMessage('Conta programada não encontrada.');
    if (Number(l.parcelasPagas) >= Number(l.parcelas)) throw fromServerMessage('Todas as parcelas já foram pagas.');
    l.parcelasPagas = Number(l.parcelasPagas) + 1;
    fin.lancamentos.push({ id: uid(), tipo: 'saida', data, descricao: `${l.descricao} · parcela ${l.parcelasPagas}/${l.parcelas}`, valor: Number(valor), contaId: contaId ?? l.contaId, cartaoId: null,
      forma: l.forma, categoria: l.categoria, responsavel: l.responsavel, centro: l.centro, parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0, vencimentoFatura: null, origemId: l.id, obs: '', contraparteId: l.contraparteId ?? null, contraparte: l.contraparte ?? '' });
    return null;
  },
  finReceberParcela: ([t, id, data, valor, contaId]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const l = fin.lancamentos.find(x => x.id === id && x.tipo === 'receber' && !x.apagado) as Record<string, unknown> | undefined;
    if (!l) throw fromServerMessage('Conta a receber não encontrada.');
    if (Number(l.parcelasPagas) >= Number(l.parcelas)) throw fromServerMessage('Todas as parcelas já foram recebidas.');
    if (!(Number(valor) > 0) || !data) throw fromServerMessage('Informe a data e o valor recebido.');
    l.parcelasPagas = Number(l.parcelasPagas) + 1;
    fin.lancamentos.push({ id: uid(), tipo: 'entrada', data, descricao: `${l.descricao} · parcela ${l.parcelasPagas}/${l.parcelas}`, valor: Number(valor), contaId: contaId ?? l.contaId, cartaoId: null,
      forma: l.forma, categoria: l.categoria, responsavel: l.responsavel, centro: l.centro, parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0, vencimentoFatura: null, origemId: l.id, obs: '',
      contraparteId: l.contraparteId ?? null, contraparte: l.contraparte ?? '' });
    return null;
  },
  finPagarFatura: ([t, cartaoId, vencimento, valor, contaId, data]: unknown[]) => {
    requireAdmin(userOf(String(t))); conta(contaId);
    if (fin.pagamentosFatura.some(p => p.cartaoId === cartaoId && p.vencimento === vencimento)) throw fromServerMessage('Essa fatura já foi paga.');
    fin.pagamentosFatura.push({ id: uid(), cartaoId, vencimento, valor: Number(valor), contaId, data });
    return null;
  },
  finSalvarConta: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t))); const r = o as { id?: string; nome: string; saldoInicial: number; ativa?: boolean };
    if (!r.nome?.trim()) throw fromServerMessage('Informe o nome da conta.');
    const c = fin.contas.find(x => x.id === r.id);
    if (c) Object.assign(c, { nome: r.nome.trim(), saldoInicial: Number(r.saldoInicial) || 0, ativa: r.ativa ?? true }); else fin.contas.push({ id: uid(), nome: r.nome.trim(), saldoInicial: Number(r.saldoInicial) || 0, ativa: true });
    return r.id ?? 'ok';
  },
  finSalvarCartao: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t))); const r = o as { id?: string; nome: string; diaFechamento: number; diaVencimento: number; ativo?: boolean };
    if (!r.nome?.trim()) throw fromServerMessage('Informe o nome do cartão.');
    const c = fin.cartoes.find(x => x.id === r.id);
    if (c) Object.assign(c, { nome: r.nome.trim(), diaFechamento: r.diaFechamento, diaVencimento: r.diaVencimento, ativo: r.ativo ?? true }); else fin.cartoes.push({ id: uid(), nome: r.nome.trim(), diaFechamento: r.diaFechamento, diaVencimento: r.diaVencimento, ativo: true });
    return 'ok';
  },
  finSalvarMeta: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t))); const r = o as { id?: string; nome: string; valorMeta: number; dataAlvo?: string | null; ativa?: boolean };
    if (!r.nome?.trim()) throw fromServerMessage('Informe o nome da meta.');
    const m = fin.metas.find(x => x.id === r.id);
    if (m) Object.assign(m, { nome: r.nome.trim(), valorMeta: Number(r.valorMeta) || 0, dataAlvo: r.dataAlvo || null, ativa: r.ativa ?? true }); else fin.metas.push({ id: uid(), nome: r.nome.trim(), valorMeta: Number(r.valorMeta) || 0, dataAlvo: r.dataAlvo || null, ativa: true });
    return 'ok';
  },
  finMovimentarMeta: ([t, metaId, tipo, valor, data, contaId]: unknown[]) => {
    requireAdmin(userOf(String(t))); conta(contaId);
    const saldo = fin.movimentosMeta.filter(m => m.metaId === metaId).reduce((s, m) => s + (m.tipo === 'deposito' ? Number(m.valor) : -Number(m.valor)), 0);
    if (tipo === 'retirada' && Number(valor) > saldo) throw fromServerMessage(`A meta só tem ${saldo.toFixed(2)} guardado.`);
    fin.movimentosMeta.push({ id: uid(), metaId, tipo, valor: Number(valor), data, contaId });
    return null;
  },
  finSalvarExpectativa: ([t, mes, entradas, saidas]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const limpo = Object.fromEntries(Object.entries(saidas as Record<string, number>).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    const i = fin.expectativas.findIndex(e => e.mes === mes);
    const reg = { mes: String(mes), entradas: Number(entradas) || 0, saidas: limpo };
    if (i >= 0) fin.expectativas[i] = reg; else fin.expectativas.push(reg);
    return null;
  },
  finSalvarConfig: ([t, data]: unknown[]) => { requireAdmin(userOf(String(t))); fin.dataInicio = String(data); return null; },
  finSalvarLista: ([t, tipo, valores]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const k = ({ categoria: 'categorias', responsavel: 'responsaveis', centro: 'centros', forma: 'formas' } as Record<string, string>)[String(tipo)];
    if (!k) throw fromServerMessage('Lista inválida.');
    fin.listas[k] = [...new Set((valores as string[]).map(v => v.trim()).filter(Boolean))];
    return null;
  },

  dreDados: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return structuredClone({ hoje: today(), categorias: dreCats, meses: [...dreMeses].sort((a, b) => b.mes.localeCompare(a.mes)) }); },
  dreSalvarMes: ([t, mes, itens]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const valores: Record<string, { marca: string; valor: number | null }> = {};
    for (const it of itens as { categoriaId: string; marca: string; valor: number | null }[]) {
      if (it.marca === 'valor' && (it.valor === null || it.valor < 0)) throw fromServerMessage('Valores não podem ser negativos.');
      valores[it.categoriaId] = { marca: it.marca, valor: it.marca === 'valor' ? it.valor : null };
    }
    const status = dreCats.some(c => c.ativa && !['valor', 'na'].includes(valores[c.id as string]?.marca ?? '')) ? 'pendente' : 'fechado';
    const i = dreMeses.findIndex(m => m.mes === mes);
    const reg = { mes: String(mes), status, atualizadoEm: `${today()}T${hhmm()}`, valores };
    if (i >= 0) dreMeses[i] = reg; else dreMeses.push(reg);
    return status;
  },
  dreApagarMes: ([t, mes]: unknown[]) => { requireAdmin(userOf(String(t))); const i = dreMeses.findIndex(m => m.mes === mes); if (i >= 0) dreMeses.splice(i, 1); return null; },
  dreSalvarCategoria: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t))); const r = o as Record<string, unknown>;
    const c = dreCats.find(x => x.id === r.id);
    if (c) {
      if (c.essencial && r.ativa === false) throw fromServerMessage('Esta categoria é essencial e não pode ser desativada.');
      Object.assign(c, { nome: r.nome, variabilidade: r.variabilidade ?? c.variabilidade, nota: r.nota ?? c.nota, ativa: r.ativa ?? c.ativa });
      return c.id;
    }
    const grupo = String(r.grupo);
    const id = `d-${uid()}`;
    dreCats.push({ id, chave: id, grupo, nome: r.nome, tipo: grupo === 'finance' ? 'plus' : grupo === 'sales' && r.tipo === 'plus' ? 'plus' : 'minus', variabilidade: r.variabilidade ?? 'fixed', essencial: false, nota: r.nota ?? '', ativa: true, ordem: dreCats.length + 1 });
    return id;
  },
  dreRestaurarCategorias: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); dreCats.forEach(c => { c.ativa = true; }); return null; },
});

export function createMockTransport(latencyMs = 120): Transport {
  return async (fn, args) => {
    await new Promise(r => setTimeout(r, latencyMs));
    const h = handlers[fn];
    if (!h) throw new ApiError('SERVIDOR', `Função desconhecida: ${fn}`);
    funcaoAtual = funcaoDaChamada(fn);
    try { return structuredClone(h(args)); } finally { funcaoAtual = null; }
  };
}

// ---------------------------------------------------------------- acessos e auditoria (demonstração)
const agoraIso = (minAtras = 0) => { const d = new Date(Date.now() - minAtras * 60_000); return `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`; };
const acessoDemo = {
  exigir: true,
  pendentes: [
    { id: 'p1', nome: 'Bruno Lima', login: 'bruno', setor: 'Cortador', perfil: 'funcionario', aparelho: 'Chrome · Android', ip: '189.40.12.7', status: 'pendente', tela: '', ativoSeg: 0, inicio: agoraIso(1), ultimo: agoraIso(1), decididoPor: '', confiavel: false },
  ] as Record<string, unknown>[],
  sessoes: [
    { id: 's1', nome: 'Ana Souza', login: 'ana', setor: 'Costureira', perfil: 'funcionario', aparelho: 'Chrome · Android', ip: '189.40.12.9', status: 'aprovada', tela: 'Lançar', ativoSeg: 5400, logadoSeg: 7800, inicio: agoraIso(130), ultimo: agoraIso(0), decididoPor: 'Edson', confiavel: true },
    { id: 's2', nome: 'Carla Dias', login: 'carla', setor: 'Conferente', perfil: 'funcionario', aparelho: 'Safari · iPhone', ip: '189.40.12.11', status: 'aprovada', tela: 'Em falta', ativoSeg: 2700, logadoSeg: 4500, inicio: agoraIso(75), ultimo: agoraIso(1), decididoPor: 'Edson', confiavel: false },
    { id: 's3', nome: 'Edson', login: 'admin', setor: 'Administração', perfil: 'admin', aparelho: 'Edge · Windows', ip: '189.40.12.2', status: 'aprovada', tela: 'Acessos', ativoSeg: 3900, logadoSeg: 5700, inicio: agoraIso(95), ultimo: agoraIso(0), decididoPor: '', confiavel: false },
    { id: 's4', nome: 'Dóris Prado', login: 'doris', setor: 'Costureira', perfil: 'funcionario', aparelho: 'Chrome · Android', ip: '177.20.3.4', status: 'negada', tela: '', ativoSeg: 0, inicio: agoraIso(300), ultimo: agoraIso(300), decididoPor: 'Edson', confiavel: false },
    { id: 's5', nome: 'Bruno Lima', login: 'bruno', setor: 'Cortador', perfil: 'funcionario', aparelho: 'Chrome · Android', ip: '189.40.12.7', status: 'encerrada', tela: 'Ponto', ativoSeg: 9800, logadoSeg: 12000, inicio: agoraIso(1500), ultimo: agoraIso(1300), decididoPor: 'Edson', confiavel: false },
  ] as Record<string, unknown>[],
  eventos: [] as Record<string, unknown>[],
  aparelhos: [{ login: 'ana', nome: 'Ana Souza', aparelho: 'demo-aparelho-ana', descricao: 'Chrome · Android', desde: agoraIso(2000).slice(0, 16), por: 'Edson' }] as Record<string, unknown>[],
};
(function seedEventos() {
  let id = 100;
  const ev = (min: number, quem: string, tipo: string, alvo: string, detalhe: Record<string, unknown> = {}) => acessoDemo.eventos.push({ id: id++, quem, tipo, alvo, detalhe, em: agoraIso(min) });
  ev(1500, 'Bruno Lima', 'acesso_pedido', '', { aparelho: 'Chrome · Android' });
  ev(1499, 'Edson', 'acesso_liberado', 'Bruno Lima', { aparelho: 'Chrome · Android' });
  ev(1450, 'Bruno Lima', 'criou', 'ponto', { dia: today(), entrada: '07:52' });
  ev(1300, 'Bruno Lima', 'saida', '');
  ev(300, 'Dóris Prado', 'acesso_pedido', '', { aparelho: 'Chrome · Android', ip: '177.20.3.4' });
  ev(299, 'Edson', 'acesso_negado', 'Dóris Prado', { aparelho: 'Chrome · Android' });
  ev(130, 'Ana Souza', 'entrada', '', { aparelho: 'Chrome · Android', automatico: true });
  ev(120, 'Ana Souza', 'criou', 'lancamentos', { etapa: 'Costura', modelo: 'Camisa Polo', cor: 'Preto', tamanho: 'M', qtd: 30 });
  ev(110, 'Ana Souza', 'alterou', 'lancamentos', { mudou: { qtd: [30, 35] }, item: { etapa: 'Costura', modelo: 'Camisa Polo', cor: 'Preto', tamanho: 'M' } });
  ev(95, 'Edson', 'entrada', '', { aparelho: 'Edge · Windows' });
  ev(80, 'Edson', 'criou', 'fin_lancamentos', { tipo: 'saida', descricao: 'Tecido malha 300 kg', valor: 4200 });
  ev(75, 'Carla Dias', 'entrada', '', { aparelho: 'Safari · iPhone' });
  ev(60, 'Carla Dias', 'criou', 'em_falta', { modelo: 'Bermuda Tactel', cor: 'Azul', tamanho: 'G', qtd: 30 });
  ev(40, 'Edson', 'alterou', 'perfis', { mudou: { perfil: ['funcionario', 'admin'] }, item: { nome: 'Carla Dias', login: 'carla' } });
  ev(20, 'Ana Souza', 'apagou', 'lancamentos', { mudou: { apagado: [false, true] }, item: { etapa: 'Costura', modelo: 'Calça Jeans', qtd: 12 } });
  acessoDemo.eventos.reverse();
})();
const metricasDemo = () => state.users.filter(u => !u.leitura).map(u => {
  const ss = acessoDemo.sessoes.filter(s => s.login === u.login);
  const ev = acessoDemo.eventos.filter(e => e.quem === u.nome);
  return {
    nome: u.nome, login: u.login, perfil: u.perfil, ativo: u.ativo, eu: u.login === 'admin',
    logadoSeg: ss.reduce((t, s) => t + Math.round(Number(s.ativoSeg) * 1.35), 0),
    entradas: ss.filter(s => s.status === 'aprovada' || s.status === 'encerrada').length, negados: ss.filter(s => s.status === 'negada').length,
    tempoSeg: ss.reduce((t, s) => t + Number(s.ativoSeg), 0),
    criou: ev.filter(e => e.tipo === 'criou').length, alterou: ev.filter(e => e.tipo === 'alterou').length, apagou: ev.filter(e => e.tipo === 'apagou').length,
    ultimo: String(ss[0]?.ultimo ?? '').slice(0, 16),
  };
});

Object.assign(handlers, {
  pedirAcesso: ([t]: unknown[]) => { userOf(String(t)); return 'aprovada'; },
  statusAcesso: ([t]: unknown[]) => { userOf(String(t)); return 'aprovada'; },
  presenca: ([t]: unknown[]) => { userOf(String(t)); return null; },
  acessosPendentes: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return acessoDemo.pendentes; },
  decidirAcesso: ([t, id, liberar]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const p = acessoDemo.pendentes.find(x => x.id === id);
    if (!p) throw fromServerMessage('Esse pedido já foi respondido ou expirou.');
    acessoDemo.pendentes = acessoDemo.pendentes.filter(x => x !== p);
    acessoDemo.sessoes.unshift({ ...p, status: liberar ? 'aprovada' : 'negada', decididoPor: u.nome, ultimo: agoraIso(0) });
    acessoDemo.eventos.unshift({ id: Date.now(), quem: u.nome, tipo: liberar ? 'acesso_liberado' : 'acesso_negado', alvo: p.nome, detalhe: { aparelho: p.aparelho }, em: agoraIso(0) });
    return null;
  },
  encerrarSessao: ([t, id]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const s = acessoDemo.sessoes.find(x => x.id === id);
    if (s) { s.status = 'encerrada'; acessoDemo.eventos.unshift({ id: Date.now(), quem: u.nome, tipo: 'sessao_encerrada', alvo: s.nome, detalhe: {}, em: agoraIso(0) }); }
    return null;
  },
  revogarAparelho: ([t, login, ap]: unknown[]) => { requireAdmin(userOf(String(t))); acessoDemo.aparelhos = acessoDemo.aparelhos.filter(a => !(a.login === login && a.aparelho === ap)); return null; },
  configAcesso: ([t, exigir]: unknown[]) => { requireAdmin(userOf(String(t))); acessoDemo.exigir = Boolean(exigir); return null; },
  acessos: ([t]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const online = acessoDemo.sessoes.filter(s => s.status === 'aprovada' && String(s.ultimo) >= agoraIso(3));
    return { exigir: acessoDemo.exigir, pendentes: acessoDemo.pendentes, online, sessoes: acessoDemo.sessoes, eventos: acessoDemo.eventos, aparelhos: acessoDemo.aparelhos, metricas: metricasDemo() };
  },
});

Object.assign(handlers, {
  convites: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return convitesDemo; },
  criarConvite: ([t, tipo, dias, usos, validade, nota]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const token = `demo${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.padEnd(40, 'x');
    convitesDemo.unshift({ id: token, tipo, nota: String(nota ?? ''), diasTeste: Number(dias), usosMax: Number(usos), usos: 0, ativo: true, expiraEm: `${isoDay(addDays(new Date(), tipo === 'teste' ? Number(dias) : Number(validade)))}T${hhmm()}`, criadoEm: `${today()}T${hhmm()}`, empresas: [] });
    return token;
  },
  revogarConvite: ([t, id]: unknown[]) => { requireAdmin(userOf(String(t))); const c = convitesDemo.find(x => x.id === id); if (c) c.ativo = false; return null; },
  ajustarTeste: ([t, id, dias]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const e = empresasDemo.find(x => x.id === id);
    if (e) e.testeAte = dias === null ? '' : `${isoDay(addDays(new Date(Math.max(Date.now(), e.testeAte ? Date.parse(String(e.testeAte)) : 0)), Number(dias)))}T09:00`;
    return null;
  },
  meuTeste: ([t]: unknown[]) => { userOf(String(t)); return ''; },
  validarConvite: ([conv]: unknown[]) => {
    const c = convitesDemo.find(x => x.id === conv)
      ?? (String(conv) === 'demo-teste' ? { tipo: 'teste', diasTeste: 7, ativo: true, usos: 0, usosMax: 99, criadoEm: `${today()}T${hhmm()}` }
        : String(conv) === 'demo-pro' ? { tipo: 'pro', diasTeste: 0, ativo: true, usos: 0, usosMax: 99, criadoEm: '' } : null);
    if (!c || !c.ativo || Number(c.usos) >= Number(c.usosMax)) return { valido: false, tipo: '', dias: 0, ate: '' };
    return { valido: true, tipo: c.tipo, dias: c.diasTeste, ate: c.tipo === 'teste' ? `${isoDay(addDays(new Date(String(c.criadoEm).slice(0, 10) + 'T12:00'), Number(c.diasTeste)))}T${String(c.criadoEm).slice(11, 16)}` : '' };
  },
  criarEmpresaTeste: ([o]: unknown[]) => {
    const r = o as { convite: string; codigo: string; nome: string; adminNome: string; adminLogin: string; adminSenha: string };
    if (empresasDemo.some(e => e.codigo === r.codigo)) throw fromServerMessage('Já existe uma empresa com esse código. Escolha outro.');
    if (r.adminSenha.length < MIN_SENHA) throw fromServerMessage(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
    if (state.users.some(u => u.login === r.adminLogin)) throw fromServerMessage('Esse login já existe nesta empresa.');
    const pro = r.convite === 'demo-pro' || convitesDemo.find(x => x.id === r.convite)?.tipo === 'pro';
    empresasDemo.push({ id: `e${Date.now()}`, codigo: r.codigo, nome: r.nome, ativa: true, motivo: '', criadaEm: today(), usuarios: 1, admins: 1, ultimoAcesso: '', testeAte: pro ? '' : `${isoDay(addDays(new Date(), 7))}T${hhmm()}`, porLink: true, tempo7d: 0, entradas7d: 0, acoes7d: 0, tipoLink: pro ? 'pro' : 'teste', pessoas7d: 1, online: 1, implantacao: { listas: false, equipe: false, producao: false, ponto: false, financeiro: false, resultado: false } });
    state.users.push({ login: r.adminLogin, nome: r.adminNome, setor: 'Administração', perfil: 'admin', ativo: true, podeFalta: true, senha: r.adminSenha } as MUser);
    const c = convitesDemo.find(x => x.id === r.convite); if (c) { c.usos = Number(c.usos) + 1; (c.empresas as string[]).push(r.nome); }
    return null;
  },
  bloquearPessoa: ([t, login, bloquear]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    if (login === u.login) throw fromServerMessage('Você não pode bloquear a sua própria conta.');
    const alvo = state.users.find(x => x.login === login);
    if (!alvo) throw fromServerMessage('Pessoa não encontrada.');
    alvo.ativo = !bloquear;
    acessoDemo.eventos.unshift({ id: Date.now(), quem: u.nome, tipo: bloquear ? 'pessoa_bloqueada' : 'pessoa_desbloqueada', alvo: alvo.nome, detalhe: {}, em: agoraIso(0) });
    return null;
  },
});

Object.assign(handlers, {
  empresaDetalhe: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const e = empresasDemo.find(x => x.id === id) ?? empresasDemo[0]!;
    const dias = Array.from({ length: 14 }, (_, i) => {
      const k = 13 - i, ativo = k > 9 ? 0 : 1, base = Math.round((Number(e.tempo7d) / 7) * ativo * (0.6 + Math.sin(i) * 0.3 + 0.4));
      return { dia: isoDay(addDays(new Date(), -k)), entradas: ativo ? 1 + (i % 4) : 0, tempoSeg: base, acoes: ativo ? 3 + ((i * 7) % 11) : 0, pessoas: ativo ? 1 + (i % 2) : 0 };
    });
    return {
      nome: e.nome, codigo: e.codigo, implantacao: e.implantacao, dias,
      pessoas: [
        { nome: 'Rita Gomes', login: 'rita', perfil: 'admin', setor: 'Administração', ativo: true, entradas: 9, tempoSeg: 9000, logadoSeg: 13200, acoes: 41, ultimo: `${today()}T09:40`, aparelhos: 2 },
        { nome: 'Paulo Silva', login: 'paulo', perfil: 'funcionario', setor: 'Corte', ativo: true, entradas: 4, tempoSeg: 3600, logadoSeg: 5400, acoes: 16, ultimo: `${isoDay(addDays(new Date(), -1))}T16:05`, aparelhos: 1 },
      ],
      modulos: [{ alvo: 'lancamentos', criou: 28, alterou: 4, apagou: 1 }, { alvo: 'itens_lista', criou: 18, alterou: 0, apagou: 2 }, { alvo: 'perfis', criou: 2, alterou: 1, apagou: 0 }],
      sessoes: acessoDemo.sessoes.slice(0, 4),
      eventos: acessoDemo.eventos.slice(0, 15),
    };
  },
});

// ---------------------------------------------------------------- funções por pessoa (demonstração)
const FUNCOES = ['painel', 'dashboard', 'relatorio', 'falta', 'lancar', 'ponto', 'pedidos', 'remessas', 'materiais', 'produtividade', 'financeiro', 'resultado', 'cadastros', 'acessos', 'mensagens', 'empresas'];
const extras: Record<string, Record<string, boolean>> = {};
const padraoDe = (u: MUser, f: string) => (f === 'empresas' ? u.login === 'admin' : ['lancar', 'ponto', 'falta'].includes(f) ? true : u.perfil === 'admin');
function funcoesDe(u: MUser): Record<string, boolean> {
  return Object.fromEntries(FUNCOES.map(f => [f, f === 'empresas' ? padraoDe(u, f) || extras[u.login]?.empresas === true : extras[u.login]?.[f] ?? padraoDe(u, f)]));
}
Object.assign(handlers, {
  funcoesPessoa: ([t, login]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const alvo = state.users.find(x => x.login === login);
    if (!alvo) throw fromServerMessage('Pessoa não encontrada.');
    return { nome: alvo.nome, perfil: alvo.perfil, eu: alvo.login === u.login, protegido: alvo.login === 'admin' && u.login !== 'admin', possoEmpresas: u.login === 'admin', funcoes: funcoesDe(alvo),
      padrao: Object.fromEntries(FUNCOES.map(f => [f, f === 'empresas' ? false : padraoDe(alvo, f)])) };
  },
  salvarFuncoes: ([t, login, funcoes]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const alvo = state.users.find(x => x.login === login);
    if (!alvo) throw fromServerMessage('Pessoa não encontrada.');
    if (alvo.login === u.login) throw fromServerMessage('Você não pode mudar as suas próprias funções.');
    if (u.perfil !== 'admin') throw fromServerMessage('Apenas o administrador pode fazer isto.');
    if (alvo.login === 'admin') throw fromServerMessage('Só o responsável pelo sistema pode mudar as funções dele.');
    const f = { ...funcoesDe(alvo), ...(funcoes as Record<string, boolean>) };
    extras[alvo.login] = Object.fromEntries(Object.entries(f).filter(([k, v]) => (k === 'empresas' ? u.login === 'admin' && v : v !== padraoDe(alvo, k))));
    acessoDemo.eventos.unshift({ id: Date.now(), quem: u.nome, tipo: 'funcoes_alteradas', alvo: alvo.nome, detalhe: { funcoes: funcoesDe(alvo) }, em: agoraIso(0) });
    return null;
  },
});

// ---------------------------------------------------------------- cadastros gerais e mensagens (demonstração)
const registrosDemo: Record<string, unknown>[] = [
  { id: 'r1', tipo: 'produto', nome: 'Camisa Polo', documento: '', telefone: '', email: '', cidade: '', obs: '', dados: { referencia: 'CP-100', preco: '79.90', custo: '32.40', unidade: 'peça', cores: 'Preto, Branco, Azul Marinho', tamanhos: 'P, M, G, GG' }, ativo: true, criadoEm: '2026-10-02' },
  { id: 'r2', tipo: 'produto', nome: 'Jaqueta Corta-vento', documento: '', telefone: '', email: '', cidade: '', obs: '', dados: { referencia: 'JC-210', preco: '159.00', custo: '71.80', unidade: 'peça', cores: 'Cinza, Preto', tamanhos: 'M, G, GG' }, ativo: true, criadoEm: '2026-10-05' },
  { id: 'r3', tipo: 'cliente', nome: 'Loja Centro Modas', documento: '12.345.678/0001-90', telefone: '(16) 99999-1000', email: 'compras@centromodas.com', cidade: 'Franca/SP', obs: 'Paga com 30 dias', dados: { contato: 'Marta' }, ativo: true, criadoEm: '2026-09-12' },
  { id: 'r4', tipo: 'cliente', nome: 'Atacado Bom Preço', documento: '98.765.432/0001-10', telefone: '(11) 3333-2000', email: '', cidade: 'São Paulo/SP', obs: '', dados: { contato: 'Rui' }, ativo: true, criadoEm: '2026-10-20' },
  { id: 'r5', tipo: 'fornecedor', nome: 'Tecelagem Sul', documento: '11.222.333/0001-44', telefone: '(47) 3030-4040', email: 'vendas@tecsul.com', cidade: 'Blumenau/SC', obs: '', dados: { contato: 'Pedro', produtos: 'Malha, moletom', prazo: '28 dias' }, ativo: true, criadoEm: '2026-08-30' },
  { id: 'r6', tipo: 'fornecedor', nome: 'Aviamentos Franca', documento: '', telefone: '(16) 3721-0000', email: '', cidade: 'Franca/SP', obs: 'Zíper e botões', dados: { produtos: 'Zíper, botões, etiquetas', prazo: 'à vista' }, ativo: true, criadoEm: '2026-09-02' },
  { id: 'r7', tipo: 'banco', nome: 'Banco do Brasil', documento: '', telefone: '', email: '', cidade: '', obs: 'Conta principal', dados: { agencia: '1234-5', conta: '98765-0', tipoConta: 'Corrente PJ', pix: '12.345.678/0001-90', titular: 'Confecção Demonstração' }, ativo: true, criadoEm: '2026-08-01' },
];
const dadosPessoasDemo: Record<string, Record<string, string>> = { ana: { cpf: '123.456.789-00', telefone: '(16) 98888-1111', admissao: '2024-02-05', cargo: 'Costureira' } };
const mensagensDemo: { id: string; autor: string; paraLogin: string; titulo: string; texto: string; importante: boolean; em: string; leram: string[] }[] = [
  { id: 'msg1', autor: 'Edson', paraLogin: '', titulo: 'Inventário sexta-feira', texto: 'Sexta às 14h vamos fazer inventário do estoque. Todos ajudam.', importante: true, em: agoraIso(240).slice(0, 16), leram: ['ana'] },
  { id: 'msg2', autor: 'Edson', paraLogin: 'carla', titulo: 'Lote 121', texto: 'Carla, priorize a conferência do lote 121 hoje.', importante: false, em: agoraIso(60).slice(0, 16), leram: [] },
];
const nomeLogin = (l: string) => state.users.find(u => u.login === l)?.nome ?? l;
Object.assign(handlers, {
  finContraparteLancamentos: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    if (!registrosDemo.some(r => r.id === id && (r.tipo === 'cliente' || r.tipo === 'fornecedor'))) throw fromServerMessage('Cliente ou fornecedor não encontrado.');
    return fin.lancamentos.filter(l => !l.apagado && l.contraparteId === id).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  },
  finContrapartesTotais: ([t, ano]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const tot = new Map<string, { id: string; recebido: number; pago: number; qtd: number; ultimo: string | null; aReceber: number }>();
    for (const l of fin.lancamentos) {
      if (l.apagado || !l.contraparteId) continue;
      const id = String(l.contraparteId), data = String(l.data);
      const x = tot.get(id) ?? { id, recebido: 0, pago: 0, qtd: 0, ultimo: null, aReceber: 0 };
      if (l.tipo === 'receber') x.aReceber += (Number(l.parcelas) - Number(l.parcelasPagas)) * Number(l.valorParcela);
      if (data.startsWith(String(ano))) {
        x.qtd++;
        if (l.tipo === 'entrada') x.recebido += Number(l.valor);
        if (l.tipo === 'saida') x.pago += Number(l.valor);
      }
      if ((l.tipo === 'entrada' || l.tipo === 'saida') && (!x.ultimo || data > x.ultimo)) x.ultimo = data;
      tot.set(id, x);
    }
    return [...tot.values()];
  },
  finContrapartes: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return registrosDemo.filter(r => (r.tipo === 'cliente' || r.tipo === 'fornecedor') && r.ativo !== false).map(r => ({ id: r.id, tipo: r.tipo, nome: r.nome, documento: r.documento })); },
  registros: ([t, tipo]: unknown[]) => { requireAdmin(userOf(String(t))); return registrosDemo.filter(r => r.tipo === tipo); },
  salvarRegistro: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const r = o as Record<string, unknown>;
    if (!String(r.nome ?? '').trim()) throw fromServerMessage('Preencha o nome.');
    const ex = registrosDemo.find(x => x.id === r.id);
    if (ex) Object.assign(ex, r); else registrosDemo.push({ ...r, id: `r${Date.now()}`, criadoEm: today() });
    if (r.tipo === 'produto' && r.ativo !== false) {
      const d = (r.dados ?? {}) as Record<string, string>;
      if (!state.modelos.includes(String(r.nome))) state.modelos.push(String(r.nome));
      for (const c of String(d.cores ?? '').split(',').map(x => x.trim()).filter(Boolean)) if (!state.cores.includes(c)) state.cores.push(c);
      for (const z of String(d.tamanhos ?? '').split(',').map(x => x.trim()).filter(Boolean)) if (!state.tamanhos.includes(z)) state.tamanhos.push(z);
    }
    return String(ex?.id ?? registrosDemo[registrosDemo.length - 1]!.id);
  },
  apagarRegistro: ([t, id]: unknown[]) => { requireAdmin(userOf(String(t))); const i = registrosDemo.findIndex(x => x.id === id); if (i >= 0) registrosDemo.splice(i, 1); return null; },
  dadosPessoas: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return dadosPessoasDemo; },
  salvarDadosPessoa: ([t, login, dados]: unknown[]) => { requireAdmin(userOf(String(t))); dadosPessoasDemo[String(login)] = dados as Record<string, string>; return null; },
  minhasMensagens: ([t]: unknown[]) => {
    const u = userOf(String(t));
    return mensagensDemo.filter(m => !m.paraLogin || m.paraLogin === u.login)
      .map(m => ({ id: m.id, autor: m.autor, para: m.paraLogin ? nomeLogin(m.paraLogin) : 'Todos', titulo: m.titulo, texto: m.texto, importante: m.importante, em: m.em, lida: m.autor === u.nome || m.leram.includes(u.login) }));
  },
  marcarLidas: ([t, ids]: unknown[]) => { const u = userOf(String(t)); for (const m of mensagensDemo) if ((ids as string[]).includes(m.id) && !m.leram.includes(u.login)) m.leram.push(u.login); return null; },
  destinatarios: ([t]: unknown[]) => { const u = userOf(String(t)); requireMensagens(u); return state.users.filter(x => !x.leitura && x.ativo && x.login !== u.login).map(x => ({ login: x.login, nome: x.nome, setor: x.setor })); },
  enviarMensagem: ([t, para, titulo, texto, importante]: unknown[]) => {
    const u = userOf(String(t)); requireMensagens(u);
    if (!String(texto ?? '').trim()) throw fromServerMessage('Escreva a mensagem.');
    mensagensDemo.unshift({ id: `msg${Date.now()}`, autor: u.nome, paraLogin: String(para ?? ''), titulo: String(titulo ?? ''), texto: String(texto), importante: Boolean(importante), em: agoraIso(0).slice(0, 16), leram: [u.login] });
    return mensagensDemo[0]!.id;
  },
  mensagensEnviadas: ([t]: unknown[]) => {
    const u = userOf(String(t)); requireMensagens(u);
    const todos = state.users.filter(x => !x.leitura && x.ativo);
    return mensagensDemo.map(m => {
      const alvo = todos.filter(x => (m.paraLogin ? x.login === m.paraLogin : true) && x.nome !== m.autor);
      return { id: m.id, autor: m.autor, para: m.paraLogin ? nomeLogin(m.paraLogin) : 'Todos', titulo: m.titulo, texto: m.texto, importante: m.importante, em: m.em,
        leram: alvo.filter(x => m.leram.includes(x.login)).map(x => x.nome), faltam: alvo.filter(x => !m.leram.includes(x.login)).map(x => x.nome) };
    });
  },
  apagarMensagem: ([t, id]: unknown[]) => { requireMensagens(userOf(String(t))); const i = mensagensDemo.findIndex(m => m.id === id); if (i >= 0) mensagensDemo.splice(i, 1); return null; },
});
function requireMensagens(u: MUser) { if (!funcoesDe(u).mensagens) throw fromServerMessage('Você não tem acesso a esta função. Fale com o administrador.'); }

// ---------------------------------------------------------------- pedidos (demonstração; mesma regra do banco)
interface MPedido {
  id: string; numero: number; clienteId: string | null; cliente: string; dataPedido: string; entrega: string | null;
  status: 'aberto' | 'entregue' | 'cancelado'; entregueEm: string | null; obs: string; finLancamentoId: string | null; criadoPor: string;
  itens: { id: string; modelo: string; cor: string; tamanho: string; qtd: number; preco: number }[];
}
const pedidosDemo: MPedido[] = [];
(function seedPedidos() {
  const hoje = new Date();
  // combinações com corte nos últimos dias, para o andamento aparecer
  const recentes = [...new Map(state.lancs.filter(l => l.etapa === 'Corte' && l.data >= isoDay(addDays(hoje, -6)))
    .map(l => [`${l.modelo}|${l.cor}|${l.tamanho}`, l])).values()].slice(0, 4);
  const clientes: [string, string][] = [['r3', 'Loja Centro Modas'], ['r4', 'Atacado Bom Preço'], ['r3', 'Loja Centro Modas'], ['', 'Boutique Bela (sem cadastro)']];
  recentes.forEach((l, i) => {
    const prod = state.lancs.filter(x => x.etapa === 'Corte' && x.modelo === l.modelo && x.cor === l.cor && x.tamanho === l.tamanho && x.data >= isoDay(addDays(hoje, -7)))
      .reduce((s, x) => s + x.qtd, 0);
    const [cid, cnome] = clientes[i]!;
    pedidosDemo.push({
      id: `ped${i + 1}`, numero: 41 + i, clienteId: cid || null, cliente: cnome, dataPedido: isoDay(addDays(hoje, -7)),
      entrega: isoDay(addDays(hoje, [-2, 3, 9, 15][i]!)), status: 'aberto', entregueEm: null, obs: i === 0 ? 'Cliente pediu urgência' : '', finLancamentoId: null, criadoPor: 'Edson',
      itens: [{ id: `pi${i}`, modelo: l.modelo, cor: l.cor, tamanho: l.tamanho, qtd: Math.max(20, Math.round(prod * [0.6, 0.9, 1.3, 1.6][i]!)), preco: [79.9, 64.5, 119, 89.9][i]! }],
    });
  });
  pedidosDemo.push({ id: 'ped0', numero: 38, clienteId: 'r4', cliente: 'Atacado Bom Preço', dataPedido: isoDay(addDays(hoje, -30)), entrega: isoDay(addDays(hoje, -12)),
    status: 'entregue', entregueEm: isoDay(addDays(hoje, -13)), obs: '', finLancamentoId: null, criadoPor: 'Edson',
    itens: [{ id: 'pi9', modelo: 'Camisa Polo', cor: 'Preto', tamanho: 'M', qtd: 120, preco: 79.9 }] });
})();

/** Distribui a produção entre os pedidos: entregues primeiro, depois a entrega mais próxima (igual a fab.pedidos_producao). */
function producaoDosPedidos(): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const ativos = pedidosDemo.filter(p => p.status !== 'cancelado');
  const combos = new Map<string, string>();
  for (const p of ativos) for (const i of p.itens) {
    const k = `${i.modelo}|${i.cor}|${i.tamanho}`;
    if (!combos.has(k) || p.dataPedido < combos.get(k)!) combos.set(k, p.dataPedido);
  }
  const ordem = (a: MPedido, b: MPedido) => Number(b.status === 'entregue') - Number(a.status === 'entregue')
    || (a.entregueEm ?? '9').localeCompare(b.entregueEm ?? '9') || (a.entrega ?? '9').localeCompare(b.entrega ?? '9') || a.numero - b.numero;
  for (const [k, inicio] of combos) {
    const [modelo, cor, tamanho] = k.split('|');
    for (const etapa of ['Corte', 'Costura', 'Conferência']) {
      let disp = state.lancs.filter(l => l.etapa === etapa && l.modelo === modelo && l.cor === cor && l.tamanho === tamanho && l.data >= inicio).reduce((s, l) => s + l.qtd, 0);
      for (const p of [...ativos].sort(ordem)) for (const i of p.itens) {
        if (`${i.modelo}|${i.cor}|${i.tamanho}` !== k) continue;
        const f = Math.min(i.qtd, disp); disp -= f;
        out.set(i.id, { ...(out.get(i.id) ?? {}), [etapa]: p.status === 'entregue' ? i.qtd : f });
      }
    }
  }
  return out;
}

Object.assign(handlers, {
  pedidos: ([t]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const prod = producaoDosPedidos();
    return pedidosDemo.map(p => ({ ...p, itens: p.itens.map(i => ({ ...i, feito: prod.get(i.id) ?? {} })) }))
      .sort((a, b) => Number(b.status === 'aberto') - Number(a.status === 'aberto') || (a.entrega ?? '9').localeCompare(b.entrega ?? '9') || b.numero - a.numero);
  },
  pedidoOpcoes: ([t]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    return {
      clientes: registrosDemo.filter(r => r.tipo === 'cliente' && r.ativo !== false).map(r => ({ id: r.id, nome: r.nome, prazo: (r.dados as Record<string, string>).prazo ?? '' })),
      precos: Object.fromEntries(registrosDemo.filter(r => r.tipo === 'produto').map(r => [r.nome, Number((r.dados as Record<string, string>).preco)])),
    };
  },
  salvarPedido: ([t, o]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const r = o as Record<string, unknown>;
    const itens = (r.itens as MPedido['itens']) ?? [];
    const cli = r.clienteId ? registrosDemo.find(x => x.id === r.clienteId && x.tipo === 'cliente') : undefined;
    if (r.clienteId && !cli) throw fromServerMessage('Cliente inválido.');
    const nome = cli ? String(cli.nome) : String(r.clienteNome ?? '').trim();
    if (!nome) throw fromServerMessage('Informe o cliente.');
    if (!itens.length) throw fromServerMessage('Inclua pelo menos um item no pedido.');
    if (r.entrega && String(r.entrega) < String(r.dataPedido)) throw fromServerMessage('A entrega não pode ser antes da data do pedido.');
    for (const i of itens) if (!(Number(i.qtd) >= 1)) throw fromServerMessage('Quantidade inválida.');
    const ex = pedidosDemo.find(p => p.id === r.id);
    if (ex && ex.status !== 'aberto') throw fromServerMessage('Reabra o pedido para editar.');
    const base = { clienteId: cli ? String(cli.id) : null, cliente: nome, dataPedido: String(r.dataPedido), entrega: (r.entrega as string) || null, obs: String(r.obs ?? ''),
      itens: itens.map((i, n) => ({ id: `pi${Date.now()}${n}`, modelo: i.modelo, cor: i.cor, tamanho: i.tamanho, qtd: Number(i.qtd), preco: Number(i.preco) || 0 })) };
    if (ex) { Object.assign(ex, base); return { id: ex.id, numero: ex.numero }; }
    const numero = Math.max(0, ...pedidosDemo.map(p => p.numero)) + 1;
    const novo: MPedido = { id: `ped${Date.now()}`, numero, status: 'aberto', entregueEm: null, finLancamentoId: null, criadoPor: u.nome, ...base };
    pedidosDemo.push(novo);
    return { id: novo.id, numero };
  },
  statusPedido: ([t, id, status, receber]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const p = pedidosDemo.find(x => x.id === id);
    if (!p) throw fromServerMessage('Pedido não encontrado.');
    if (status === 'entregue') {
      if (p.status !== 'aberto') throw fromServerMessage('Só pedidos em aberto podem ser entregues.');
      const rcb = receber as Record<string, unknown> | null;
      if (rcb) {
        const total = p.itens.reduce((s, i) => s + i.qtd * i.preco, 0);
        if (!(total > 0)) throw fromServerMessage('O pedido não tem preço: informe o preço dos itens para lançar no Financeiro.');
        conta(rcb.contaId);
        const descricao = `Pedido #${p.numero} · ${p.cliente}`;
        const fid = uid();
        const baseL = { id: fid, descricao, valor: Math.round(total * 100) / 100, contaId: rcb.contaId, cartaoId: null, forma: '', categoria: 'Vendas', responsavel: '', centro: '', obs: '',
          vencimentoFatura: null, origemId: null, contraparteId: p.clienteId, contraparte: p.cliente, parcelasPagas: 0, data: today() };
        if (rcb.avista) fin.lancamentos.push({ ...baseL, tipo: 'entrada', parcelas: null, valorParcela: null, diaVencimento: null });
        else fin.lancamentos.push({ ...baseL, tipo: 'receber', parcelas: Number(rcb.parcelas), valorParcela: Math.round((total / Number(rcb.parcelas)) * 100) / 100, diaVencimento: Number(rcb.diaVencimento) });
        p.finLancamentoId = fid;
      }
      p.status = 'entregue'; p.entregueEm = today();
    } else if (status === 'cancelado') {
      if (p.status !== 'aberto') throw fromServerMessage('Só pedidos em aberto podem ser cancelados.');
      p.status = 'cancelado';
    } else { p.status = 'aberto'; p.entregueEm = null; }
    return null;
  },
  apagarPedido: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const i = pedidosDemo.findIndex(x => x.id === id);
    if (i < 0) throw fromServerMessage('Pedido não encontrado.');
    if (pedidosDemo[i]!.status === 'entregue') throw fromServerMessage('Pedido entregue não pode ser excluído. Reabra ou cancele antes.');
    pedidosDemo.splice(i, 1);
    return null;
  },
});

// ---------------------------------------------------------------- produtividade, pagamento por produção e lucro (demonstração)
const valoresPecaDemo: { etapa: string; modelo: string; valor: number }[] = [
  { etapa: 'Corte', modelo: '', valor: 0.35 }, { etapa: 'Costura', modelo: '', valor: 1.6 }, { etapa: 'Costura', modelo: 'Jaqueta Corta-vento', valor: 3.2 },
  { etapa: 'Conferência', modelo: '', valor: 0.25 },
];
const fechamentosDemo: { id: string; login: string; ini: string; fim: string; pecas: number; valor: number; finId: string | null }[] = [];
const valorPecaDe = (etapa: string, modelo: string) =>
  valoresPecaDemo.find(v => v.etapa === etapa && v.modelo === modelo)?.valor ?? valoresPecaDemo.find(v => v.etapa === etapa && v.modelo === '')?.valor ?? 0;
const sobrepoe = (a: { ini: string; fim: string }, ini: string, fim: string) => !(a.fim < ini || a.ini > fim);
const r2 = (n: number) => Math.round(n * 100) / 100;

function producaoDemo(ini: string, fim: string) {
  const doPeriodo = state.lancs.filter(l => l.data >= ini && l.data <= fim);
  const logins = [...new Set(doPeriodo.map(l => l.login))].filter(l => state.users.some(u => u.login === l));   // oficinas de fora não entram aqui
  return logins.map(login => {
    const u = state.users.find(x => x.login === login)!;
    const meus = doPeriodo.filter(l => l.login === login);
    const porEtapa: Record<string, number> = {};
    for (const l of meus) porEtapa[l.etapa] = (porEtapa[l.etapa] ?? 0) + l.qtd;
    const pontos = state.pontos.filter(p => p.login === login && p.data >= ini && p.data <= fim);
    const min = (h: string) => { const [a, b] = h.split(':').map(Number); return a! * 60 + b!; };
    const f = fechamentosDemo.find(x => x.login === login && sobrepoe(x, ini, fim));
    return {
      login, nome: u.nome, setor: u.setor, ativo: u.ativo, porEtapa, pecas: meus.reduce((s, l) => s + l.qtd, 0),
      valor: r2(meus.reduce((s, l) => s + l.qtd * valorPecaDe(l.etapa, l.modelo), 0)),
      diasProducao: new Set(meus.map(l => l.data)).size, diasPonto: pontos.length,
      minutosPonto: pontos.reduce((s, p) => s + (p.saida && p.entrada ? Math.max(0, min(p.saida) - min(p.entrada)) : 0), 0),
      fechado: f ? { id: f.id, ini: f.ini, fim: f.fim, valor: f.valor } : null,
    };
  }).sort((a, b) => b.pecas - a.pecas);
}

Object.assign(ROTAS_MOCK, { produtividade: 'produtividade', salvarValoresPeca: 'produtividade' });
Object.assign(handlers, {
  produtividade: ([t, ini, fim]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const a = String(ini), b = String(fim);
    const dias = new Map<string, number>();
    for (const l of state.lancs) if (l.data >= a && l.data <= b) dias.set(l.data, (dias.get(l.data) ?? 0) + l.qtd);
    return {
      pessoas: producaoDemo(a, b),
      porDia: [...dias.entries()].sort().map(([dia, pecas]) => ({ dia, pecas })),
      valores: valoresPecaDemo,
      fechamentos: fechamentosDemo.filter(f => sobrepoe(f, a, b)).map(f => ({ id: f.id, nome: state.users.find(u => u.login === f.login)?.nome ?? f.login, ini: f.ini, fim: f.fim, pecas: f.pecas, valor: f.valor, pago: !!f.finId })),
    };
  },
  salvarValoresPeca: ([t, lista]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const l = (lista as { etapa: string; modelo: string; valor: number }[]) ?? [];
    for (const v of l) if (!(Number(v.valor) >= 0)) throw fromServerMessage('Valor inválido.');
    valoresPecaDemo.splice(0, valoresPecaDemo.length, ...l.map(v => ({ etapa: v.etapa, modelo: v.modelo ?? '', valor: Number(v.valor) })));
    return null;
  },
  finFecharProducao: ([t, ini, fim, contaId, data, logins]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    if (u.perfil !== 'admin' && extras[u.login]?.produtividade !== true) throw fromServerMessage('Você não tem acesso à Produtividade.');
    conta(contaId);
    const a = String(ini), b = String(fim);
    let n = 0;
    for (const p of producaoDemo(a, b).filter(x => (logins as string[]).includes(x.login))) {
      if (fechamentosDemo.some(f => f.login === p.login && sobrepoe(f, a, b))) throw fromServerMessage(`${p.nome} já tem pagamento de produção neste período.`);
      if (!(p.valor > 0)) continue;
      const finId = uid();
      fin.lancamentos.push({ id: finId, tipo: 'saida', data, descricao: `Produção ${a.slice(8, 10)}/${a.slice(5, 7)} a ${b.slice(8, 10)}/${b.slice(5, 7)} · ${p.nome}`, valor: p.valor,
        contaId, cartaoId: null, forma: '', categoria: 'Folha de pagamento', responsavel: p.nome, centro: '', parcelas: null, valorParcela: null, diaVencimento: null,
        parcelasPagas: 0, vencimentoFatura: null, origemId: null, obs: '', contraparteId: null, contraparte: '' });
      fechamentosDemo.push({ id: uid(), login: p.login, ini: a, fim: b, pecas: p.pecas, valor: p.valor, finId });
      n++;
    }
    if (!n) throw fromServerMessage('Ninguém com valor a receber no período (confira os valores por peça).');
    return n;
  },
  finDesfazerFechamento: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const i = fechamentosDemo.findIndex(f => f.id === id);
    if (i < 0) throw fromServerMessage('Fechamento não encontrado.');
    const l = fin.lancamentos.find(x => x.id === fechamentosDemo[i]!.finId);
    if (l) l.apagado = true;
    fechamentosDemo.splice(i, 1);
    return null;
  },
  dreLucroModelos: ([t, ini, fim]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const a = String(ini), b = String(fim);
    const modelos = [...new Set(state.lancs.filter(l => l.data >= a && l.data <= b).map(l => l.modelo))];
    return modelos.map(modelo => {
      const ls = state.lancs.filter(l => l.modelo === modelo && l.data >= a && l.data <= b);
      const prod = registrosDemo.find(r => r.tipo === 'produto' && r.nome === modelo);
      const d = (prod?.dados ?? {}) as Record<string, string>;
      const entregues = pedidosDemo.filter(p => p.status === 'entregue' && p.entregueEm && p.entregueEm >= a && p.entregueEm <= b).flatMap(p => p.itens).filter(i => i.modelo === modelo);
      return {
        modelo, produzidas: ls.filter(l => l.etapa === 'Conferência').reduce((s, l) => s + l.qtd, 0),
        maoDeObra: r2(ls.reduce((s, l) => s + l.qtd * valorPecaDe(l.etapa, l.modelo), 0)),
        maoDeObraPeca: r2(['Corte', 'Costura', 'Conferência'].reduce((s, e) => s + valorPecaDe(e, modelo), 0)),
        preco: prod ? Number(d.preco) : null, custo: prod ? Number(d.custo) : null, cadastrado: !!prod,
        entreguesPecas: entregues.reduce((s, i) => s + i.qtd, 0), entreguesValor: r2(entregues.reduce((s, i) => s + i.qtd * i.preco, 0)),
      };
    }).sort((x, y) => y.produzidas - x.produzidas);
  },
});

// ---------------------------------------------------------------- matéria-prima (demonstração; mesma regra do banco)
interface MMaterial { id: string; nome: string; unidade: string; minimo: number; inicio: string; ativo: boolean; obs: string; regras: { etapa: string; modelo: string; qtdPorPeca: number }[] }
interface MMov { id: string; materialId: string; tipo: 'entrada' | 'saida' | 'ajuste'; qtd: number; data: string; valor: number | null; fornecedor: string; finId: string | null; obs: string; por: string }
const inicioMat = isoDay(addDays(new Date(), -45));
const materiaisDemo: MMaterial[] = [
  { id: 'm1', nome: 'Malha piquet', unidade: 'kg', minimo: 120, inicio: inicioMat, ativo: true, obs: '', regras: [{ etapa: 'Corte', modelo: 'Camisa Polo', qtdPorPeca: 0.22 }] },
  { id: 'm2', nome: 'Tecido tactel', unidade: 'm', minimo: 200, inicio: inicioMat, ativo: true, obs: '', regras: [{ etapa: 'Corte', modelo: 'Bermuda Tactel', qtdPorPeca: 0.6 }, { etapa: 'Corte', modelo: 'Jaqueta Corta-vento', qtdPorPeca: 1.4 }] },
  { id: 'm3', nome: 'Linha de costura', unidade: 'cone', minimo: 30, inicio: inicioMat, ativo: true, obs: 'Cone 4.000 m', regras: [{ etapa: 'Costura', modelo: '', qtdPorPeca: 0.01 }] },
  { id: 'm4', nome: 'Zíper 15 cm', unidade: 'un', minimo: 300, inicio: inicioMat, ativo: true, obs: '', regras: [{ etapa: 'Costura', modelo: 'Jaqueta Corta-vento', qtdPorPeca: 1 }, { etapa: 'Costura', modelo: 'Calça Jeans', qtdPorPeca: 1 }] },
  { id: 'm5', nome: 'Etiqueta bordada', unidade: 'un', minimo: 500, inicio: inicioMat, ativo: true, obs: '', regras: [{ etapa: 'Conferência', modelo: '', qtdPorPeca: 1 }] },
];
const movsDemo: MMov[] = [
  { id: 'mv1', materialId: 'm1', tipo: 'entrada', qtd: 900, data: inicioMat, valor: 31500, fornecedor: 'Tecelagem Sul', finId: null, obs: '', por: 'Edson' },
  { id: 'mv2', materialId: 'm2', tipo: 'entrada', qtd: 1800, data: inicioMat, valor: 16200, fornecedor: 'Tecelagem Sul', finId: null, obs: '', por: 'Edson' },
  { id: 'mv3', materialId: 'm3', tipo: 'entrada', qtd: 80, data: inicioMat, valor: 1440, fornecedor: 'Aviamentos Franca', finId: null, obs: '', por: 'Edson' },
  { id: 'mv4', materialId: 'm4', tipo: 'entrada', qtd: 2500, data: inicioMat, valor: 1750, fornecedor: 'Aviamentos Franca', finId: null, obs: '', por: 'Edson' },
  { id: 'mv5', materialId: 'm5', tipo: 'entrada', qtd: 6000, data: inicioMat, valor: 900, fornecedor: 'Aviamentos Franca', finId: null, obs: '', por: 'Edson' },
  { id: 'mv6', materialId: 'm1', tipo: 'saida', qtd: 12, data: isoDay(addDays(new Date(), -10)), valor: null, fornecedor: '', finId: null, obs: 'Perda no enfesto', por: 'Bruno Lima' },
];
function consumoMat(m: MMaterial, ini: string, fim: string) {
  let t = 0;
  for (const l of state.lancs) {
    if (l.data < (ini > m.inicio ? ini : m.inicio) || l.data > fim) continue;
    const esp = m.regras.find(r => r.etapa === l.etapa && r.modelo === l.modelo);
    const ger = m.regras.find(r => r.etapa === l.etapa && r.modelo === '');
    const r = esp ?? ger;
    if (r) t += l.qtd * r.qtdPorPeca;
  }
  return Math.round(t * 1000) / 1000;
}
function materialJson(m: MMaterial) {
  const mv = movsDemo.filter(x => x.materialId === m.id);
  const soma = (tipo: string) => mv.filter(x => x.tipo === tipo).reduce((s, x) => s + x.qtd, 0);
  const hoje = today(), consumo = consumoMat(m, m.inicio, hoje);
  const comValor = mv.filter(x => x.tipo === 'entrada' && x.valor !== null);
  const qv = comValor.reduce((s, x) => s + x.qtd, 0);
  return {
    ...m, entradas: soma('entrada'), saidas: soma('saida'), ajustes: soma('ajuste'), consumo, consumo30: consumoMat(m, isoDay(addDays(new Date(), -29)), hoje),
    saldo: Math.round((soma('entrada') - soma('saida') + soma('ajuste') - consumo) * 1000) / 1000,
    custoMedio: qv ? Math.round((comValor.reduce((s, x) => s + (x.valor ?? 0), 0) / qv) * 10000) / 10000 : null,
    ultimaEntrada: mv.filter(x => x.tipo === 'entrada').map(x => x.data).sort().pop() ?? null,
  };
}
Object.assign(ROTAS_MOCK, Object.fromEntries(['materiais', 'salvarMaterial', 'apagarMaterial', 'movimentarMaterial', 'movsMaterial', 'apagarMovMaterial', 'materialOpcoes'].map(f => [f, 'materiais'])));
Object.assign(handlers, {
  materiais: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return materiaisDemo.map(materialJson).sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome)); },
  salvarMaterial: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const r = o as MMaterial;
    if (!String(r.nome ?? '').trim()) throw fromServerMessage('Informe o nome do material.');
    if (!String(r.unidade ?? '').trim()) throw fromServerMessage('Informe a unidade (kg, m, un…).');
    if (materiaisDemo.some(m => m.id !== r.id && m.nome.toLowerCase() === r.nome.trim().toLowerCase())) throw fromServerMessage('Já existe um material com esse nome.');
    if ((r.regras ?? []).some(g => !(Number(g.qtdPorPeca) > 0))) throw fromServerMessage('Consumo por peça precisa ser maior que zero.');
    const ex = materiaisDemo.find(m => m.id === r.id);
    const base = { nome: r.nome.trim(), unidade: r.unidade.trim(), minimo: Number(r.minimo) || 0, obs: r.obs ?? '', regras: (r.regras ?? []).map(g => ({ ...g, qtdPorPeca: Number(g.qtdPorPeca) })) };
    if (ex) { Object.assign(ex, base, { ativo: r.ativo ?? ex.ativo, inicio: r.inicio || ex.inicio }); return ex.id; }
    const id = `m${Date.now()}`;
    materiaisDemo.push({ id, ativo: true, inicio: r.inicio || today(), ...base });
    return id;
  },
  apagarMaterial: ([t, id]: unknown[]) => { requireAdmin(userOf(String(t))); const i = materiaisDemo.findIndex(m => m.id === id); if (i < 0) throw fromServerMessage('Material não encontrado.'); materiaisDemo.splice(i, 1); return null; },
  movimentarMaterial: ([t, o]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const r = o as Record<string, unknown>;
    const m = materiaisDemo.find(x => x.id === r.materialId);
    if (!m) throw fromServerMessage('Material não encontrado.');
    let qtd = Number(r.qtd);
    if (r.tipo === 'ajuste') {
      qtd = Math.round((Number(r.contado) - materialJson(m).saldo) * 1000) / 1000;
      if (!Number.isFinite(qtd)) throw fromServerMessage('Informe a quantidade contada.');
      if (qtd === 0) throw fromServerMessage('O saldo contado é igual ao do sistema: nada a ajustar.');
    } else if (!(qtd > 0)) throw fromServerMessage('Informe uma quantidade maior que zero.');
    const forn = r.fornecedorId ? registrosDemo.find(x => x.id === r.fornecedorId && x.tipo === 'fornecedor') : undefined;
    let finId: string | null = null;
    if (r.contaId) {
      if (r.tipo !== 'entrada') throw fromServerMessage('Só a entrada (compra) é lançada no Financeiro.');
      if (!(Number(r.valor) > 0)) throw fromServerMessage('Informe o valor da compra para lançar no Financeiro.');
      conta(r.contaId);
      finId = uid();
      fin.lancamentos.push({ id: finId, tipo: 'saida', data: r.data || today(), descricao: `Compra: ${m.nome} (${qtd} ${m.unidade})`, valor: Number(r.valor), contaId: r.contaId, cartaoId: null,
        forma: '', categoria: 'Matéria-prima', responsavel: '', centro: '', parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0, vencimentoFatura: null,
        origemId: null, obs: '', contraparteId: forn ? forn.id : null, contraparte: forn ? String(forn.nome) : '' });
    }
    const id = `mv${Date.now()}`;
    movsDemo.push({ id, materialId: m.id, tipo: r.tipo as MMov['tipo'], qtd, data: String(r.data || today()), valor: r.tipo === 'entrada' && r.valor !== undefined && r.valor !== null && r.valor !== '' ? Number(r.valor) : null,
      fornecedor: forn ? String(forn.nome) : '', finId, obs: String(r.obs ?? ''), por: u.nome });
    return id;
  },
  movsMaterial: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const m = materiaisDemo.find(x => x.id === id);
    if (!m) throw fromServerMessage('Material não encontrado.');
    const meses = Array.from({ length: 6 }, (_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - k)); return isoDay(d).slice(0, 7); });
    return {
      movimentos: movsDemo.filter(x => x.materialId === m.id).sort((a, b) => b.data.localeCompare(a.data)).map(x => ({ ...x, noFinanceiro: !!x.finId })),
      consumoMensal: meses.map(mes => ({ mes, qtd: consumoMat(m, `${mes}-01`, `${mes}-31`) })),
    };
  },
  apagarMovMaterial: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const i = movsDemo.findIndex(x => x.id === id);
    if (i < 0) throw fromServerMessage('Movimento não encontrado.');
    if (movsDemo[i]!.finId && fin.lancamentos.some(l => l.id === movsDemo[i]!.finId && !l.apagado)) throw fromServerMessage('Esta compra está no Financeiro: exclua o lançamento lá antes.');
    movsDemo.splice(i, 1);
    return null;
  },
  materialOpcoes: ([t]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    return {
      fornecedores: registrosDemo.filter(r => r.tipo === 'fornecedor' && r.ativo !== false).map(r => ({ id: r.id, nome: r.nome })),
      contas: funcoesDe(u).financeiro ? fin.contas.filter(c => c.ativa).map(c => ({ id: c.id, nome: c.nome })) : [],
    };
  },
});

// ---------------------------------------------------------------- avisos (demonstração: não há servidor de envio)
const pushDemo = new Set<string>();
Object.assign(handlers, {
  pushInscrever: ([t, o]: unknown[]) => { userOf(String(t)); pushDemo.add(String((o as { endpoint: string }).endpoint)); return null; },
  pushCancelar: ([t, ep]: unknown[]) => { userOf(String(t)); pushDemo.delete(String(ep)); return null; },
  pushStatus: ([t, ep]: unknown[]) => { userOf(String(t)); return { esteAparelho: pushDemo.has(String(ep)), aparelhos: pushDemo.size, configurado: false }; },
});

// ---------------------------------------------------------------- vitrine (demonstração)
const vitrineDemo: { token: string | null; dias: number; usos: number; usosMax: number; whatsapp: string | null } = { token: 'demo-publico-'.padEnd(40, 'x'), dias: 7, usos: 3, usosMax: 50, whatsapp: null };
const exigeDonoDemo = (t: unknown) => { if (userOf(String(t)).login !== 'admin') throw fromServerMessage('Apenas o responsável pelo sistema pode fazer isto.'); };
Object.assign(handlers, {
  vitrine: () => ({ convite: vitrineDemo.token, dias: vitrineDemo.dias, whatsapp: vitrineDemo.whatsapp }),
  vitrineAdmin: ([t]: unknown[]) => {
    exigeDonoDemo(t);
    return { link: vitrineDemo.token ? { token: vitrineDemo.token, dias: vitrineDemo.dias, usos: vitrineDemo.usos, usosMax: vitrineDemo.usosMax, valido: vitrineDemo.usos < vitrineDemo.usosMax, empresas: vitrineDemo.usos } : null, whatsapp: vitrineDemo.whatsapp };
  },
  linkPublicoCriar: ([t, dias, usos]: unknown[]) => {
    exigeDonoDemo(t);
    Object.assign(vitrineDemo, { token: `demo-${Date.now()}`.padEnd(40, 'y'), dias: Number(dias), usos: 0, usosMax: Number(usos) });
    return vitrineDemo.token;
  },
  linkPublicoDesativar: ([t]: unknown[]) => { exigeDonoDemo(t); vitrineDemo.token = null; return null; },
  salvarContatoVitrine: ([t, w]: unknown[]) => {
    exigeDonoDemo(t);
    const v = String(w ?? '').replace(/\D/g, '');
    if (v && (v.length < 10 || v.length > 13)) throw fromServerMessage('WhatsApp inválido: informe DDD e número (com 55 opcional).');
    vitrineDemo.whatsapp = v ? (v.length <= 11 ? `55${v}` : v) : null;
    return null;
  },
});

// ---------------------------------------------------------------- oficinas e remessas (demonstração; mesma regra do banco)
interface MOrdem { id: string; numero: number; data: string; quem: string; login: string; modelo: string; cor: string; obs: string; materialId: string | null; materialQtd: number | null; itens: Record<string, number> }
interface MRemessa {
  id: string; numero: number; quem: string; login: string; oficinaId: string | null; etapa: string; dataEnvio: string; prazo: string | null;
  valorPeca: number; descontoFaltante: number; ordemId: string | null; status: 'aberta' | 'fechada'; fechadaEm: string | null; valorPago: number | null;
  finId: string | null; obs: string; itens: { id: string; modelo: string; cor: string; tamanho: string; qtd: number }[];
  retornos: { id: string; data: string; obs: string; cega?: boolean; itens: { itemId: string; boas: number; defeito: number }[] }[];
  token?: string | null;
  /** respostas da oficina pelo link (retornoId null = envio) */
  confirmacoes?: { retornoId: string | null; etapa?: 'envio' | 'retorno'; confere: boolean; em: string; nome: string; obs: string; itens: { itemId: string; qtd: number }[];
    resolvida?: { em: string; por: string; nota: string } | null; substituidaEm?: string | null }[];
}
let limitePerdaDemo = 3;
const ordensDemo: MOrdem[] = [];
const remessasDemo: MRemessa[] = [];
registrosDemo.push(
  { id: 'of1', tipo: 'oficina', nome: 'Costura da Maria', documento: '', telefone: '(16) 99999-3030', email: '', cidade: 'Franca/SP', obs: 'Faz moletom e polo', dados: { etapa: 'Costura', valorPeca: '2.50', pix: '16999993030' }, ativo: true, criadoEm: '2026-09-01' },
  { id: 'of2', tipo: 'oficina', nome: 'Facção Bom Ponto', documento: '', telefone: '(16) 98888-4040', email: '', cidade: 'Restinga/SP', obs: '', dados: { etapa: 'Costura', valorPeca: '2.20' }, ativo: true, criadoEm: '2026-09-15' },
  { id: 'of3', tipo: 'oficina', nome: 'Corte do João', documento: '', telefone: '(16) 97777-5050', email: '', cidade: 'Franca/SP', obs: '', dados: { etapa: 'Corte', valorPeca: '0.40' }, ativo: true, criadoEm: '2026-08-20' },
);
const quemDemo = (q: Record<string, string>) => {
  if (q?.login) { const u = state.users.find(x => x.login === q.login); if (!u) throw fromServerMessage('Pessoa não encontrada.'); return { login: u.login, nome: u.nome, oficinaId: null as string | null }; }
  if (q?.oficinaId) { const o = registrosDemo.find(x => x.id === q.oficinaId && x.tipo === 'oficina'); if (!o) throw fromServerMessage('Oficina não encontrada.'); return { login: '', nome: String(o.nome), oficinaId: String(o.id) }; }
  throw fromServerMessage('Informe quem fez (funcionário ou oficina).');
};
const lancDe = (quem: { login: string; nome: string }, etapa: string, modelo: string, cor: string, tamanho: string, qtd: number, data: string) =>
  state.lancs.push({ id: `L${state.nextId++}`, login: quem.login, nome: quem.login ? quem.nome : `${quem.nome} (oficina)`, etapa, modelo, cor, tamanho, qtd, data, hora: hhmm(), edicoes: 0, hist: '' } as MLanc);
(function seedRemessas() {
  const hoje = new Date();
  const d = (n: number) => isoDay(addDays(hoje, n));
  ordensDemo.push({ id: 'oc1', numero: 12, data: d(-6), quem: 'Corte do João', login: '', modelo: 'Camisa Polo', cor: 'Branco', obs: '', materialId: 'm1', materialQtd: 30, itens: { P: 40, M: 50, G: 30 } });
  remessasDemo.push({
    id: 'rm1', numero: 31, quem: 'Costura da Maria', login: '', oficinaId: 'of1', etapa: 'Costura', dataEnvio: d(-5), prazo: d(-1), valorPeca: 2.5, descontoFaltante: 8, ordemId: 'oc1',
    status: 'aberta', fechadaEm: null, valorPago: null, finId: null, obs: '',
    itens: [{ id: 'ri1', modelo: 'Camisa Polo', cor: 'Branco', tamanho: 'P', qtd: 40 }, { id: 'ri2', modelo: 'Camisa Polo', cor: 'Branco', tamanho: 'M', qtd: 50 }],
    retornos: [{ id: 'rt1', data: d(-2), obs: '', cega: true, itens: [{ itemId: 'ri1', boas: 38, defeito: 1 }, { itemId: 'ri2', boas: 30, defeito: 0 }] }],
    token: 'demo0000000000000000000000000031',
    confirmacoes: [
      { retornoId: null, confere: true, em: `${d(-5)}T15:20:00`, nome: 'Maria', obs: '', itens: [] },
      { retornoId: 'rt1', confere: false, em: `${d(-2)}T17:05:00`, nome: 'Maria', obs: 'Entreguei 32 do M, contei na frente do motoboy', itens: [{ itemId: 'ri2', qtd: 32 }] },
    ],
  }, {
    id: 'rm2', numero: 32, quem: 'Facção Bom Ponto', login: '', oficinaId: 'of2', etapa: 'Costura', dataEnvio: d(-3), prazo: d(4), valorPeca: 2.2, descontoFaltante: 0, ordemId: 'oc1',
    status: 'aberta', fechadaEm: null, valorPago: null, finId: null, obs: '', itens: [{ id: 'ri3', modelo: 'Camisa Polo', cor: 'Branco', tamanho: 'G', qtd: 30 }], retornos: [],
    token: 'demo0000000000000000000000000032',
  }, {
    id: 'rm0', numero: 29, quem: 'Costura da Maria', login: '', oficinaId: 'of1', etapa: 'Costura', dataEnvio: d(-20), prazo: d(-12), valorPeca: 2.5, descontoFaltante: 8, ordemId: null,
    status: 'fechada', fechadaEm: d(-11), valorPago: 292, finId: null, obs: '',
    itens: [{ id: 'ri0', modelo: 'Bermuda Tactel', cor: 'Preto', tamanho: 'M', qtd: 120 }], retornos: [{ id: 'rt0', data: d(-12), obs: '', itens: [{ itemId: 'ri0', boas: 120, defeito: 0 }] }],
  });
})();
const remessaJson = (r: MRemessa) => ({
  id: r.id, numero: r.numero, quem: r.quem, login: r.login || null, oficinaId: r.oficinaId, telefone: r.oficinaId ? String(registrosDemo.find(x => x.id === r.oficinaId)?.telefone ?? '') : null,
  etapa: r.etapa, dataEnvio: r.dataEnvio, prazo: r.prazo, valorPeca: r.valorPeca, descontoFaltante: r.descontoFaltante,
  ordemId: r.ordemId, ordemNumero: ordensDemo.find(o => o.id === r.ordemId)?.numero ?? null, status: r.status, fechadaEm: r.fechadaEm, valorPago: r.valorPago,
  noFinanceiro: !!r.finId && fin.lancamentos.some(l => l.id === r.finId && !l.apagado), obs: r.obs,
  token: r.token ?? null, confirmacaoEnvio: confDemo(r, null),
  historico: (r.confirmacoes ?? []).filter(c => c.substituidaEm).map(c => ({ ...confJson(c), etapa: c.etapa ?? (c.retornoId ? 'retorno' : 'envio'), substituidaEm: c.substituidaEm })),
  itens: r.itens.map(i => ({ ...i, boas: r.retornos.flatMap(t => t.itens).filter(x => x.itemId === i.id).reduce((s, x) => s + x.boas, 0),
    defeito: r.retornos.flatMap(t => t.itens).filter(x => x.itemId === i.id).reduce((s, x) => s + x.defeito, 0) })),
  retornos: r.retornos.map(t => ({ id: t.id, data: t.data, obs: t.obs, boas: t.itens.reduce((s, x) => s + x.boas, 0), defeito: t.itens.reduce((s, x) => s + x.defeito, 0),
    cega: !!t.cega, itens: t.itens, confirmacao: confDemo(r, t.id) })),
});
type ConfDemo = NonNullable<MRemessa['confirmacoes']>[number];
const confAtual = (r: MRemessa, retornoId: string | null) => (r.confirmacoes ?? []).find(x => !x.substituidaEm && (retornoId ? x.retornoId === retornoId : (x.etapa ?? 'envio') === 'envio' && x.retornoId === null));
const confJson = (c: ConfDemo) => ({ confere: c.confere, em: c.em, nome: c.nome, obs: c.obs, itens: c.itens, resolvida: c.resolvida ?? null });
function confDemo(r: MRemessa, retornoId: string | null) {
  const c = confAtual(r, retornoId);
  return c ? confJson(c) : null;
}
const contestacaoAbertaDemo = (r: MRemessa, retornoId?: string) =>
  (r.confirmacoes ?? []).some(c => !c.substituidaEm && !c.confere && !c.resolvida && (!retornoId || c.retornoId === retornoId));
const remessaPorToken = (token: unknown) => {
  if (!/^[a-z0-9]{32}$/.test(String(token ?? ''))) throw fromServerMessage('LINK_INVALIDO: Link inválido. Peça um novo link para a fábrica.');
  const r = remessasDemo.find(x => x.token === token);
  if (!r) throw fromServerMessage('LINK_INVALIDO: Este link não vale mais. Peça um novo link para a fábrica.');
  return r;
};
const consumoPecaDe = (matId: string, modelo: string) => {
  const m = materiaisDemo.find(x => x.id === matId);
  return m?.regras.find(r => r.etapa === 'Corte' && r.modelo === modelo)?.qtdPorPeca ?? m?.regras.find(r => r.etapa === 'Corte' && r.modelo === '')?.qtdPorPeca ?? null;
};
Object.assign(ROTAS_MOCK, Object.fromEntries(['remessas', 'remessaOpcoes', 'salvarOrdemCorte', 'apagarOrdemCorte', 'salvarRemessa', 'apagarRemessa', 'registrarRetorno', 'apagarRetorno', 'fecharRemessa', 'reabrirRemessa', 'remessaLink', 'salvarLimitePerda', 'resolverContestacao'].map(f => [f, 'remessas'])), { lancarPor: 'lancar' });
Object.assign(handlers, {
  remessas: ([t]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    return {
      limitePerda: limitePerdaDemo,
      remessas: remessasDemo.map(remessaJson).sort((a, b) => Number(b.status === 'aberta') - Number(a.status === 'aberta') || (a.prazo ?? '9').localeCompare(b.prazo ?? '9') || b.numero - a.numero),
      ordens: [...ordensDemo].sort((a, b) => b.data.localeCompare(a.data)).map(o => {
        const m = materiaisDemo.find(x => x.id === o.materialId);
        return { ...o, material: m?.nome ?? null, unidade: m?.unidade ?? null, consumoPeca: o.materialId ? consumoPecaDe(o.materialId, o.modelo) : null,
          remetido: remessasDemo.filter(r => r.ordemId === o.id).flatMap(r => r.itens).reduce((s, i) => s + i.qtd, 0) };
      }),
    };
  },
  remessaOpcoes: ([t]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    return {
      oficinas: registrosDemo.filter(r => r.tipo === 'oficina' && r.ativo !== false).map(r => ({ id: r.id, nome: r.nome, telefone: r.telefone, etapa: (r.dados as Record<string, string>).etapa ?? '', valorPeca: Number((r.dados as Record<string, string>).valorPeca) || null })),
      pessoas: state.users.filter(x => x.ativo && !x.leitura).map(x => ({ login: x.login, nome: x.nome, setor: x.setor })),
      materiais: materiaisDemo.filter(m => m.ativo).map(m => ({ id: m.id, nome: m.nome, unidade: m.unidade })),
      contas: funcoesDe(u).financeiro ? fin.contas.filter(c => c.ativa).map(c => ({ id: c.id, nome: c.nome })) : [],
    };
  },
  salvarOrdemCorte: ([t, o]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const r = o as { quem: Record<string, string>; data: string; modelo: string; cor: string; materialId?: string; materialQtd?: number; obs: string; itens: { tamanho: string; qtd: number }[] };
    const quem = quemDemo(r.quem);
    const itens = r.itens.filter(i => Number(i.qtd) > 0);
    if (!itens.length) throw fromServerMessage('Informe a quantidade cortada em pelo menos um tamanho.');
    const numero = Math.max(0, ...ordensDemo.map(x => x.numero)) + 1, id = `oc${Date.now()}`, data = r.data || today();
    ordensDemo.push({ id, numero, data, quem: quem.nome, login: quem.login, modelo: r.modelo, cor: r.cor, obs: r.obs ?? '', materialId: r.materialId || null, materialQtd: r.materialQtd ? Number(r.materialQtd) : null,
      itens: Object.fromEntries(itens.map(i => [i.tamanho, Number(i.qtd)])) });
    for (const i of itens) lancDe(quem, 'Corte', r.modelo, r.cor, i.tamanho, Number(i.qtd), data);
    if (r.materialId && r.materialQtd) movsDemo.push({ id: `mv${Date.now()}`, materialId: r.materialId, tipo: 'saida', qtd: Number(r.materialQtd), data, valor: null, fornecedor: '', finId: null, obs: `Ordem de corte #${numero}`, por: u.nome });
    return { id, numero, pecas: itens.reduce((s, i) => s + Number(i.qtd), 0) };
  },
  apagarOrdemCorte: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    if (remessasDemo.some(r => r.ordemId === id)) throw fromServerMessage('Há remessa feita a partir desta ordem: exclua a remessa antes.');
    const i = ordensDemo.findIndex(o => o.id === id); if (i < 0) throw fromServerMessage('Ordem de corte não encontrada.');
    ordensDemo.splice(i, 1); return null;
  },
  salvarRemessa: ([t, o]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const r = o as RemessaInputMock;
    const quem = quemDemo(r.quem);
    if (r.etapa === 'Corte') throw fromServerMessage('Etapa inválida para remessa.');
    if (!r.itens?.length) throw fromServerMessage('Inclua pelo menos um item na remessa.');
    if (r.prazo && r.prazo < r.dataEnvio) throw fromServerMessage('O prazo não pode ser antes do envio.');
    const ex = remessasDemo.find(x => x.id === r.id);
    if (ex && ex.retornos.length) throw fromServerMessage('Já há retorno nesta remessa: não dá para mudar os itens. Registre a diferença no retorno.');
    const base = { quem: quem.nome, login: quem.login, oficinaId: quem.oficinaId, etapa: r.etapa || 'Costura', dataEnvio: r.dataEnvio || today(), prazo: r.prazo || null,
      valorPeca: Number(r.valorPeca) || 0, descontoFaltante: Number(r.descontoFaltante) || 0, ordemId: r.ordemId || null, obs: r.obs ?? '',
      itens: r.itens.map((i, n) => ({ id: `ri${Date.now()}${n}`, modelo: i.modelo, cor: i.cor, tamanho: i.tamanho, qtd: Number(i.qtd) })) };
    if (ex) {
      const chave = (l: { modelo: string; cor: string; tamanho: string; qtd: number }[]) => JSON.stringify(l.map(i => [i.modelo, i.cor, i.tamanho, Number(i.qtd)]).sort());
      const mudou = chave(ex.itens) !== chave(base.itens);
      if (mudou && contestacaoAbertaDemo(ex)) throw fromServerMessage('A oficina contestou esta remessa: resolva a contestação antes de mudar os itens.');
      if (!mudou) base.itens = ex.itens;   // mesmos itens: mantém (e mantém a confirmação)
      Object.assign(ex, base);
      if (mudou) for (const c of ex.confirmacoes ?? []) if (!c.substituidaEm && (c.etapa ?? 'envio') === 'envio' && c.retornoId === null) c.substituidaEm = new Date().toISOString();
      return { id: ex.id, numero: ex.numero, pecas: base.itens.reduce((s, i) => s + i.qtd, 0) }; }
    const numero = Math.max(0, ...remessasDemo.map(x => x.numero)) + 1, id = `rm${Date.now()}`;
    remessasDemo.push({ id, numero, status: 'aberta', fechadaEm: null, valorPago: null, finId: null, retornos: [], ...base });
    return { id, numero, pecas: base.itens.reduce((s, i) => s + i.qtd, 0) };
  },
  remessaLink: ([t, id, novo]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const r = remessasDemo.find(x => x.id === id); if (!r) throw fromServerMessage('Remessa não encontrada.');
    if (!r.token || novo) r.token = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    return r.token;
  },
  salvarLimitePerda: ([t, limite]: unknown[]) => {
    if (userOf(String(t)).perfil !== 'admin') throw fromServerMessage('Apenas o administrador pode fazer isto.');   // quem é vigiado pelos avisos não muda o limite
    const n = Number(limite);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw fromServerMessage('Informe um limite entre 0 e 100%.');
    limitePerdaDemo = Math.round(n * 100) / 100; return limitePerdaDemo;
  },
  resolverContestacao: ([t, remessaId, retornoId, nota]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const r = remessasDemo.find(x => x.id === remessaId); if (!r) throw fromServerMessage('Remessa não encontrada.');
    const c = confAtual(r, (retornoId as string | null) || null);
    if (!c || c.confere || c.resolvida) throw fromServerMessage('Não há contestação em aberto nesta etapa.');
    const n = String(nota ?? '').trim();
    if (n.length < 3) throw fromServerMessage('Escreva o que foi decidido (ex.: recontamos juntos, eram 88).');
    c.resolvida = { em: new Date().toISOString(), por: u.nome, nota: n.slice(0, 300) };
    return null;
  },
  remessaPublica: ([token]: unknown[]) => {
    const r = remessaPorToken(token); const j = remessaJson(r);
    return { empresa: 'Confecção Demonstração', numero: r.numero, quem: r.quem, etapa: r.etapa, dataEnvio: r.dataEnvio, prazo: r.prazo, valorPeca: r.valorPeca,
      descontoFaltante: r.descontoFaltante, status: r.status, fechadaEm: r.fechadaEm, valorPago: r.valorPago,
      enviadas: j.itens.reduce((n, i) => n + i.qtd, 0), boas: j.itens.reduce((n, i) => n + i.boas, 0), defeito: j.itens.reduce((n, i) => n + i.defeito, 0),
      itens: j.itens, confirmacaoEnvio: confDemo(r, null), retornos: r.retornos.map(x => ({ id: x.id, data: x.data, itens: x.itens, confirmacao: confDemo(r, x.id) })) };
  },
  remessaConfirmar: ([token, o]: unknown[]) => {
    const r = remessaPorToken(token);
    const p = o as { retornoId: string | null; confere: boolean; itens: { itemId: string; qtd: number }[]; nome: string; obs: string };
    const retornoId = p.retornoId || null;
    const ret = retornoId ? r.retornos.find(x => x.id === retornoId) : null;
    if (retornoId && !ret) throw fromServerMessage('Retorno inválido.');
    if (confAtual(r, retornoId)) throw fromServerMessage('Esta etapa já foi respondida. Se precisar corrigir, fale com a fábrica.');
    const esperado = new Map<string, number>(ret ? ret.itens.map(i => [i.itemId, i.boas + i.defeito] as [string, number]) : r.itens.map(i => [i.id, i.qtd] as [string, number]));
    const contado = new Map(esperado);
    if (!p.confere) {
      if (!p.itens?.length) throw fromServerMessage('Informe quantas peças você contou em cada item.');
      for (const i of p.itens) {
        if (!esperado.has(i.itemId)) throw fromServerMessage('Item inválido.');
        if (!Number.isInteger(Number(i.qtd)) || Number(i.qtd) < 0 || Number(i.qtd) > 999999) throw fromServerMessage('Quantidade inválida.');
        contado.set(i.itemId, Number(i.qtd));
      }
    }
    const dif = [...contado].filter(([k, v]) => v !== esperado.get(k));
    const tot = (m: Map<string, number>) => [...m.values()].reduce((n, x) => n + x, 0);
    (r.confirmacoes ??= []).push({ retornoId, etapa: retornoId ? 'retorno' : 'envio', confere: dif.length === 0, em: new Date().toISOString(), nome: String(p.nome ?? '').slice(0, 60), obs: String(p.obs ?? '').slice(0, 300),
      itens: dif.map(([itemId, qtd]) => ({ itemId, qtd })) });
    return { confere: dif.length === 0, fabrica: tot(esperado), oficina: tot(contado) };
  },
  apagarRemessa: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const i = remessasDemo.findIndex(r => r.id === id); if (i < 0) throw fromServerMessage('Remessa não encontrada.');
    if (remessasDemo[i]!.retornos.length) throw fromServerMessage('A remessa já tem retorno: exclua os retornos antes.');
    if (contestacaoAbertaDemo(remessasDemo[i]!)) throw fromServerMessage('A oficina contestou esta remessa: resolva a contestação antes de excluir.');
    remessasDemo.splice(i, 1); return null;
  },
  registrarRetorno: ([t, o]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const p = o as { remessaId: string; data: string; obs: string; cega?: boolean; itens: { itemId: string; boas: number; defeito: number }[] };
    const r = remessasDemo.find(x => x.id === p.remessaId); if (!r) throw fromServerMessage('Remessa não encontrada.');
    if (r.status !== 'aberta') throw fromServerMessage('A remessa já foi fechada. Reabra para registrar retorno.');
    const itens = p.itens.filter(i => Number(i.boas) + Number(i.defeito) > 0);
    if (!itens.length) throw fromServerMessage('Informe quantas peças voltaram (boas ou com defeito).');
    for (const i of itens) {
      const it = r.itens.find(x => x.id === i.itemId); if (!it) throw fromServerMessage('Item inválido na remessa.');
      const ja = r.retornos.flatMap(x => x.itens).filter(x => x.itemId === it.id).reduce((s, x) => s + x.boas + x.defeito, 0);
      if (ja + Number(i.boas) + Number(i.defeito) > it.qtd && p.cega) throw fromServerMessage(`${it.modelo} ${it.cor} ${it.tamanho}: a contagem passa do que foi enviado. Reconte essas peças.`);
      if (ja + Number(i.boas) + Number(i.defeito) > it.qtd) throw fromServerMessage(`${it.modelo} ${it.cor} ${it.tamanho}: voltaram ${ja + Number(i.boas) + Number(i.defeito)} de ${it.qtd} enviadas (já tinham voltado ${ja}).`);
    }
    const id = `rt${Date.now()}`, data = p.data || today();
    r.retornos.push({ id, data, obs: p.obs ?? '', cega: !!p.cega, itens: itens.map(i => ({ itemId: i.itemId, boas: Number(i.boas), defeito: Number(i.defeito) })) });
    for (const i of itens) { const it = r.itens.find(x => x.id === i.itemId)!; if (Number(i.boas) > 0) lancDe({ login: r.login, nome: r.quem }, r.etapa, it.modelo, it.cor, it.tamanho, Number(i.boas), data); }
    return id;
  },
  apagarRetorno: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const r = remessasDemo.find(x => x.retornos.some(y => y.id === id)); if (!r) throw fromServerMessage('Retorno não encontrado.');
    if (r.status !== 'aberta') throw fromServerMessage('A remessa já foi fechada. Reabra para corrigir.');
    if (contestacaoAbertaDemo(r, String(id))) throw fromServerMessage('A oficina contestou esta devolução: resolva a contestação antes de excluir.');
    for (const c of r.confirmacoes ?? []) if (c.retornoId === id && !c.substituidaEm) { c.substituidaEm = new Date().toISOString(); c.retornoId = null; c.etapa = 'retorno'; }
    r.retornos = r.retornos.filter(y => y.id !== id); return null;
  },
  fecharRemessa: ([t, id, pagar]: unknown[]) => {
    const u = userOf(String(t)); requireAdmin(u);
    const r = remessasDemo.find(x => x.id === id); if (!r) throw fromServerMessage('Remessa não encontrada.');
    if (r.status !== 'aberta') throw fromServerMessage('A remessa já está fechada.');
    if (contestacaoAbertaDemo(r)) throw fromServerMessage('A oficina contestou uma contagem desta remessa: resolva a contestação antes de acertar.');
    const j = remessaJson(r);
    const env = j.itens.reduce((s, i) => s + i.qtd, 0), boas = j.itens.reduce((s, i) => s + i.boas, 0), def = j.itens.reduce((s, i) => s + i.defeito, 0);
    const falt = env - boas - def, valor = Math.max(0, Math.round((boas * r.valorPeca - falt * r.descontoFaltante) * 100) / 100);
    const pg = pagar as { contaId: string; data: string } | null;
    if (pg && valor > 0) {
      conta(pg.contaId);
      r.finId = uid();
      fin.lancamentos.push({ id: r.finId, tipo: 'saida', data: pg.data || today(), descricao: `Remessa #${r.numero} · ${r.etapa} · ${r.quem} (${boas} peças)`, valor, contaId: pg.contaId, cartaoId: null,
        forma: '', categoria: 'Facção', responsavel: r.quem, centro: '', parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0, vencimentoFatura: null, origemId: null, obs: '',
        contraparteId: r.oficinaId, contraparte: r.oficinaId ? r.quem : '' });
    }
    Object.assign(r, { status: 'fechada', fechadaEm: today(), valorPago: valor });
    return { enviadas: env, boas, defeito: def, faltando: falt, valor, noFinanceiro: !!(pg && valor > 0) };
  },
  reabrirRemessa: ([t, id]: unknown[]) => {
    requireAdmin(userOf(String(t)));
    const r = remessasDemo.find(x => x.id === id); if (!r) throw fromServerMessage('Remessa não encontrada.');
    if (r.status !== 'fechada') throw fromServerMessage('A remessa já está aberta.');
    const l = fin.lancamentos.find(x => x.id === r.finId); if (l) l.apagado = true;
    Object.assign(r, { status: 'aberta', fechadaEm: null, valorPago: null, finId: null }); return null;
  },
  lancarPor: ([t, por, o]: unknown[]) => {
    const u = userOf(String(t));
    if (u.perfil !== 'admin') throw fromServerMessage('Apenas o administrador lança em nome de outra pessoa.');
    const quem = quemDemo(por as Record<string, string>);
    const r = o as LancamentoInput;
    let total = 0;
    for (const i of r.itens) if (Number(i.qtd) > 0) { lancDe(quem, r.etapa, r.modelo, r.cor, i.tamanho, Number(i.qtd), today()); total += Number(i.qtd); }
    if (!total) throw fromServerMessage('Informe a quantidade em pelo menos um tamanho.');
    return { total, avisos: [] };
  },
});
type RemessaInputMock = { id?: string; quem: Record<string, string>; etapa: string; dataEnvio: string; prazo: string | null; valorPeca: number; descontoFaltante: number; ordemId?: string | null; obs: string; itens: { modelo: string; cor: string; tamanho: string; qtd: number }[] };

// ---------------------------------------------------------------- Dani (demonstração: sem IA, configuração fictícia)
const daniDemo = { configurada: false, final: null as string | null, modelo: '' };
Object.assign(handlers, {
  daniConfig: ([t]: unknown[]) => { exigeDonoDemo(t); return { ...daniDemo, perguntasHoje: 0 }; },
  daniModelos: ([t]: unknown[]) => { exigeDonoDemo(t); if (!daniDemo.configurada) throw fromServerMessage('Salve a chave do Gemini primeiro.'); return { modelos: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash'], recomendados: ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'] }; },
  salvarDani: ([t, chave, modelo]: unknown[]) => {
    exigeDonoDemo(t);
    const k = String(chave ?? '').trim();
    if (k === '-') { daniDemo.configurada = false; daniDemo.final = null; }
    else if (k) { if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{29,119}$/.test(k)) throw fromServerMessage('Chave do Gemini inválida: copie a chave inteira do Google AI Studio (começa com AIza ou AQ.).'); daniDemo.configurada = true; daniDemo.final = k.slice(-4); }
    daniDemo.modelo = String(modelo ?? '').trim();
    return null;
  },
});
