# Genesis: restaurar exclusao de contatos e ativar follow-up

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../../docs/INDEX.md) para localizar os exports do NORIA.

## Diagnostico confirmado

O workflow enviado em 05/10/2026 nao consulta `contact_exclusion_enabled` nem `tenant_ai_excluded_contacts`. A perda da trava esta no codigo publicado: manter a lista e a flag no Supabase nao basta quando o Core deixa de consulta-las. Nao foi consultado o banco LIVE nesta tarefa, portanto ainda e necessario verificar se os 3.260 numeros importados permanecem cadastrados.

O Core local tambem estava atrasado em relacao ao anexo: as funcoes comerciais semanticas foram incorporadas mecanicamente do workflow enviado antes de regenerar. As regras comerciais dessa versao foram preservadas, inclusive suas limitacoes de documentos/fotos ja identificadas; esta entrega nao e uma revisao do fluxo comercial inteiro.

O follow-up tinha outro bloqueio: `scheduleFollowUps()` retornava imediatamente para qualquer tenant `sales_v1`. Apenas ativar uma politica no banco nao produziria jobs.

## O que foi corrigido

- Checagem da lista, isolada por tenant, antes de historico, Gemini, transcricao, OCR e estoque.
- Nova checagem imediatamente antes do envio para detectar inclusao de numero durante o processamento.
- Falha da consulta, resposta invalida, lista vazia ou identidade nao resolvida: silencio, sem liberar o contato por falta de verificacao.
- Telefones brasileiros com e sem nono digito, formatos nacionais e JID com sufixo de dispositivo; sem comparacao por simples final de numero.
- Identificadores `@lid` nao sao tratados como telefones. Quando a Evolution fornece `remoteJidAlt` telefonico, ele e preservado na entrada e usado na verificacao. Sem identificacao confiavel, a IA permanece em silencio e registra `contact_identity_unresolved`.
- Mensagens recebidas continuam no sistema; nao sao apagadas. O resultado da trava fica em `raw_payload.contact_exclusion`.
- Um tenant com exclusao ativada nao pode cair silenciosamente no motor legado sem essa protecao.
- Importacao antiga preservada: a migration nao apaga nem reinsere contatos.
- VCF e SQL privado nao sao adicionados ao Git.

Erros nao liberam automaticamente a IA, mas podem deixar um numero novo aguardando verificacao. Monitorar os motivos `contact_exclusion_unavailable`, `exclusion_list_empty` e `contact_identity_unresolved`.

Se uma conversa foi encaminhada durante uma falha da trava, corrigir a causa e devolver a conversa a IA pelo controle autorizado do painel. A correcao nao remove bloqueios humanos automaticamente.

## Follow-up aprovado

Sequencia confirmada pelo responsavel: **3 horas, 24 horas e 15 dias**, contados desde a resposta comercial elegivel, nao somados entre si.

A configuração de intervalos e textos fica no Supabase.

Elegivel somente quando:

- Tenant ativo e IA/follow-up comercial habilitados.
- Lista de exclusao habilitada, disponivel e contato fora dela.
- Lead da sessao atual em etapa inicial ou qualificacao, com IA permitida.
- Nao ha interesse registrado, humano, avaliacao, pos-venda ou negocio fechado.
- Ancora e uma resposta de qualificacao persistida pelo Core.
- Cliente nao respondeu e nenhum operador assumiu/alterou a conversa desde a ancora.
- Politica e lease do job continuam validos no momento da checagem antes do envio.

A elegibilidade e consultada antes do processamento e novamente antes do envio. O banco tambem impede a criacao de jobs comerciais inelegiveis. Uma resposta nova cancela a sequencia anterior; uma nova qualificacao elegivel pode iniciar outra.

Para esta entrega, as tres retomadas usam **textos neutros configurados**, sem nova chamada ao Gemini. Nao prometem estoque, taxa, credito, preco ou reserva, nem repetem dados pessoais do historico. O follow-up existente da NB Bronze continua com seu caminho de geracao atual.

Nao ha retroatividade: ativar nao dispara para todas as conversas antigas. Nao foi adicionada janela de horario comercial; a sequencia pode vencer a noite, como os atrasos atuais do scheduler. Se isso nao for desejado, nao ativar o SQL 13 antes de definir a janela.

## Referência de publicação

Para alterações no ambiente atual, siga o [checklist de publicação](../../docs/operations/production_deploy_checklist.md).

## Easypanel

Nenhuma nova variavel ou servico. O dispatcher utiliza as credenciais existentes:

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
- `EVOLUTION_API_URL_WESLEY_AUTOMOVEIS`.
- `EVOLUTION_API_KEY_WESLEY_AUTOMOVEIS`.
- `EVOLUTION_INSTANCE_WESLEY_AUTOMOVEIS=wesley-carros`.

Os nomes sao derivados do slug `wesley_automoveis`, nao do nome comercial Genesis. Nao renomear instancia, slug nem credenciais. O follow-up comercial configurado nao precisa de Gemini; o workflow compartilhado ainda precisa da chave Gemini para os tenants que ja usam geracao.

## Homologacao

- Contato listado: texto, audio e `/reset` nao geram resposta automatica; inbound continua no painel.
- Numero nao listado: atendimento normal.
- Mesmo telefone com/sem nono digito: continua bloqueado.
- LID com telefone alternativo: verifica telefone; LID sem telefone confiavel: silencio com motivo de diagnostico.
- Falha da RPC: silencio, nunca fallback permissivo.
- Lead em qualificacao responde normalmente e cria tres jobs futuros.
- Lead em humano, avaliacao, pos-venda ou com interesse registrado nao cria/envia follow-up.
- Cliente responde antes do vencimento: cancela sequencia antiga.
- Contato incluido na lista depois da criacao do job: envio cancelado pelo guard.
- Timeout de envio ou falha de persistencia depois do envio: `uncertain`, sem repeticao automatica cega.
- NB Bronze: atendimento e follow-up existentes continuam funcionando, sem exigir flag comercial.

Para testar vencimento, usar banco/transporte de homologacao. Nao antecipar todos os jobs LIVE nem usar reexecucao de envio como teste. Consultar `follow_up_jobs` e os retornos do no para acompanhar `cancelled`, `failed` e `uncertain`.

## Pausa e rollback

Para desligar somente as retomadas da Genesis, executar `15_pausar_follow_up.sql`; ele preserva exclusao, IA de entrada, catalogo e os demais tenants. Nao desativar o workflow compartilhado, pois atende NB Bronze.

Nao restaurar o Core antigo sem a trava. Se houver falha operacional, pausar a IA da Genesis e manter a protecao, em vez de desligar `contact_exclusion_enabled`. Nao apagar tabela, lista, mensagens ou jobs enviados. Nenhuma checagem pode cancelar uma mensagem que o provedor ja aceitou; tratar eventos incertos manualmente.

## Testes locais e limites

Suites novas: `scripts/test_contact_exclusions_database.cjs` (PGlite isolado) e `scripts/test_sales_follow_up.cjs` (transporte falso). A suite `test_whatsapp_sales.cjs` foi alinhada ao protocolo do workflow enviado e ampliada para exclusao e opt-in de follow-up.

O workflow enviado diferencia `[document]` de `[image]`; os testes de OCR agora exercitam documento, como o codigo publicado. Isso nao significa que a limitacao ja identificada de CNH enviada como imagem normal tenha sido corrigida nesta entrega.

Implementacao e testes locais nao equivalem a implantacao LIVE. Conferir e publicar os passos acima; nenhum SQL foi executado no banco de producao por esta tarefa.
