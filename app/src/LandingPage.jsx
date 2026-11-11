import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  DollarSign,
  KanbanSquare,
  Layers,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  Rocket,
  ShieldCheck,
  TrendingUp,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import noriaLogo from './assets/noria_logo.png';
import noriaConversasPreview from './assets/noria_conversas_preview.jpg';
import { isSessionBootstrapped, clearSessionBootstrapped } from './app/appStorage.js';
import { signOut } from './services/auth/authService.js';
import { SavingsSimulator } from './features/landing/SavingsSimulator.jsx';
import {
  useInView,
  usePrefersReducedMotion,
  useScrollProgressVar,
  useTweenedNumber,
} from './features/landing/useLandingMotion.js';

const NAV_LINKS = [
  { id: 'operacao', label: 'Operação' },
  { id: 'calculadora', label: 'Economia' },
  { id: 'ecossistema', label: 'Ecossistema' },
  { id: 'modulos', label: 'Módulos' },
  { id: 'seguranca', label: 'Segurança' },
];

const PROOF_POINTS = [
  { value: '< 30s', label: 'Tempo médio de resposta no WhatsApp' },
  { value: '24/7', label: 'Atendimento à noite e nos finais de semana' },
  { value: 'Kanban', label: 'Funil de vendas atualizado em tempo real' },
  { value: 'Handoff', label: 'Humanizado para a equipe na hora de fechar' },
];

const WHATSAPP_CONTACT_URL = 'https://wa.me/5521993614704?text=Ol%C3%A1!%20Quero%20conhecer%20mais%20sobre%20a%20Noria.';

const PIPELINE_METRICS = [
  { value: 1253, format: (v) => Math.round(v).toLocaleString('pt-BR'), label: 'Oportunidades', delta: '+18% de conversão mensal' },
  { value: 312, format: (v) => Math.round(v).toLocaleString('pt-BR'), label: 'Reuniões & visitas', delta: '+24% de comparecimento' },
  { value: 2.48, format: (v) => `R$ ${v.toFixed(2).replace('.', ',')}M`, label: 'Receita prevista', delta: 'Pipeline em tempo real' },
];

const FLOW_STEPS = [
  {
    title: 'A mensagem chega',
    text: 'Múltiplos números de WhatsApp da empresa e o Telegram centralizados em uma única tela.',
  },
  {
    title: 'A IA qualifica',
    text: 'Nome, interesse e entrada coletados automaticamente. Em concessionárias: veículo, ano e forma de pagamento.',
  },
  {
    title: 'O painel organiza',
    text: 'Conversas viram cards no Kanban, o test-drive é agendado e follow-ups automáticos evitam que o cliente esfrie.',
  },
  {
    title: 'Sua equipe fecha',
    text: 'O vendedor recebe o lead com nome, telefone e interesse já qualificados e entra só na hora de fechar negócio.',
  },
];

const ECOSYSTEM = [
  { code: 'SDR', icon: UserRound, text: 'Prospecção automatizada e qualificação de leads com inteligência artificial humanizada.' },
  { code: 'Pipeline', icon: TrendingUp, text: 'Oportunidades organizadas por valor de proposta e probabilidade de fechamento.' },
  { code: 'Flow', icon: KanbanSquare, text: 'Processos, tarefas e etapas comerciais em Kanban, com clareza e velocidade.' },
  { code: 'Agenda', icon: CalendarDays, text: 'Agendamentos integrados e controle de horários de visitas, reuniões e atendimentos.' },
  { code: 'Finance', icon: DollarSign, text: 'Sinais de pagamento, controle financeiro e histórico de propostas em um só lugar.' },
  { code: 'Intelligence', icon: BarChart3, text: 'Dashboards de conversão e horários de pico para decisões estratégicas.' },
];

const MODULE_TABS = [
  {
    id: 'conversas',
    icon: MessageCircle,
    label: 'Central de Conversas',
    kicker: 'Atendimento ágil',
    title: 'Toda a comunicação da sua empresa em uma tela',
    text: 'Acompanhe a IA respondendo em tempo real no WhatsApp e no Telegram, leia áudios transcritos sem precisar escutar e assuma o controle com um clique.',
    perks: [
      'Áudios de clientes transcritos em texto automaticamente',
      'Envio de fotos, anexos e localização oficial',
      'Histórico completo de conversas por cliente',
    ],
  },
  {
    id: 'kanban',
    icon: KanbanSquare,
    label: 'Kanban de Vendas',
    kicker: 'Gestão de oportunidades',
    title: 'Um funil visual para nunca mais perder um lead qualificado',
    text: 'Organize contatos por etapa comercial, arraste cards com facilidade e configure alertas automáticos de retorno.',
    perks: [
      'Classificação automática de leads frios, mornos e quentes',
      'Atribuição de responsável por negócio',
      'Sinal de pagamento e registro de propostas',
    ],
  },
  {
    id: 'dashboard',
    icon: Layers,
    label: 'Métricas & Dashboard',
    kicker: 'Controle gerencial',
    title: 'Métricas claras sobre o desempenho do atendimento',
    text: 'Saiba quantos clientes entraram em contato, quais canais mais convertem, os horários de pico e quanto tempo sua empresa leva para atender.',
    perks: [
      'Gráficos de volume diário e taxa de conversão',
      'Identificação dos horários com mais mensagens',
      'Relatórios exportáveis com 1 clique',
    ],
  },
  {
    id: 'configuracoes',
    icon: Building2,
    label: 'Multiempresa & Equipe',
    kicker: 'Estrutura empresarial',
    title: 'Filiais, marcas e equipes separadas na mesma infraestrutura',
    text: 'Cada empresa possui seus próprios contatos, canais, agentes humanos e regras comerciais exclusivas.',
    perks: [
      'Permissões granulares de acesso por atendente',
      'Catálogo de produtos e serviços individualizado',
      'Políticas de atendimento e horários de funcionamento customizados',
    ],
  },
];

const PILLARS = [
  { icon: ShieldCheck, title: 'Segura', text: 'Isolamento rigoroso por empresa, criptografia e conformidade com a LGPD.' },
  { icon: Zap, title: 'Rápida', text: 'Tempo de resposta médio inferior a 3 segundos no WhatsApp.' },
  { icon: Layers, title: 'Integrada', text: 'Conversas, equipe, funil, agendamentos e métricas em um único ecossistema.' },
  { icon: Rocket, title: 'Escalável', text: 'Do negócio local às redes com múltiplas filiais e dezenas de atendentes.' },
];

const KANBAN_COLUMNS = [
  { stage: 'Novos Leads', cards: [{ name: 'Lead', note: 'Test drive', temp: 'morno' }] },
  { stage: 'Em Atendimento', cards: [{ name: 'Lead', note: 'Peças em estoque', temp: 'frio' }] },
  { stage: 'Financiamento', cards: [{ name: 'Lead', note: 'Follow-up agendado', temp: 'morno' }] },
  { stage: 'Visita Agendada', cards: [{ name: 'Lead', note: 'SUV automático', temp: 'quente' }] },
  { stage: 'Fechamento', cards: [] },
];

const PEAK_HOURS = [22, 38, 64, 90, 72, 48, 80, 96, 58, 30];

function WhatsAppIcon({ size = 18, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1Zm0 0a5 5 0 0 0 5 5m0 0h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1Z" />
    </svg>
  );
}

function SectionHead({ index, label, title, children }) {
  return (
    <header className="lp-section-head" data-reveal>
      <span className="lp-kicker">
        <span className="lp-kicker-index">{index}</span>
        {label}
      </span>
      <h2 className="lp-h2">{title}</h2>
      {children && <p className="lp-lead">{children}</p>}
    </header>
  );
}

function CountUpMetric({ metric, reducedMotion }) {
  const ref = useRef(null);
  const inView = useInView(ref, { threshold: 0.6, once: true });
  const value = useTweenedNumber(inView ? metric.value : 0, { duration: 1400, from: reducedMotion ? metric.value : 0, disabled: reducedMotion });
  return (
    <div className="lp-metric" ref={ref}>
      <dt>{metric.label}</dt>
      <dd>
        <strong>{metric.format(value)}</strong>
        <span>{metric.delta}</span>
      </dd>
    </div>
  );
}

function ModuleVisual({ id }) {
  if (id === 'conversas') {
    return (
      <img
        src={noriaConversasPreview}
        alt="Central de Conversas NORIA com painel de atendimento e chat de WhatsApp"
        className="lp-module-img"
        loading="lazy"
      />
    );
  }

  if (id === 'kanban') {
    return (
      <div className="lp-kanban">
        {KANBAN_COLUMNS.map((column) => (
          <div className="lp-kanban-col" key={column.stage}>
            <div className="lp-kanban-head">{column.stage}</div>
            {column.cards.map((card) => (
              <div className="lp-kanban-card" key={card.note}>
                <span className="lp-kanban-line" />
                <span>{card.note}</span>
                <span className={`lp-temp lp-temp--${card.temp}`}>{card.temp}</span>
              </div>
            ))}
            {column.cards.length === 0 && <div className="lp-kanban-empty">Arraste para fechar</div>}
          </div>
        ))}
      </div>
    );
  }

  if (id === 'dashboard') {
    return (
      <div className="lp-dash">
        <div className="lp-dash-kpis">
          {['Conversas ativas', 'Aguardando equipe', 'Agendamentos'].map((label) => (
            <div key={label}><span>{label}</span><span className="lp-kanban-line lp-kanban-line--lg" /></div>
          ))}
        </div>
        <div className="lp-dash-chart">
          <span className="lp-dash-chart-title">Horários de pico</span>
          <div className="lp-dash-bars">
            {PEAK_HOURS.map((height, i) => (
              <span key={i} style={{ '--h': `${height}%`, '--i': i }} className={height > 85 ? 'is-peak' : ''} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lp-tenants">
      <div className="lp-tenants-core">
        <Layers size={16} />
        <span>Infraestrutura NORIA</span>
      </div>
      <div className="lp-tenants-grid">
        {['Empresa A', 'Empresa B', 'Empresa C'].map((name) => (
          <div className="lp-tenant" key={name}>
            <strong>{name}</strong>
            <ul>
              <li>Contatos</li>
              <li>Canais</li>
              <li>Agentes</li>
              <li>Regras comerciais</li>
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomePage() {
  const [activeTab, setActiveTab] = useState('conversas');
  const [hasSession, setHasSession] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const wrapperRef = useRef(null);
  const heroRef = useRef(null);
  const flowRef = useRef(null);

  useScrollProgressVar(flowRef, { disabled: reducedMotion, start: 0.75, end: 0.6 });

  useEffect(() => {
    setHasSession(isSessionBootstrapped());
    if (typeof document !== 'undefined') {
      document.body.classList.add('home-view');
      document.documentElement.classList.add('home-view');
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.classList.remove('home-view');
        document.documentElement.classList.remove('home-view');
      }
    };
  }, []);

  // Navbar: estado de rolagem e inclinação do produto no hero, num único listener.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 8);
      if (heroRef.current && !reducedMotion) {
        heroRef.current.style.setProperty('--hero-progress', Math.min(1, y / 520).toFixed(4));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [reducedMotion]);

  // Seção ativa na navbar.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const sections = NAV_LINKS.map((link) => document.getElementById(link.id)).filter(Boolean);
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  // Revelação progressiva: só esconde conteúdo quando há JS e movimento permitido.
  useEffect(() => {
    const root = wrapperRef.current;
    if (!root || reducedMotion || typeof IntersectionObserver === 'undefined') return undefined;
    root.classList.add('lp-motion');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    root.querySelectorAll('[data-reveal]').forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      root.classList.remove('lp-motion');
    };
  }, [reducedMotion]);

  const goTo = (search) => {
    if (typeof window !== 'undefined') {
      window.location.assign(`${window.location.pathname}${search}`);
    }
  };

  const startWhatsAppConversation = () => {
    if (typeof window !== 'undefined') {
      const opened = window.open(WHATSAPP_CONTACT_URL, '_blank', 'noopener,noreferrer');
      if (opened) opened.opener = null;
    }
  };

  const handleSignOut = async () => {
    clearSessionBootstrapped();
    setHasSession(false);
    await signOut();
  };

  const currentTab = MODULE_TABS.find((tab) => tab.id === activeTab) ?? MODULE_TABS[0];

  return (
    <div className="home-wrapper" ref={wrapperRef}>
      <header className={`lp-nav ${scrolled ? 'is-scrolled' : ''} ${menuOpen ? 'is-open' : ''}`}>
        {hasSession && (
          <div className="lp-session-banner">
            <span>Você já possui uma sessão ativa na plataforma.</span>
            <button type="button" onClick={handleSignOut}>
              <LogOut size={13} /> Sair
            </button>
          </div>
        )}
        <div className="lp-container lp-nav-inner">
          <a className="lp-brand" href="#inicio" aria-label="NORIA, início" onClick={() => setMenuOpen(false)}>
            <img src={noriaLogo} alt="NORIA" className="lp-brand-logo" />
          </a>

          <nav className="lp-nav-links" aria-label="Navegação da página">
            {NAV_LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={activeSection === link.id ? 'is-active' : ''}
                aria-current={activeSection === link.id ? 'true' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="lp-nav-actions">
            <button className="lp-btn lp-btn--primary" type="button" onClick={() => goTo('?app=1')}>
              {hasSession ? 'Abrir dashboard' : 'Acessar plataforma'} <ArrowRight size={15} />
            </button>
            <button
              className="lp-menu-toggle"
              type="button"
              aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section id="inicio" className="lp-hero" ref={heroRef}>
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-hero-kicker lp-rise" style={{ '--d': 0 }}>
                WhatsApp oficial · CRM · Automação com IA
              </p>
              <h1 className="lp-h1">
                <span className="lp-line"><span className="lp-rise" style={{ '--d': 1 }}>Atenda mais rápido,</span></span>
                <span className="lp-line"><span className="lp-rise" style={{ '--d': 2 }}>organize seus clientes</span></span>
                <span className="lp-line lp-line--em">
                  <em className="lp-rise" style={{ '--d': 3 }}>
                    e venda mais com <span className="lp-nowrap">inteligência artificial</span>
                  </em>
                </span>
              </h1>
              <p className="lp-hero-sub lp-rise" style={{ '--d': 4 }}>
                Centralize WhatsApp, atendimento, CRM e automações em uma única plataforma. Sua IA
                atende, sua equipe acompanha e nenhuma oportunidade fica esquecida.
              </p>
              <div className="lp-hero-ctas lp-rise" style={{ '--d': 5 }}>
                <button className="lp-btn lp-btn--primary lp-btn--lg" type="button" onClick={startWhatsAppConversation}>
                  Ver a plataforma em ação <ArrowRight size={18} />
                </button>
                <a className="lp-btn lp-btn--quiet lp-btn--lg" href="#calculadora">
                  Simular economia da minha equipe
                </a>
              </div>
            </div>

            <figure className="lp-stage">
              <div className="lp-stage-frame">
                <img
                  src={noriaConversasPreview}
                  alt="Central de Atendimento e Conversas da plataforma NORIA"
                  className="lp-stage-img"
                  fetchpriority="high"
                />
              </div>
              <figcaption className="lp-stage-caption lp-mono">Central de Conversas · tela da plataforma</figcaption>
            </figure>
          </div>

          <div className="lp-container">
            <ul className="lp-proof">
              {PROOF_POINTS.map((point, i) => (
                <li key={point.value} className="lp-rise" style={{ '--d': 6 + i * 0.5 }}>
                  <strong>{point.value}</strong>
                  <span>{point.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 01 OPERAÇÃO */}
        <section id="operacao" className="lp-section">
          <div className="lp-container lp-split">
            <div className="lp-split-aside">
              <SectionHead index="01" label="Operação" title={<>A inteligência que <em>move o seu negócio.</em></>}>
                Da primeira mensagem no WhatsApp até o fechamento do contrato e a emissão da proposta.
              </SectionHead>
            </div>

            <ol className="lp-flow" ref={flowRef}>
              {FLOW_STEPS.map((step, i) => (
                <li key={step.title} data-reveal style={{ '--d': i }}>
                  <span className="lp-flow-index">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="lp-container">
            <div className="lp-ledger" data-reveal>
              <span className="lp-ledger-label lp-mono">Exemplo do painel de pipeline</span>
              <dl>
                {PIPELINE_METRICS.map((metric) => (
                  <CountUpMetric key={metric.label} metric={metric} reducedMotion={reducedMotion} />
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* 02 ECONOMIA */}
        <section id="calculadora" className="lp-section lp-section--sunken">
          <div className="lp-container">
            <div className="lp-cost-head">
              <SectionHead
                index="02"
                label="Economia"
                title="Quanto você paga hoje de salário pra quem responde o WhatsApp da sua empresa?"
              >
                Sua operação pode custar menos. Muito menos. Automatize atendimentos repetitivos, otimize o trabalho
                da equipe e reduza a necessidade de novas contratações.
              </SectionHead>
              <div className="lp-cost-figure" data-reveal>
                <span className="lp-cost-figure-pre">até</span>
                <strong>60%</strong>
                <span>de redução potencial de custo operacional</span>
              </div>
            </div>

            <div data-reveal>
              <SavingsSimulator onStart={startWhatsAppConversation} />
            </div>
          </div>
        </section>

        {/* 03 ECOSSISTEMA */}
        <section id="ecossistema" className="lp-section">
          <div className="lp-container lp-split">
            <div className="lp-split-aside">
              <SectionHead index="03" label="Ecossistema" title={<>Tudo conectado. <em>Tudo em movimento.</em></>}>
                Menos ferramentas, mais inteligência. Substitua planilhas perdidas, CRM desconectado e atendentes
                sobrecarregados por um sistema único.
              </SectionHead>
            </div>

            <ul className="lp-eco">
              {ECOSYSTEM.map(({ code, icon: Icon, text }, i) => (
                <li key={code} data-reveal style={{ '--d': i * 0.6 }}>
                  <span className="lp-eco-index lp-mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lp-eco-name">
                    <small>NORIA</small>
                    {code}
                  </span>
                  <p>{text}</p>
                  <Icon size={20} className="lp-eco-icon" />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 04 MÓDULOS */}
        <section id="modulos" className="lp-section lp-section--sunken">
          <div className="lp-container">
            <div className="lp-modules-head">
              <SectionHead index="04" label="Tour da plataforma" title="Conheça cada detalhe da sua nova central." />
              <div className="lp-tabs" role="tablist" aria-label="Módulos da plataforma" data-reveal>
                {MODULE_TABS.map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={activeTab === id}
                    aria-controls="lp-tab-panel"
                    className={`lp-tab ${activeTab === id ? 'is-active' : ''}`}
                    onClick={() => setActiveTab(id)}
                  >
                    <Icon size={16} /> {label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="lp-tab-panel"
              id="lp-tab-panel"
              role="tabpanel"
              aria-labelledby={`tab-${currentTab.id}`}
              key={currentTab.id}
            >
              <div className="lp-tab-copy">
                <span className="lp-tab-kicker">{currentTab.kicker}</span>
                <h3>{currentTab.title}</h3>
                <p>{currentTab.text}</p>
                <ul>
                  {currentTab.perks.map((perk) => (
                    <li key={perk}><Check size={15} /> {perk}</li>
                  ))}
                </ul>
                <button className="lp-link" type="button" onClick={() => goTo('?app=1')}>
                  Abrir na plataforma <ArrowUpRight size={15} />
                </button>
              </div>
              <figure className="lp-tab-visual">
                <ModuleVisual id={currentTab.id} />
                <figcaption className="lp-mono">
                  {currentTab.id === 'conversas' ? 'Tela da plataforma' : 'Representação ilustrativa da interface'}
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* 05 SEGURANÇA */}
        <section id="seguranca" className="lp-section">
          <div className="lp-container lp-trust">
            <div className="lp-trust-statement">
              <SectionHead index="05" label="Confiabilidade" title="Construída para empresas que não podem parar.">
                Isolamento rigoroso entre empresas, criptografia em trânsito e em repouso, backups automatizados e
                conformidade estrita com as políticas do WhatsApp e a LGPD.
              </SectionHead>
              <ul className="lp-security-list" data-reveal>
                <li><Lock size={15} /> Criptografia de ponta a ponta</li>
                <li><ShieldCheck size={15} /> Isolamento de dados por empresa</li>
                <li><Building2 size={15} /> Servidores de alta disponibilidade</li>
              </ul>
            </div>

            <ul className="lp-pillars">
              {PILLARS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} data-reveal style={{ '--d': i * 0.6 }}>
                  <Icon size={22} />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA FINAL */}
        <section className="lp-final">
          <div className="lp-container lp-final-inner" data-reveal>
            <h2 className="lp-h2">
              Pare de perder vendas por <em>demora no WhatsApp.</em>
            </h2>
            <div className="lp-final-side">
              <p className="lp-lead">
                Junte-se às empresas que já automatizaram a qualificação de clientes e aceleraram o fechamento com a NORIA.
              </p>
              <div className="lp-final-actions">
                <a
                  className="lp-btn lp-btn--primary lp-btn--lg"
                  href={WHATSAPP_CONTACT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  <WhatsAppIcon size={18} /> Falar no WhatsApp <ArrowRight size={18} />
                </a>
                <button className="lp-btn lp-btn--quiet lp-btn--lg" type="button" onClick={() => goTo('?app=1')}>
                  Explorar a plataforma
                </button>
              </div>
              <p className="lp-final-note lp-mono">Configuração rápida · Sem burocracia · Suporte comercial dedicado</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <img src={noriaLogo} alt="NORIA" className="lp-footer-logo" />
            <p>A plataforma para unificar WhatsApp, atendimento inteligente, CRM e vendas.</p>
          </div>
          <nav className="lp-footer-cols" aria-label="Rodapé">
            <div>
              <h4>Produto</h4>
              {NAV_LINKS.map((link) => (
                <a key={link.id} href={`#${link.id}`}>{link.label}</a>
              ))}
            </div>
            <div>
              <h4>Acesso</h4>
              <button type="button" onClick={() => goTo('?app=1')}>Área do cliente</button>
              <a
                href={WHATSAPP_CONTACT_URL}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Falar no WhatsApp
              </a>
            </div>
          </nav>
        </div>
        <div className="lp-container lp-footer-bottom">
          <span>© {new Date().getFullYear()} NORIA. Todos os direitos reservados.</span>
          <span className="lp-mono">Inteligência em movimento</span>
        </div>
      </footer>

      <a
        className="lp-whatsapp-fab"
        href={WHATSAPP_CONTACT_URL}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        aria-label="Falar com a NORIA no WhatsApp"
      >
        <WhatsAppIcon size={24} className="lp-whatsapp-fab-icon" />
        <span className="lp-whatsapp-fab-label">Falar no WhatsApp</span>
      </a>
    </div>
  );
}

export default HomePage;
