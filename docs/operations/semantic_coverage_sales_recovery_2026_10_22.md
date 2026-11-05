# Correção local: cobertura semântica e qualificação de venda — 22/10/2026

## Escopo e evidência

Correção implementada somente no repositório local. Nenhum workflow foi publicado, nenhuma fila foi liberada, nenhum dado de produção foi alterado e nenhuma mensagem real ou chamada paga ao Gemini foi enviada.

O motor ativo consultado foi `mlKNPv862H2g3Gap`, versão `a2b2d99e-01ae-458c-80b0-7a1229bc51f0`. O evento técnico de Ivan ocorreu depois da criação dessa versão e registrou o mesmo hash embutido no motor ativo: `fd6dba9cc20cf93e27b60072144e3886e63a5a5771495bf83753fc6726041589`. Portanto, esse incidente não foi atribuído a release anterior.

O evento persistido contém dois segmentos da auditoria, mas não contém o texto original da resposta enviado à auditoria. O texto original também não foi recuperado de `response_text` ou do payload. Logo, a omissão de espaços ou quebras entre os segmentos é uma hipótese concreta reproduzida por fixture, não a causa histórica comprovada. A mudança corrige esse mecanismo sem afirmar replay exato.

No caso Eduardo, a causa do vínculo incorreto ano→mensagem foi encontrada no CORE: após combinar os dados da operação comercial com o estado semântico, o código atribuía o ano resolvido ao último item de `customerVehicleSnapshot.evidence_ids`, sem validar que aquela mensagem continha aquele ano. Isso permite ligar 2019 ao evento “Gol g5 2011”. A correção valida o ano contra o texto de um evento citado; anos estruturados conflitantes ou sem evidência única permanecem pendentes para esclarecimento.

## Implementação

- A fonte canônica alinha segmentos como trechos literais, em ordem e sem sobreposição. Só permite preencher lacunas compostas exclusivamente por whitespace presente na resposta original; preserva esses bytes no segmento anterior. Divergências de palavras, números, preço, produto ou negação continuam bloqueadas.
- `salesValidateSemanticEvidence`, `salesAuditPrimaryDialogue` e `salesScopeMediaAnswer` usam os segmentos alinhados. Escopo do tenant, sessão, turno e produto, além das evidências, `fact_id` e fontes, continuam sujeitos à validação anterior.
- No caso Eduardo, a oferta de avaliação não escolhe uma mensagem de modelo/ano por regex nem associa automaticamente o evento mais recente à evidência geral do veículo. A âncora de foto continua separada. Modelo, ano, condição e documentos dependem da interpretação estruturada e das evidências de cada mensagem.
- O CORE não transfere ano para o último ID da operação EXT. Se os anos estruturados do CORE/EXT divergirem, o ano é limpo, o requisito pendente volta a `sell_year` ou `sell_model` conforme o campo ainda ausente e o handoff fica suspenso até a qualificação continuar.
- A auditoria exige pergunta para o requisito de modelo/ano/condição que o EXT manteve pendente, evitando aceitar apenas agradecimento.
- O requisito pendente decidido pelo EXT é sincronizado em `state.pending_requirement` e `state.dialogue_context.pending_requirement` antes da gravação.
- Recuperação vazia fica em revisão técnica, não é declarada como resposta nem como transferência, e persiste `follow_up_disposition=not_applicable` usando o mesmo token do turno e a revisão retornada pela gravação inicial. A falha de persistência mantém o caminho de revisão e fica sinalizada no evento.
- O builder agora prefere o nome exato do nó, evitando confundir `CORE | Motor conversacional único` com o nó de fase que compartilha o prefixo.

## Validação

- `node --test scripts/test_noria_primary_dialogue.cjs scripts/test_genesis_dialogue_recovery.cjs`: **43 passaram, 0 falharam**.
- O builder foi executado duas vezes após a correção final. As saídas de fonte, código gerado e workflows ficaram idênticas após normalizar `built_at`. O manifesto também muda `raw_disk_sha256`, que depende desse timestamp; essa diferença é metadado, não divergência de código.
- Paridade verificada: fonte CORE → `n8n/code/whatsapp_conversation_core.generated.js` → nó do workflow; fonte EXT e identidade → nós publicados nos JSONs locais. JSONs válidos e zero conexões apontando para nós inexistentes.
- `git diff --check` não encontrou erros; o Git apenas avisou sobre conversão futura de LF/CRLF nos arquivos já modificados.

## Hashes locais

| Artefato | SHA-256 |
|---|---|
| CORE normalizado embutido (`core_sha256`) | `d072d4477425c451234d775b5bdcedae1866dc51f3bb94a4df5aa0d94fb4175d` |
| Fonte CORE em disco | `449fdc7f26af2123afb42e277bfd0afa51cd75dc05a180258fa2df3167315856` |
| Código CORE gerado | `15e19c030a111abb1a556aeaf870d601c91206b7f4f5629f043d88b00d1777b8` |
| EXT Gênesis (`ext_sha256`) | `6d2ebb0d83e40f34b17b4b6035829114666aa6823ae48ecd9384f4aa7bab2249` |
| CORE ativo consultado antes da correção | `fd6dba9cc20cf93e27b60072144e3886e63a5a5771495bf83753fc6726041589` |

O CORE ativo continua com o hash anterior. Os artefatos novos são locais e ainda precisam do fluxo de revisão e de autorização antes de qualquer publicação.

## Arquivos revisáveis

- Fonte canônica: `n8n/sources/noria_core.js`
- Builder: `scripts/build_noria_workflows.cjs`
- Testes: `scripts/test_noria_primary_dialogue.cjs`
- Testes de recuperação/handoff: `scripts/test_genesis_dialogue_recovery.cjs`
- Código gerado: `n8n/code/whatsapp_conversation_core.generated.js`
- Workflow CORE local: `n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json`
- Workflow EXT local: `n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json`

## Rollback

As alterações locais anteriores foram preservadas e o builder também propaga alterações canônicas preexistentes para os artefatos gerados. Para reverter somente esta correção, reverta de forma seletiva os blocos de `salesAlignSemanticSegments` e seus consumidores, `salesResolveCustomerVehicleYearEvidence`, `salesApplyOwnVehicleOfferState`/`salesOwnVehicleOfferEvidence`, `salesPersistEmptyRecoveryState`, a sincronização do requisito pendente, os dois ramos de recuperação vazia, a validação do requisito EXT e a preferência por nome exato no builder. Depois execute `node scripts/build_noria_workflows.cjs` para reconstruir os derivados.

Não reverta os arquivos completos com `git checkout`/`git restore`: isso descartaria alterações locais preexistentes, incluindo mudanças na capacidade de vídeo e no prompt comercial do CORE, a identidade/cache do EXT e alterações de UI e homologação. Nenhum arquivo ou documento existente foi removido.
