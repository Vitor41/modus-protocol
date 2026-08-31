# Protocolo de comentários do tracker

Use este protocolo em toda execução live. O comentário é evidência operacional; a resposta no chat não o substitui.

## Gate físico

Siga exatamente os providers do adapter. Para Trello com provider `environment`, execute `runtime/pipeline.ps1 trello`: `snapshot` para a fila enxuta, `list` para histórico pontual, `write-readback` para publicação e `read` para reconciliação. O cliente lê o arquivo externo declarado sem imprimir credenciais. Uma falha encerra o gate; não faça fallback, nova implementação ad hoc ou leitura integral de comentários do board.

Para cada evento obrigatório declarado em `tracker.comments.required_events`:

1. publique um comentário novo no card correto;
2. capture a referência retornada pela escrita e os providers efetivamente usados;
3. releia o comentário pela referência ou pelo card combinado com `RUN_ID` e prefixo inequívoco;
4. compare `RUN_ID`, card, papel/evento, fatos essenciais e UTF-8;
5. somente depois considere a escrita concluída.

Falha na publicação gera `TRACKER_COMMENT_WRITE_FAILED`. Falha, ausência ou divergência na releitura gera `TRACKER_COMMENT_READBACK_FAILED`. Em ambos os casos, não mova o card e não presuma sucesso.

Antes de movimentar, materialize `schema/tracker-transition-receipt.schema.json` com o handoff aprovado, hash do conteúdo persistido, providers e timestamps. Execute `runtime/pipeline.ps1 transition-gate`; somente `PASS / GRANTED` autoriza `runtime/pipeline.ps1 trello --action move-readback`. A movimentação só conclui após reler e confirmar a lista persistida.

## Eventos mínimos

- `lock`: `CODEX LOCK`, `RUN_ID`, papel, estado e status;
- `capsule`: `CONTEXT CAPSULE`, decisões, evidências, riscos e próximo passo;
- `role_handoff`: prefixo do papel, commit/artefato fixado, veredito e evidências;
- `blocker`: causa, estado preservado, retorno esperado e necessidade humana;
- `transition`: estado de origem, destino e referência do handoff que autorizou a mudança.

Um único comentário pode representar `role_handoff` e `transition` quando declarar ambos explicitamente. Aprovações humanas continuam sendo comentários separados e posteriores à evidência que aprovam.

## Segurança

Não inclua tokens, chaves, cookies, senhas, strings de conexão ou dados reais sensíveis. O adapter declara somente providers e o caminho relativo do arquivo externo; credenciais permanecem fora do adapter e nunca aparecem na saída do cliente.
