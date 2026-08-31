# Protocolo de execução v0.1

Leia esta referência somente para execução ao vivo, retomada ou transição.

## Snapshot mínimo

O snapshot normalizado contém:

- `board_ref`;
- `open_lists[]` com `ref` e `position`;
- `cards[]` com `ref`, `title`, `list_ref` e `position`; `key` pode faltar somente em `refinement`, onde será normalizada pelo PO;
- por card, quando aplicável: `signals`, `loop_counts` e `lock`;
- `active_execution` quando existir lote em andamento no projeto.
- `integration.comments` com leitura, escrita e referência do teste observadas.

Sinais são derivados de evidências reais pelo adaptador/integrador. Ausência de sinal nunca equivale a aprovação.

## Sequência de escrita

1. Releitura otimista do estado oficial.
2. Validação da capacidade de comentário conforme `tracker-comment-protocol.md`.
3. Registro de lock ativo com `RUN_ID`, card, estado, papel e timestamp, seguido de releitura.
4. Registro ou atualização da cápsula, seguido de releitura.
5. Lançamento explícito do agente de papel com modelo e esforço do planner.
6. Registro do recibo de lançamento e execução do papel selecionado.
7. Publicação e releitura da evidência do gate.
8. Nova releitura do lock e do estado.
9. Transição permitida somente após comentário confirmado, ou bloqueio explícito.
10. Atualização final da cápsula e do lock, ambas relidas.

Se qualquer escrita/releitura falhar ou o estado mudar entre 1 e 9, não presuma sucesso e não repita cegamente. Consulte o estado oficial e reconcilie antes de continuar.

## Cápsula mínima

- `run_id`;
- card ou lote;
- estado e papel;
- objetivo;
- decisões e regras confirmadas;
- evidências produzidas;
- riscos e bloqueios;
- próximo passo;
- fontes consultadas.

A cápsula reduz releitura, mas não substitui card, diff, teste, gate humano ou evidência atual.

## Recibo de execução

O planner resolve o perfil semântico antes de qualquer escrita. O ORCHESTRATOR deve repassar ao agente de papel, como parâmetros explícitos, `execution_request.model` e `execution_request.reasoning_effort`.

O ORCHESTRATOR copia a solicitação em `execution.request` e carimba `execution.observation` a partir da chamada de lançamento; o papel não pode autodeclarar sua configuração. O recibo registra:

- modelo e esforço aceitos no lançamento;
- fonte `explicit-agent-launch`;
- referência do agente ou da operação que comprova o lançamento;
- `fallback_used: false`.

Uso de tokens e horários entram em `execution.usage` somente quando o ambiente os expuser. Ausência de telemetria deve ser registrada como `not_observable`, nunca estimada.

Em execução ao vivo, `not_observable`, herança implícita, divergência ou fallback falham no role gate antes de qualquer transição. Em shadow, o planner exibe apenas a configuração solicitada e não afirma que um papel foi executado.

## Roteamento canônico

| Estado | Papel inicial | Observação |
|---|---|---|
| `refinement` | `pipeline-po` | Refinar ou responder dúvida. |
| `ux_ui` | `pipeline-ux-ui` | Classificar frontend, especificar ou validar gate. |
| `ready_for_development` | `pipeline-dev` | Iniciar implementação. |
| `in_development` | `pipeline-dev` ou `pipeline-code-review` | Review somente após implementação sinalizada como concluída. |
| `ready_for_validation` | `pipeline-qa` | Validar critérios e regressão. |
| `ready_for_release` | `pipeline-dev` | Com aprovação humana válida, concluir push, PR, checks, conflitos e merge antes de mover para `ready_for_production`. |

Retorno por dúvida de negócio roteia ao PO. Reprovação de review ou QA retorna ao DEV sem criar uma coluna adicional. No terceiro retorno do mesmo loop e escopo, registrar espera humana e encerrar a automação daquele card.
