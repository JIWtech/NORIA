# Adaptador de agendamento do I&C Salon

Proposta local, sem publicação. O adaptador do ic_salon envolve uma cópia integral do código do motor ativo e só opera para o tenant, instância e fase de turno definidos. Os arquivos e os workflows compartilhados do CORE ficam intactos. A leitura de evidência mantém o mesmo contato, canal e fronteira de atendimento já usados pelo motor. Lê até 250 mensagens de entrada do cliente. O nome proposto para um novo pedido exige trecho literal de uma dessas mensagens e validação da identidade do destinatário. Nome no perfil, no título de uma reserva sem fala comprobatória ou em outra sessão não autoriza um novo registro.

A resposta do Gemini ainda passa pelo contrato de agendamento existente. Para criar um pedido, apenas a ação interna validada chega ao motor. O recibo visível continua sendo renderizado pelo fluxo existente após a gravação. Se o Gemini alegar que anotou sem emitir a ação, o adaptador entrega o texto de falha já configurado no salão. Se a gravação falhar, vale o tratamento já existente. Há uma verificação textual para afirmações conhecidas e uma auditoria semântica para paráfrases. Nenhuma delas tem autorização para confirmar pedido ou realizar gravação.

## Evidência local

Com o código ativo do motor 5ca3e184-4110-4cc8-8add-972d06879272, Gemini, PostgreSQL local e envio simulado, a reprodução incluiu o nome João Victor Santos 38 mensagens atrás, sem reserva anterior. O fluxo encontrou o nome na fala do cliente, gravou um pedido aguardando confirmação e só então enviou o recibo. Forçar “já anotei” sem ação, forçar a falha de escrita com a ação presente e retirar a evidência da sessão foram controles negativos. Nenhum registrou pedido nem enviou recibo falso. A saudação simples também seguiu sem iniciar agendamento. As demais mensagens da reprodução foram sintéticas.

## Homologação antes de qualquer aplicação

O comando node clients/ic_saloon/build_conversation_adapter.cjs recebe um export do motor e gera um subworkflow inativo. O construtor preserva o código do motor literalmente. Em homologação, apontar os turnos do salão para essa cópia e demonstrar que entrada e recuperação de fila usam a mesma rota exclusiva. A recuperação compartilhada atual ainda chama o motor original. Mudar só a URL de entrada deixaria um caminho que contorna o adaptador. Manter inativo até que o roteamento, o runner, a recuperação, áudio, pedidos pendentes e os controles negativos sejam verificados em ambiente isolado. Em caso de reversão após um piloto, retirar o roteamento do subworkflow do salão e restaurar a rota anterior, sem tocar nas reservas já registradas.
## Ensaio de recuperação após interrupção

O ensaio de 10/11/2026 usou a lógica ativa do recuperador do n8n, o motor ativo, fila e pedidos em PostgreSQL local, Gemini e Evolution simulada. O primeiro worker recebeu o pedido e foi interrompido antes da gravação e de reservar o envio. Depois do vencimento da concessão e da espera de retentativa, o recuperador voltou a selecionar a mesma conversa. O ensaio não enviou WhatsApp real.

Encaminhada ao adaptador do salão, a segunda execução recuperou o nome João Victor Santos da fala antiga, gravou um único pedido aguardando confirmação e só então enviou um único recibo. Uma nova tentativa de recuperação não encontrou lote para executar. Uma rodada inicial mostrou que a auditoria podia rejeitar uma solicitação legítima. O critério passou a avaliar apenas a intenção atual e o vínculo do nome com a fala do cliente. A versão revisada passou no ensaio local.

O controle de roteamento reexecutou a configuração compartilhada atual. O recuperador ativo lê a fila sem excluir o ic_salon e chama o motor original. Nessa rota, uma saída forçada do modelo dizendo “já anotei” foi enviada ao provedor simulado, com zero pedidos gravados. Mudar somente o endereço de entrada do salão deixaria esse caminho aberto. O ambiente acessível também não listou um workflow de homologação independente. A publicação foi retida porque o isolamento não pôde ser comprovado para a recuperação ativa, sem alterar o CORE.
## Publicação do roteamento em 10/11/2026

Entrada e recuperação do ic_salon convergem no nó Motor conversacional único do roteador compartilhado. A seleção só aponta para o adaptador quando coincidem o ID do tenant, o slug ic_salon e a instância ic_saloon. Outros itens continuam no mesmo motor compartilhado. Os nós de preparação, disponibilidade e finalização mantêm seus destinos. O build preserva o seletor existente ou aceita NORIA_IC_SALON_ENGINE_WORKFLOW_ID para configurá-lo.

- Roteador 3N5oN6sxtir9lFrA, revisão ativa a289d6d9-fed2-42c4-96c1-418eb52ab8dc. O único parâmetro funcional alterado foi o destino desse nó.
- Adaptador yxdKP0PeskDMUFSo, revisão ativa 17ae2ba6-783f-43e4-a047-541700920aee.
- Motor compartilhado permaneceu na revisão 5ca3e184-4110-4cc8-8add-972d06879272, com os mesmos nós e configurações.

O ensaio com configuração atual, PostgreSQL local e Evolution simulada gravou o pedido após interromper o primeiro worker antes da gravação. O nome vinha de 38 mensagens antes e o recibo saiu uma vez após a gravação. O teste sintético no runner real verificou entrada, recuperação, fallback para outro tenant e uma tentativa fora da fase permitida que só o adaptador rejeita. O workflow temporário foi removido. A barreira de publicação aprovou 406 testes. Não houve envio real de WhatsApp de teste. A publicação não incluiu as propostas de banco, catálogo, preço ou endereço.

Para reverter, restaurar o workflowId original mlKNPv862H2g3Gap, em modo id, no nó Motor conversacional único e reativar o roteador. A cópia do estado anterior está em .local/deploy_backups/ic-salon-routing-5bbc1a20-ccc8-4f77-9b20-fba278d48a44/router.json. Conferir antes a versão ativa para preservar alterações posteriores e só desativar o adaptador depois de verificar que o roteador já não o chama.
