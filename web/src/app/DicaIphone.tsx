import { useState } from 'react';
import { ehIphone, instalado } from '../lib/avisos';
import { abrirManual } from '../lib/manual';
import { Icon } from '../ui/Icon';

const CHAVE = 'fab_dica_iphone';
const lerDispensada = () => { try { return localStorage.getItem(CHAVE) === '1'; } catch { return false; } };

/** Só para quem usa iPhone pelo navegador: sem instalar na Tela de Início, o iPhone não recebe avisos. */
export function deveMostrarDicaIphone(iphone: boolean, jaInstalado: boolean, dispensada: boolean) {
  return iphone && !jaInstalado && !dispensada;
}

export function DicaIphone() {
  const [fechada, setFechada] = useState(lerDispensada);
  if (!deveMostrarDicaIphone(ehIphone(), instalado(), fechada)) return null;
  const fechar = () => { setFechada(true); try { localStorage.setItem(CHAVE, '1'); } catch { /* sem armazenamento */ } };
  return (
    <div className="dica-iphone" role="status">
      <Icon name="bell" size={18} />
      <p>
        <b>No iPhone, instale o app para receber avisos.</b> No Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>,
        abra pelo ícone e ligue os avisos no sino.
      </p>
      <div className="dica-iphone-acoes">
        <button type="button" onClick={() => abrirManual('iphone')}>Passo a passo</button>
        <button type="button" onClick={fechar} aria-label="Fechar a dica do iPhone">Entendi</button>
      </div>
    </div>
  );
}
