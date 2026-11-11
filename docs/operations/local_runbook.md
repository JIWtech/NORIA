# Desenvolvimento local

## Preparar a stack

Na raiz do clone, copie `.env.example` para `.env` e `app/.env.example` para `app/.env.local`. Preencha os valores do ambiente de desenvolvimento. Use um projeto Supabase de teste e deixe as chaves de serviço fora da interface.

```powershell
docker compose up -d
docker compose ps
npm --prefix app ci
npm --prefix app run dev -- --port 5174
```

- Interface: <http://localhost:5174/?app=1>
- n8n: <http://localhost:5678> com a porta padrão do Compose.
- Para validar a interface localmente, rode `npm --prefix app test` e `npm --prefix app run build`.

## Trabalhar com workflows

1. Confira as [fontes canônicas](../../n8n/sources/) e a [estrutura do CORE](whatsapp_conversation_core.md).
2. Depois de editar fontes, execute `node scripts/build_noria_workflows.cjs` e confira o diff dos [exports](../../n8n/workflows/).
3. Se o teste precisar de n8n local, use uma instância de desenvolvimento. Confira as referências entre o CORE, o motor e as EXT pelos IDs dessa instância. Use dados sintéticos e serviços de teste.
4. Selecione as regressões correspondentes em [scripts/](../../scripts/). Antes de rodar um script que usa credenciais, verifique quais serviços ele acessa.
