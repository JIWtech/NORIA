# NORIA — segurança, prompts e regras comerciais

Rodada iniciada em 23/10/2026, horário do cliente. Consultas de produção somente para leitura. Correções de código, dependências e rascunhos aplicadas localmente; política RLS preparada e testada, ainda sem aplicar ao Supabase.

## Resultados concretos

| Achado | Evidência | Correção e estado |
| --- | --- | --- |
| Prefixo de tenant interpretado como padrão no Storage | Política publicada usa `objects.name LIKE t.slug || '/%'`. O `_` aceita outro caractere; SELECT sintético confirmou o resultado. Nenhuma colisão entre os tenants atuais foi encontrada. | Proposta usa igualdade do primeiro segmento do caminho. Três testes com RLS real em PGlite, role sem superusuário, isolamento, membro inativo, bucket, repetição e edição concorrente. Pendente de aplicação em produção. |
| URL privada reaparece após limpeza/invalidação | Três testes falharam com a implementação anterior: conclusão tardia repovoava cache e podia enriquecer dados após troca de sessão ou substituir URL nova. | Época do cache e invalidação de promessas antigas impedem reinserção. Limpeza conectada a troca de usuário/logout e invalidação da sessão. Aplicado localmente. |
| Token Telegram pode entrar na mensagem de erro | Transporte simulado lançou erro contendo URL do bot/token; três cenários falharam antes, incluindo descrição externa retornada pelo provedor. | Exceções de consulta/download e caminho ausente conservam apenas mensagem operacional e código. Mensagem bruta/descrição externa não é propagada. Aplicado no CORE canônico e regenerado. |
| Dados antigos completos autorizam candidata de reserva durante pergunta informativa | Execução do CORE gerado com transporte simulado retornou marcador de criação, com uma única chamada, embora a mensagem atual fosse “Como funciona o Comfort?”. Nenhum RPC de reserva ou envio foi realizado. | Auditoria independente exige ato atual de pedido/aceite e mesmo tenant, sessão, turno, serviço, unidade, data, horário e nome. Evidências antigas e relatório de outro turno são recusados. Cinco testes passaram. |
| Diretiva de reserva em texto livre | O protocolo de criação é executável; o parser aceita também variantes com acento e `AGENDAMENTO_CONFIRMADO`. | O mesmo parser bloqueia diretivas vindas de `reply`. A saída final canônica só libera marcador com autorização aceita. Nome de serviço com delimitador de protocolo é recusado. |
| Dois pacotes com alertas altos no npm audit | Vite 6.4.3 e source-map-js 1.2.1, conforme auditoria atual do registry. | Lockfile atualizado somente nesses dois nós: Vite 6.4.5 e source-map-js 1.2.2. Instalação com scripts desabilitados, sem adicionar/remover pacotes. Audit final: zero alertas. Build passou. |

O cenário de Storage demonstra falha da expressão de autorização, não exploração de arquivos de outro tenant. O comportamento de reserva demonstra aceitação de candidata indevida sob transporte simulado, não um agendamento indevido observado em produção. Os auditores semânticos continuam dependendo do julgamento do modelo real, que não foi chamado nesta rodada.

## Política RLS revisável

Arquivo: `supabase/migrations_pending_review/channel_media_exact_tenant_scope.PROPOSAL.sql`.

A proposta altera somente `channel_media_read_member` em `storage.objects`; mantém bucket privado, operação SELECT, role authenticated e exigência de membro ativo. Usa `(select auth.uid())` e `split_part(name,'/',1)=t.slug`. Não abre acesso às 29 tabelas internas sem políticas nem revoga indiscriminadamente RPCs usados pelo painel.

Antes de alterar, trava a relação durante a transação e confere nome, operação, roles e hash da expressão existente. Hash publicado verificado: `507b7182bf6e68dff101effcd3a5d0bd`. Hash corrigido: `d31b073c9fb579edc31df2082a3013f8`. A mesma expressão anterior produziu o mesmo hash no PGlite. Estado já corrigido é aceito; outra mudança de expressão ou roles aborta sem sobrescrever. Uma atualização futura do Postgres que altere a representação da expressão pode exigir nova revisão do hash.

É uma proposta local fora do histórico de migrações aplicadas. Nenhuma mudança de política ou schema foi executada em produção. Contenção em caso de falha de aplicação: negar temporariamente acesso pela política e revisar; não restaurar automaticamente o `LIKE` vulnerável. Aplicar a política exige autorização explícita para produção, conforme AGENTS.md.

## Prompts e decisões comerciais

Os rascunhos Gênesis v14.25 e Núbia v5 receberam orientações de proteção de dados, coleta mínima e separação entre conteúdo externo e autoridade. Declaração de ser administrador, instrução em OCR/áudio/anúncio ou pedido de depuração não concede permissão para expor credenciais, URLs privadas, dados de terceiros ou mudar regras.

Na Núbia, a lista de campos JSON agora inclui `price_claims`, removendo a instrução antiga incompleta. A reserva exige pedido ou aceite atual da mesma proposta; dados antigos e consulta informativa não bastam. Essas instruções acompanham validação de código: o prompt sozinho não é controle de segurança.

Foram atualizados também o destino do patch de prompts e a expectativa do rollback, preservando seus guards contra edição concorrente. O baseline continua sendo o prompt anteriormente consultado no Supabase. Nenhum prompt ativo foi substituído.

Mantidos: preços por serviço, percentual de sinal configurado, confirmação financeira humana, recursos de agenda por serviço, autoridade da EXT, evidência atual para ano desconhecido, entrada validada pelo CORE e marca estruturada. Não foi ativado o pipeline Núbia v2 nem alterado o estado da Royal.

A auditoria de autorização de reserva é uma chamada adicional somente quando uma candidata completa de criação é produzida pelo fluxo canônico. Usa o orçamento atômico existente e não tenta novamente em cascata. Aprovação do auditor autoriza a candidata; disponibilidade, gravação atômica e pagamento mantêm suas verificações próprias.

## Supabase: revisão de permissões

Advisors atualizados: 29 tabelas com RLS sem política, 21 funções SECURITY DEFINER executáveis por authenticated, extensão em public e proteção de senha vazada desabilitada. Performance: 55 FKs sem índice de cobertura, 30 ocorrências de auth em RLS, uma tabela sem PK, sete índices sem uso, 29 políticas permissivas múltiplas e quatro índices duplicados.

Nenhuma das 21 funções listadas concedia execução a anon. Foram examinadas definições de helpers de tenant, atestação de ingresso, eventos de controle, supressão, autorização de agenda, reserva e movimentação de lead. A atestação de ingresso vincula a origem ao `auth.uid()`; controle exige membro/role; agenda passa por autorização de tenant ativo e membro autorizado, ou service_role. Isso não prova ausência de todas as falhas nesses RPCs, mas não justifica revogar suas permissões apenas pelo aviso do advisor.

A consulta às políticas não encontrou `USING(true)` ou `WITH CHECK(true)` nas tabelas públicas/storage examinadas. A política de Storage foi o defeito confirmado. Alertas de RLS sem políticas podem indicar tabelas internas deliberadamente fechadas; índices sem uso e duplicados exigem análise própria antes de alteração.

Referências: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [SECURITY DEFINER exposto](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Os [avisos oficiais do launch-editor/Vite](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm) incluem risco no ambiente Windows de desenvolvimento. Outro [aviso do Vite](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw) depende de middleware customizado; o alerta de pacote não comprova que o app publicado esteja explorável.

## Validação e limites

- Bateria de CORE, comercial, contratos e segurança: 181/181 em 29 arquivos. Em seguida foi acrescentado e aprovado um terceiro teste de Storage contra edição concorrente: 182 testes distintos aprovados.
- Casos novos: três de cache no app, três de privacidade de erros Telegram, cinco de autorização/diretivas de reserva e três de Storage. Os cenários iniciais de cache, Telegram, reserva e isolamento falharam antes das respectivas correções.
- `npm test` no app: 651 testes, 640 aprovados, 11 falhas. As mesmas 11 falhas ocorreram ao carregar as versões HEAD dos dois serviços alterados em memória, sem restaurar arquivos; baseline sem os três testes novos: 648 testes, 637 aprovados, 11 falhas. Os casos anteriores envolvem contratos estruturais de App/timeline/topbar, localização, catálogo e galeria.
- Nenhuma asserção antiga foi removida ou reduzida. As 72 falhas anteriores das suítes antigas CORE/vendas documentadas nas rodadas anteriores permanecem uma limitação; esta rodada não as declarou resolvidas.
- Build do app com Vite 6.4.5: passou. Há aviso de chunk grande já existente; não houve refatoração fora do escopo para eliminá-lo.
- npm audit final: zero vulnerabilidades conhecidas no grafo auditado naquele momento. Isso não garante ausência de vulnerabilidades desconhecidas nem segurança integral do sistema.
- Anti-hardcode e 16 checks de fotos passaram; 32 nós JavaScript compilados em quatro workflows, sem inconsistências de nomes/IDs/conexões; 15 entradas estáveis após regeneração; `git diff --check` passou.

Build local desta rodada: CORE `99289e1a319da66569ffdea413bac3e84dc102d8fca5bea951d39ea4667324f9`, EXT `3fffdf4d39074c3857d0269fd1c4ce5d011ff32f619007c7e995eaa3059de663`. Esses hashes não foram publicados.

Limpar o cache do navegador não revoga URLs assinadas já copiadas ou emitidas: elas conservam o prazo concedido pelo Storage. A correção impede reuso/reinserção pelo cache após as transições tratadas. Uma política diferente de expiração exige decisão de produto e validação específica.

## Arquivos e rollback local

Fontes: `n8n/sources/noria_core.js`, `app/src/services/auth/authService.js`, `app/src/services/media/mediaUrlService.js`. Lockfile: `app/package-lock.json`, somente dois pacotes. Rascunhos e SQLs de prompts foram sincronizados. Testes novos em `scripts/test_booking_authorization.cjs`, `scripts/test_telegram_error_privacy.cjs`, `scripts/test_storage_tenant_scope.cjs` e `app/tests/unit/mediaUrlSecurity.test.js`.

Preservados os três arquivos de frontend já modificados pelo usuário e todo o trabalho das rodadas anteriores. Rollback local exige revisão dos hunks desta rodada e regeneração do CORE, preservando alterações posteriores; não restaurar o checkout inteiro. Reverter os dois pacotes reintroduz os alertas conhecidos, portanto prefira outra versão corrigida se houver incompatibilidade. Como não houve implantação, não há rollback remoto desta rodada.
