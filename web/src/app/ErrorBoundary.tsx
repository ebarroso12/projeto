import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '../ui/QueryView';
import { isChunkError } from './lazyPage';

/** Um erro de código em uma tela não derruba o app inteiro. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error('Erro na tela:', error, info.componentStack); }
  render() {
    if (this.state.error) {
      const novaVersao = isChunkError(this.state.error);
      return (
        <ErrorState
          error={novaVersao ? new Error('Há uma versão nova do sistema. Toque em "Tentar de novo" para atualizar.') : this.state.error}
          onRetry={() => (novaVersao ? window.location.reload() : this.setState({ error: null }))}
        />
      );
    }
    return this.props.children;
  }
}
