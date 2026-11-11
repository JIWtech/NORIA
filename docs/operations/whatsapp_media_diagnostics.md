# WhatsApp: catalogo de fotos e diagnostico

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../INDEX.md) para localizar os exports do NORIA.

## Verificado em 2026-09-21

- O tenant universo_prata possui quatro categorias e tres imagens por categoria.
- O codigo local seleciona tres fotos para "me mostra pulseiras" usando o Supabase atual.
- Os eventos inspecionados registram `product_media_delivery.skipped = no_product_media`.
  Nessas execucoes, nenhuma chamada de envio de foto foi feita.
- Ha eventos com `raw_payload` como objeto e outros como string contendo JSON.
  Uma consulta direta `raw_payload->'product_media_delivery'` pode retornar null
  mesmo quando o campo existe dentro da string.
- A interface antiga exibia `response_text` do inbound e tambem o outbound.
  A correcao mantem o outbound e preserva respostas legadas sem evento de saida.
- Links do Wikimedia retornaram HTTP 429 durante a verificacao. Isso e um risco
  adicional de download; nao explica execucoes que pularam o envio por falta de selecao.

## Referências

- [CORE WhatsApp](whatsapp_conversation_core.md)
- [Teste local de mídia](../../scripts/test_whatsapp_media.cjs)
- [Checklist de publicação](production_deploy_checklist.md)

## Credenciais

O no `Gemini Chat Model` usa a credencial selecionada no proprio n8n. O envio de
texto pela Evolution usa a credencial do no visual. O envio de fotos usa as
variaveis `EVOLUTION_API_URL_{TENANT}`, `EVOLUTION_API_KEY_{TENANT}` e a instancia
recebida no evento, com fallback para `EVOLUTION_INSTANCE_{TENANT}`.
As variaveis precisam estar acessiveis no ambiente que executa os Code nodes;
ter uma credencial Supabase funcionando em outro no nao comprova esse acesso.
Nao copiar senhas ou chaves para o repositorio.

## Teste controlado

1. No numero usado nos testes, enviar "Quero ver pulseiras".
2. Conferir no contexto `catalog_categories = 4`, `selected_count = 3` e
   `selection_source = current_message`.
3. Conferir `product_media_delivery.sent`: `accepted` significa que a Evolution
   aceitou o envio e retornou ID; confirmar tambem o recebimento no aparelho.
4. Enviar "manda de novo" e conferir `selection_source = conversation_history`.
5. Categoria nao e recuperada de uma sessao encerrada nem inventada a partir
   apenas de promessas anteriores da IA. Nesse caso, informar novamente a categoria.

Consulta compativel com os dois formatos historicos de payload:

```sql
with recent as (
  select created_at, direction, message_text,
    case when jsonb_typeof(raw_payload) = 'string'
      then (raw_payload #>> '{}')::jsonb
      else raw_payload
    end as payload
  from public.channel_events
  where tenant_slug = 'universo_prata'
  order by created_at desc
  limit 20
)
select created_at, direction, message_text,
  payload->'catalog_diagnostics' as catalog_diagnostics,
  payload->'product_media_matches' as media_matches,
  payload->'product_media_delivery' as media_delivery
from recent
order by created_at desc;
```

Interpretacao:

- `missing_supabase_env_in_code_node`: variaveis ausentes ou bloqueadas no Code node/runner.
- `tenant_settings` com status HTTP: falha na leitura da configuracao pelo Code node.
- `catalog_categories = 0`: catalogo nao carregado ou vazio.
- `catalog_categories > 0`, `selected_count = 0`: categoria nao encontrada na mensagem/historico.
- `missing_or_placeholder_evolution_media_env`: falta configuracao de envio de fotos.
- `sent[].status = failed`: houve tentativa; conferir HTTP e erro na execucao/Evolution.
- `unconfirmed`: resposta da Evolution sem ID de mensagem; nao tratar como entrega.

Atualizacao em 22/09/2026: as 12 imagens de exemplo da Universo Prata foram
copiadas para Supabase Storage, bucket publico `product-catalog`, em caminhos
prefixados pelo UUID do tenant. O catalogo em tenant_settings foi atualizado.
As URLs originais continuam em `source_url`. Continuam sendo imagens de exemplo,
nao estoque real da loja. Antes do uso comercial, substituir por fotos proprias
e revisar direitos/atribuicao dos arquivos de referencia.

## Falha de download confirmada em 22/09/2026

O teste real encontrou 4 categorias e selecionou 3 fotos de pulseiras. Todas
falhavam no envio. A Evolution devolvia HTTP 500 com erro interno de download
HTTP 403 do Wikimedia. O Code node antigo descartava o detalhe e persistia
apenas evolution_request_failed, sem status HTTP. Nao era falta de token.

Diagnosticos isolados no n8n hospedado, sem chamar Gemini:

- Execucao 1093: credenciais e instância verificadas; connectionState = open.
- Execucao 1097: Evolution 500, response.message indicando download 403.
- Execucao 1098: uma foto do Storage enviada ao contato de teste autorizado;
  Evolution HTTP 201, com ID de mensagem. O usuario confirmou o recebimento
  da foto no WhatsApp. Nos demais envios, aceite nao substitui confirmacao
  de entrega ao aparelho.
- Workflows temporarios de diagnostico foram arquivados e removidos.

Validacao local: 38 testes aprovados (conversas, encerramento e midia).
Os nodes publicados foram comparados com o JSON local testado e coincidem.

O workflow ativo `Y318foGE6xQlpP3h` foi atualizado pontualmente, preservando
credenciais, rota, configuracoes e demais nodes. Versao publicada:
`29c88323-d730-4589-b46f-c9bf970ae119`.
Backup local anterior em `.local/backups/whatsapp-before-media-20260922.json`
(ignorado pelo Git; nao compartilhar publicamente).

### Ordem de envio e falhas

`Sessao ainda ativa?` -> `Enviar Fotos do Catalogo` ->
`Validar Sessao Apos Fotos` -> `Sessao ativa apos fotos?` ->
`Enviar Resposta pela Evolution` -> `Preparar Evento Enviado`.

As fotos sao tentadas antes do texto de confirmacao. O resultado determina
uma resposta curta: sucesso, falha parcial ou indisponibilidade. Sem aceite,
nao afirmar que as fotos foram enviadas nem marcar Produtos apresentados.
O node de persistencia nao envia midia novamente. O payload outbound preserva
conversation_session_id e registra product_media_delivery.revision =
`media-before-text-v1`, status HTTP e detalhe de erro com segredos removidos.
Nao ha retry automatico de envio: repetir POST apos timeout pode duplicar fotos.
Aceite da API nao significa comprovacao de entrega ao aparelho.

Depois das fotos, a sessao e conferida novamente antes do texto para nao
retomar uma conversa que foi encerrada durante o envio. O envio externo nao
e atomico com o encerramento; uma foto ja aceita nao pode ser desfeita.

### Armazenamento do catalogo

O bucket publico contem SOMENTE imagens de produtos, nunca anexos privados de
conversas. Nao foram alteradas as policies nem a visibilidade de channel-media.
Foram copiados 12 arquivos, total 32.924.937 bytes (aproximadamente 31,4 MiB).
Storage/egress consomem as franquias do Supabase; nao envolvem tokens Gemini.

Script reutilizavel para catalogos de exemplo existentes no Wikimedia:

```powershell
node --env-file=.env scripts/cache_catalog_media.cjs --tenant=universo_prata
node --env-file=.env scripts/cache_catalog_media.cjs --tenant=universo_prata --apply
```

Sem --apply, apenas valida/download; nao grava. Valida HTTPS/hosts, tipo e
assinatura da imagem, limita a 10 MiB/arquivo e respeita espera em erro 429.
Nao substitui o catalogo se qualquer download falhar. Antes do PATCH usa
updated_at para nao sobrescrever uma edicao concorrente do cliente. Reexecucao
ignora URLs ja migradas. Prompts, credenciais e outros tenants nao sao alterados.

## Limite conhecido

### Encerramento de atendimento

O encerramento grava `service = conversation_closed` no Supabase. Antes desta
correcao, a memoria Redis usava a mesma chave por contato por ate 24 horas.
Isso fazia a IA continuar o atendimento anterior apesar do status Finalizado.

Agora o workflow consulta o ultimo encerramento filtrando tenant, canal e contato.
Esse evento define `conversation_session_id` e uma nova `memory_session_key`.
Somente eventos posteriores ao encerramento sao usados como contexto ativo.
A consulta ao encerramento e independente da janela de 40 eventos, para que a
chave nao volte a apontar para a memoria antiga quando a conversa crescer.
Atendimentos sem encerramento previo preservam a chave Redis existente.

O historico da interface e preservado; nenhuma conversa ou chave de outros
clientes e apagada. A memoria antiga expira pelo TTL existente. Ha uma verificacao
antes do envio: se o operador encerrou enquanto a IA gerava a resposta, ela e
descartada com `conversation_closed_during_processing`. Essa verificacao nao e
uma transacao atomica com o envio externo; uma mensagem ja entregue ao provedor
nao pode ser cancelada retroativamente.

Aplicar: importar/publicar o JSON atualizado de WhatsApp. Nao precisa migration,
limpar Redis inteiro, mudar prompt ou reinstalar o Command Router. O botao de
encerrar existente ja grava o evento necessario. Confirmar isso com o teste:

1. Pedir um produto e aguardar resposta.
2. Encerrar pelo painel e verificar Finalizado.
3. Mandar uma nova saudacao no WhatsApp.
4. Conferir que a IA inicia um novo atendimento, sem retomar o pedido antigo.
5. Na execucao, conferir `conversation_session_id` igual ao ID do encerramento,
   `hasHistory = false` na primeira mensagem e chave Redis diferente da anterior.
6. Mandar nova mensagem e conferir que a chave permanece a mesma na nova sessao.

### Agrupamento de mensagens

Este JSON possui deduplicacao por ID, mas nao possui buffer de debounce para
agrupar varias mensagens diferentes. Nao descrever esse mecanismo como implementado.
O ajuste de fotos e a correcao visual nao alteram essa parte do fluxo.
