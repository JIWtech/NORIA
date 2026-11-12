# Validação de preços no envio do I&C Salon

A ponte local recebe os envios de texto da instância ic_saloon antes da Evolution. A ligação é exclusiva do tenant ic_salon. O fluxo atual de agendamento continua gravando pedidos para confirmação da equipe. O CORE e os workflows compartilhados não precisam ser editados.

A ponte lê os serviços ativos do tenant e audita o texto com Gemini. Para publicar um preço, a frase precisa mencionar o nome do serviço como consta no catálogo e conter uma cifra em formato brasileiro. O valor em centavos e o tipo de preço precisam coincidir com a linha do serviço. Em caso de rejeição, inconsistência ou indisponibilidade, a ponte não chama a Evolution. O texto aprovado é repassado sem edição, preservando o conteúdo registrado pelo CORE.

## Testes locais

- Executar node --test clients/ic_saloon/price_relay.test.cjs. Os casos verificam preço válido, preço ausente, valor de outro serviço, erro do auditor, tentativa de acesso de outra instância e repasse das duas rotas de leitura usadas para foto e áudio.
- Na reexecução local do nó ativo, com catálogo de teste, auditor Gemini e Evolution simulada, R$ 50, cinquenta reais por extenso e o preço de outro serviço foram barrados. R$ 140 do corte, avaliação de mechas e endereço foram repassados. O pedido foi gravado como pending_confirmation, e a confirmação ao cliente foi repassada.

## Resultado anterior à correção da fila

O filtro barrou R$ 50 no corte, o mesmo valor por extenso e um preço de outro serviço. R$ 140 do corte, a avaliação de mechas, o endereço e a confirmação de um novo pedido sem bloqueio prévio chegaram à Evolution simulada. O pedido foi registrado como pending_confirmation.

O teste que encadeou um bloqueio e um novo pedido na mesma conversa reprovou. A ponte respondeu HTTP 422 e fez zero chamadas ao provedor. O nó ativo do n8n classificou a tentativa como entrega incerta. Com as funções magia_fail_turn e magia_claim_turn do repositório em PostgreSQL local e uma reserva de entrega correspondente, a fila ficou em uncertain e não iniciou o turno do pedido seguinte. Esse caso é impeditivo para ativar a ponte como está. A solução precisa distinguir recusa comprovada antes do provedor de entrega incerta, mantendo a proteção contra duplicidade.

A instância Evolution teste documentada retornou HTTP 404 no endpoint acessível. O inventário acessível não listou outra instância de teste e o n8n e o Supabase consultados não listaram um fluxo ou tenant de homologação. Nenhuma entrega real foi testada e nenhum ambiente de produção foi alterado.

## Correção da fila e resultado local

A proposta 09_proposta_liberar_fila_preco_recusado.sql mantém intactos o CORE e as funções existentes da fila. A ponte emite, somente em recusa de preço antes de chamar a Evolution, uma prova de uso único com validade de dois minutos e vinculada à reserva de entrega da mesma conversa. O banco verifica a identidade da ponte, o tenant, a tentativa e a prova que voltou na resposta de erro daquela mesma chamada. Só então encerra o lote recusado e libera a fila, preservando as mensagens pendentes. A fila não repete o lote recusado. Recusas sem prova, provas expiradas ou reaproveitadas e falhas com entrega realmente incerta conservam a proteção normal. A regra do banco só executa para ic_salon.

No ensaio isolado com o nó ativo do n8n, PostgreSQL local, auditor Gemini e Evolution simulada, R$ 50 foram bloqueados e houve zero chamadas ao provedor naquele turno. O pedido seguinte na mesma conversa foi gravado como pending_confirmation e gerou uma única confirmação, com o comprovante de entrega registrado no banco local. Os testes separados também cobriram isolamento, autorização, prova expirada e prova reaproveitada.

O CORE ainda pode retornar diagnóstico de entrega incerta para a recusa, porque ele não conhece a extensão. A fonte para distinguir recusa resolvida de falha real é o comprovante terminal com evidence.kind igual a ic_salon_price_rejected_before_provider. Confirmar em instância de teste que o runner preserva o campo message do HTTP 422 no erro recebido pelo CORE. Sem esse campo ou sem o comprovante vinculado, a fila mantém a proteção normal. Nenhuma proposta foi aplicada em produção.

## Homologação e reversão

1. Homologar em uma instância de teste antes de apontar o tráfego do salão. O serviço sobe com node clients/ic_saloon/price_relay.cjs e expõe GET /healthz. Usar rede privada ou TLS e restringir o acesso aos serviços do n8n. Configurar IC_SALON_UPSTREAM_URL e IC_SALON_UPSTREAM_KEY com a Evolution real da instância e uma IC_SALON_RELAY_KEY exclusiva para a ponte.
2. Configurar NORIA_SUPABASE_URL, NORIA_SUPABASE_PUBLISHABLE_KEY, IC_SALON_CATALOG_EMAIL e IC_SALON_CATALOG_PASSWORD para uma conta dedicada de menor privilégio, autorizada a ler o catálogo do salão por RLS. Configurar GEMINI_API_KEY e IC_SALON_PRICE_AUDIT_MODEL com o auditor homologado. O auditor recebe o texto final e os nomes e preços dos serviços ativos, sem o telefone do destinatário.
3. Em homologação, aplicar a proposta 09 no banco isolado e configurar na conta dedicada da ponte a marca administrativa raw_app_meta_data.noria_ic_salon_price_relay = true. A conta não deve ter service_role. Apontar apenas EVOLUTION_API_URL_IC_SALON e EVOLUTION_API_KEY_IC_SALON no n8n e no runner para a ponte. Manter a instância ic_saloon. Validar áudio, foto, pedido, confirmação, alteração e cancelamento, comandos, follow-ups, campanhas e falhas de consulta. O envio de texto dos fluxos que usam essa URL será validado. As duas rotas de leitura permitidas passam direto. Inventariar saídas que não usam essa URL antes de ativar.
4. O bloqueio gera HTTP 422 sem envio. Conferir a prova, o registro terminal e o próximo agendamento na mesma conversa. Alertas que usam o retorno do CORE devem ser reconciliados com o comprovante terminal. A indisponibilidade do catálogo ou auditor também retém o texto, inclusive a notificação de um pedido já gravado. O vínculo semântico e formatos incomuns de dinheiro dependem em parte do auditor. Monitorar respostas legítimas recusadas e usar uma conta de teste para o aceite.
5. Após autorização explícita de produção e confirmação do salão, aplicar a proposta 08_proposta_catalogo_e_endereco.sql separadamente. Para reverter a ponte, restaurar apenas as duas variáveis anteriores do salão no n8n e no runner. Para reverter os dados, seguir REVISAO_CATALOGO_ENDERECO_2026-11-09.md.


Para reverter a fila, retirar o tráfego da ponte antes de desinstalar a proposta 09. Revogar a marca administrativa da conta e remover apenas os objetos da extensão, em uma transação. Preservar os registros terminais já emitidos.

    drop trigger if exists ic_salon_price_rejection on public.conversation_turn_delivery_attempts;
    drop function if exists public.ic_salon_issue_price_rejection(text);
    drop function if exists noria_ic_salon.finish_price_rejection();
    drop table if exists noria_ic_salon.price_rejections;
    drop schema if exists noria_ic_salon;
## Aplicação no adaptador do salão em 10/11/2026

As regras de validação de preço foram reutilizadas no adaptador exclusivo do ic_salon, antes que o motor receba o rascunho da resposta do Gemini. Uma afirmação de preço precisa corresponder ao serviço e ao valor do catálogo ativo do salão. Uma afirmação recusada é substituída pela mensagem de consulta configurada no tenant. O motor recebe uma resposta válida e termina o turno normalmente. Essa implantação não usa a ponte HTTP de entrega nem a proposta 09, portanto não cria entrega incerta por causa de uma recusa de preço. O catálogo completo, quando respondido diretamente pelo motor, continua sendo formatado a partir das linhas do banco. A validação semântica pode rejeitar uma resposta legítima em caso de dúvida ou indisponibilidade.

A atualização de dados 08 foi aplicada no Supabase e relida. O corte com Ítalo tem R$ 140 fixos no Pix ou em dinheiro. Mechas loiras e morena iluminada seguem sem valor numérico, com orçamento na avaliação presencial gratuita e os requisitos de avaliação e teste preservados. O cadastro e o prompt informam Av. das Acácias, 207, Loja 4, Cidade Jardim.

O adaptador yxdKP0PeskDMUFSo foi publicado na versão 2939762d-bd02-43e4-a099-ed31e194f537. O roteador e o motor compartilhado permaneceram nas versões anteriores. No ensaio com PostgreSQL local, Gemini e Evolution simulada, a resposta forçada de R$ 50 foi barrada e o turno terminou com fila pronta. O pedido seguinte, no mesmo contato e sessão, foi gravado uma vez como aguardando confirmação, e o recibo só saiu após a gravação. Também passaram o corte a R$ 140, as mechas e o endereço. O runner real do n8n validou a recusa com dados sintéticos. Não houve WhatsApp real de teste. Passaram 103 testes de regressão.

A cópia anterior do adaptador e dos dados alterados está em .local/deploy_backups/ic-salon-prices-e6a8a32d-db9a-4f19-8a19-cb184e8d6e6c. Para retirar o filtro, restaurar o código anterior no mesmo adaptador e reativá-lo, depois de verificar que a versão ativa ainda corresponde a esta publicação. Para reverter os dados, restaurar somente os campos guardados, incluindo price_rejection_template, numa transação que confira o estado atual e o ID das linhas do salão. Preservar mudanças posteriores.
