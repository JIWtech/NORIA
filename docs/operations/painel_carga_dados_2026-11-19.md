# Painel: carga de dados e recargas — 19/11/2026

## Escopo

Mudanças locais para reduzir esperas na carga e leituras repetidas após eventos Realtime. Sem publicação, alterações de schema, migrações ou mudanças de infraestrutura.

## Alterações

- A fachada `dataService.js` preserva seus 106 exports. A implementação da carga fica em `app/src/services/clientData/clientDataLoader.js`, com cliente injetável para validar o fluxo completo com banco sintético.
- Configurações e leituras independentes começam após a resolução do tenant. As últimas conversas começam assim que a janela recente termina, sem esperar agendamentos e demais domínios. Janela vazia ou com erro continua sem disparar essa RPC.
- As três consultas de agendamentos começam juntas, preservando filtros, limites e prioridade da mesclagem. Contatos usam até três lotes simultâneos, com ordem estável e fallback por lote. Contatos e catálogo são enriquecidos em paralelo.
- Eventos de campanhas recarregam somente campanhas, após carga completa do mesmo escopo. O patch valida o tenant e se aplica sobre o estado atual, preservando mensagens, mídia e Kanban; falhas mantêm os dados anteriores.
- Debounce e fila unem recursos solicitados; um pedido de carga completa prevalece. Eventos durante uma leitura ainda provocam uma leitura posterior para não perder alterações. Recarga parcial não renova o prazo de validade da carga completa.
- Bootstrap e assinatura Realtime têm efeitos separados: a chegada do ID do tenant atualiza as assinaturas sem repetir o bootstrap. Agendamentos e campanhas recebem filtros de tenant, além de proteção no recebimento contra eventos identificados de outra empresa.
- Agendamentos, vendas e eventos operacionais continuam com sincronização completa, pois afetam os estados derivados de conversas/Kanban.

## Validação

Os testes novos de espera por configurações, início de heads, consultas simultâneas de agendamentos, lotes de contatos e patch de campanhas falharam antes das respectivas implementações e passaram depois.

- `npm --prefix app test`: 883 testes aprovados, zero falhas ou testes ignorados.
- `npm --prefix app run build`: aprovado. Persistem avisos de bundle grande e de importação estática/dinâmica de `integration.js`; esta entrega não divide o bundle.
- `node scripts/test_panel_loading_ui.cjs`: valida navegador Edge headless em ambiente local com HTTP e WebSocket sintéticos. Cobre bootstrap sem cache, assinaturas por tenant, campanha sem recarga de eventos/heads, evento de outra empresa, mensagem durante patch, falha parcial sem apagar dados, pedido parcial durante carga completa, navegação, troca de empresa e menu mobile. Nenhuma chamada externa alcança produção.
- `git diff --check`: aprovado.

O script de navegador usa Playwright externo ao projeto. Nesta execução foi instalado apenas no diretório temporário `noria-panel-ui-tools`, sem alterar dependências ou lockfiles do repositório. Em outro ambiente, `NORIA_PLAYWRIGHT_PATH` pode apontar para um módulo Playwright já disponível; o teste requer Microsoft Edge e a porta local 5186 livre.

Os testes arquiteturais de contagem de hooks foram atualizados para a ref de carga completa e o efeito separado de assinatura. As demais verificações foram preservadas e foram adicionadas verificações de dependência para impedir novo bootstrap ao chegar `tenantId`.

## Limitações e riscos

Não há medição pós-publicação em sessão real. As evidências locais demonstram paralelismo e eliminação de consultas completas em campanhas; não autorizam prometer um percentual de melhoria em produção. A RPC SQL e o volume da carga completa permanecem iguais. `raw_payload`, mídia, histórico e conversas antigas foram preservados. Mais leituras podem ocorrer simultaneamente; a concorrência de contatos é limitada a três.

## Rollback

Reverter em conjunto os hunks desta entrega em `App.jsx`, `dataService.js`, `realtimeRefresh.js`, `tenantDataReads.js` e `contactDataService.js`, removendo os módulos novos `clientDataLoader.js` e `realtimeRefreshTargets.js` e os testes/registro correspondentes. Preservar alterações locais preexistentes. Não há rollback de banco ou infraestrutura. Após reverter, executar novamente testes e build antes de qualquer publicação autorizada.
