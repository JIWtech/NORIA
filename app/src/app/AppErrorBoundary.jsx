import { userFacingError } from '../utils/userFacingError.js';
import React from 'react';

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Falha ao renderizar o painel NORIA:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="auth-page auth-loading-page">
        <section className="auth-loading-card" role="alert">
          <h1 className="auth-loading-title">Não foi possível abrir o painel</h1>
          <p className="muted">{userFacingError(this.state.error, 'Erro inesperado ao carregar a tela.')}</p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }
}
