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
const funcaoDaChamada = (fn: string): string | null =>
  fn.startsWith('fin') ? 'financeiro' : fn.startsWith('dre') ? 'resultado'
  : ['listarUsuarios', 'salvarUsuario', 'salvarListas', 'criarChave', 'revogarChaves', 'exportar', 'funcoesPessoa', 'salvarFuncoes', 'verWifi', 'salvarWifi'].includes(fn) ? 'cadastros'
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
  const L = (o: Record<string, unknown>) => fin.lancamentos.push({ id: uid(), forma: '', categoria: '', responsavel: 'Edson', centro: 'Produção', parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0, vencimentoFatura: null, origemId: null, obs: '', contaId: null, cartaoId: null, ...o });
  L({ tipo: 'entrada', data: `${p}-08`, descricao: 'Venda lote 118 · Loja Centro', valor: 14800, contaId: 'cc', categoria: 'Vendas', centro: 'Comercial' });
  L({ tipo: 'saida', data: `${p}-10`, descricao: 'Tecido malha 300 kg', valor: 6200, contaId: 'cc', categoria: 'Matéria-prima', forma: 'Boleto' });
  L({ tipo: 'saida', data: `${p}-05`, descricao: 'Folha de pagamento', valor: 9200, contaId: 'cc', categoria: 'Folha de pagamento', centro: 'Administrativo', forma: 'Transferência' });
  L({ tipo: 'entrada', data: `${m}-06`, descricao: 'Venda lote 121 · Atacado', valor: 21400, contaId: 'cc', categoria: 'Vendas', centro: 'Comercial', forma: 'PIX' });
  L({ tipo: 'saida', data: `${m}-05`, descricao: 'Folha de pagamento', valor: 9350, contaId: 'cc', categoria: 'Folha de pagamento', centro: 'Administrativo', forma: 'Transferência' });
  L({ tipo: 'saida', data: `${m}-10`, descricao: 'Aluguel do galpão', valor: 4800, contaId: 'cc', categoria: 'Aluguel', centro: 'Administrativo', forma: 'Boleto' });
  L({ tipo: 'saida', data: `${m}-12`, descricao: 'Energia elétrica', valor: 1730, contaId: 'cc', categoria: 'Energia e água', forma: 'Débito automático' });
  L({ tipo: 'saida', data: `${m}-14`, descricao: 'Linhas e aviamentos', valor: 860, cartaoId: 'visa', categoria: 'Matéria-prima', vencimentoFatura: vencFatura(`${m}-14`, 25, 5) });
  L({ tipo: 'saida', data: `${m}-18`, descricao: 'Anúncios Instagram', valor: 450, cartaoId: 'visa', categoria: 'Marketing', centro: 'Comercial', vencimentoFatura: vencFatura(`${m}-18`, 25, 5) });
  L({ tipo: 'programada', data: `${p}-20`, descricao: 'Máquina overloque', valor: 7200, contaId: 'cc', parcelas: 6, valorParcela: 1200, diaVencimento: 20, parcelasPagas: 1, categoria: 'Manutenção', forma: 'Boleto' });
  L({ tipo: 'programada', data: `${m}-02`, descricao: 'Contador (mensal)', valor: 900, contaId: 'cc', parcelas: 12, valorParcela: 900, diaVencimento: 15, categoria: 'Outros', centro: 'Administrativo', forma: 'PIX' });
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
(function seedDre() {
  const vals = (o: Record<string, number>) => Object.fromEntries(dreCats.map(c => [c.id as string, c.chave as string in o ? { marca: 'valor', valor: o[c.chave as string]! } : { marca: 'na', valor: null }]));
  dreMeses.push({ mes: mesMenos(1), status: 'fechado', atualizadoEm: `${today()}T09:00`, valores: vals({ gross: 52000, returns: 1300, tax: 4700, cmv: 21500, ads: 900, shipping: 1600, commission: 1250, rent: 4800, accountant: 900, electricity: 650, prolabore: 6000, interest: 180 }) });
  dreMeses.push({ mes: mesMenos(2), status: 'fechado', atualizadoEm: `${today()}T09:00`, valores: vals({ gross: 47500, returns: 900, tax: 4300, cmv: 20100, ads: 900, shipping: 1450, commission: 1100, rent: 4800, accountant: 900, electricity: 610, prolabore: 6000 }) });
  dreMeses.push({ mes: mesMenos(3), status: 'fechado', atualizadoEm: `${today()}T09:00`, valores: vals({ gross: 39800, returns: 1500, tax: 3600, cmv: 19800, ads: 1400, shipping: 1300, commission: 900, rent: 4800, accountant: 900, electricity: 640, prolabore: 6000 }) });
})();

Object.assign(handlers, {
  criarChave: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return 'demo-key'; },
  revogarChaves: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return 0; },
  exportar: ([t]: unknown[]) => { requireAdmin(userOf(String(t))); return { formato: 'fabrica-backup-1', geradoEm: `${today()}T12:00:00`, empresa: { codigo: 'demo', nome: 'Confecção Demonstração' }, tabelas: { financeiro: finSnapshot(), dre_meses: dreMeses } }; },

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
    const cartao = r.tipo !== 'entrada' && r.cartaoId ? fin.cartoes.find(c => c.id === r.cartaoId) : undefined;
    if (!cartao) conta(r.contaId);
    if (r.tipo === 'programada' && !cartao && !(Number(r.diaVencimento) >= 1)) throw fromServerMessage('Informe o dia do vencimento (1 a 31).');
    const item = { forma: '', categoria: '', responsavel: '', centro: '', obs: '', parcelasPagas: 0, origemId: null, parcelas: null, valorParcela: null, diaVencimento: null, ...r,
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
      forma: l.forma, categoria: l.categoria, responsavel: l.responsavel, centro: l.centro, parcelas: null, valorParcela: null, diaVencimento: null, parcelasPagas: 0, vencimentoFatura: null, origemId: l.id, obs: '' });
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
const FUNCOES = ['painel', 'dashboard', 'relatorio', 'falta', 'lancar', 'ponto', 'financeiro', 'resultado', 'cadastros', 'acessos', 'empresas'];
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
