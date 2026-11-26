import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { httpTransport, type Transport } from './api/transport';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

declare global {
  interface Window { __FABRICA__?: { apiUrl?: string } }
}

async function start() {
  const url = window.__FABRICA__?.apiUrl?.trim();
  let transport: Transport;
  let demo = false;
  if (url) {
    transport = httpTransport(url);
  } else {
    // Sem apiUrl: modo demonstração (dados fictícios em memória; carregado só quando preciso).
    const { createMockTransport } = await import('./api/mock');
    transport = createMockTransport();
    demo = true;
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode><App transport={transport} demo={demo} /></StrictMode>,
  );
}

void start();
