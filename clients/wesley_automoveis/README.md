# Gênesis Automóveis

O tenant `wesley_automoveis` usa a instância WhatsApp `wesley-carros`. A [EXT Gênesis](../../n8n/sources/genesis_extension.js) trata vendas, compras, trocas, financiamento e catálogo. O [CORE compartilhado](../../n8n/sources/noria_core.js) processa o turno e consome a decisão comercial estruturada. O Supabase guarda as configurações e os dados do tenant.

## Referências

- [Prompt de alinhamento do contrato comercial](prompts/system_prompt_v14_25_contract_alignment.md)
- [Configuração de vendas](sales.json)
- [Consultas de diagnóstico da qualificação](18_diagnostico_qualificacao.sql)
- [Exports do CORE e da EXT Gênesis](../../n8n/workflows/)
- [Gerador dos workflows](../../scripts/build_noria_workflows.cjs)

O [passo a passo da ativação original](PASSO_A_PASSO.md) registra a implantação de `sales_v1`. Para intervenções, confira o workflow ativo e a configuração vigente do tenant antes de reaplicar instruções da ativação inicial.
