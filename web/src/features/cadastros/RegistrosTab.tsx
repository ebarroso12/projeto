import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Registro2, RegistroInput, TipoRegistro } from '../../api/types';
import { useApi } from '../../app/auth';
import { useBoot } from '../../app/boot';
import { pode } from '../../app/registry';
import { useAction } from '../../app/useAction';
import { dataBR, formatBRL } from '../../lib/format';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { Dialog, useConfirm } from '../../ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { QueryView } from '../../ui/QueryView';
import { Badge, Card, Segmented } from '../../ui/primitives';
import { BOOT_KEY } from '../../app/boot';
import { HistoricoContraparte } from './HistoricoContraparte';

interface Campo { k: string; label: string; tipo?: 'texto' | 'moeda' | 'longo'; dica?: string; meia?: boolean }
interface Config {
  titulo: string; singular: string; icone: 'card' | 'users' | 'building' | 'wallet';
  nome: string; documento?: string; contato: boolean; extras: Campo[];
  colunas: (r: Registro2) => { sub: string; extra?: string };
}

const CONFIG: Record<TipoRegistro, Config> = {
  produto: {
    titulo: 'Produtos', singular: 'produto', icone: 'card', nome: 'Nome do produto (modelo)', contato: false,
    extras: [
      { k: 'referencia', label: 'Referência / código', meia: true }, { k: 'unidade', label: 'Unidade', dica: 'peça, kit, dúzia…', meia: true },
      { k: 'preco', label: 'Preço de venda (R$)', tipo: 'moeda', meia: true }, { k: 'custo', label: 'Custo (R$)', tipo: 'moeda', meia: true },
      { k: 'cores', label: 'Cores', dica: 'Separe por vírgula. Entram na lista do Lançar.' },
      { k: 'tamanhos', label: 'Tamanhos', dica: 'Separe por vírgula. Ex.: P, M, G, GG' },
      { k: 'categoria', label: 'Categoria / coleção', meia: true }, { k: 'ncm', label: 'NCM (opcional)', meia: true },
    ],
    colunas: r => {
      const p = Number(r.dados.preco), c = Number(r.dados.custo);
      const margem = p > 0 && c >= 0 ? Math.round(((p - c) / p) * 100) : null;
      return { sub: [r.dados.referencia, r.dados.cores].filter(Boolean).join(' · '), extra: p ? `${formatBRL(p)}${margem !== null ? ` · margem ${margem}%` : ''}` : '' };
    },
  },
  cliente: {
    titulo: 'Clientes', singular: 'cliente', icone: 'users', nome: 'Nome / razão social', documento: 'CPF ou CNPJ', contato: true,
    extras: [{ k: 'contato', label: 'Pessoa de contato', meia: true }, { k: 'prazo', label: 'Prazo de pagamento', meia: true }, { k: 'endereco', label: 'Endereço' }],
    colunas: r => ({ sub: [r.documento, r.cidade].filter(Boolean).join(' · '), extra: [r.telefone, r.dados.contato].filter(Boolean).join(' · ') }),
  },
  fornecedor: {
    titulo: 'Fornecedores', singular: 'fornecedor', icone: 'building', nome: 'Nome / razão social', documento: 'CNPJ ou CPF', contato: true,
    extras: [{ k: 'produtos', label: 'O que fornece', dica: 'Ex.: malha, zíper, etiquetas' }, { k: 'contato', label: 'Pessoa de contato', meia: true },
      { k: 'prazo', label: 'Prazo de pagamento', meia: true }, { k: 'pix', label: 'PIX / dados bancários' }, { k: 'endereco', label: 'Endereço' }],
    colunas: r => ({ sub: [r.dados.produtos, r.cidade].filter(Boolean).join(' · '), extra: [r.telefone, r.dados.contato].filter(Boolean).join(' · ') }),
  },
  banco: {
    titulo: 'Bancos', singular: 'banco', icone: 'wallet', nome: 'Banco', documento: undefined, contato: false,
    extras: [{ k: 'agencia', label: 'Agência', meia: true }, { k: 'conta', label: 'Conta', meia: true }, { k: 'tipoConta', label: 'Tipo de conta', dica: 'Corrente PJ, poupança…', meia: true },
      { k: 'pix', label: 'Chave PIX', meia: true }, { k: 'titular', label: 'Titular' }, { k: 'gerente', label: 'Gerente / telefone do banco' }],
    colunas: r => ({ sub: [r.dados.agencia && `ag. ${r.dados.agencia}`, r.dados.conta && `c/c ${r.dados.conta}`, r.dados.tipoConta].filter(Boolean).join(' · '), extra: r.dados.pix ? `PIX: ${r.dados.pix}` : '' }),
  },
};

const vazio = (tipo: TipoRegistro): RegistroInput => ({ tipo, nome: '', documento: '', telefone: '', email: '', cidade: '', obs: '', dados: {}, ativo: true });

function Formulario({ tipo, inicial, onClose }: { tipo: TipoRegistro; inicial: Registro2 | null; onClose: () => void }) {
  const api = useApi();
  const { eu } = useBoot();
  const cfg = CONFIG[tipo];
  const [f, setF] = useState<RegistroInput>(() => (inicial ? { ...inicial } : vazio(tipo)));
  const [contaFin, setContaFin] = useState(false);
  const comHistorico = !!inicial && (tipo === 'cliente' || tipo === 'fornecedor') && pode(eu, 'financeiro');
  const [aba, setAba] = useState<'dados' | 'historico'>('dados');
  const [erro, setErro] = useState('');
  const set = (k: keyof RegistroInput, v: string | boolean) => setF(s => ({ ...s, [k]: v }));
  const setD = (k: string, v: string) => setF(s => ({ ...s, dados: { ...s.dados, [k]: v } }));
  const salvar = useAction(async (o: RegistroInput) => {
    const id = await api.salvarRegistro(o);
    if (tipo === 'banco' && contaFin) await api.finSalvarConta({ nome: `${o.nome}${o.dados.conta ? ` ${o.dados.conta}` : ''}`, saldoInicial: 0 });
    return id;
  }, { success: `${cfg.singular[0]!.toUpperCase()}${cfg.singular.slice(1)} salvo.`, invalidate: [['registros', tipo], BOOT_KEY, ['financeiro']], onSuccess: onClose });
  const moeda = (s: string) => s.replace(',', '.').replace(/[^\d.]/g, '');
  return (
    <Dialog open onClose={onClose} title={inicial ? (comHistorico ? inicial.nome : `Editar ${cfg.singular}`) : `Novo ${cfg.singular}`} variant="drawer"
      footer={aba === 'historico' ? <Button onClick={onClose}>Fechar</Button> : <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending}
        onClick={() => (f.nome.trim() ? (setErro(''), salvar.mutate(f)) : setErro('Preencha o nome.'))}>Salvar</Button></>}>
      {comHistorico && (
        <Segmented label={`Ficha do ${cfg.singular}`} value={aba} onChange={setAba}
          options={[{ value: 'dados', label: 'Dados' }, { value: 'historico', label: tipo === 'cliente' ? 'Compras e pagamentos' : 'Compras e contas' }]} />
      )}
      {aba === 'historico' && inicial ? <HistoricoContraparte registro={inicial} /> : <>
      <TextField label={cfg.nome} value={f.nome} autoFocus onChange={e => set('nome', e.target.value)} />
      {cfg.documento && <TextField label={cfg.documento} value={f.documento} onChange={e => set('documento', e.target.value)} />}
      {cfg.contato && <>
        <div className="form-grid">
          <TextField label="Telefone / WhatsApp" value={f.telefone} inputMode="tel" onChange={e => set('telefone', e.target.value)} />
          <TextField label="E-mail" value={f.email} type="email" onChange={e => set('email', e.target.value)} />
        </div>
        <TextField label="Cidade / UF" value={f.cidade} onChange={e => set('cidade', e.target.value)} />
      </>}
      <div className="form-grid">
        {cfg.extras.map(c => (
          <div key={c.k} style={c.meia ? undefined : { gridColumn: '1 / -1' }}>
            <TextField label={c.label} value={f.dados[c.k] ?? ''} hint={c.dica} inputMode={c.tipo === 'moeda' ? 'decimal' : undefined}
              onChange={e => setD(c.k, c.tipo === 'moeda' ? moeda(e.target.value) : e.target.value)} />
          </div>
        ))}
      </div>
      <TextAreaField label="Observações" value={f.obs} rows={3} onChange={e => set('obs', e.target.value)} />
      {inicial && <SelectField label="Situação" value={f.ativo ? 'Sim' : 'Não'} onChange={e => set('ativo', e.target.value === 'Sim')} options={[{ value: 'Sim', label: 'Ativo' }, { value: 'Não', label: 'Inativo' }]} />}
      {tipo === 'banco' && !inicial && pode(eu, 'financeiro') && (
        <label className="check"><input type="checkbox" checked={contaFin} onChange={e => setContaFin(e.target.checked)} /> Criar também como conta no Financeiro (para lançar entradas e saídas)</label>
      )}
      {tipo === 'produto' && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Ao salvar, o produto, as cores e os tamanhos passam a aparecer no Lançar.</p>}
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
      </>}
    </Dialog>
  );
}

export function RegistrosTab({ tipo }: { tipo: TipoRegistro }) {
  const api = useApi();
  const confirm = useConfirm();
  const cfg = CONFIG[tipo];
  const q = useQuery({ queryKey: ['registros', tipo], queryFn: () => api.registros(tipo) });
  const { eu } = useBoot();
  const ano = new Date().getFullYear();
  const comFin = (tipo === 'cliente' || tipo === 'fornecedor') && pode(eu, 'financeiro');
  const totais = useQuery({ queryKey: ['financeiro', 'totais', ano], queryFn: () => api.finContrapartesTotais(ano), enabled: comFin });
  const totalDe = (id: string) => {
    const t = totais.data?.find(x => x.id === id);
    return { valor: t ? (tipo === 'cliente' ? t.recebido : t.pago) : 0, ultimo: t?.ultimo ?? null, aReceber: t?.aReceber ?? 0 };
  };
  const [editando, setEditando] = useState<Registro2 | null | undefined>(undefined);
  const apagar = useAction((id: string) => api.apagarRegistro(id), { success: 'Excluído.', invalidate: [['registros', tipo]] });
  const cols: Column<Registro2>[] = [
    { id: 'nome', header: cfg.titulo.slice(0, -1).replace(/e$/, 'e'), value: r => r.nome,
      cell: r => <button type="button" className="link-empresa" onClick={() => setEditando(r)}><b>{r.nome}</b>{!r.ativo && <Badge>inativo</Badge>}<small>{cfg.colunas(r).sub || '—'}</small></button> },
    { id: 'extra', header: tipo === 'produto' ? 'Preço' : tipo === 'banco' ? 'PIX' : 'Contato', value: r => cfg.colunas(r).extra ?? '', cell: r => cfg.colunas(r).extra || '—' },
    ...(comFin ? [{
      id: 'ano', header: tipo === 'cliente' ? `Recebido em ${ano}` : `Pago em ${ano}`, numeric: true, value: (r: Registro2) => totalDe(r.id).valor,
      cell: (r: Registro2) => {
        const t = totalDe(r.id);
        return <>{t.valor ? <b className="tnum">{formatBRL(t.valor)}</b> : <span className="muted">—</span>}<small>{t.aReceber ? `a receber ${formatBRL(t.aReceber)}` : t.ultimo ? `último ${dataBR(t.ultimo)}` : 'sem lançamentos'}</small></>;
      },
    }] : []),
    { id: 'obs', header: 'Observação', value: r => r.obs, cell: r => <span className="muted">{r.obs || '—'}</span> },
    {
      id: 'acoes', header: '', cell: r => (
        <span className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" iconOnly aria-label={`Editar ${r.nome}`} onClick={() => setEditando(r)}><Icon name="pencil" size={15} /></Button>
          <Button size="sm" variant="ghost" iconOnly aria-label={`Excluir ${r.nome}`} onClick={async () => {
            if (await confirm({ title: `Excluir ${r.nome}?`, message: 'O cadastro sai da lista. Fica registrado na Atividade.', confirmLabel: 'Excluir', tone: 'danger' })) apagar.mutate(r.id);
          }}><Icon name="trash" size={15} /></Button>
        </span>
      ),
    },
  ];
  return (
    <Card title={cfg.titulo} flush
      actions={<Button variant="primary" icon={<Icon name="plus" size={16} />} onClick={() => setEditando(null)}>Novo {cfg.singular}</Button>}>
      <QueryView query={q}>
        {rows => <DataTable label={cfg.titulo} columns={cols} rows={rows} rowKey={r => r.id} searchable exportName={tipo + 's'}
          empty={`Nenhum ${cfg.singular} cadastrado ainda.`} initialSort={{ id: 'nome', dir: 1 }} />}
      </QueryView>
      {editando !== undefined && <Formulario tipo={tipo} inicial={editando} onClose={() => setEditando(undefined)} />}
    </Card>
  );
}
