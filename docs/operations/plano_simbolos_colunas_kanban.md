# Plano: símbolo, cor e papel das colunas vêm do Supabase

Data: 07/11/2026. Pedido: o estado da conversa e o seu símbolo devem estar alinhados no Supabase, por tenant, e não decididos por regras fixas no código.

## 1. O que existe hoje (investigado)

| Item | Onde | Problema |
|---|---|---|
| Símbolo, rótulo curto e descrição de cada coluna | `kanbanColumnPresentation.js` (antes dentro do `Kanban.jsx`) | Regex sobre a chave e o título, por exemplo "contém `humano`" vira o ícone de pessoa |
| Título exibido no Kanban | o mesmo arquivo, campo `displayTitle` | `com_humano` e `conversas_humanos` sempre aparecem como "Em atendimento humano", ignorando o nome do tenant ("Com humano" no Noria, na Núbia e na Royal; "Conversas com humanos" na Universo e na Núbia antiga) |
| Cor da coluna | `stageTone.js`, `TONE_BY_STAGE` | Mapa fixo por chave |
| Coluna "de humano" ou "de IA" | `conversationListTags.js` (feito hoje, sem commit) | Lista fixa de chaves |
| `kanban_columns` | Supabase | Tem só nome, posição e `automation_key`. Nenhum dado visual |
| Quem cria colunas | RPC `magia_create_tenant_onboarding`, SQL de clientes (`clients/*`), `build_wesley_sales_sql.cjs` | Nenhum define símbolo nem cor |

Produção: 7 tenants, todos com quadro padrão, 31 combinações distintas de chave e nome.

## 2. Decisão

### Banco (migração 032)

- `kanban_columns` ganha `icon`, `tone`, `owner_role`, `short_label` e `description`, todos opcionais, com `check` nos valores aceitos:
  - `icon`: lista fechada dos símbolos que o painel sabe desenhar.
  - `tone`: as 12 cores da paleta.
  - `owner_role`: `ai`, `human` ou `neutral`.
- Nova tabela `kanban_column_presets`, com os padrões da plataforma por `automation_key`. É dado, não código.
- Gatilho antes de inserir em `kanban_columns`: preenche os campos vazios a partir do preset da chave. Vale para o onboarding, os SQL de clientes e qualquer outra inserção, sem reescrever a RPC de onboarding. O que vier preenchido não é sobrescrito.
- Carga inicial das colunas existentes pelos presets.
- Os presets reproduzem **exatamente** o que o código mostra hoje. Os valores foram gerados executando o código atual sobre as 31 combinações de produção, e um teste compara os presets com esse resultado.

### Painel

- O Kanban, a lista e o cabeçalho leem `icon`, `tone`, `owner_role`, `short_label` e `description` da coluna.
- Fica no código só um dicionário técnico que liga o nome do símbolo ao componente que o desenha. Um teste garante que esse dicionário e o `check` do banco têm a mesma lista.
- Sem dado na coluna, vale o padrão neutro (caixa de entrada, cinza). Não há mais regex por texto.
- O título exibido passa a ser sempre o nome do tenant no banco.
- O selo da conversa sem card no Kanban usa a coluna que o estágio já resolve (`getStageLabel`). Se nenhuma corresponder, usa o neutro.

## 3. Única mudança visível

O cabeçalho da coluna no Kanban passa a mostrar o nome cadastrado de cada tenant:

| Tenant | Hoje no Kanban | Depois |
|---|---|---|
| Noria, Núbia oficial, Royal | Em atendimento humano | Com humano |
| Universo, Núbia antiga | Em atendimento humano | Conversas com humanos |

Para manter o texto anterior, basta renomear a coluna no banco. O resto (símbolo, cor e rótulo curto) fica igual ao de hoje.

## 4. Fora do escopo

- Gravar no Supabase em qual coluna cada conversa está. Hoje isso é calculado no painel a partir dos eventos. É um passo separado, maior, e envolve o CORE.
- `getKanbanColumnKind` (colunas especiais) e o roteamento de eventos para colunas, que são regra de automação e não aparência.
- `getStageTone` continua para telas que mostram estágio sem coluna (por exemplo, o painel inicial).

## 5. Execução e verificação

1. Teste da migração em PGlite, escrito antes: colunas, checks, gatilho, preferência pelo valor explícito, chave desconhecida, carga inicial e RLS da tabela de presets.
2. Teste de equivalência: presets iguais ao resultado do código atual.
3. Testes do painel, escritos antes: leitura dos campos, padrão neutro, dicionário igual ao check, mapeamento do banco para o painel, lista e cabeçalho.
4. Suíte completa sem falha nova, build, gate.
5. Aplicar a migração com confirmação de linhas por tenant e conferir que o resultado no banco é igual ao esperado.
6. Rollback: `supabase/migrations_pending_review/032_kanban_column_presentation_rollback.sql`.
