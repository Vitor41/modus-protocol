# Contrato da proposta de setup

A saída usa `contract_version: "0.1"` e contém:

- `status`: `REVIEW_REQUIRED` enquanto existir decisão não comprovada;
- `inventory.evidence`: nomes dos arquivos que sustentaram inferências;
- `decisions`: código, caminho e pergunta que exigem confirmação;
- `adapter_candidate`: rascunho estruturalmente compatível com o schema;
- `guarantees`: comprovação das fronteiras somente leitura.

Decisões mínimas que normalmente permanecem humanas ou dependem de integração:

| Código | Decisão |
|---|---|
| `TRACKER_MAPPING_REQUIRED` | Board e nove listas canônicas. |
| `CARD_KEY_PATTERN_REQUIRED` | Padrões estáveis de feature e bug. |
| `COMMANDS_UNRESOLVED` | Baseline, teste direcionado e regressão. |
| `COMMAND_CAPABILITIES_REVIEW_REQUIRED` | Confirmação de que comandos inferidos cobrem capacidades distintas. |
| `GIT_POLICY_REVIEW_REQUIRED` | Branch padrão e padrões de branch do projeto. |
| `AGENTS_MISSING` | Bootstrap fino que será criado somente na instalação. |
| `CONTEXT_INDEX_MISSING` | Índice de contexto progressivo do projeto. |

Uma proposta só pode avançar quando:

1. placeholders forem resolvidos;
2. o adapter passar no `pipeline-doctor`;
3. comandos e caminhos forem revisados;
4. a versão do Kernel estiver pinada;
5. a pessoa autorizar a gravação no projeto consumidor.
