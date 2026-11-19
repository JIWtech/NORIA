# Fotos de perfil do WhatsApp: worker multi-tenant (2026-11-19)

## Problema

- Os links de foto do WhatsApp (`pps.whatsapp.net`) vencem cerca de **9,8 dias** depois de emitidos. O valor foi medido em 314 contatos (mínimo de 9,8 e máximo de 10,0 dias).
- O CORE buscava a foto na Evolution **durante a mensagem** e só renovava depois de 14 dias. Por isso a foto ficava quebrada por cerca de 4 dias em cada ciclo, e contatos sem mensagem nova nunca eram renovados.
- Fotos vencidas no banco em 2026-11-19: Wesley 591/591, Núbia 285/446, I&C Salon 2/6.
- O utilitário legado `rvAsu0RdGTk98sWq` era manual, atendia só a Gênesis, lia até 20 mil `channel_events` e criava contatos.

## O que mudou

| Peça | Fonte | Mudança |
| --- | --- | --- |
| Worker de fotos | `n8n/code/whatsapp_avatar_refresh.js` | Novo. Roda a cada 30 min para todos os tenants ativos com `EVOLUTION_API_URL_/KEY_/INSTANCE_<SLUG>` |
| CORE: Sincronizar Contato | `n8n/code/whatsapp_sync_contact.js` | Não chama mais a Evolution. Só repassa a foto cadastrada e grava a que chega no webhook |
| CORE: Preparar Contexto JIW | `n8n/code/whatsapp_prepare_context.js` | Retirada a função morta que chamava a Evolution |
| Gerador | `scripts/build_noria_workflows.cjs` | Monta o workflow UTIL e projeta os dois nós do CORE |
| Painel | `app/src/services/contacts/*` | Prefere a foto do cadastro e ignora links vencidos |

### Limites do worker (proteção do n8n)

- No máximo **25 chamadas** à Evolution por execução, somando todos os tenants, em rodízio justo entre eles.
- Até **40 s** de execução, timeout de 6 s por chamada e 250 ms entre chamadas. O `executionTimeout` do workflow é de 120 s.
- O banco devolve só os contatos vencidos, os mais antigos primeiro, em lote pequeno. Nada é paginado em memória.
  - Foto renovada com mais de 7 dias.
  - Contato sem foto conferido de novo depois de 3 dias.
  - Contato nunca buscado.
- Depois de 3 falhas seguidas, o tenant fica pausado naquela execução. Uma falha adia o contato em cerca de 1 dia e não apaga a foto atual.
- Toda gravação é filtrada por `id` **e** `tenant_id`. As execuções com sucesso não são salvas, só as com erro.
- Capacidade de cerca de 1.200 contatos por dia. O passivo atual some em aproximadamente 1 dia.

Um tenant novo entra sozinho ao configurar as três variáveis `EVOLUTION_*_<SLUG>` no n8n. Não precisa de código.

## Publicação (exige autorização)

1. Rode `node scripts/build_noria_workflows.cjs` e as suítes `scripts/test_whatsapp_avatar_refresh.cjs`, `scripts/test_whatsapp_media.cjs` e `scripts/test_sync_contact_lid.cjs`.
2. Publique o UTIL `rvAsu0RdGTk98sWq`, rode uma vez manualmente, confira o resumo e então **ative** o agendamento.
3. Publique o CORE Roteador `3N5oN6sxtir9lFrA`. No diff só podem aparecer os nós `Sincronizar Contato WhatsApp` e `Preparar Contexto JIW`.

## Rollback

- Os exports anteriores estão em `n8n/workflows/backup_pre_fotos_2026-11-19/`: o legado do UTIL e o Roteador.
- O worker pode ser desativado a qualquer momento sem efeito no atendimento.
- Republicar o Roteador do backup volta à busca durante a mensagem.
