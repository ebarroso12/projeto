import { describe, expect, it } from 'vitest';
import type { Remessa } from '../../api/types';
import { htmlComprovante } from './comprovante';

const R: Remessa = { id: 'r', numero: 31, quem: 'Costura <da> Maria', login: null, oficinaId: 'o', telefone: null, etapa: 'Costura', dataEnvio: '2026-11-20', prazo: '2026-11-25',
  valorPeca: 2.5, descontoFaltante: 10, ordemId: null, ordemNumero: null, status: 'aberta', fechadaEm: null, valorPago: null, noFinanceiro: false, obs: '', token: 'a'.repeat(32),
  confirmacaoEnvio: null, historico: [],
  itens: [{ id: 'a', modelo: 'Calça', cor: 'Branco', tamanho: 'P', qtd: 40, boas: 30, defeito: 2 }, { id: 'b', modelo: 'Calça', cor: 'Branco', tamanho: 'M', qtd: 50, boas: 50, defeito: 0 }],
  retornos: [{ id: 't1', data: '2026-11-24', obs: 'pacote rasgado', boas: 80, defeito: 2, cega: true, itens: [{ itemId: 'a', boas: 30, defeito: 2 }, { itemId: 'b', boas: 50, defeito: 0 }], confirmacao: null }] };

describe('comprovante impresso', () => {
  it('envio: itens, total, assinaturas e QR com o link', () => {
    const h = htmlComprovante(R, 'Fábrica X', 'https://app/?r=' + 'a'.repeat(32));
    expect(h).toContain('Remessa #31 · envio');
    expect(h).toContain('<td class="n">40</td>');
    expect(h).toContain('<th class="n">90</th>');
    expect(h).toContain('<svg');                                      // QR gerado no aparelho
    expect(h).toContain('conferir e confirmar');
    expect(h).toContain('Costura &lt;da&gt; Maria');                  // nome escapado
    expect(h).not.toContain('<da>');
    expect(h).toContain('desconto de R$');
  });
  it('devolução: boas, defeito, às cegas e obs.', () => {
    const h = htmlComprovante(R, 'Fábrica X', 'https://app/?r=x', 't1');
    expect(h).toContain('devolução de 24/11');
    expect(h).toContain('contada às cegas');
    expect(h).toContain('<th class="n">80</th><th class="n">2</th><th class="n">82</th>');
    expect(h).toContain('Obs.: pacote rasgado');
    expect(h).toContain('Conferido por (Fábrica X)');
  });
  it('sem link: sem QR; retorno inexistente: erro', () => {
    expect(htmlComprovante(R, 'X', null)).not.toContain('<svg');
    expect(() => htmlComprovante(R, 'X', null, 'nao-existe')).toThrow();
  });
});
