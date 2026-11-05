# Núbia: vínculo entre preço e serviço

Reprodução: `node scripts/homolog/nubia_price_binding_probe.cjs`. Sem rede ou alterações de dados.

No início da investigação, o CORE publicado e o local usavam uma lista global de preços em `groundingValidateResponse`: bastava o valor existir em qualquer linha do catálogo, sinal calculado ou taxa. Isso não comprovava que o valor pertencesse ao serviço afirmado. A reprodução inicial aceitou R$ 99,99 para Bronze Comfort; o catálogo consultado em 23/10 registra R$ 179,99 para Comfort e R$ 99,99 para Clássico. Era uma candidata inserida no teste, não uma mensagem comprovadamente enviada em produção.

Restringir valores ao `state.service_id` não resolve a identidade semanticamente: o modelo também pode escolher o ID errado ou comparar vários serviços legitimamente. Interpretar nomes no texto por regex criaria outra autoridade semântica, proibida pelas regras do projeto.

Implementação local após o esclarecimento do usuário: contrato `price_claims`, com fonte tipada, ID, centavos e trecho literal; verificação determinística contra a mesma linha do catálogo, percentual ou taxa; auditoria independente da correspondência entre texto e fontes. Reutiliza o protocolo de evidência semântica existente, sem classificador de intenção por palavras-chave. Toda resposta livre passa pela auditoria, inclusive quando declara não conter valores ou quando o catálogo está vazio: valores por extenso ou omitidos poderiam contornar uma triagem lexical. Blocos oficiais literais mantêm a validação de seus snapshots e dispensam a chamada extra. Rejeição ou indisponibilidade impede entregar a candidata. Comparações preservam fontes separadas para cada serviço.

Alternativa: restringir toda resposta com valores aos blocos oficiais validados do Supabase. Evita uma auditoria adicional, mas reduz a liberdade das comparações, cálculos de sinal e respostas combinadas com coleta; exige definir a experiência quando faltar um bloco.

Critérios de aceitação da proposta preferida: bloquear preço cruzado mesmo com valor e ID de outro serviço válidos; aceitar comparação com preços corretos; separar preço, sinal e adicional; manter preços ausentes como desconhecidos; não confirmar pagamento por declaração; validar tenant, turno, catálogo e evidências; falhar fechado se o auditor estiver indisponível; testar tudo offline antes de qualquer publicação.

Impacto: novo campo no contrato canônico e uma chamada adicional por resposta livre desse fluxo, sem retry em cascata do auditor. Usa a reserva atômica de orçamento já existente. Não houve chamada real durante a preparação local. Não há DDL necessário. Publicação e alteração do prompt no Supabase continuam pendentes de autorização específica.

Validação local: os seis testes iniciais falharam antes da implementação; a bateria foi ampliada para 13 casos e passou integralmente. Inclui preço cruzado, ID válido do serviço errado, comparação correta, sinal, taxa, valor por extenso, relatório de outro turno, indisponibilidade, isolamento de tenant, serviço inativo, preço ausente, milhar, bloco oficial válido e snapshot obsoleto. O probe agora retorna `gap_reproduced:false`, com `PRICE_SOURCE_VALUE_MISMATCH`. O teste usa transporte Gemini simulado: comprova o bloqueio e os contratos, não a qualidade de julgamento do modelo real. Nenhum preço foi alterado.
