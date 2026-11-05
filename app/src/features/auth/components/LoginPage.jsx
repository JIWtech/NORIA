import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState } from 'react';
import { Mail, Lock, EyeOff, Eye, RefreshCcw, ArrowRight } from 'lucide-react';
import noriaLogo from '../../../assets/noria_logo.png';
import { signInWithPassword } from '../../../services/auth/authService.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signInWithPassword(email.trim(), password);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('auth');
      nextUrl.searchParams.set('app', '1');
      window.location.replace(nextUrl.toString());
    } catch (loginError) {
      setError(userFacingError(loginError, 'Não foi possível entrar.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      {/* Lado Esquerdo: Área Visual e Marca NORIA (Hero Central Inspirado na Ref 1) */}
      <section className="auth-visual-side" aria-hidden="true">
        {/* Iluminação Ambiental & Efeitos Difusos */}
        <div className="auth-visual-ambient-aurora cyan" />
        <div className="auth-visual-ambient-aurora violet" />
        <div className="auth-visual-ambient-glow" />
        <div className="auth-visual-grid-overlay" />

        {/* Composição Hero Integrada: Logo Grande + Tagline + Rede de Fluxo */}
        <div className="auth-hero-composition">
          <div className="auth-hero-branding">
            <img src={noriaLogo} alt="NORIA" className="auth-hero-logo-img" />
            <span className="auth-hero-tagline">INTELIGÊNCIA EM MOVIMENTO</span>
          </div>

          <div className="auth-visual-art">
            <svg
              className="auth-network-svg"
              viewBox="0 0 600 420"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="0.95" />
                  <stop offset="45%" stopColor="#00E0FF" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#7861FF" stopOpacity="0.95" />
                </linearGradient>
                <linearGradient id="flowGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#7861FF" stopOpacity="0.85" />
                  <stop offset="55%" stopColor="#00E0FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#00E0FF" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id="flowGrad3" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="0.8" />
                  <stop offset="60%" stopColor="#7861FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#7861FF" stopOpacity="0.1" />
                </linearGradient>
                <radialGradient id="nodeGlowCyan" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="1" />
                  <stop offset="35%" stopColor="#00E0FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#00E0FF" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="nodeGlowViolet" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#7861FF" stopOpacity="1" />
                  <stop offset="35%" stopColor="#7861FF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#7861FF" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="coreAuraGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00E0FF" stopOpacity="0.25" />
                  <stop offset="60%" stopColor="#7861FF" stopOpacity="0.08" />
                  <stop offset="100%" stopColor="#00E0FF" stopOpacity="0" />
                </radialGradient>
              </defs>

              {/* Anéis orbitais sutis de fundo */}
              <ellipse cx="300" cy="210" rx="270" ry="180" stroke="rgba(0, 224, 255, 0.04)" strokeWidth="1" strokeDasharray="8 8" className="auth-orbital-ring-1 auth-secondary-orbital" />
              <circle cx="300" cy="210" r="140" stroke="rgba(120, 97, 255, 0.05)" strokeWidth="1" strokeDasharray="4 6" className="auth-orbital-ring-2 auth-secondary-orbital" />
              <circle cx="300" cy="210" r="48" stroke="rgba(0, 224, 255, 0.14)" strokeWidth="1" strokeDasharray="3 3" className="auth-core-ring" />

              {/* Malha de conexões secundárias (linhas estáticas finas) */}
              <line x1="80" y1="130" x2="190" y2="75" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="190" y1="75" x2="360" y2="85" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="360" y1="85" x2="510" y2="140" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="80" y1="130" x2="140" y2="280" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="140" y1="280" x2="290" y2="350" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="290" y1="350" x2="470" y2="310" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="470" y1="310" x2="510" y2="140" stroke="rgba(242, 244, 247, 0.07)" strokeWidth="1" className="auth-secondary-line" />
              <line x1="190" y1="75" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />
              <line x1="140" y1="280" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />
              <line x1="360" y1="85" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />
              <line x1="470" y1="310" x2="300" y2="210" stroke="rgba(242, 244, 247, 0.06)" strokeDasharray="3 3" strokeWidth="1" className="auth-secondary-line" />

              {/* Rotas de fluxo ativo (curvas bezier com traços e gradiente) */}
              <path
                id="flowRouteMain"
                className="auth-flow-line"
                d="M 80 130 Q 180 200 300 210 T 510 140"
                stroke="url(#flowGradient)"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
              <path
                id="flowRouteSecondary"
                className="auth-flow-line-secondary auth-secondary-route"
                d="M 190 75 Q 300 210 290 350 T 470 310"
                stroke="url(#flowGrad2)"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
              />
              <path
                id="flowRouteTertiary"
                className="auth-flow-line-tertiary auth-secondary-route"
                d="M 140 280 Q 220 180 300 210 T 360 85"
                stroke="url(#flowGrad3)"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />

              {/* Pulsos luminosos viajando pelas rotas */}
              <circle className="auth-pulse-particle" r="4.5" fill="#00E0FF">
                <animateMotion
                  path="M 80 130 Q 180 200 300 210 T 510 140"
                  dur="7.5s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle className="auth-pulse-particle-violet auth-secondary-particle" r="4" fill="#7861FF">
                <animateMotion
                  path="M 190 75 Q 300 210 290 350 T 470 310"
                  dur="9.5s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle className="auth-pulse-particle-cyan-small auth-secondary-particle" r="3.2" fill="#00E0FF">
                <animateMotion
                  path="M 140 280 Q 220 180 300 210 T 360 85"
                  dur="11s"
                  repeatCount="indefinite"
                />
              </circle>

              {/* Nós da Rede Deliberados (hierarquia luminosa controlada) */}
              {/* 1. Origem Esquerda (Cyan - Primário) */}
              <circle cx="80" cy="130" r="18" fill="url(#nodeGlowCyan)" className="auth-node-pulse-1" />
              <circle cx="80" cy="130" r="5.5" fill="#00E0FF" />
              <circle cx="80" cy="130" r="2.5" fill="#FFFFFF" />

              {/* 2. Topo Esquerda (Secundário) */}
              <circle cx="190" cy="75" r="14" fill="url(#nodeGlowCyan)" className="auth-secondary-node" />
              <circle cx="190" cy="75" r="4.5" fill="#00E0FF" className="auth-secondary-node" />

              {/* 3. NÚCLEO CENTRAL NORIA (Primário com aura e anéis) */}
              <circle cx="300" cy="210" r="38" fill="url(#coreAuraGlow)" />
              <circle cx="300" cy="210" r="24" fill="url(#nodeGlowCyan)" className="auth-core-glow" />
              <circle cx="300" cy="210" r="8" fill="#0B1220" stroke="#00E0FF" strokeWidth="2.5" />
              <circle cx="300" cy="210" r="3.5" fill="#00E0FF" />

              {/* 4. Topo Direita (Secundário) */}
              <circle cx="360" cy="85" r="14" fill="url(#nodeGlowViolet)" className="auth-secondary-node" />
              <circle cx="360" cy="85" r="4.5" fill="#7861FF" className="auth-secondary-node" />

              {/* 5. Destino Direita (Primário com centro branco) */}
              <circle cx="510" cy="140" r="20" fill="url(#nodeGlowViolet)" className="auth-node-pulse-2" />
              <circle cx="510" cy="140" r="6" fill="#7861FF" />
              <circle cx="510" cy="140" r="2.5" fill="#FFFFFF" />

              {/* 6. Fundo Esquerda (Secundário) */}
              <circle cx="140" cy="280" r="13" fill="url(#nodeGlowCyan)" className="auth-secondary-node" />
              <circle cx="140" cy="280" r="4" fill="#00E0FF" className="auth-secondary-node" />

              {/* 7. Fundo Centro (Primário) */}
              <circle cx="290" cy="350" r="16" fill="url(#nodeGlowViolet)" />
              <circle cx="290" cy="350" r="5" fill="#7861FF" />
              <circle cx="290" cy="350" r="2" fill="#FFFFFF" />

              {/* 8. Fundo Direita (Secundário) */}
              <circle cx="470" cy="310" r="15" fill="url(#nodeGlowViolet)" className="auth-secondary-node" />
              <circle cx="470" cy="310" r="5" fill="#7861FF" className="auth-secondary-node" />
            </svg>
          </div>
        </div>
      </section>

      {/* Divisor Vertical Dinâmico com Highlight Móvel */}
      <div className="auth-dynamic-divider" aria-hidden="true">
        <div className="auth-divider-pulse" />
      </div>

      {/* Lado Direito: Formulário de Autenticação com Profundidade & Camadas Glass */}
      <section className="auth-form-side">
        {/* Iluminação Ambiental & Spotlight Atrás do Card */}
        <div className="auth-form-spotlight-cyan" />
        <div className="auth-form-spotlight-violet" />
        <div className="auth-form-ambient-glow" />
        <div className="auth-form-decor-orbit" aria-hidden="true" />

        <div className="auth-form-container">
          {/* Top Accent Line Sutil com Pulso Móvel Mobile */}
          <div className="auth-card-top-accent" aria-hidden="true">
            <div className="auth-card-top-pulse" />
          </div>

          <div className="auth-mobile-brand">
            <img src={noriaLogo} alt="NORIA" className="auth-mobile-logo-img" />
            <span className="auth-mobile-tagline">INTELIGÊNCIA EM MOVIMENTO</span>
          </div>

          <h1 className="auth-title">Bem-vindo</h1>

          <form className="auth-form" onSubmit={handleSubmit} noValidate={false}>
            <label className="auth-label">
              <span>E-mail</span>
              <div className="auth-input-wrapper">
                <Mail size={17} className="auth-input-icon" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nome@empresa.com"
                  autoComplete="email"
                  required
                />
              </div>
            </label>

            <label className="auth-label">
              <span>Senha</span>
              <div className="auth-input-wrapper auth-password-input-wrapper">
                <Lock size={17} className="auth-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            {error && (
              <div className="inline-error auth-error-box" role="alert">
                {error}
              </div>
            )}

            <button className="primary-button auth-submit-btn" type="submit" disabled={loading}>
              <span className="auth-submit-shine" aria-hidden="true" />
              {loading ? (
                <>
                  <RefreshCcw size={16} className="spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <span>Entrar</span>
                  <ArrowRight size={17} className="auth-submit-arrow" />
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
