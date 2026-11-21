# Validação e correções do painel P2

Worktree: `C:\noria-wt-bugs2`, branch `fix/bugs-p2-painel`. As alterações anteriores do Gemini foram preservadas. Nenhum commit, push, publicação, migração, instalação de dependências ou acesso de escrita à produção foi realizado.

## Resultado

- Reprodução inicial: `npm test` em `app/`: **962/982**, 20 falhas.
- Resultado integrado final: `npm test`: **983/983**, zero falhas, código de saída 0.
- `npx vite build --configLoader runner`: **aprovado**, código de saída 0.
- `git diff --check`: **aprovado**.
- `npm run build` foi tentado e encontrou `EPERM` ao criar `app/node_modules/.vite-temp/...`, porque `node_modules` é uma junção fora da raiz gravável. A alternativa solicitada com `--configLoader runner` compilou os arquivos finais sem modificar dependências. Permanece o aviso de chunks maiores que 500 kB.
- Logs locais: `app/test-p2-initial.log`, `app/test-p2-final.log`, `app/build-p2.log`, `app/build-p2-runner.log`.

## Causa de cada uma das 20 falhas iniciais

Na tabela, **TDZ** significa a regressão introduzida no Realtime: o bloco da conversa existente declarava um `const resolvedTenant` que ocultava a variável externa, mas o preview usava esse identificador antes da declaração. Isso lançava `ReferenceError`. A correção em `app/src/services/conversations/applyIncomingEvent.js:190` resolve o tenant antes de calcular o preview. As asserções de comportamento desses testes foram preservadas.

| # | Teste inicialmente falho | Causa e tratamento |
| --- | --- | --- |
| 1 | `REGRESSAO: App.jsx preserva os 19 estados, 7 refs e 10 efeitos auditados` | Contagem estrutural antiga. C3 acrescenta legitimamente `refreshDataRef`. Atualizado para 8 refs, mantendo 19 estados e 10 efeitos: `app/tests/architecture/app.test.js:53,72`. |
| 2 | `6B.13 conversation presentation preserves location cache and audio normalization` | Fixture esperava cache global sem tenant, incompatível com A5. As duas chamadas agora informam `tenant-a`; a exigência de reutilização permanece: `app/tests/architecture/serviceExtraction6b13.test.js:15`. |
| 3 | `6B.32 fechamento de App.jsx: AST limpa, orquestração coesa e estabilidade de hooks` | Mesmo acréscimo legítimo de ref em C3. Atualizado read tracker de 2 para 3 refs e total de 7 para 8; demais invariantes preservadas: `app/tests/architecture/serviceExtraction6b32.test.js:104,113`. |
| 4 | `C2: Appointments renderiza sem erro quando schedule.units e schedule.services estão ausentes` | O teste procurava `Novo agendamento`, texto que seu próprio stub de `PanelTitle` omitia. Continua renderizando o componente e verifica formulário, campos de unidade/serviço e placeholders efetivos: `app/tests/features/appointmentsC2.test.js:178`. |
| 5 | `TEST 1: Evento realtime de áudio com status stored ganha URL e integra na conversa sem F5` | TDZ; corrigido código do preview. Teste de integração/URL preservado. |
| 6 | `normalizeLocation: reutiliza cache de endereço e nome para coordenadas idênticas` | Fixture sem tenant esperava cache global. Adicionado o mesmo `tenant_slug` aos dois eventos, mantendo asserções de nome/endereço: `app/tests/features/audioPlayer.test.js:1019,1034`. |
| 7 | `CENÁRIO G: encerrar conversa via atualização (Realtime) muda classificação atomicamente` | TDZ; corrigido código. Asserções de classificação atômica preservadas. |
| 8 | `C1: MediaAttachment é um wrapper sem hooks e o componente interno chama todos os hooks antes de qualquer return` | Bug do teste: o callback de `ts.forEachChild` retornava o array de `collectNodes`; esse retorno truthy interrompia a travessia. Callback agora não retorna valor, mantendo todas as verificações AST: `app/tests/features/mediaAttachment.test.js:75`. |
| 9 | `VERIFICATION 5: applyIncomingEvent preserves resolved media.url and thumbnailUrl on realtime updates` | Evento da fixture não tinha canal, mas a conversa era WhatsApp; a normalização legada de canal ausente resulta em Telegram. C4 corretamente recusa esse fallback. Fixture explicita `channel_type: 'whatsapp'`, sem alterar asserções de URL, thumbnail ou status: `app/tests/features/mediaFixesVerification.test.js:171`. |
| 10 | `applyIncomingEventToConversations updates messages, preview, unread, and moves conversation to top` | TDZ; corrigido código. |
| 11 | `applyIncomingEventToConversations handles outbound message and does not increment unread` | TDZ; corrigido código. |
| 12 | `unread: incrementa somente para inbound novo fora da conversa visivel` | TDZ; corrigido código. |
| 13 | `unread: evento Realtime duplicado nao incrementa novamente` | TDZ; corrigido código. |
| 14 | `unread: duas mensagens inbound diferentes acumulam 0 -> 1 -> 2` | TDZ; corrigido código. |
| 15 | `unread: eventos operacionais e outbound nao recebem badge` | TDZ; corrigido código. |
| 16 | `unread: inbound posterior ao watermark volta a contar como nao lido` | TDZ; corrigido código. |
| 17 | `unread: aba oculta ou chat mobile fechado mantem inbound como nao lido` | TDZ; corrigido código. |
| 18 | `contact identity only trusts inbound contact events across conversations, Kanban, and realtime` | TDZ; corrigido código, mantendo regras de confiança de identidade. |
| 19 | `contact identity requires a useful trusted name and keeps Conversations and Kanban consistent` | TDZ; corrigido código, mantendo validação de nomes confiáveis. |
| 20 | `SINCRONIA KANBAN E: applyIncomingEventToConversations resolve etapa respeitando kanbanColumns passadas` | Conversa da fixture não tinha canal. Adicionado `channelType: 'whatsapp'`, coerente com o evento. Mantida exigência de uma única conversa e etapa correta: `app/tests/unit/kanbanStageSynchronization.test.js:113`. |

Nenhuma asserção de comportamento, isolamento ou segurança foi removida para acomodar uma regressão. Não foi reintroduzido matching sem canal nem cache global sem tenant.

## Correções adicionais encontradas na revisão

- **C2, select controlado:** `app/src/components/NoriaSelect.jsx:32,58` mantém `''` no `Select.Root`, normalizando null/undefined e filtrando opções vazias. O Radix proíbe valor vazio em `Select.Item`; o Root aceita `''` para limpar seleção. Usar `undefined` no Root trocava para estado não controlado e podia impedir o reset. O teste em `app/tests/features/appointmentsC2.test.js:109` verifica o contrato com Radix real e root capturado.
- **C2, conversa legada ambígua:** `app/src/features/appointments/components/Appointments.jsx:55,71` só usa fallback por ID sem canal quando há exatamente um candidato. IDs iguais em WhatsApp e Telegram não selecionam silenciosamente o primeiro. Cobertura no teste iniciado em `app/tests/features/appointmentsC2.test.js:198`, com falha reproduzida antes da correção.
- **C2, escolha manual:** `app/src/features/appointments/components/Appointments.jsx:260` marca o preenchimento inicial como resolvido ao selecionar manualmente. Evita que uma conversa inicial carregada depois substitua a escolha do usuário.
- **C4, IDs ausentes:** `app/src/app/hooks/useKanbanMutations.js:12` e `app/src/app/hooks/useAgentAssignment.js:7` não consideram dois IDs ausentes uma identidade válida. Recusam tenant/canal explicitamente diferentes antes de comparar chaves e preservam fallback com mesmo canal. Teste adicional em `app/tests/unit/kanbanConversationKeyAndChannel.test.js:177`, reprovado antes da correção; esse teste explica a passagem de 982 para 983 casos.

## Correções preservadas e evidências

- **C1:** wrapper de `MediaAttachment` sem hooks e componente interno com hooks estáveis; AST e renderização cobertas.
- **C2:** proteção de `available_starts`, units/services ausentes, opções sem valor vazio, chaves de conversa com canal e payload com identidade da conversa selecionada.
- **C3:** `app/src/app/hooks/useConversationReadTracker.js:22,102` conserva a ref atual de refreshData. O teste simula troca de tenant mantendo usuário e verifica rollback com callback atual.
- **C4:** chaves canônicas do Kanban continuam incluindo tenant; fallbacks exigem canal. Atualizações normais de conversas existentes voltaram a passar junto com as recusas de canal diferente.
- **A5:** funções de escrita continuam exigindo tenant explícito. `app/src/services/conversations/conversationPresentation.js:49` conserva a chave `tenant::lat,lng`, sem cache quando falta tenant. Testes verificam reutilização no mesmo tenant, isolamento entre tenants e ausência de compartilhamento sem tenant.

## Limites e rollback

A validação foi local: suíte Node.js, renderização de componentes no servidor e build. Não houve validação interativa no navegador, envio real de WhatsApp ou execução em produção. O fluxo de escolha manual seguida de prefill tardio foi revisado no código; o harness SSR não executa efeitos/interações.

Os comparadores preservam compatibilidade com objetos legados sem tenant; a recusa por tenant explícito depende de ambos os objetos o informarem. Os chamadores devem continuar fornecendo coleções do tenant ativo.

Para rollback, reverta seletivamente os trechos desta revisão nos arquivos e testes indicados, preservando as alterações anteriores do Gemini. Não use reset/checkout global: o diff inicial já continha trabalho legítimo não commitado. Nenhuma alteração saiu desta worktree.
