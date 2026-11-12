# Design System, Tokens & Manual de CSS Moderno — NORIA / Mag.IA

Este documento consolida a identidade visual real da plataforma **NORIA / Mag.IA**, a arquitetura modular de frontend em `app/src/`, os padrões modernos de **Vanilla CSS** (inspirados no Uiverse.io e adaptados à paleta da marca) e as anotações de especialização em UI/UX dark-mode para SaaS B2B.

---

## 🏗️ 1. Arquitetura do Frontend e Cascata CSS

O projeto utiliza **React 19 + Vite 6** com **CSS modular puro** (sem Tailwind), ícones SVG (`lucide-react` e `react-icons`) e primitivos acessíveis (`@radix-ui/react-select` via `NoriaSelect`).

### Estrutura em `app/src/`

- **Shell e rotas principais (`app/src/app/`):**
  - `App.jsx`: alterna entre a landing comercial (`HomePage`), login/onboarding (`LoginPage`) e o shell logado (`.app-shell`), com as views `dashboard`, `conversas`, `kanban`, `disparos`, `agendamentos`, `configuracoes` (além de suporte a `funil`).
  - `AppNavigation.jsx`: sidebar fixa (`.sidebar`) no desktop e drawer (`.mobile-nav-drawer`) no mobile.
  - `AppTopbar.jsx`: barra superior com título acentuado (`.kanban-title-accent`), seletor multi-tenant (`NoriaSelect`), `NotificationCenter`, atualizar e sair.
- **Componentes compartilhados (`app/src/components/`):**
  - `NoriaSelect.jsx`, `AudioMessagePlayer.jsx`, `TenantOnboardingWizard.jsx` e `components/ui/` (`Badge`, `ChannelIcon`, `ContactAvatar`, `EmptyState`, `PanelTitle`, `Skeletons`).
- **Módulos por domínio (`app/src/features/`):**
  - `auth/`, `dashboard/`, `conversations/`, `kanban/`, `broadcasts/`, `appointments/`, `settings/`, `notifications/` (com `notifications.css` co-localizado) e `landing/` (`SavingsSimulator.jsx`, `savingsModel.js`, `useLandingMotion.js`).

### Ordem de Importação CSS (`app/src/main.jsx`)

A ordem da cascata global é controlada explicitamente em `app/src/main.jsx`:

1. Fonte local: `@fontsource-variable/manrope` (complementada por Google Fonts `Source Sans 3` e `Newsreader` em `app/index.html`).
2. Base (`app/src/styles/base/`): `tokens.css`, `reset.css`.
3. Layout (`app/src/styles/layout/`): `shell-sidebar.css`, `topbar.css`, `mobile-nav.css` (e `responsive-global.css` após as páginas).
4. Componentes (`app/src/styles/components/`): `controls.css`, `noria-select.css`, `dashboard-table.css`, `audio-player.css`, `media-viewer.css`, `modals.css`, `skeletons.css`, `attachments-location.css`, `stage-tones.css`, `appointment-outcome.css` (e `document-preview.css` importado sob demanda em `DocumentAttachment.jsx`).
5. Páginas (`app/src/styles/pages/`): `dashboard.css`, `conversations-legacy.css`, `conversations-responsive.css`, `auth.css`, `kanban.css`, `appointments.css`, `agents.css`, `settings.css`, `broadcasts.css`, `dashboard-responsive.css`, `kanban-responsive.css`.
6. Complementos e páginas dedicadas: `app/src/styles.css` (onboarding wizard), `app/src/conversations.css`, `app/src/landing.css` (landing page isolada em `.home-wrapper` / `.lp-*` / `.sim-*`).
7. Estilos co-localizados de feature: `app/src/features/notifications/notifications.css` (importado em `NotificationPanel.jsx`).

---

## 🎨 2. Tokens Oficiais do Sistema Dark Mode (`app/src/styles/base/tokens.css`)

Paleta oficial de alto contraste da identidade **NORIA Dark Navy** — todo componente novo deve consumir estas variáveis em vez de cores hexadecimais avulsas:

```css
:root {
  color-scheme: dark;

  /* Superfícies & Canvas (NORIA Dark Navy) */
  --bg: #0B1220;
  --canvas: var(--bg);
  --surface-sunken: #070d18;
  --surface: #0f182b;
  --surface-soft: #142036;
  --surface-elevated: #1a2944;
  --surface-raised: #1a2944;
  --surface-hover: #1f3050;

  /* Tipografia */
  --text: #F2F4F7;
  --muted: #8b9cb5;
  --muted-soft: #64748b;

  /* Bordas & Divisores */
  --line: rgba(242, 244, 247, 0.08);
  --line-strong: rgba(242, 244, 247, 0.16);

  /* Marca & Acentos (Identidade NORIA) */
  --brand: #00E0FF;
  --brand-strong: #00b8d4;
  --brand-soft: rgba(0, 224, 255, 0.12);
  --brand-glow: rgba(0, 224, 255, 0.2);
  --violet: #7861FF;
  --violet-soft: rgba(120, 97, 255, 0.15);
  --brand-gradient: linear-gradient(135deg, var(--brand) 0%, var(--violet) 100%);

  /* Status Semânticos */
  --blue: #00E0FF;
  --amber: #fbbf24;
  --red: #f87171;
  --green: #34d399;

  /* Sombras & Escalas */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.2);
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* Dimensões do Shell & Controles */
  --sidebar-width: 240px;
  --sidebar-collapsed-width: 72px;
  --topbar-height: 64px;
  --control-height: 40px;
  --control-height-lg: 44px;

  /* Larguras Máximas de Conteúdo */
  --content-dashboard-max: 1400px;
  --content-form-max: 1280px;
  --content-reading-max: 980px;

  /* Raios */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 9999px;

  /* Famílias Tipográficas */
  --font-sans: "Source Sans 3", "Manrope Variable", "Manrope", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-serif: "Newsreader", "Charter", "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif;
  --font-editorial: var(--font-serif);
  --font-display: var(--font-sans);
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
```

---

## 💎 3. Padrões Modernos de CSS (Uiverse.io Adaptado à Identidade NORIA)

Todos os padrões abaixo foram preservados e adaptados para consumir exclusivamente os tokens oficiais da NORIA (`--surface`, `--brand`, `--violet`, `--line*`, `--radius-*`):

### 1. Glassmorphism 2.0 (Vidro Fosco Hiper-Refinado)

Combinação de **sombras internas sutis**, **desfoque com saturação** e **bordas semitransparentes** sobre a base `--surface`:

```css
/* Card Glassmorphism Premium (Identidade NORIA) */
.glass-card-modern {
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow:
    var(--shadow),
    inset 0 1px 1px 0 rgba(242, 244, 247, 0.08);
  transition:
    background-color 240ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 240ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 240ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.glass-card-modern:hover {
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
  border-color: var(--line-strong);
  transform: translateY(-2px);
  box-shadow:
    0 14px 40px rgba(0, 0, 0, 0.45),
    inset 0 1px 2px 0 rgba(242, 244, 247, 0.14);
}
```

### 2. Bordas Animadas com Rotação de Gradiente (`@property` + `conic-gradient`)

Técnica para cards de destaque ou CTAs principais com borda `--brand` / `--violet` animada via GPU:

```css
@property --angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.glowing-border-card {
  position: relative;
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
}

.glowing-border-card::before {
  content: '';
  position: absolute;
  inset: -1.5px;
  border-radius: calc(var(--radius-lg) + 1px);
  background: conic-gradient(
    from var(--angle),
    transparent 20%,
    var(--brand) 50%,
    var(--violet) 70%,
    transparent 90%
  );
  z-index: -1;
  animation: rotateBorder 4s linear infinite;
}

.glowing-border-card::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: calc(var(--radius-lg) + 4px);
  background: conic-gradient(
    from var(--angle),
    transparent 30%,
    var(--brand-glow) 60%,
    transparent 85%
  );
  z-index: -2;
  filter: blur(12px);
  animation: rotateBorder 4s linear infinite;
}

@keyframes rotateBorder {
  to {
    --angle: 360deg;
  }
}
```

### 3. Botões com Efeito de Brilho Dinâmico (Shimmer Sweep)

Reflexo de luz que varre o botão ao passar o cursor, usando a paleta ciano/navy da NORIA:

```css
.btn-shimmer {
  position: relative;
  overflow: hidden;
  height: var(--control-height);
  padding: 0 var(--space-5);
  font-size: 14px;
  font-weight: 600;
  color: #03141c;
  background: linear-gradient(135deg, var(--brand), var(--brand-strong));
  border: 1px solid color-mix(in srgb, var(--brand) 55%, white 15%);
  border-radius: var(--radius-sm);
  cursor: pointer;
  box-shadow: 0 4px 16px var(--brand-glow);
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms ease;
}

.btn-shimmer::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.35),
    transparent
  );
  transition: left 0.6s ease;
}

.btn-shimmer:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 22px rgba(0, 224, 255, 0.32);
}

.btn-shimmer:hover:not(:disabled)::before {
  left: 100%;
}

.btn-shimmer:active:not(:disabled) {
  transform: translateY(1px);
}
```

### 4. Botão 3D Tátil (SaaS Premium)

Botão com resposta física tátil ao clique para ações rápidas e confirmações de destaque:

```css
.btn-tactile-3d {
  background: var(--brand);
  color: #03141c;
  font-weight: 700;
  padding: 12px 24px;
  border-radius: var(--radius-md);
  border: 1px solid #66ecff;
  box-shadow: 0 5px 0 var(--brand-strong), 0 10px 20px rgba(0, 0, 0, 0.35);
  transition: transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.btn-tactile-3d:hover:not(:disabled) {
  background: #33e7ff;
  transform: translateY(2px);
  box-shadow: 0 3px 0 var(--brand-strong), 0 6px 14px rgba(0, 0, 0, 0.3);
}

.btn-tactile-3d:active:not(:disabled) {
  transform: translateY(5px);
  box-shadow: 0 0 0 var(--brand-strong), 0 2px 4px rgba(0, 0, 0, 0.25);
}
```

### 5. Inputs com Foco Neon e Floating Label

Campos de formulário com borda e anel de foco alinhados ao padrão de `controls.css` e `noria-select.css`:

```css
.input-group-modern {
  position: relative;
  width: 100%;
}

.input-modern {
  width: 100%;
  min-height: var(--control-height-lg);
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 200ms cubic-bezier(0.16, 1, 0.3, 1),
    background-color 200ms ease,
    box-shadow 200ms ease;
}

.input-modern:focus-visible {
  border-color: var(--brand);
  background: var(--surface-soft);
  box-shadow:
    0 0 0 3px var(--brand-soft),
    0 4px 20px rgba(0, 0, 0, 0.28);
}

.input-modern::placeholder {
  color: var(--muted-soft);
}
```

### 6. Loaders Modernos e Minimalistas

#### A. Anel de Pulso Orbital
```css
.loader-orbit {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-block;
  position: relative;
  border: 3px solid transparent;
  border-top-color: var(--brand);
  animation: spinOrbit 1s ease-in-out infinite;
}

.loader-orbit::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  border: 3px solid transparent;
  border-top-color: var(--violet);
  animation: spinOrbit 0.6s ease-in-out infinite reverse;
}

@keyframes spinOrbit {
  to { transform: rotate(360deg); }
}
```

#### B. Barras de Som / Equalizador Suave (ideal para áudio WhatsApp e processamento de IA)
```css
.loader-bars {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
}

.loader-bar {
  width: 3.5px;
  height: 100%;
  background: var(--brand);
  border-radius: 3px;
  animation: barWave 1.2s ease-in-out infinite;
}

.loader-bar:nth-child(2) { animation-delay: 0.15s; }
.loader-bar:nth-child(3) { animation-delay: 0.3s; }
.loader-bar:nth-child(4) { animation-delay: 0.45s; }

@keyframes barWave {
  0%, 100% { transform: scaleY(0.25); opacity: 0.4; }
  50% { transform: scaleY(1); opacity: 1; filter: drop-shadow(0 0 4px var(--brand)); }
}
```

---

## 🧠 4. Guia de Especialização: Design Dark-Mode B2B & CSS Moderno

Anotações consolidadas de referência SaaS (estilo Linear/Vercel/Openbox), `modern-web-guidance` (Baseline) e boas práticas de Motion & Acessibilidade:

### A. Hierarquia Visual em Dark Mode (Luminância > Sombra)
- **Escada de superfícies, não sombras pesadas:** em temas escuros, elevação vem do degrau progressivo de luminosidade (`--surface-sunken` → `--bg` → `--surface` → `--surface-soft` → `--surface-elevated`) combinado com bordas finas (`1px solid var(--line)` / `var(--line-strong)`). Reservar sombras amplas apenas para overlays flutuantes (`--shadow`, modais e popovers).
- **Disciplina 60-30-10 de cor:** ~90–95% da interface deve permanecer na família dark navy neutra (`--bg`, `--surface*`, `--text`, `--muted`); `--brand` (`#00E0FF`) atua como **sinal funcional** (CTA principal, item ativo, foco, unread) e `--violet` (`#7861FF`) como apoio sutil (gradientes da marca, acento de agenda). Status (`--green`, `--amber`, `--red`) nunca devem ser a única forma de comunicar estado — combinar sempre com ícone ou rótulo (WCAG 1.4.1).
- **Tipografia e densidade:**
  - Aplicar *tracking* negativo em títulos grandes (`-0.02em` a `-0.04em` em displays) e `font-variant-numeric: tabular-nums` em métricas, tabelas, contadores e horários.
  - Evitar branco puro (`#ffffff`) em texto longo — `--text: #F2F4F7` reduz fadiga visual, enquanto `--muted: #8b9cb5` mantém leitura secundária com contraste confortável.

### B. CSS Moderno Baseline (Sem Bloat de JS)
- **Seletores inteligentes sem duplicação:** usar `:has()` para estilizar contêineres pelo estado filho (já adotado em `reset.css` com `body:has(.app-shell)` e `body:has(.home-wrapper)`), `:not()` para evitar conflito de hover/disabled (`button:hover:not(:disabled)`), e `:where()` / `:is()` para reduzir repetição sem inflar especificidade.
- **Cores dinâmicas com `color-mix()`:** derivar fundos sutis e bordas sem multiplicar tokens hex (`color-mix(in srgb, var(--brand) 12%, transparent)` — padrão já usado em `notifications.css`), mantendo tints/shades dentro do gamut sem lavar a cor.
- **Organização da cascata (`@layer` / `@scope`):** ao evoluir módulos novos, preferir `@layer` para separar base, componentes e overrides sem recorrer a `!important`.
- **Layout intrínseco e responsivo:**
  - Preferir `minmax(0, 1fr)`, `min-width: 0` em filhos de Grid/Flex, `clamp()` para tipografia/espaçamento fluido e `@container` (`container-type: inline-size`) quando um card precisa se adaptar ao tamanho da coluna onde está inserido (sidebar vs área principal).
  - Usar `100%` ou `100dvh`/`100dvw` em vez de `100vw` (evita overflow horizontal pela largura da scrollbar).
  - Reservar espaço de rolagem e estabilidade com `scrollbar-gutter: stable`, `overscroll-behavior: contain` em painéis roláveis (sidebar, timeline, popovers) e `overflow: clip` quando o objetivo for apenas recorte visual sem criar container de scroll.
  - Em modais/popovers futuros, considerar `<dialog>` / `popover` nativos com `@starting-style` para entrada/saída suave sem JavaScript extra.

### C. Motion Design & Acessibilidade (WCAG)
- **Temporização funcional (perfil corporativo/premium):**
  - Micro-feedback / hover: `80–120ms`
  - Clique / toggle / controle: `120–180ms`
  - Cards / modais / painéis: `200–350ms` (entradas ~30–50% mais longas que saídas; entrada desacelera `ease-out`, saída acelera `ease-in`).
- **Aceleração por hardware:** animar preferencialmente `transform` e `opacity` (evitar animar `width`, `height`, `top`, `left` em massa).
- **Contraste e foco obrigatórios:** mínimo `4.5:1` para texto normal, `3:1` para texto grande, ícones e contornos de componentes/inputs (WCAG 1.4.3 / 1.4.11); manter `:focus-visible` com `outline: 2px solid var(--brand)` e suporte a `@media (prefers-reduced-motion: reduce)`.

---

## 📐 5. Referências Estudadas — Figma Community (Modelos SaaS Gratuitos)

Estudo extraído a partir do diretório oficial [Modelos de site SaaS gratuitos no Figma](https://www.figma.com/community/website-templates/saas?resource_type=files) e previews ao vivo (`launchuicomponents.com` e `need-spiny-01266573.figma.site`):

### Templates gratuitos mais relevantes para a NORIA
- **Launch UI – Landing Page Templates & Components** (`figma.com/pt-br/comunidade/file/1420131743903900629`): kit dark mode com Bento Grid modular, cards de KPI (`+12.5%` badge), blocos de código/UI e iluminação radial sutil dentro dos cards.
- **Modern, Clean SaaS Company** (`figma.com/pt-br/comunidade/file/1573023525218599861`): composição editorial limpa com contraste alto entre título e subtítulo (alinhado ao uso de `Source Sans 3` + `Newsreader` na landing da NORIA).
- **SaaS, Futuristic App — Webflow Landing Page Design** (`figma.com/pt-br/comunidade/file/1220395318362406554`): estética escura com halos radiais difusos e cards translúcidos.
- **Multiple Dark Dashboards Inspirations** (`figma.com/pt-br/comunidade/file/1354429309780258770`) e **CRM UI Kit / Venture CRM** (`1463557748128304576` / `1340997556708750617`): referências diretas para funil, cards de métricas, heatmaps e listas de atendimento.
- **Botly – AI Chatbot Dashboard** (`1263876139353787026`) e **SaaS Landing Page - Bento UI** (`1360683197038417365`): padrões de chat com IA, seletores rápidos e storytelling em Bento Grid.

### Como adaptar esses padrões para a NORIA (sem perder a identidade)
- **Superfícies:** trocar fundos pretos/zinco (`#090A0F`) pelos degraus navy da NORIA (`--surface-sunken: #070d18`, `--bg: #0B1220`, `--surface: #0f182b`, `--surface-soft: #142036`) com borda `1px solid var(--line)`.
- **Iluminação de Bento Cards:** em vez de brilhos laranja/roxo genéricos, aplicar um glow radial sutil (`radial-gradient` com `var(--brand-soft)` ou `var(--violet-soft)` em `8%–14%` de opacidade) no fundo do card de destaque.
- **Tipografia & Métricas:** manter título curto à esquerda, descrição em `--muted`, badges em `font-family: var(--font-mono)` e números em `font-variant-numeric: tabular-nums`.
- **Fluxo com Figma MCP:** para importar qualquer um desses modelos para o projeto, basta clicar em **Abrir no Figma / Duplicar** na página do template e colar o link do frame desejado aqui no chat.

---

### 📌 Aplicação Contínua
Este manual é a referência viva de **UI, CSS e Design System** do projeto. Qualquer nova tela, componente ou ajuste visual deve respeitar os tokens de `app/src/styles/base/tokens.css`, manter o CSS modular (sem Tailwind salvo pedido explícito) e preservar a identidade NORIA.
