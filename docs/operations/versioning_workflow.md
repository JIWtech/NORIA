# Fluxo de versionamento

A branch `dev` integra as mudanças. A branch `prod` reúne as versões aprovadas para operação. Se uma tarefa precisar de isolamento, crie uma branch temporária a partir de `dev` e integre de volta após a revisão.

## Desenvolver e revisar

1. Confira a branch e o diff com `git status -sb` e `git diff`. Em um checkout limpo de `dev`, atualize com `git pull --ff-only origin dev`.
2. Valide o escopo conforme o [AGENTS.md](../../AGENTS.md). Para alterações no painel ou em serviços, rode `npm --prefix app test`. Se a interface mudar, confira também `npm --prefix app run build`.
3. Se houver mudanças no n8n, regenere os exports a partir das fontes canônicas e confira o diff dos arquivos gerados.
4. Selecione os arquivos do incremento. Revise `git diff --staged`, procure segredos ou dados privados e faça um commit com uma descrição do objetivo.

## Promover e reverter

- Abra a promoção de `dev` para `prod` com a suíte completa verde, aprovação da equipe e evidência de homologação.
- Siga o [checklist de publicação](production_deploy_checklist.md) para serviços externos.
- Se for necessário reverter uma versão compartilhada, use um commit de reversão e valide o diff. Para serviços externos, execute o rollback documentado na publicação autorizada.
