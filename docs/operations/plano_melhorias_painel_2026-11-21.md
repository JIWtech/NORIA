# Plano de melhorias do painel, back e banco (2026-11-21)

Análise consolidada de três frentes, todas feitas só com leitura:
- **Codex:** desempenho e correção do painel e das consultas.
- **Gemini:** UI/UX, estilos, menus e acessibilidade.
- **Claude:** banco de produção (advisors, `pg_stat_statements`, funções `SECURITY DEFINER`).

Cada item indica o esforço (P, M ou G) e quem o encontrou.

## Fase 0: ganhos rápidos e seguros (1–2 dias)

1. **Mensagens mais leves:** o painel deixa de trazer o `raw_payload` inteiro nas listas e no histórico (`select *` de até 1.000 eventos). No banco, essa consulta soma 62 mil chamadas, com média de 55 ms e picos de 8 s. Isso exige projetar só as colunas usadas. M, Codex + Claude.
2. **Erros não podem virar lista vazia:** agenda, contatos, campanhas e leituras passam a mostrar erro com opção de tentar de novo. P/M, Codex.
3. **Agenda sem horários inventados** quando a configuração é inválida, e revalidar antes de reservar. P/M, Codex.
4. **Composer:** esconder ou marcar como "em breve" os botões de anexo e áudio, que hoje só falham no envio. P, Gemini.
5. **Camadas sobrepostas:** criar uma escala única de z-index. Hoje o dropdown abre atrás do modal e o visualizador de mídia fica abaixo do menu. M, Gemini.
6. **Breakpoint de Conversas:** o JS usa 800px e o CSS 768px. Alinhar os dois. P, Gemini.
7. **Vazamentos de cascata:** `.channel-*` sem escopo e uma media query da Agenda anulada pela ordem das regras. P, Gemini.
8. **Dashboard:** trocar a data falsa `'12/10 · 11:24'` por `—` e o agrupamento de horários (antes das 8h e depois das 22h) que distorce o gráfico. P, Gemini + Codex.
9. **Textos:** acentuação ("Nao foi possivel") e copy de bronzeamento aparecendo em telas genéricas. P, Gemini.
10. **Login:** ligar a proteção contra senha vazada no Supabase Auth. É configuração, P, Claude.

## Fase 1: correção e isolamento (3–4 dias)

1. **Kanban:** os movimentos pendentes e os callbacks passam a ficar presos ao usuário e ao tenant e são descartados na troca de empresa. M, Codex.
2. **Histórico por canal:** filtrar também pelo `channel_type`. A chave do cache passa a incluir usuário, tenant e canal, e o cache é limpo no logout. M, Codex.
3. **Etapa manual do Kanban** não pode se perder na recarga. O estado de controle deve ser lido por conversa, fora da janela de 1.000 eventos. G, risco alto, Codex.
4. **Marcadores de leitura:** hoje são cortados em 500 e conversas lidas voltam como não lidas. M, Codex.
5. **Ações destrutivas com confirmação:** excluir atendente, cancelar campanha, reconciliar incertos e finalizar pelo Kanban. Configurações passa a ter `catch` e feedback. M, Gemini.
6. **Campanha e destinatários criados de forma atômica.** M/G, Codex.
7. **Validar a hipótese:** uma recarga pode sobrescrever um evento do Realtime recebido durante a consulta. Codex.

## Fase 2: desempenho estrutural (4–6 dias)

1. **Histórico paginado por cursor** (`created_at` + `id`), para acessar mensagens além das 1.000. G, Codex.
2. **Recarga por tela** em vez de global, com invalidação explícita. G, Codex.
3. **Conversas antigas:** paginação real, hoje limitada a 2.000 cabeças. M/G, Codex.
4. **Code splitting:** `React.lazy` por tela, leitor de planilha sob demanda e landing sem o bundle e o CSS do painel. M, Codex + Gemini.
5. **Kanban:** preservar referências entre renderizações e medir antes de virtualizar. M, Codex.
6. **Banco**, com migração e autorização:
   - índices nas chaves estrangeiras mais usadas (opportunities, conversations, kanban_cards, appointments);
   - trocar `auth.uid()` por `(select auth.uid())` nas 31 políticas;
   - unificar as 29 políticas permissivas duplicadas e remover os 4 índices duplicados.

   M, Claude.
7. **RPC da fila mais cara:** uma das funções com parâmetros tenant, chat e token, com 553 ms de média e 5.600 s no total. Investigar com `EXPLAIN`. M, Claude.
8. **Lista de fusos** (`pg_timezone_names`, 0,7 s, 1.304 chamadas): guardar em cache no cliente. P, Claude.

## Fase 3: padronização visual e acessibilidade (5–7 dias)

1. **Primitivos únicos:** `NoriaButton`, `NoriaField`, `NoriaSelect` (com altura máxima e colisão) e `NoriaMenu`/`NoriaPopover` portalado, além de `NoriaDialog`. Hoje existem 5 implementações de menu. M/G, Gemini.
2. **Tokens:**
   - cores de canal (hoje são 4 paletas);
   - substituir o `--cv-*` divergente;
   - remover hex fixos em dashboard, auth e media-viewer;
   - raios fora da escala.

   G, Gemini.
3. **CSS morto e duplicado:**
   - `dashboard-table.css` e `dashboard.css:1-1500`;
   - `.badge` duplicado;
   - `prefers-reduced-motion` repetido em 12 arquivos.

   G, Gemini.
4. **WCAG AA:**
   - contraste de `--muted-soft` e `--lp-dim`;
   - `:focus-visible` padronizado;
   - alvos de toque de 44px no mobile;
   - `role="status"` em excesso;
   - botão aninhado na tabela do Dashboard;
   - `aria-current` na navegação;
   - setas do teclado em tabs.

   M, Gemini.
5. **Ícones de canal únicos:** sair da mistura de react-icons, lucide e SVG manual. P, Gemini.
6. **Rolagens internas presas** em Configurações, Agenda e Disparos. M, Gemini.

## Fase 4: landing (2 dias)

- LCP:
  - remover o atraso e o `opacity: 0` da imagem principal;
  - usar `fetchPriority`;
  - definir `width` e `height`;
  - converter para WebP.
- Fontes duplicadas.
- SEO: description, canonical, Open Graph, JSON-LD e título por rota.

M, Gemini.

## Fora do painel (backlog já no Trello)

- JOYERÍA: promessa da especialista antes da execução real e auditoria do retail.
- Filas antigas: 39 da Núbia e 168 da Gênesis.
- O publicador trava no Roteador.
- Observabilidade do Salon.
