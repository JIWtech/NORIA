import { userFacingError } from '../utils/userFacingError.js';
import React, { useState, useMemo } from 'react';
import {
  Building2,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  CarFront,
  Flame,
  ShoppingBag,
  Briefcase,
  Bot,
  RefreshCcw,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { signUpWithPassword, createTenantOnboarding } from '../authService';
import { generateSystemPrompt, SEGMENT_TEMPLATES, TONE_PRESETS } from '../promptFactory';

const SEGMENTS = [
  {
    id: 'vehicle_sales',
    title: 'Venda de Veículos',
    subtitle: 'Concessionárias, revendas, motos e repasses',
    icon: CarFront,
    badge: 'Comercial + Estoque',
  },
  {
    id: 'aesthetic_clinic',
    title: 'Clínica & Estética',
    subtitle: 'Bronzeamento, estética, saúde e bem-estar',
    icon: Flame,
    badge: 'Agendamento + Protocolos',
  },
  {
    id: 'retail_sales',
    title: 'Varejo & Produtos',
    subtitle: 'E-commerce, lojas físicas e catálogo de produtos',
    icon: ShoppingBag,
    badge: 'Vendas + Catálogo',
  },
  {
    id: 'general_services',
    title: 'Serviços & Negócios',
    subtitle: 'Consultorias, agências, B2B e atendimento geral',
    icon: Briefcase,
    badge: 'Atendimento Consultivo',
  },
];

const TONES = [
  {
    id: 'consultative',
    title: 'Consultivo & Especialista',
    desc: 'Equilibrado, técnico e orientador. Foco em autoridade e solução.',
  },
  {
    id: 'friendly',
    title: 'Acolhedor & Próximo',
    desc: 'Caloroso, empático e prestativo. Cria conexão rápida.',
  },
  {
    id: 'direct',
    title: 'Pragmático & Ágil',
    desc: 'Objetivo e focado no essencial sem rodeios.',
  },
];

export function TenantOnboardingWizard({
  initialEmail = '',
  requireAuthFields = true,
  onSuccess,
  onCancel,
}) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [segment, setSegment] = useState('vehicle_sales');
  const [tone, setTone] = useState('consultative');
  const [businessFacts, setBusinessFacts] = useState('');
  const [catalogHighlights, setCatalogHighlights] = useState('');
  const [customRules, setCustomRules] = useState('');

  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Prompt gerado em tempo real com o promptFactory testado
  const compiledPrompt = useMemo(() => {
    try {
      return generateSystemPrompt({
        companyName: companyName.trim() || 'Minha Empresa',
        segment,
        tone,
        businessFacts: businessFacts.trim() ? [businessFacts.trim()] : [],
        catalogHighlights: catalogHighlights.trim() ? [catalogHighlights.trim()] : [],
        customRules: customRules.trim() ? [customRules.trim()] : [],
      });
    } catch {
      return '';
    }
  }, [companyName, segment, tone, businessFacts, catalogHighlights, customRules]);

  async function handleFinalSubmit(e) {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (requireAuthFields) {
        if (!email.trim() || !password) {
          throw new Error('Preencha seu e-mail e senha de acesso.');
        }
        if (password.length < 6) {
          throw new Error('A senha deve conter no mínimo 6 caracteres.');
        }
        await signUpWithPassword(email.trim(), password);
      }

      if (!companyName.trim()) {
        throw new Error('Informe o nome da sua empresa.');
      }

      const result = await createTenantOnboarding({
        companyName: companyName.trim(),
        segment,
        tone,
        businessFacts: businessFacts.trim(),
        catalogHighlights: catalogHighlights.trim(),
        customRules: customRules.trim(),
        systemPrompt: compiledPrompt,
      });

      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err) {
      setError(userFacingError(err, 'Falha ao concluir o onboarding da empresa.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="onboarding-wizard-container">
      {/* Header do Wizard */}
      <div className="onboarding-wizard-header">
        <div className="onboarding-wizard-badge">
          <Sparkles size={14} />
          <span>Configuração Autônoma SaaS</span>
        </div>
        <h2 className="onboarding-wizard-title">
          {step === 1 && (requireAuthFields ? 'Crie sua Conta e Empresa' : 'Identifique sua Empresa')}
          {step === 2 && 'Personalize sua IA de Atendimento'}
          {step === 3 && 'Revisão e Ativação do Sistema'}
        </h2>
        <p className="onboarding-wizard-subtitle">
          {step === 1 && 'Configuração rápida para gerar seu funil, canais e personalidade de IA sob medida.'}
          {step === 2 && 'Defina o segmento e o tom de voz para adequar a IA às regras do seu negócio.'}
          {step === 3 && 'Tudo pronto! Seu sistema e prompt foram compilados automaticamente.'}
        </p>

        {/* Indicador de Passos */}
        <div className="onboarding-steps-indicator">
          <div className={`onboarding-step-pill ${step >= 1 ? 'active' : ''}`}>
            <span>1</span> <span>Identificação</span>
          </div>
          <div className="onboarding-step-divider" />
          <div className={`onboarding-step-pill ${step >= 2 ? 'active' : ''}`}>
            <span>2</span> <span>Personalidade IA</span>
          </div>
          <div className="onboarding-step-divider" />
          <div className={`onboarding-step-pill ${step >= 3 ? 'active' : ''}`}>
            <span>3</span> <span>Ativação</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="inline-error auth-error-box" role="alert" style={{ marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* Passo 1: Conta & Nome da Empresa */}
      {step === 1 && (
        <div className="onboarding-step-content">
          <div className="onboarding-form-group">
            <label className="auth-label">
              <span>Nome da Empresa ou Loja *</span>
              <div className="auth-input-wrapper">
                <Building2 size={17} className="auth-input-icon" />
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: Prime Veículos, Studio Bella, Loja do Varejo..."
                  required
                  autoFocus
                />
              </div>
            </label>
          </div>

          {requireAuthFields && (
            <div className="onboarding-auth-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="auth-label">
                <span>E-mail de Acesso *</span>
                <div className="auth-input-wrapper">
                  <Mail size={17} className="auth-input-icon" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    required
                  />
                </div>
              </label>

              <label className="auth-label">
                <span>Senha (mínimo 6 dígitos) *</span>
                <div className="auth-input-wrapper auth-password-input-wrapper">
                  <Lock size={17} className="auth-input-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((p) => !p)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            </div>
          )}

          <div className="onboarding-segment-section" style={{ marginTop: 18 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 10 }}>
              Selecione o Segmento de Atuação Principal:
            </span>
            <div className="onboarding-segment-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {SEGMENTS.map((s) => {
                const Icon = s.icon;
                const selected = segment === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`onboarding-segment-card ${selected ? 'selected' : ''}`}
                    onClick={() => setSegment(s.id)}
                    style={{
                      textAlign: 'left',
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: selected ? '1px solid var(--brand)' : '1px solid var(--line)',
                      background: selected ? 'rgba(0, 224, 255, 0.08)' : 'var(--surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon size={18} color={selected ? 'var(--brand)' : 'var(--muted)'} />
                        <strong style={{ fontSize: 14, color: selected ? '#fff' : 'var(--text)' }}>
                          {s.title}
                        </strong>
                      </div>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: 'var(--muted)' }}>
                        {s.badge}
                      </span>
                    </div>
                    <small style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>
                      {s.subtitle}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="onboarding-actions" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
            {onCancel && (
              <button type="button" className="secondary-button" onClick={onCancel}>
                Voltar para o Login
              </button>
            )}
            <button
              type="button"
              className="primary-button"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                if (!companyName.trim()) {
                  setError('Por favor, informe o nome da sua empresa.');
                  return;
                }
                if (requireAuthFields && (!email.trim() || !password)) {
                  setError('Por favor, preencha o e-mail e a senha.');
                  return;
                }
                setError('');
                setStep(2);
              }}
            >
              <span>Avançar para Personalidade da IA</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Passo 2: Tom de Voz & Informações do Negócio */}
      {step === 2 && (
        <div className="onboarding-step-content">
          <div className="onboarding-tone-section">
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 10 }}>
              Tom de Voz do Atendimento:
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {TONES.map((t) => {
                const selected = tone === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTone(t.id)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: selected ? '1px solid var(--brand)' : '1px solid var(--line)',
                      background: selected ? 'rgba(0, 224, 255, 0.08)' : 'var(--surface)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--brand)' : '#fff', marginBottom: 4 }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>
                      {t.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
            <label className="auth-label">
              <span>Informações do Negócio / Endereço (opcional)</span>
              <textarea
                value={businessFacts}
                onChange={(e) => setBusinessFacts(e.target.value)}
                rows={3}
                placeholder="Ex: Estamos na Av. Principal 1000. Horário: Seg a Sex 08h às 18h. Estacionamento gratuito."
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 10,
                  color: '#fff',
                  fontSize: 13,
                  resize: 'none',
                }}
              />
            </label>

            <label className="auth-label">
              <span>Destaques do Catálogo / Serviços (opcional)</span>
              <textarea
                value={catalogHighlights}
                onChange={(e) => setCatalogHighlights(e.target.value)}
                rows={3}
                placeholder="Ex: Financiamento com parcelas acessíveis, laudo cautelar aprovado e garantia de motor."
                style={{
                  width: '100%',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 10,
                  color: '#fff',
                  fontSize: 13,
                  resize: 'none',
                }}
              />
            </label>
          </div>

          <label className="auth-label" style={{ marginTop: 12 }}>
            <span>Regras Importantes de Atendimento (opcional)</span>
            <input
              type="text"
              value={customRules}
              onChange={(e) => setCustomRules(e.target.value)}
              placeholder="Ex: Sempre pedir o nome do cliente antes de enviar opções; não confirmar reservas sem sinal."
              style={{
                width: '100%',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '10px 14px',
                color: '#fff',
                fontSize: 13,
              }}
            />
          </label>

          <div className="onboarding-actions" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
            <button type="button" className="secondary-button" onClick={() => setStep(1)}>
              <ArrowLeft size={16} />
              <span>Voltar</span>
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => setStep(3)}
            >
              <span>Revisar e Ativar</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Passo 3: Revisão & Prévia do Prompt */}
      {step === 3 && (
        <div className="onboarding-step-content">
          <div style={{ background: 'var(--surface-soft)', borderRadius: 12, padding: 16, border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bot size={22} color="var(--brand)" />
                <div>
                  <strong style={{ fontSize: 15, color: '#fff' }}>{companyName}</strong>
                  <span style={{ fontSize: 12, color: 'var(--muted)', display: 'block' }}>
                    Segmento: {SEGMENTS.find((s) => s.id === segment)?.title} · Tom: {TONES.find((t) => t.id === tone)?.title}
                  </span>
                </div>
              </div>
              <span style={{ fontSize: 12, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={14} /> Pronto para criação
              </span>
            </div>

            {/* Resumo dos Módulos Gerados Automaticamente */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 14 }}>
              <div style={{ background: 'var(--surface)', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: 11 }}>Funil Kanban</span>
                <strong style={{ color: '#fff' }}>4 Colunas com IA</strong>
              </div>
              <div style={{ background: 'var(--surface)', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: 11 }}>Motor WhatsApp</span>
                <strong style={{ color: '#fff' }}>Core v1 Ativo</strong>
              </div>
              <div style={{ background: 'var(--surface)', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: 11 }}>Capacidade</span>
                <strong style={{ color: '#fff' }}>{segment === 'vehicle_sales' || segment === 'retail_sales' ? 'Vendas Comerciais' : 'Atendimento Padrão'}</strong>
              </div>
              <div style={{ background: 'var(--surface)', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', display: 'block', fontSize: 11 }}>Prompt Gerado</span>
                <strong style={{ color: '#fff' }}>{compiledPrompt.length} caracteres</strong>
              </div>
            </div>
          </div>

          {/* Acordeão de Prévia do Prompt */}
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={() => setShowPromptPreview((p) => !p)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} color="var(--brand)" />
                Prévia do Prompt do Sistema da IA ({compiledPrompt.length} caracteres)
              </span>
              {showPromptPreview ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showPromptPreview && (
              <pre
                style={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  background: '#070d18',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: '#94a3b8',
                  marginTop: 6,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                }}
              >
                {compiledPrompt}
              </pre>
            )}
          </div>

          <div className="onboarding-actions" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
            <button type="button" className="secondary-button" onClick={() => setStep(2)} disabled={loading}>
              <ArrowLeft size={16} />
              <span>Voltar</span>
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleFinalSubmit}
              disabled={loading}
              style={{ minWidth: 200 }}
            >
              {loading ? (
                <>
                  <RefreshCcw size={16} className="spin" />
                  <span>Configurando Sistema...</span>
                </>
              ) : (
                <>
                  <span>Criar Empresa & Ativar IA</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
