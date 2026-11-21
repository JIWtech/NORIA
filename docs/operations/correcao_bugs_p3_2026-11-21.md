# Correção dos bugs P3 do backend — 2026-11-21

## Escopo e estado

Worktree `C:\noria-wt-bugs3`, branch `fix/bugs-p3-backend`. A árvore começou limpa. Foram alteradas fontes canônicas, testes e artefatos gerados locais. Não houve commit, push, publicação, instalação de dependências, migração, acesso a produção ou envio de WhatsApp.

Referências lidas: `AGENTS.md`, `.agents/rules/*.md`, `.agents/context/estrutura-atual-2026-11-21.md` e `docs/operations/bugs_investigacao_2026-11-21.md`.

## 1. Previsão de reabertura

- `n8n/sources/noria_core.js`: a previsão considera o retorno do almoço no mesmo dia. A resolução de `holiday_dates`/`holiday`, antes restrita ao dia atual, também é aplicada às datas futuras. O avanço usa a data civil do tenant, evitando depender da data UTC do instante de referência.
- `clients/ic_saloon/salon_engine.js`: a previsão considera o retorno do almoço no mesmo dia e mantém as exceções de feriados já existentes. O avanço também passou a usar a data civil, preservando a correspondência de feriados durante mudanças de horário de verão.
- Relógios fixos em `scripts/test_business_hours_p3.cjs`: 09–18 com almoço 12–13; 12h30 → hoje 13h; segunda após o expediente e terça feriado fechado → quarta 09h; feriado aberto com horário especial; domingo fechado; virada UTC com data local ainda no dia anterior; limites de 12h, 13h e 18h; diferença entre São Paulo e Manaus no mesmo instante.

**RED antes da correção:** os testes iniciais do CORE falharam no almoço e no feriado futuro. **GREEN:** regressões nas duas fontes passam, incluindo as condições de borda acima.

A revisão independente encontrou a sobreposição entre o início do expediente e o almoço: feriado de 12h30–18h ainda estava fechado às 12h30. Foram acrescentados oito casos com falha antes do ajuste, nos dois motores: início dentro do almoço hoje/futuro e expediente inteiramente coberto pelo almoço hoje/futuro. O cálculo agora busca o primeiro intervalo realmente aberto e pula dias sem esse intervalo. Um caso de horário de verão em Nova York também falhou antes da alteração do avanço civil do Salon. Após os ajustes, `test_business_hours_p3.cjs` passou 21/21 em execução independente; a revisão final não apontou novos problemas concretos.

## 2. Modos removidos do Salon

`loadTenantContext` recusa a configuração antes das consultas de agente/canal e do processamento do turno, lançando `SALON_ENGINE_MODE_UNSUPPORTED` quando encontra qualquer um dos modos:

- `grounding_mode: 'canonical_v2'`;
- `appointment_scheduling.enabled: true`;
- `conversation_capability: 'sales_v1'`;
- `noria_turn_pipeline.enabled: true`.

**RED antes da correção:** os quatro testes esperavam rejeição e o motor aceitava os modos silenciosamente. A configuração compatível passava. Somando horários e modos, a primeira execução registrou 1 aprovação e 6 falhas.

**GREEN:** cada modo é recusado; a fixture compatível com o modo atual continua aceita. Trata-se de fixture local mínima, sem leitura ou confirmação da configuração de produção.

## 3. Claim sem pino

**Hipótese reproduzida.** O dispatch chama `magia_claim_turn` antes de consultar/gravar o evento de pino. O roteador encontrava um lote `claimed`, não encontrava pino e retornava o caminho legado sem avaliar a declaração válida do pipeline.

**RED antes da correção:** a regressão de retail esperava `retail_v1` e recebeu `undefined` na rota padrão. O teste integrado adicional também falhou com a expressão anterior do roteador reconstruída em memória: `undefined` em vez de `services_v1`.

**Correção mínima:** em `n8n/sources/noria_router.js`, um pino existente continua prevalecendo; se não existir pino, a seleção prossegue pelas mesmas validações de declaração, versão, capability e rollout já usadas para novos lotes. Declaração ausente/desligada ou contato fora do piloto preserva o caminho padrão; declaração habilitada inconsistente continua falhando fechada. O dispatch e o schema não foram alterados.

**GREEN:** `scripts/test_claim_pin_interruption.cjs` executa o dispatch canônico com HTTP simulado, persiste o claim no mock e pausa a leitura do pino. Durante a pausa, executa o roteador e confirma `services_v1`/`services_v2`. Depois libera o dispatch e confirma a gravação do pino. O teste reproduz a janela entre as chamadas; não mata um processo real nem demonstra atomicidade no banco.

Os testes de services e retail que exigiam legado para qualquer lote sem pino foram atualizados para o comportamento solicitado. Permanecem as verificações de isolamento de tenant/conversa, prioridade do pino e declaração inválida.

**Limitação operacional:** um lote legado anterior à ativação, sem pino, é indistinguível do lote interrompido nessa janela e também pode adotar a declaração vigente. Em uma ativação futura, deve-se drenar os lotes antigos antes de habilitar o pipeline. A correção não recupera a versão original de um lote sem marcador se a configuração também tiver mudado. Nenhuma ativação foi feita nesta tarefa.

## Validações finais

| Comando | Resultado |
| --- | --- |
| `node scripts/validate_noria_release.cjs` | 745 testes, 745 aprovados, 0 falhas |
| `node scripts/audit_anti_hardcode.cjs` | aprovado, sem padrões proibidos |
| `node --test` com todos os `clients/ic_saloon/*.test.cjs` | 85 testes, 85 aprovados, 0 falhas |
| `npm test --prefix app` | 971 testes, 971 aprovados, 0 falhas |
| Compilação das três fontes alteradas com `AsyncFunction` | aprovada |
| `git -c core.safecrlf=false diff --check` | aprovado |

As duas regressões novas foram incluídas em `validate_noria_release.cjs`.

Na primeira execução isolada dos testes do Salon, `price_relay_queue.test.cjs` não encontrou PGlite no caminho temporário padrão. A execução completa passou apontando `MAGIA_TEST_MODULES` para a dependência já instalada em `app/node_modules`, como o validador de release já faz:

```powershell
$env:MAGIA_TEST_MODULES = (Resolve-Path app/node_modules).Path
$salonTests = @(Get-ChildItem clients/ic_saloon/*.test.cjs | ForEach-Object { $_.FullName })
node --test @salonTests
```

A checagem direta `node --check` das fontes n8n não é adequada: elas são corpos de funções assíncronas e contêm `await` no nível do corpo. A sintaxe foi conferida no contexto correto com `AsyncFunction`, além dos testes que executam essas fontes.

Uma verificação adicional fora da suíte obrigatória, `scripts/test_out_of_hours_and_silence.cjs`, falhou no primeiro cenário com `Reply must not be empty`. A mesma falha foi reproduzida com o CORE do `HEAD` em memória, sem esta correção. Esse teste não foi alterado para ocultar a falha.

## Build e nós alterados

O build final foi executado e repetido, sequencialmente e sem testes lendo exports durante a geração:

```powershell
$env:NORIA_RETAIL_EXT_WORKFLOW_ID = 'vE8rPAAdzkkVzPBG'
node scripts/build_noria_workflows.cjs
```

Comparação dos exports copiados inicialmente, preservados em `.local/p3-before/workflows/`, com os exports regenerados:

| Workflow | ID | Nó alterado |
| --- | --- | --- |
| Motor compartilhado | `mlKNPv862H2g3Gap` | `CORE \| Motor conversacional` |
| Roteador | `3N5oN6sxtir9lFrA` | `CORE - Resolver extensão do tenant` |
| IC Salon | `yxdKP0PeskDMUFSo` | `CORE \| Motor conversacional` |

Somente os parâmetros desses três nós mudaram. Não houve adição/remoção de nós nem alteração de conexões ou demais propriedades dos workflows. Os outros seis exports não tiveram mudanças semânticas. Os nove exports, o manifesto e as duas projeções de código foram comparados após o segundo build: **12 artefatos idênticos byte a byte**. Os JSON de `n8n/workflows/` continuam gitignored.

O gerador atualizou `n8n/build_manifest.json` e a projeção `n8n/code/whatsapp_conversation_core.generated.js`. Hash final `core_sha256`: `1cbb68ad018630d60e98e368e9e193bfd88b20b01262037459b1716788fd6dd8`.

## Rollback e limites de evidência

Para desfazer este incremento local, reverta seletivamente os trechos das três fontes, os testes associados e a inclusão no validador; restaure o manifesto/projeções correspondentes ou regenere a partir das fontes anteriores. Para os exports ignorados, as cópias anteriores estão em `.local/p3-before/workflows/`. Não sobrescreva alterações posteriores de outros trabalhos.

As evidências são locais: testes, mocks, fontes, geração e comparação de artefatos. Não comprovam publicação no n8n, execução com Supabase/Evolution reais, resposta real do Gemini ou entrega ao cliente.
