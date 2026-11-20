# Auditoria do plano JOYERÍA — 20/11/2026

Revisão independente, em modo de leitura, dos documentos deste diretório, do CORE, do roteador, do painel e dos metadados do `NORIA-prod`. Nenhum código, banco, workflow ou configuração foi alterado. As decisões tomadas a partir desta auditoria estão em [plano-implementacao.md](plano-implementacao.md), seção "Decisões após a auditoria".

## Conclusão

As regras comerciais estão bem representadas no plano. A implementação depende de quatro pré-requisitos técnicos que o plano não previa:

1. **Perfil comercial:** o CORE aceita só `nb_bronze_v1`, `vehicle_sales_v1` e `services_booking_v2` (`n8n/sources/noria_core.js`, `allowedBusinessProfiles`). Decisão: criar um perfil novo e genérico de venda consultiva de produtos.
2. **Fotos de produto:** o envio existe, com o contrato `noria_product_images_v1` (prova de tenant, produto, hash e origem), mas só no fluxo de veículos, só JPEG e com nome de arquivo `veiculo-catalogo.jpg` (`noria_core.js`, `sendChannelMessage` e `salesUsableCatalogPhotos`).
3. **Aviso à Joyce:** não há envio para número diferente do chat do lead (`noria_core.js`, `sendText` com `number: chatId`; `n8n/code/command_router.js`, lista de comandos).
4. **Grants:** tabelas novas no schema `public` do `NORIA-prod` recebem ALL para `anon` e `authenticated` por padrão.

## Outros achados

| Gravidade | Achado | Evidência |
| --- | --- | --- |
| Alta | "Assumir" é exibido antes da confirmação do servidor; a falha fica só no console | `app/src/app/App.jsx`, comando `assign_conversation` |
| Alta | Prisma 5 mm e 6 mm compartilham a mesma foto no próprio PDF | Hashes idênticos e páginas 19–20 renderizadas |
| Alta | 14 das 16 variações estavam marcadas como pendentes, contrariando a decisão de usar os preços do catálogo | `catalogo_pdf/manifesto-produtos.json` (corrigido) |
| Alta | Manifesto e prévia SQL não registravam composição | Corrigido no manifesto: blend, PDF p. 3 |
| Alta | Roteador, variáveis `EVOLUTION_*_JOYERIA` e canal cadastrado não constavam do plano | `n8n/sources/noria_router.js`, caminho `saas_dynamic` |
| Média | Levantamento com trechos superados (Elegance, endereço, regra de blend) | Marcado como histórico |
| Média | Políticas permissivas somadas por OR em `channels` e `tenant_service_catalog` | `pg_policies` no `NORIA-prod` |
| Média | Bucket `Noria Disparos` público, sem limite de tipo ou tamanho | `storage.buckets` |
| Baixa | Nó legado de mídia com fallback para credenciais globais da Evolution | `n8n/code/whatsapp_send_product_media.js`, encontrado só em backups de workflow |

## O que já existe e pode ser reaproveitado

- Atribuição pelo painel ou movimentação do card para coluna humana grava `conversation_assigned` com `handoff: true`; o CORE pausa a IA e cancela envios do turno em andamento.
- Retomada pelo painel grava `resume_ai`.
- Registro de revisão da equipe sem pausar a IA (`recordTeamReviewWithoutTransfer`) serve de precedente para "Joyce avisada, IA ativa".
- Entrega de foto com reserva prévia, sem reenvio cego e com reconciliação de resultado desconhecido.

## Contratos sugeridos

- **`send_catalog_media`:** entrada com item e imagens; o CORE recarrega os dados do mesmo tenant, confere hash, MIME e autorização, reserva cada envio e usa o MIME real.
- **`notify_specialist`:** entrada com motivo (blend, alto padrão ou decidido), resumo e telefone do lead; destino somente da configuração do tenant, recusa se igual ao lead, chave de idempotência por tenant, conversa, sessão e motivo, estados `reserved`, `sent`, `failed` e `unknown`. Não grava `handoff: true`.
- **Humano genérico:** handoff atual, sem aviso pessoal e sem nome de atendente.
- **Instagram:** apenas `channel_type` previsto nos contratos.

## Matriz de testes mínima

- Blend com interesse comercial e blend só com dúvida; ouro maciço; peça banhada; composição desconhecida; indeciso que se decide; mudança de categoria.
- Preços da Elegance 6 mm e da abaulada 2 mm; item na posição 150 de 191; Prisma com foto compartilhada; PNG; imagem ausente ou com hash divergente.
- Dois tenants em tabelas, FKs compostas e Storage; `anon` sem acesso.
- Aviso único sob repetição e concorrência; timeout sem reenvio; destino igual ao lead bloqueado.
- IA ativa após o aviso, pausada após Assumir, erro de Assumir visível, retomada pelo painel.
- Regressões: `npm test` no `app/`, testes do CORE e do roteador em `scripts/`, gerador e auditoria anti-hardcode.

## Verificações executadas

- Manifesto: 16 itens, 32 arquivos existentes, SHA-256 conferidos, 22 JPEG e 10 PNG, dois pares duplicados.
- PDF: texto extraído e páginas 19–20 renderizadas com poppler; os 16 preços conferem.
- Inventário do site: 191 itens, nenhum erro, todos com preço, nenhum de ouro maciço.
- `NORIA-prod`: apenas metadados (tabelas, RLS, políticas, grants, privilégios padrão, buckets, funções e perfis). Nenhum dado de cliente lido.
- Evolution Manager: instância `joyeria` existente, desconectada, sem número pareado.
- `npm test` em `app/`: 930 de 930 aprovados. `node scripts/audit_anti_hardcode.cjs`: aprovado.

Não verificado: workflows publicados, RLS com usuário autenticado e envio real pela Evolution.
