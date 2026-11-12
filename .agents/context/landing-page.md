# Landing page e interface comercial

Ler apenas ao desenvolver ou alterar a homepage e páginas de conversão.

- **Estilo Openbox / SaaS premium**: visual limpo, profissional, corporativo e focado em retorno financeiro. Evitar clichês futuristas de "robôs de ficção científica".
- **Gancho**: *"Quanto você paga hoje de salário pra quem responde o WhatsApp da sua empresa?"*
- **Headline oficial**: *"Atenda mais rápido, organize seus clientes e venda mais com inteligência artificial"* (com ênfase em itálico editorial na cláusula final).
- **Subhead oficial**: *"Centralize WhatsApp, atendimento, CRM e automações em uma única plataforma. Sua IA atende, sua equipe acompanha e nenhuma oportunidade fica esquecida."*
- **Valor**: comparativo direto de produtividade e ROI (tempo de resposta, atendimento 24/7, qualificação automática, distribuição ágil para o time de fechamento).
- **Estilos e tokens**: CSS modular puro (sem Tailwind) com folha dedicada em `app/src/landing.css` (namespace `.home-wrapper`, `.lp-*`, `.sim-*`), consumindo os tokens oficiais de `app/src/styles/base/tokens.css` (`--bg: #0B1220`, `--surface: #0f182b`, `--brand: #00E0FF`, `--font-sans` com `Source Sans 3` + `Manrope` e `--font-serif` com `Newsreader`). Consulte também [o manual de Design System](../../docs/architecture/design_system_modern_css_uiverse.md).
