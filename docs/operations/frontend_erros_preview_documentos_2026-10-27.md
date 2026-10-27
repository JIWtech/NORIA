# Frontend: erros legíveis e prévia de documentos — 27/10/2026

## Alterações locais

- Login, criação de empresa, carregamento do painel, falha de renderização, agenda, campanhas, envio/encerramento de conversa e confirmação de sinal passam por `userFacingError`. Mensagens arbitrárias do servidor não são reproduzidas na interface; códigos conhecidos recebem uma orientação específica.
- Eventos `technical_error`, `core_error` e `core_operator_review` de sistema recebem apresentação humana na prévia e no histórico, tanto na carga inicial quanto no Realtime. Os eventos originais continuam disponíveis para auditoria. Mensagens legítimas do cliente não são modificadas.
- Documentos exibem cartão com nome, tipo, tamanho, prévia e download opcional. PDFs, imagens raster enviadas como documento e texto/CSV podem ser lidos no painel. Fotos recebidas como imagem mantêm o visualizador existente.
- PDF.js `6.4.299`, adicionado com autorização explícita do usuário, renderiza PDF em canvas e worker local. O navegador interno não exibiu conteúdo no iframe nativo; a renderização por PDF.js foi conferida visualmente. O código do leitor e o worker entram em arquivos separados no build.
- O leitor ampliado oferece páginas, zoom e fechamento com retorno ao cartão. Não utiliza conversores externos. Reutiliza as URLs autorizadas pelo fluxo de mídia existente.

## Limites

- Prévia de até 20 MiB; limite aplicado aos bytes recebidos, mesmo sem Content-Length. Download permanece disponível.
- Texto limitado aos primeiros 200.000 caracteres, com indicação de truncamento. HTML é exibido apenas como texto quando o formato autorizado é texto; HTML e SVG não são incorporados como documentos ativos.
- Word, Excel, arquivos compactados e outros formatos sem renderizador mostram aviso de prévia indisponível e opção de download. PDF protegido por senha ou inválido recebe aviso legível.
- Não houve publicação do frontend, alteração de schema, workflow, fila ou envio de WhatsApp.

## Evidências

- Testes reproduziram o vazamento e a ausência de apresentação humana antes da correção.
- Oito regressões novas passaram: apresentação inicial/Realtime, revisão sem texto, preservação de mensagem do cliente, tradução de erros, renderização da tela de falha, tipos de prévia, PDF com Content-Disposition de download/HTML disfarçado e limite real do stream.
- `npm test`: baseline de 658 testes, 647 aprovados e 11 falhas; após alterações, 666 testes, 655 aprovados e as mesmas 11 falhas por identidade. Nenhum teste antigo alterado.
- `npm run build`: aprovado, incluindo chunk do PDF.js e worker. Permanecem avisos de tamanho do bundle e de importação estática/dinâmica já presentes.
- Instalação da dependência: auditoria npm informou zero vulnerabilidades.
- Navegador interno: primeira página no cartão, abertura ampliada, zoom, segunda página e fechamento com foco devolvido ao cartão. Arquivos sintéticos, sem dados de clientes.
- Demonstração reproduzível com Vite em `/tests/fixtures/document-preview.html`. Captura local: `.local/document-preview-20261027.png`.
- Logs completos locais: `.local/frontend-baseline-20261027.log`, `.local/frontend-after-20261027.log`, `.local/frontend-build-20261027.log`.

## Rollback

Reverter somente os hunks desta alteração nos componentes de interface e nos transformadores de conversa. Restaurar o ramo anterior de documento em `MediaAttachment.jsx`. Remover os novos módulos `userFacingError`, `technicalEventPresentation`, `documentPreview`, `DocumentAttachment`, `PdfDocumentPreview` e seu CSS após remover os imports. Remover `pdfjs-dist` e atualizar o lockfile se nenhum outro trabalho passar a depender dele. Preservar alterações concorrentes e não executar restauração integral da árvore. Nenhuma reversão de banco ou n8n é necessária.

## Complemento: galeria de fotos

- Miniaturas agora resolvem descritores com bucket/storagePath pelo cliente autenticado e cache compartilhado. A imagem principal usava incorretamente duas strings como argumentos de `resolveSingleMediaUrl`; a chamada foi corrigida. Resultados de uma foto anterior não são reutilizados enquanto outra origem carrega.
- Cliques de navegação, zoom e soltura de arraste não fecham o visualizador. O clique no palco não propaga para o fundo, e a captura do ponteiro não transforma um gesto iniciado na imagem em pedido de fechamento. Clique direto no fundo, botão de fechar e Esc continuam funcionando.
- Quatro testes adicionais passaram. Suíte completa: 670 testes, 659 aprovados, mesmas 11 falhas anteriores por identidade; build aprovado. No navegador foram conferidos cinco previews, troca para a segunda imagem, zoom de 125%, arraste sem fechamento e clique fora fechando.
- Fixture sintética: `/tests/fixtures/gallery-thumbnails.html`; captura `.local/gallery-thumbnails-fixed.png`. Logs `.local/gallery-full-suite.log` e `.local/gallery-build.log`.
- Rollback deste complemento: reverter os hunks de `MediaViewer.jsx` e remover os auxiliares `viewerMediaUrl.js` e `viewerInteractions.js` depois dos imports. Não requer alteração em banco, provedor ou workflow.
- Duplo clique: o handler foi levado ao palco para receber também eventos redirecionados pela captura do ponteiro. Com zoom aplicado, retorna a 100% e zera o deslocamento. Reproduzido antes com `scale(1.25)` persistindo; depois, zoom + arraste + duplo clique resultaram em `translate(0px, 0px) scale(1)` sem fechar o visualizador. Logs adicionais: `.local/gallery-doubleclick-suite.log` e `.local/gallery-doubleclick-build.log`.
