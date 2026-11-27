import { useEffect, useState } from 'react';
import type { Vitrine } from '../api/types';
import { useApi } from './auth';

const MODULOS: [string, string, string][] = [
  ['lancar', 'Produção por etapa', 'Corte, costura e conferência lançados no celular de cada um, com alerta de erro.'],
  ['pedidos', 'Pedidos de clientes', 'Quanto de cada pedido já foi feito, fila do que produzir e aviso de atraso.'],
  ['ponto', 'Ponto da equipe', 'Entrada e saída pelo celular, horas extras e faltas no relatório.'],
  ['materiais', 'Matéria-prima', 'Estoque de malhas e aviamentos com baixa automática pela produção.'],
  ['financeiro', 'Financeiro', 'Entradas, saídas, contas a pagar e a receber, cartões e metas.'],
  ['resultado', 'Resultado e lucro', 'DRE do mês e lucro de cada modelo: preço − material − mão de obra.'],
  ['produtividade', 'Produtividade', 'Peças por pessoa e pagamento por produção lançado no financeiro.'],
  ['dashboard', 'Dashboard', 'Gráficos do mês e comparação com os meses anteriores.'],
];
const BENEFICIOS: [string, string][] = [
  ['No celular de todo mundo', 'Instala como app, funciona sem internet para consultar e avisa no celular.'],
  ['Cada um vê o que deve', 'Você libera cada função por pessoa e aprova cada novo acesso.'],
  ['Tudo registrado', 'Quem lançou, editou ou apagou: histórico completo e cópia de segurança.'],
  ['Sem planilha quebrada', 'Os números batem sozinhos: produção, estoque, pedidos e financeiro se conversam.'],
];

/** Página pública de apresentação (/?conheca): o que o app faz e o botão de teste grátis. */
export function LandingPage({ onEntrar }: { onEntrar: () => void }) {
  const api = useApi();
  const [v, setV] = useState<Vitrine | null>(null);
  useEffect(() => { api.vitrine().then(setV).catch(() => setV({ convite: null, dias: 0, whatsapp: null })); }, [api]);
  const testar = v?.convite ? `${window.location.pathname}?convite=${encodeURIComponent(v.convite)}` : null;
  const zap = v?.whatsapp ? `https://wa.me/${v.whatsapp}?text=${encodeURIComponent('Olá! Quero conhecer o app Fábrica para a minha confecção.')}` : null;
  useEffect(() => { document.title = 'Fábrica · Gestão da produção e do financeiro para confecções'; }, []);

  const Cta = ({ grande = false }: { grande?: boolean }) => (
    <div className={`lp-cta${grande ? ' grande' : ''}`}>
      {testar && <a className="lp-btn primario" href={testar}>Testar {v?.dias ? `${v.dias} dias ` : ''}grátis</a>}
      {zap && <a className="lp-btn" href={zap} target="_blank" rel="noopener">Falar no WhatsApp</a>}
      {!testar && !zap && v && <span className="lp-nota">Peça seu acesso de teste a quem te indicou o app.</span>}
    </div>
  );

  return (
    <div className="lp">
      <header className="lp-topo">
        <img src="marca/logo-horizontal.webp" alt="Fábrica" height={40} />
        <button type="button" className="lp-btn pequeno" onClick={onEntrar}>Já tenho acesso · Entrar</button>
      </header>

      <section className="lp-hero">
        <div>
          <p className="lp-selo">Para confecções e pequenas fábricas</p>
          <h1>Sua fábrica inteira<br /><em>na palma da mão.</em></h1>
          <p className="lp-sub">Produção por etapa, pedidos, ponto, estoque, financeiro e lucro de cada modelo — em tempo real, no celular de cada pessoa da equipe.</p>
          <Cta grande />
          <p className="lp-mini">Sem cartão de crédito · seus dados ficam só com a sua empresa</p>
        </div>
        <div className="lp-hero-arte" aria-hidden="true">
          {MODULOS.slice(0, 6).map(([id]) => <img key={id} src={`marca/${id}.webp`} alt="" width={120} height={120} loading="lazy" />)}
        </div>
      </section>

      <section className="lp-sec">
        <h2>Tudo o que a confecção precisa, ligado entre si</h2>
        <div className="lp-mods">
          {MODULOS.map(([id, t, d]) => (
            <article key={id}><img src={`marca/${id}.webp`} alt="" width={64} height={64} loading="lazy" /><h3>{t}</h3><p>{d}</p></article>
          ))}
        </div>
      </section>

      <section className="lp-sec lp-escura">
        <h2>Por que as fábricas usam</h2>
        <div className="lp-ben">{BENEFICIOS.map(([t, d]) => <div key={t}><h3>{t}</h3><p>{d}</p></div>)}</div>
      </section>

      <section className="lp-sec">
        <h2>Comece em 3 passos</h2>
        <ol className="lp-passos">
          <li><b>Crie a sua empresa</b><span>Em 1 minuto, com o seu login de administrador.</span></li>
          <li><b>Cadastre modelos e equipe</b><span>Produtos, cores, tamanhos e quem lança cada etapa.</span></li>
          <li><b>Mande o link para a equipe</b><span>Cada um entra no celular e você libera o acesso.</span></li>
        </ol>
        <Cta />
      </section>

      <footer className="lp-rodape">
        <img src="marca/marca-96.webp" alt="" width={28} height={28} /> Fábrica · Gestão da produção e do financeiro
        <button type="button" className="link" onClick={onEntrar}>Entrar</button>
      </footer>
    </div>
  );
}
