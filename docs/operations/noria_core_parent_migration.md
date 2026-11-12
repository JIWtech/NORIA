# Migração local para um único CORE pai

O workflow **NORIA CORE | Roteador WhatsApp, Comandos e Follow-ups** passa a executar o motor genérico no próprio grafo. Entrada do WhatsApp, recuperação da fila, comandos e follow-ups mantêm os gatilhos do roteador. As fases do motor usam a mesma fonte canônica e cada nó executa somente sua fase. O caminho do I&C Salon preserva a seleção por ID do tenant, slug e instância, com o adaptador atual na entrada e na recuperação.

O ID antigo do motor, `mlKNPv862H2g3Gap`, está reservado no grafo local para **NORIA EXT | Política NORIA**. A EXT só recebe o tenant `noria` validado pelo roteador. Ela confirma novamente a identidade e o canal no Supabase, entrega a política já configurada em `tenant_settings` e preserva o áudio. O arquivo exportado mantém o nome histórico `NORIA CORE _ Motor conversacional.json` para compatibilidade de caminhos. Em outro ambiente, use `NORIA_EXT_WORKFLOW_ID` para apontar para a EXT daquele ambiente.

A **EXT Núbia v2** exige uma autorização auditada para reservar. A EXT decide elegibilidade e devolve uma proposta. O CORE consulta disponibilidade e coleta a evidência sem reservar. A reavaliação verifica a evidência do turno e autoriza ou recusa a proposta. Antes de executar, o CORE reconfirma identidade, proposta, disponibilidade e sobreposição. Pix, mensagens oficiais e disposições de follow-up usam a configuração do tenant. Cancelamento e reagendamento continuam com a equipe. A v1 permanece disponível para os turnos cujo contrato ainda é 1.0. Use `NORIA_NUBIA_V2_EXT_WORKFLOW_ID` com o ID do ambiente de homologação.

## Validação e corte

1. Rode o gerador duas vezes e compare os hashes. Execute a suíte de release, os testes das EXTs e o executor simulado de serviços.
2. Importe os três artefatos em n8n isolado, com os IDs correspondentes e credenciais de teste. Valide entrada, áudio, recuperação, os caminhos Gênesis e Salon, a v1 da Núbia e o piloto da v2. Confirme envio e gravação somente nos provedores de teste.
3. Meça memória, tempo e tamanho das execuções no n8n. O artefato do pai tem cerca de 6,3 MB, pois inclui a mesma fonte em seis nós. O estado estático passa para o pai. Confirme o comportamento de partida a frio, o orçamento do Gemini e a rastreabilidade das execuções.
4. Antes de um corte autorizado, exporte o roteador, o motor antigo e a EXT v2 ativos ou salvos, com IDs, versões e configurações. Confirme que nenhum outro chamador usa o antigo ID como motor e que a janela de troca permite drenar execuções. O publicador legado da v2 bloqueia essa topologia. O corte precisa de um procedimento coordenado e ensaiado para evitar que uma versão do pai chame o contrato errado.

## Reversão

Se a homologação falhar, preserve os artefatos atuais do ambiente. Para um corte autorizado, o rollback restaura em conjunto o conteúdo e o título do antigo motor, o roteador anterior e a EXT v2 anterior, conforme os backups. A versão do roteador e o contrato do workflow chamado precisam voltar juntos. Preserve reservas, recibos e filas existentes. Se a v2 tiver sido habilitada por configuração, use o procedimento de [retorno ao contrato 1.0](nubia_v2_cutover.md) para novos lotes e conclua os turnos já fixados na versão 2.0.
