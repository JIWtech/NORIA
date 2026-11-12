# Plano de ação — proteção do número nos disparos (12/11/2026)

## 1. Diagnóstico

**O intervalo de 41 minutos não torna o disparo conforme.** O envio hoje passa pela Evolution API, que conecta ao WhatsApp como o WhatsApp Web (cliente não oficial). Pontos da fonte oficial:

- Os [Termos de Serviço do WhatsApp](https://www.whatsapp.com/legal/terms-of-service) proíbem "comunicações ilegais ou não permitidas, como mensagens em massa, mensagens automáticas, discagem automática e semelhantes" e uso não pessoal do serviço sem autorização. Em caso de violação, a conta pode ser desativada ou suspensa.
- A [Política de Mensagens do WhatsApp Business](https://www.whatsapp.com/legal/business-policy) (atualizada em 23/09/2026) diz que o WhatsApp pode limitar ou remover o acesso, ou limitar o envio, de quem recebe muito feedback negativo (bloqueios e denúncias) ou "envia mensagens em escala de forma não autorizada". Uma conta encerrada pode ficar impedida de usar produtos do WhatsApp no futuro.
- A [documentação de opt-in da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in) exige deixar claro que a pessoa aceita receber comunicações, exibir o nome da empresa e cumprir a lei aplicável. Recomenda aceitação por categoria de mensagem e fluxo de recusa claro.
- Fornecedores de API oficial afirmam que a Evolution herda a exposição de detecção da biblioteca Baileys ([exemplo](https://pasqualepillitteri.it/en/news/12969/integrate-whatsapp-evolution-api-vs-cloud-api)). São blogs de quem vende a alternativa: servem como alerta, não como prova. Não há fonte primária que dê prazo ou taxa de banimento.

**Conclusão:** com a Evolution, o risco de banimento só pode ser reduzido, não eliminado. O caminho conforme para mensagens em massa é a WhatsApp Business Platform (API oficial), com modelos de mensagem aprovados.

## 2. O que o sistema já faz (aplicado em 12/11/2026)

| Proteção | Estado |
| --- | --- |
| Uma mensagem por vez, com lease no servidor (sem envio duplicado, sem envio pelo navegador) | Pronto |
| Intervalo mínimo de 41 min, máximo padrão de 55 min, aleatório | Aplicado no banco |
| Limite diário padrão de 30 mensagens por tenant | Aplicado no banco |
| Consentimento confirmado na campanha (checkbox) | Pronto, mas é uma declaração única, sem prova por contato |
| Pedido de saída detectado pelo Gemini, com evidência, e lista de bloqueio do tenant | Pronto |
| Pausa após 5 falhas consecutivas | Pronto |
| Número "sem WhatsApp" marcado como falha definitiva | Pronto |

## 3. Lacunas

1. Não há prova de consentimento por contato (data, origem, texto aceito); contatos importados de planilha entram sem prova.
2. Nenhuma mensagem de disparo traz instrução para sair da lista.
3. Não há janela de horário nem regra para domingos e feriados.
4. Não há aquecimento: um número sem histórico de disparos começa direto no limite diário.
5. Não se restringe o disparo a quem já conversou com a empresa, que é o grupo de menor risco.
6. Não há limite de frequência por contato (quantos disparos por semana).
7. Todos os destinatários recebem o texto idêntico, o que é um padrão de spam fácil de detectar.
8. Não há monitoramento da conexão da instância nem alerta quando ela cai.
9. O número que atende clientes é o mesmo que dispara: um banimento derruba o atendimento junto.
10. Sem botão de parada geral (kill switch) por tenant e sem relatório de qualidade da campanha.

## 4. Plano por fases

### Fase 1 — Reduzir o risco no canal atual (1 a 2 semanas)

Mudanças no repositório e no banco; cada item com teste e commit próprio.

| # | Ação | Critério de pronto |
| --- | --- | --- |
| 1.1 | **Consentimento por contato.** Nova coluna ou tabela com data, origem (`conversa`, `formulário`, `importação com prova`), texto aceito e responsável. O worker só envia a contato com consentimento registrado. A importação de planilha exige informar a origem. | Contato sem registro nunca é reivindicado; teste de isolamento por tenant |
| 1.2 | **Só contatos que já conversaram.** Por padrão, só entra no disparo quem enviou mensagem nos últimos 90 dias. Exceção exige consentimento explícito de origem externa. | Filtro aplicado no enfileiramento e no claim |
| 1.3 | **Saída em toda mensagem.** O worker acrescenta uma linha fixa ("Para não receber mais, responda SAIR"). A detecção continua semântica pelo Gemini, que já existe; a palavra exata só reforça. | Texto final sempre contém a instrução; resposta de saída bloqueia o contato em até 1 minuto |
| 1.4 | **Janela de horário.** Enviar só entre 09h e 19h, de segunda a sábado, no fuso do tenant, configurável em `settings.broadcast`. Fora da janela, `next_send_at` vai para a próxima abertura. | Teste com relógio fixo em domingo, 22h e 08h |
| 1.5 | **Aquecimento.** Limite diário crescente por número: 5 no primeiro dia, subindo cerca de 20% por dia sem sinal ruim, até o teto do tenant. Reinicia após 14 dias sem disparo. | Cálculo em função do banco, sem estado no n8n |
| 1.6 | **Frequência por contato.** No máximo 1 disparo a cada 7 dias por contato e por tenant. | Contato recente é pulado como `skipped_frequency` |
| 1.7 | **Variação de texto.** O Gemini gera uma variação curta por destinatário a partir do texto aprovado pelo operador, com validação estruturada (nome, oferta, valor e link iguais aos do original). O operador vê uma amostra antes de enfileirar. Sem link no primeiro contato. | Teste de que valores e dados não mudam; falha do Gemini cai no texto original |
| 1.8 | **Sinais e pausa automática.** Pausar a campanha se: 2% ou mais dos enviados pedirem saída na janela, a instância ficar desconectada, houver erros 4xx/5xx em sequência ou nenhum destinatário responder após 20 envios. Limiares são sugestões a calibrar, não valores da Meta. | Campanha pausada com motivo visível no painel |
| 1.9 | **Monitor da instância.** Verificar o estado da conexão da Evolution a cada minuto no worker; se estiver fora do ar, não reivindicar lote e avisar o operador no painel. | Alerta no painel e registro em `last_error` |
| 1.10 | **Botão de parada geral** por tenant em `settings.broadcast.enabled`, checado no claim, e relatório da campanha (enviados, falhas, saídas, respostas). | Um clique para o envio em até 1 ciclo |

### Fase 2 — Isolar o risco (em paralelo à Fase 1)

| # | Ação |
| --- | --- |
| 2.1 | Usar um **número dedicado a disparos**, separado do número de atendimento. Banimento do número de disparos não derruba a IA. Cada tenant escolhe a instância de disparo em `settings.broadcast.instance`. |
| 2.2 | Manter um **número reserva** pronto e uma cópia exportável dos contatos e das provas de consentimento, para retomar em horas se houver banimento. |
| 2.3 | Escrever o **procedimento de incidente**: sinais, quem pausa, como comunicar clientes, como acionar o reserva. |

### Fase 3 — Migrar os disparos para a API oficial (3 a 6 semanas)

É a única opção que remove o descumprimento dos termos. Os disparos vão pela WhatsApp Business Platform; o atendimento pela IA pode continuar na Evolution até haver uma decisão separada.

- **Modelos de mensagem aprovados** pela Meta, por categoria (utilidade e marketing), com botão de recusa de marketing. Fontes de fornecedores indicam botão de resposta rápida com texto como "parar promoções" ou "opt-out"; confirmar na documentação da Meta antes de criar os modelos.
- **Coexistência:** permite usar o mesmo número no app WhatsApp Business e na API, mantendo histórico e contatos. As orientações dos provedores divergem sobre o passo a passo (se é preciso ou não desregistrar o número do app); confirmar com o provedor escolhido.
- **Limites e qualidade:** a Meta limita o volume por faixas (250, 1 mil, 10 mil, 100 mil, ilimitado, segundo fornecedores, com regras que estão mudando em 2026) e reduz o envio de quem tem baixa qualidade ou muito bloqueio. Também limita marketing por destinatário conforme a taxa de leitura.
- **Custo:** o Brasil cobra em reais desde julho de 2026. Um fornecedor lista cerca de R$ 0,32 por mensagem de marketing e R$ 0,035 por utilidade; **não confirmei na tabela oficial da Meta**, então valide antes de orçar.
- **Arquitetura:** o worker já tem uma camada de remetente por canal (`resolveSender`). Acrescentar o canal `whatsapp_cloud`, a tabela de modelos, o recebimento dos webhooks de status (entregue, lido, falha, qualidade) e as regras da janela de 24 horas.
- **Entrega por etapas:** primeiro um tenant piloto com poucos contatos, depois os demais; a Evolution sai do fluxo de disparos quando o piloto estiver estável por 30 dias.

### Fase 4 — Governança e LGPD (contínua)

1. Política de consentimento por tenant: texto exibido, canal separado por finalidade (consentimento por e-mail não vale para WhatsApp), registro auditável.
2. Registro dos pedidos de saída com data e prova, mantido pelo prazo definido pelo jurídico. Prazos citados por fornecedores (24 horas, 5 anos) não vêm de norma; confirmar com a assessoria jurídica e com o texto da LGPD e da ANPD.
3. Revisão mensal: taxa de saída, falhas, qualidade, bloqueios relatados pelos clientes.
4. Evitar verticais restritas pela política da Meta (por exemplo, saúde e produtos médicos, cobrança de dívidas): conferir se o texto de cada tenant se enquadra, em especial clínicas.

## 5. Ordem recomendada

1. Fase 1, itens 1.1, 1.3, 1.4 e 1.10 primeiro (consentimento, saída, horário, parada geral): são os que mais protegem com pouco código.
2. Item 2.1 (número dedicado) antes de qualquer campanha real.
3. Itens 1.2, 1.5 a 1.9 em seguida.
4. Decidir a Fase 3 enquanto a Fase 1 é feita, porque ela define o destino de longo prazo.

## 6. Decisões necessárias

1. Os disparos vão migrar para a API oficial? Se sim, qual provedor e qual orçamento mensal?
2. Quais tenants disparam hoje ou vão disparar, e com que objetivo (lembrete, reativação, promoção)? Lembretes de agendamento são utilidade e têm risco bem menor que promoção.
3. Haverá um número dedicado para disparos?
4. Quem responde pelo consentimento de cada tenant (texto, origem, guarda das provas)?

## 7. Limites desta pesquisa

Não encontrei fonte primária com taxas de banimento, prazos ou limiares de comportamento para a Evolution. Os limiares da seção 4 são práticas conservadoras sugeridas, a calibrar com dados reais. Preços, faixas de limite e passos de coexistência vêm de páginas de fornecedores e devem ser conferidos nas páginas oficiais da Meta.

## Fontes

- [WhatsApp Business Messaging Policy](https://www.whatsapp.com/legal/business-policy)
- [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service)
- [Meta: Receber aceitação para o WhatsApp](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [Meta: Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Quality rating e limites (Braze)](https://braze.com/docs/user_guide/channels/whatsapp/message_processing/quality_rating_and_messaging_limits/)
- [Risco de ferramentas não oficiais (Spoki)](https://spoki.com/en/blog/official-whatsapp-business-api-vs-unofficial-tools-the-risk)
- [Evolution API vs Cloud API](https://pasqualepillitteri.it/en/news/12969/integrate-whatsapp-evolution-api-vs-cloud-api)
- [Coexistência (360dialog)](https://docs.360dialog.com/docs/hub/embedded-signup/whatsapp-coexistence)
- [Preços no Brasil (ChatMaxima, não oficial)](https://chatmaxima.com/whatsapp-api-pricing/brazil/)
- [LGPD e WhatsApp (Legale)](https://legale.com.br/blog/consentimento-marketing-digital-lgpd/)
