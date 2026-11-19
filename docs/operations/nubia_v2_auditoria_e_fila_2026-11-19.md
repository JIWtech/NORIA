# NB Bronze (EXT v2): auditoria da resposta e conversas travadas (2026-11-19)

A Núbia (`clinica_nubia_oficial`) usa o pipeline v2: `noria_turn_pipeline` está habilitado com `rollout: all` e o contrato `noria_services_decision_v2`.

## 1. Respostas reprovadas pelo auditor (corrigido no código, publicação pendente)

**Sintoma.** De 12/11 a 19/11, 111 de 239 turnos da IA caíram em `services_contingency`: a cliente recebia a mensagem genérica e a conversa ia para a equipe. A falha era de 22% antes de 12/11 às 20:32 UTC e passou a 54% depois.

**Causa.** O commit `3bbb344` (IA-02), publicado em 12/11 às 20:32, passou a exigir `addresses_customer_requests`. Esse código (`AUDIT_REQUEST_NOT_COVERED`) aparece em 75 das 99 falhas. O auditor semântico recebia só o texto da IA (`composed.value.reply`), enquanto a cliente recebe esse texto mais os blocos aprovados anexados, como o menu de preços. Por isso "qual o valor?", respondido com texto e menu, era reprovado.

**Correção** (`n8n/sources/noria_core.js`):

- `servicesSemanticAudit` recebe `attachedBlockKeys` e envia `attached_blocks` ao auditor. Os blocos contam só para a cobertura e não entram em `assertions`.
- `servicesComposeAudited` repassa os `block_keys` da composição atual.
- A contingência grava `services_pipeline.rejected_candidates`, com até 3 respostas truncadas em 500 caracteres.

**Validação:**

- 3 testes novos em `scripts/test_noria_services_pipeline.cjs`. A suíte passa com 33/33.
- Regressão do n8n idêntica à base: as mesmas 26 suítes que já falhavam continuam falhando, e as outras 110 passam.
- `scripts/validate_services_audit_gemini.cjs` com o Gemini real (`gemini-3.5-flash-lite`), 5 chamadas, 5/5 casos como esperado:
  - reproduz o erro antigo;
  - aprova preço com menu e pedido de informações com menu;
  - continua reprovando preço sem resposta e pergunta de horário respondida só com o menu.

**Publicação.** Basta o Motor `mlKNPv862H2g3Gap`. No Roteador e no Salon mudou apenas o rótulo `core_revision`, que nada valida.

**Publicação:** motor `mlKNPv862H2g3Gap` `f438dcb9 → 54aa07d5` (auditor) e `54aa07d5 → dc4c1908` (horário de funcionamento), ambos em 19/11. Backups em `.local/deploy_backups/fotos-2026-11-19T13-56-45-083Z/` e `.local/deploy_backups/fotos-2026-11-19T17-36-58-898Z/`.

**Horário de funcionamento como fato (publicado em 19/11).**
- O CORE transforma `tenant_settings.business_hours` em fatos citáveis (`business_hours.<dia>`, `business_hours.summary`, `business_hours.lunch`) e os acrescenta à decisão usada na composição e na auditoria. Isso vale para todo tenant com horário cadastrado.
- O auditor passou a aceitar horários que estejam no fato ou bloco citado (antes, `AUDIT_ASSERTED_TIME_NOT_IN_AUTHORITY`).
- Validação com o Gemini real:
  - "até que horas?" e "abre domingo?" aprovados;
  - 1 chamada extra antes da publicação.
- A regressão ficou igual à base.

## 2. Conversas travadas em `review` (liberadas)

**Sintoma.** 75 conversas estavam em `phase='review'` desde falhas do Gemini em outubro e novembro: HTTP 400 em 20–21/10, rate limit em 30–31/10 e `TERMINAL_EVIDENCE_MISSING`. Nessas conversas a IA não atende mais, e as mensagens novas ficam em `Buffering`. De 12 a 19/11 foram 487 mensagens em 13 conversas. Não houve entrada nova em `review` depois de 07/11.

**Liberação em 19/11.** Foram liberadas 37 conversas em que a última mensagem era da cliente sem resposta.

- Cada conversa recebeu um recibo `cancelled` com `evidence.kind='admin_release'`, que arquiva as mensagens antigas.
- A fila voltou a `ready` sem pendências, então a IA só responde às próximas mensagens. Nenhuma resposta automática atrasada foi enviada.
- O ticket ficou com `resolution='admin_release'` e uma nota.
- As 38 que já tinham resposta continuam em `review`. A equipe as libera ao encerrar a conversa no painel.

**Backup.** `.local/deploy_backups/nubia-fila-review-2026-11-19T13-51-34-038Z/` (queue.json e tickets.json).

**Atenção da equipe.** Uma cliente perguntou "Bronze a jato, qual o valor?" em 10/11 e não teve resposta (conversa `md5` prefixo `440320`).

**Pendências.**

- Wesley tem 168 tickets abertos do mesmo tipo.
- O painel não tem uma tela para ver ou liberar conversas em `review`.
