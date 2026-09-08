# Protocolo de execução v0.1

Leia esta referência somente para execução ao vivo, retomada ou transição.

## Snapshot mínimo

O snapshot normalizado contém:

- `board_ref`;
- `open_lists[]` com `ref` e `position`;
- `cards[]` com `ref`, `title`, `list_ref` e `position`; `key` pode faltar somente em `refinement`, onde será normalizada pelo PO;
- por card, quando aplicável: `signals`, `loop_counts`, `lock` e `delivery_group`;
- `delivery_groups[]` quando houver grupos ou dependências, inclusive membros em estados terminais necessários para resolver precedência;
- `active_execution` quando existir lote em andamento no projeto.
- `integration.comments` com leitura, escrita e referência do teste observadas.
- `integration.comments.observation` com horário e referências de todos os cards acionáveis relidos naquela captura;
- por card acionável, `signals.observed_list_ref` e `signals.observed_at`, comprovando que os sinais pertencem à lista atual.

Sinais são derivados de evidências reais pelo adaptador/integrador. Ausência de sinal nunca equivale a aprovação.
Comentários, bloqueios e aprovações anteriores à entrada na lista atual são históricos e não participam do gate presente. Em UX/UI, uma nova evidência visual posterior invalida a aprovação anterior e exige nova `Tela aprovada`; uma aprovação posterior à evidência vigente libera o handoff. Um `BLOQUEIO RESOLVIDO:` posterior encerra o bloqueio de negócio correspondente. O planner rejeita execução ao vivo quando a cobertura não coincide exatamente com todos os cards acionáveis ou quando os sinais não comprovam a lista observada.

## Sequência de escrita

1. Releitura otimista do estado oficial.
2. Validação da capacidade de comentário conforme `tracker-comment-protocol.md`.
3. Registro de lock ativo com `RUN_ID`, card, estado, papel e timestamp, seguido de releitura.
4. Registro ou atualização da cápsula, seguido de releitura.
5. Lançamento explícito do agente de papel com modelo e esforço do planner pela colaboração da conversa ou pelo `pipeline.ps1 role-launch` quando aquela capacidade não estiver exposta.
6. Registro do recibo de lançamento e execução do papel selecionado.
7. Publicação e releitura da evidência do gate.
8. Nova releitura do lock e do estado.
9. Transição permitida somente após comentário confirmado, ou bloqueio explícito.
10. Atualização final da cápsula e do lock, ambas relidas.
11. Novo snapshot e novo plano com `plan --tracker-snapshot <arquivo> --continue-run-id <RUN_ID atual>` após cada transição técnica confirmada.
12. Lançamento imediato do próximo papel elegível até alcançar uma condição de parada canônica.

Se qualquer escrita/releitura falhar ou o estado mudar entre 1 e 9, não presuma sucesso e não repita cegamente. Consulte o estado oficial e reconcilie antes de continuar.

## Continuação automática

O gatilho drena o trabalho independente elegível, e não apenas um papel ou um card. Quando roteado para PO, `refinement_queue` contém todos os cards elegíveis em refinamento e o PO os refina antes de devolver o controle. Handoffs `pipeline-po → pipeline-ux-ui`, `pipeline-ux-ui → pipeline-dev`, `pipeline-dev → pipeline-code-review` e `pipeline-code-review → pipeline-qa` continuam automaticamente no mesmo loop quando seus gates passam. Retornos de Review ou QA ao DEV também continuam, respeitando o limite de ciclos.

Decisão de negócio, aprovação visual, aprovação para PRD, terceiro retorno e lock externo adiam somente o `blocker.scope` declarado: `card`, `delivery_group` ou `dependency_group`. Um grupo `optimization` continua nos membros independentes; um grupo `dependency` bloqueia todos os membros; `DEPENDS ON` bloqueia apenas o grupo posterior até a conclusão terminal do anterior. A simples existência de um próximo papel nunca encerra o loop.

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

A cápsula reduz releitura do domínio, mas não substitui card, lista, diff, teste, gate humano ou evidência atual. Se cápsula, lock ou execução ativa descreverem uma fase anterior à lista confirmada, preserve o `RUN_ID`, descarte a conclusão obsoleta e reconstrua a continuidade a partir do tracker fresco. Essa reconciliação não é gate humano.

## Recibo de execução

O planner resolve o perfil semântico antes de qualquer escrita. O ORCHESTRATOR deve repassar ao agente de papel, como parâmetros explícitos, `execution_request.model` e `execution_request.reasoning_effort`.

O ORCHESTRATOR substitui qualquer valor proposto pelo papel: copia o `execution_request` do plano em `execution.request` e carimba `execution.observation` a partir da chamada real de lançamento; o papel não pode autodeclarar sua configuração. A evidência usa `agent:<id-real-retornado>`, nunca placeholder. O recibo registra:

- modelo e esforço aceitos no lançamento;
- fonte `explicit-agent-launch` ou `explicit-codex-exec`, conforme a rota efetivamente usada;
- referência do agente ou da operação que comprova o lançamento;
- `fallback_used: false`.

Uso de tokens e horários entram em `execution.usage` somente quando o ambiente os expuser. Ausência de telemetria deve ser registrada como `not_observable`, nunca estimada.

As duas fontes aceitas iniciam uma execução separada com configuração explícita e referência real. O launcher `role-launch` usa uma tarefa efêmera do Codex e carimba deterministicamente o recibo com o identificador retornado. Em execução ao vivo, `not_observable`, herança implícita, divergência ou fallback falham no role gate antes de qualquer transição. Em shadow, o planner exibe apenas a configuração solicitada e não afirma que um papel foi executado.

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
