# Contrato de diagnósticos

O resultado JSON usa `contract_version: "0.1"` e contém `tool`, `mode`, `target`, `status`, `summary` e `diagnostics`.

Severidades:

- `error`: impede o modo solicitado;
- `warning`: não impede shadow run, mas requer atenção;
- `info`: evidência complementar.

Diagnósticos principais:

| Código | Significado | Conduta |
|---|---|---|
| `ADAPTER_OUTSIDE_PROJECT` | O adapter não pertence à raiz informada. | Usar o adapter repo-scoped do projeto. |
| `ADAPTER_LOCATION_NONCANONICAL` | O cutover não usa `.pipeline/project.adapter.yaml`. | Mover/versionar o adapter canônico antes do cutover. |
| `ADAPTER_SCHEMA_INVALID` | O adapter viola o schema canônico. | Corrigir o contrato antes de continuar. |
| `INLINE_SECRET_KEY` | Há uma chave com aparência de segredo embutido. | Migrar o segredo para provedor externo sem expor o valor. |
| `KERNEL_VERSION_MISMATCH` | A versão fixada difere do runtime. | Instalar a versão exata ou executar migração explícita. |
| `REQUIRED_CONTEXT_MISSING` | Um contexto obrigatório não existe. | Criar ou corrigir a referência. |
| `OPTIONAL_CONTEXT_MISSING` | Um contexto opcional não existe. | Registrar como aviso; não bloqueia shadow. |
| `TRACKER_CREDENTIAL_PATH_OUTSIDE_PROJECT` | O arquivo externo de credenciais escaparia da raiz. | Corrigir para caminho relativo contido no projeto. |
| `TRACKER_CREDENTIAL_FILE_MISSING` | O provider `environment` não possui o arquivo local declarado. | Provisionar o arquivo sem versionar seus valores. |
| `TRACKER_NOT_CHECKED` | Não houve snapshot do tracker. | Consultar o board em modo somente leitura. Em cutover, bloqueia. |
| `TRACKER_STATE_REF_DUPLICATE` | Dois estados apontam para a mesma lista. | Corrigir o mapeamento após revisão humana. |
| `TRACKER_STATE_ORDER_MISMATCH` | Listas abertas ou ordem divergem do adapter. | Alinhar board e adapter antes do cutover. |
| `UNIFIED_ROUTER_PENDING` | Em shadow, o gatilho ainda não aponta para `$pipeline-run`. | Preparar a rota unificada sem antecipar o cutover. |
| `UNIFIED_ROUTER_MISSING` | No cutover, o gatilho não aponta para `$pipeline-run`. | Bloquear e instalar a rota unificada exclusiva. |
| `LEGACY_ROUTER_CONFLICT` | O gatilho ainda referencia outra Skill próxima. | Tratar como aviso em shadow e remover a concorrência somente no cutover aprovado. |
| `MULTIPLE_PROJECT_ADAPTERS` | Há mais de um adapter candidato. | Manter uma única fonte ativa. |

O doctor nunca imprime valores de chaves identificadas como sensíveis e nunca executa os comandos declarados no adapter.
