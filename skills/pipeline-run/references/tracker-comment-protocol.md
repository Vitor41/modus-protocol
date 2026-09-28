# Protocolo de comentários do tracker

Use este protocolo em toda execução live. O comentário é evidência operacional; a resposta no chat não o substitui.

## Gate físico

Siga exatamente os providers do adapter. Para Trello com provider `environment`, execute `runtime/pipeline.ps1 trello` com acesso externo autorizado: `snapshot` para a fila enxuta, `list` para histórico pontual, `write-tracker-receipt` para os eventos operacionais, `write-readback` somente para mensagens humanas deliberadamente curtas e `read` para reconciliação. O cliente lê o arquivo externo declarado sem imprimir credenciais. Leituras idempotentes recuperam falhas transitórias em até três tentativas totais. Não faça fallback, implementação ad hoc ou leitura integral do board. Antes de isolar uma falha recuperável, use a reconciliação limitada abaixo.

Para cada evento obrigatório declarado em `tracker.comments.required_events`:

1. mantenha o artefato completo local e publique um recibo mínimo novo no card correto;
2. capture a referência retornada pela escrita e os providers efetivamente usados;
3. releia o comentário pela referência ou pelo card combinado com `RUN_ID` e prefixo inequívoco;
4. compare `RUN_ID`, card, papel/evento, fatos essenciais e UTF-8;
5. somente depois considere a escrita concluída.

Falha na publicação gera `TRACKER_COMMENT_WRITE_FAILED`. Falha, ausência ou divergência na releitura gera `TRACKER_COMMENT_READBACK_FAILED`. Em ambos os casos, não mova o card e não presuma sucesso.

Quando a publicação já devolveu `comment_ref`, uma falha posterior não autoriza publicar de novo. Execute uma única `read` nessa referência; a resposta renovada fornece `written_at`, `read_at`, hash e confirmação. Se card, conteúdo, `RUN_ID` e eventos coincidirem, reconstrua o recibo e prossiga. O gate aceita diferença causal de relógio de até cinco segundos entre Trello e host e registra `clock_skew_reconciled`; diferença maior permanece inválida.

Antes de movimentar, materialize `schema/tracker-transition-receipt.schema.json` com o handoff aprovado, hash do conteúdo persistido, providers e timestamps. Execute `runtime/pipeline.ps1 transition-gate --receipt <recibo> --adapter <projeto>/.pipeline/project.adapter.yaml --format json`; esse comando não aceita `--project-root`. Somente `PASS / GRANTED` autoriza `runtime/pipeline.ps1 trello --action move-readback`. A movimentação só conclui após reler e confirmar a lista persistida.

Se um snapshot posterior encontrar `STATUS: completed`, `STATE_FROM`, `STATE_TO` diferente e eventos `role_handoff, transition` ainda na lista de origem, o planner emite `execution_kind: operational`. O orquestrador relê a evidência e retoma apenas o gate/movimento; não chama novamente PO, UX/UI, DEV, Review ou QA.

## Recibo mínimo seguro

O conteúdo completo de cápsulas, handoffs, bloqueios e transições é interno ao projeto. Para cada evento, use `write-tracker-receipt` com `--artifact-file` local e campos canônicos. O runtime calcula o hash local e constrói o único payload externo permitido: cabeçalho, `RECEIPT_VERSION`, `RUN_ID`, `ROLE`, `STATUS`, `EVENTS`, estados, próximo papel quando aplicável e `LOCAL_ARTIFACT_SHA256`.

O recibo não pode conter descrição do card, comentários, anexos, dados de negócio, caminhos locais, prompts, logs, texto de evidência, stack trace ou credenciais. O gate semântico lê o artefato local; o tracker apenas atesta a versão por hash e a sequência de estados. Isso reduz a superfície de divulgação e permite a revisão automática avaliar uma escrita pequena e determinística.

## Eventos mínimos

- `lock`: `CODEX LOCK`, `RUN_ID`, papel, estado e status;
- `capsule`: recibo de cápsula local por hash;
- `role_handoff`: recibo do papel, commit/artefato fixado localmente, veredito e hash;
- `blocker`: recibo do bloqueio local, estado preservado e hash; falha técnica usa `requires_human: false` no artefato local;
- `transition`: estado de origem, destino e referência do handoff que autorizou a mudança.

Um único comentário pode representar `role_handoff` e `transition` quando declarar ambos explicitamente. Aprovações humanas continuam sendo comentários separados e posteriores à evidência que aprovam.

## Segurança

Não inclua tokens, chaves, cookies, senhas, strings de conexão ou dados reais sensíveis. O adapter declara somente providers e o caminho relativo do arquivo externo; credenciais permanecem fora do adapter e nunca aparecem na saída do cliente.
