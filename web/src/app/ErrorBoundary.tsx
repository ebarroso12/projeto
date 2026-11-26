import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '../ui/QueryView';

/** Um erro de código em uma tela não derruba o app inteiro. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error('Erro na tela:', error, info.componentStack); }
  render() {
    if (this.state.error) return <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
