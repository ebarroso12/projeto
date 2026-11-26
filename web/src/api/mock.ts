/**
 * Servidor de demonstração em memória. Implementa o mesmo contrato do Api.gs, com dados fictícios.
 * Serve para: modo demonstração (config.js sem apiUrl), desenvolvimento e testes automáticos.
 *
 * Logins de teste: admin/admin · ana/1234 (costura) · bruno/1234 (corte) · carla/1234 (conferência)
 * Chave "só ver": ?k=demo-key
 */
import { hmToMin, isoDay } from '../lib/format';
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

  for (let k = 14; k >= 1; k--) {
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
const requireAdmin = (u: MUser) => { if (u.perfil !== 'admin') throw fromServerMessage('Apenas o administrador pode fazer isto.'); };
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
    eu: { nome: u.nome, setor: u.setor, admin: u.perfil === 'admin', leitura: !!u.leitura, podeFalta: u.podeFalta, demo: false },
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
    if (String(nova).length < 4) throw fromServerMessage('A nova senha precisa ter pelo menos 4 caracteres.');
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
    if (r.novo && r.senha.length < 4) throw fromServerMessage('A senha precisa ter pelo menos 4 caracteres.');
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

export function createMockTransport(latencyMs = 120): Transport {
  return async (fn, args) => {
    await new Promise(r => setTimeout(r, latencyMs));
    const h = handlers[fn];
    if (!h) throw new ApiError('SERVIDOR', `Função desconhecida: ${fn}`);
    return structuredClone(h(args));
  };
}
