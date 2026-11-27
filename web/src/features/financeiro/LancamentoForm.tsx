import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FinLancamento, FinLancamentoInput, FinTipo } from '../../api/types';
import { useApi } from '../../app/auth';
import { useAction } from '../../app/useAction';
import { isoDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { SelectField, TextField } from '../../ui/Field';
import { FIN_KEY, useFin } from './shared';

/** Aceita "1.234,56", "1234,56" e "1234.56". */
export function parseValor(s: string): number {
  const t = s.trim().replace(/\s|R\$/g, '');
  if (!t) return NaN;
  const n = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(n);
}
export const valorTexto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

const TIPOS: { id: FinTipo; titulo: string; dica: string }[] = [
  { id: 'entrada', titulo: 'Entrada', dica: 'Dinheiro que entrou' },
  { id: 'saida', titulo: 'Saída', dica: 'Paga, ou comprada no cartão' },
  { id: 'programada', titulo: 'A pagar', dica: 'Parcelada ou conta futura' },
];

export function LancamentoForm({ inicial, tipo: tipoInicial = 'saida', onClose }: { inicial?: FinLancamento; tipo?: FinTipo; onClose: () => void }) {
  const api = useApi();
  const d = useFin();
  const [tipo, setTipo] = useState<FinTipo>(inicial?.tipo ?? tipoInicial);
  const [data, setData] = useState(inicial?.data ?? isoDay(new Date()));
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '');
  const [valor, setValor] = useState(valorTexto(inicial?.valor));
  const [pagamento, setPagamento] = useState(inicial?.cartaoId ? `cartao:${inicial.cartaoId}` : `conta:${inicial?.contaId ?? d.contas.find(c => c.ativa)?.id ?? ''}`);
  const [categoria, setCategoria] = useState(inicial?.categoria ?? '');
  const [centro, setCentro] = useState(inicial?.centro ?? '');
  const [responsavel, setResponsavel] = useState(inicial?.responsavel ?? '');
  const [forma, setForma] = useState(inicial?.forma ?? '');
  const [parcelas, setParcelas] = useState(String(inicial?.parcelas ?? 1));
  const [valorParcela, setValorParcela] = useState(valorTexto(inicial?.valorParcela));
  const [diaVenc, setDiaVenc] = useState(String(inicial?.diaVencimento ?? ''));
  const [obs, setObs] = useState(inicial?.obs ?? '');
  const [contraparte, setContraparte] = useState(inicial?.contraparteId ?? '');
  // clientes e fornecedores ativos (Cadastros) — rota do Financeiro, então quem só tem o Financeiro também vê
  const cps = useQuery({ queryKey: [...FIN_KEY, 'contrapartes'], queryFn: () => api.finContrapartes(), staleTime: 60_000 });
  const [erro, setErro] = useState('');

  const salvar = useAction((o: FinLancamentoInput) => api.finSalvarLancamento(o), {
    success: inicial ? 'Lançamento atualizado.' : 'Lançamento salvo.', invalidate: [FIN_KEY], onSuccess: onClose,
  });

  const [pagTipo, pagId] = pagamento.split(':') as ['conta' | 'cartao', string];
  const noCartao = tipo !== 'entrada' && pagTipo === 'cartao';
  const contasAtivas = d.contas.filter(c => c.ativa || c.id === inicial?.contaId);
  const cartoesAtivos = d.cartoes.filter(c => c.ativo || c.id === inicial?.cartaoId);
  const opcoesPagamento = [
    ...contasAtivas.map(c => ({ value: `conta:${c.id}`, label: `Conta · ${c.nome}` })),
    ...(tipo === 'entrada' ? [] : cartoesAtivos.map(c => ({ value: `cartao:${c.id}`, label: `Cartão · ${c.nome}` }))),
  ];

  const tipoCp = tipo === 'entrada' ? 'cliente' : 'fornecedor';
  const listaCp = (cps.data ?? []).filter(c => c.tipo === tipoCp || c.id === contraparte);
  const opcoesCp = listaCp.map(c => ({ value: c.id, label: c.documento ? `${c.nome} · ${c.documento}` : c.nome }));
  // cadastro excluído ou inativo: mantém o nome guardado no lançamento como opção
  if (contraparte && !listaCp.some(c => c.id === contraparte) && inicial?.contraparteId === contraparte && inicial.contraparte) {
    opcoesCp.push({ value: contraparte, label: `${inicial.contraparte} (inativo)` });
  }
  const trocarTipo = (t: FinTipo) => {
    setTipo(t);
    if (t === 'entrada' && pagTipo === 'cartao') setPagamento(`conta:${contasAtivas[0]?.id ?? ''}`);
    const atual = cps.data?.find(c => c.id === contraparte);
    if (atual && atual.tipo !== (t === 'entrada' ? 'cliente' : 'fornecedor')) setContraparte('');
  };

  const onValor = (v: string) => {
    setValor(v);
    const n = parseValor(v), p = Number(parcelas) || 1;
    if (tipo === 'programada' && Number.isFinite(n)) setValorParcela(valorTexto(Math.round((n / p) * 100) / 100));
  };
  const onParcelas = (v: string) => {
    setParcelas(v);
    const n = parseValor(valor), p = Number(v) || 1;
    if (Number.isFinite(n)) setValorParcela(valorTexto(Math.round((n / p) * 100) / 100));
  };

  const submit = () => {
    const v = parseValor(valor);
    if (!descricao.trim()) return setErro('Informe a descrição.');
    if (!(v > 0)) return setErro('Informe um valor maior que zero.');
    if (!pagId) return setErro(tipo === 'entrada' ? 'Escolha a conta.' : 'Escolha a conta ou o cartão.');
    const o: FinLancamentoInput = {
      id: inicial?.id, tipo, data, descricao: descricao.trim(), valor: v,
      contaId: noCartao ? null : (tipo === 'entrada' || pagTipo === 'conta' ? pagId : null),
      cartaoId: noCartao ? pagId : null,
      categoria, centro, responsavel, forma: noCartao ? 'Cartão de crédito' : forma, obs,
      contraparteId: contraparte || null,
    };
    if (tipo === 'programada') {
      const p = Number(parcelas), vp = parseValor(valorParcela), dia = Number(diaVenc);
      if (!(p >= 1 && p <= 360)) return setErro('Quantidade de parcelas: 1 a 360.');
      if (!(vp > 0)) return setErro('Informe o valor da parcela.');
      if (!noCartao && !(dia >= 1 && dia <= 31)) return setErro('Informe o dia do vencimento (1 a 31).');
      Object.assign(o, { parcelas: p, valorParcela: vp, diaVencimento: noCartao ? null : dia });
    }
    setErro('');
    salvar.mutate(o);
  };

  return (
    <Dialog open onClose={onClose} title={inicial ? 'Editar lançamento' : 'Novo lançamento'} variant="drawer"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={salvar.isPending} onClick={submit}>Salvar</Button></>}>
      <div className="tipo-toggle" role="radiogroup" aria-label="Tipo de lançamento">
        {TIPOS.map(t => (
          <button key={t.id} type="button" role="radio" aria-checked={tipo === t.id} className={tipo === t.id ? 'on' : ''}
            onClick={() => trocarTipo(t.id)}>
            <b>{t.titulo}</b><small>{t.dica}</small>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <TextField label={tipo === 'programada' ? 'Data da compra' : 'Data'} type="date" value={data} onChange={e => setData(e.target.value)} />
        <TextField label={tipo === 'programada' ? 'Valor total (R$)' : 'Valor (R$)'} inputMode="decimal" value={valor} onChange={e => onValor(e.target.value)} placeholder="0,00" />
      </div>
      <TextField label="Descrição" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder={tipo === 'entrada' ? 'Ex.: Venda lote 121' : 'Ex.: Tecido malha 300 kg'} />
      <SelectField label={tipo === 'entrada' ? 'Cliente (opcional)' : 'Fornecedor (opcional)'} value={contraparte} onChange={e => setContraparte(e.target.value)}
        options={opcoesCp} placeholder={cps.isLoading ? 'Carregando…' : '—'}
        hint={cps.data && !opcoesCp.length ? `Nenhum ${tipoCp} cadastrado. Cadastre em Cadastros → ${tipo === 'entrada' ? 'Clientes' : 'Fornecedores'}.` : undefined} />
      <SelectField label={tipo === 'entrada' ? 'Entrou na conta' : 'Pagamento'} value={pagamento} onChange={e => setPagamento(e.target.value)} options={opcoesPagamento} />
      {tipo === 'programada' && (
        <div className="form-grid">
          <TextField label="Parcelas" type="number" inputMode="numeric" min={1} max={360} value={parcelas} onChange={e => onParcelas(e.target.value)} />
          <TextField label="Valor da parcela (R$)" inputMode="decimal" value={valorParcela} onChange={e => setValorParcela(e.target.value)} />
          {!noCartao && <TextField label="Dia do vencimento" type="number" inputMode="numeric" min={1} max={31} value={diaVenc} onChange={e => setDiaVenc(e.target.value)} />}
        </div>
      )}
      {noCartao && <p className="muted" style={{ fontSize: 13 }}>Entra na fatura do cartão conforme o dia de fechamento; sai da conta só quando a fatura for paga.</p>}
      <div className="form-grid">
        <SelectField label="Categoria" value={categoria} onChange={e => setCategoria(e.target.value)} options={d.listas.categorias} placeholder="—" />
        <SelectField label="Centro de custo" value={centro} onChange={e => setCentro(e.target.value)} options={d.listas.centros} placeholder="—" />
      </div>
      <div className="form-grid">
        {!noCartao && <SelectField label="Forma de pagamento" value={forma} onChange={e => setForma(e.target.value)} options={d.listas.formas} placeholder="—" />}
        <SelectField label="Responsável" value={responsavel} onChange={e => setResponsavel(e.target.value)} options={d.listas.responsaveis} placeholder="—" />
      </div>
      <TextField label="Observação (opcional)" value={obs} onChange={e => setObs(e.target.value)} />
      {erro && <p className="err" role="alert" style={{ color: 'var(--danger)' }}>{erro}</p>}
    </Dialog>
  );
}
