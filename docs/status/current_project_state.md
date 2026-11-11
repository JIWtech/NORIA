# Estado do projeto

Referência do repositório local revisada em 11/11/2026. Para confirmar o que está em produção, confira as versões ativas no n8n, as configurações do tenant e as migrações aplicadas.

## Componentes

- [Frontend React/Vite](../../app/). Conversas e envio manual, Kanban, agendamentos e disparos. O painel recebe eventos do Supabase Realtime.
- [NORIA CORE](../../n8n/sources/noria_core.js). Motor compartilhado para turnos de WhatsApp, integrado à Evolution API. Os exports do CORE incluem roteamento, comandos e follow-ups.
- [NORIA EXT](../../n8n/workflows/). Os exports incluem políticas de Gênesis, Núbia e Royal 4x4. As regras comerciais ficam nas extensões e nas configurações do tenant no Supabase.
- [Supabase](../../supabase/). Dados e configurações por tenant, eventos, migrações e políticas de acesso.

## Operações documentadas

| Operação | Referência no repositório |
| --- | --- |
| Gênesis Automóveis (`wesley_automoveis`) | [Vendas, compras, trocas, financiamento e catálogo](../../clients/wesley_automoveis/README.md) |
| Clínica Núbia (`clinica_nubia_oficial`) | [Atendimento e agendamentos](../../clients/clinica_nubia_oficial/) |
| IC Saloon | [Configuração e pendências de atendimento e agendamento](../../clients/ic_saloon/) |
| Royal 4x4 (`royal_4x4`) | [Export de catálogo no Supabase](../../n8n/workflows/NORIA%20EXT%20Royal%204x4%20_%20Catalogo%20Supabase%2024h%20%2B%20IA%20sob%20demanda%20v2.json) |

Os registros do piloto Telegram/JIW documentam a fase anterior do projeto. Veja o [índice](../INDEX.md) para localizar as referências do CORE WhatsApp e seus exports.
