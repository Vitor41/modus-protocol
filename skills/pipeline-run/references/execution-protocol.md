# Protocolo de execução v0.2

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
Comentários, bloqueios e aprovações anteriores à entrada na lista atual são históricos e não participam do gate presente. A exceção é a evidência de handoff que provoca a própria transição: um handoff técnico `PASS` até quinze minutos antes da entrada na lista de destino pertence à fronteira dessa fase e materializa o próximo papel. Em UX/UI, uma nova evidência visual posterior invalida a aprovação anterior e exige nova `Tela aprovada`; uma aprovação posterior à evidência vigente libera o handoff. Um `BLOQUEIO RESOLVIDO:` posterior encerra o bloqueio de negócio correspondente. Bloqueio genérico do `pipeline-run` não vira gate humano; somente as categorias canônicas da política de autonomia podem fazê-lo.
O snapshot reconstrói o lock mais recente da lista atual. Um resultado terminal posterior do mesmo papel libera o lock; uma transição confirmada supera locks da fase anterior. Um novo gatilho respeita locks ativos externos, enquanto `--continue-run-id` pode retomar somente locks pertencentes ao próprio run.

## Sequência de escrita

1. Releitura otimista do estado oficial.
2. Validação da capacidade de comentário conforme `tracker-comment-protocol.md`.
3. Registro de lock ativo com `RUN_ID`, card, estado, papel e timestamp, seguido de releitura.
4. Registro ou atualização da cápsula, seguido de releitura.
5. Lançamento explícito e simultâneo de todos os slots independentes com modelo e esforço do planner pelo `pipeline.ps1 role-launch --manifest`. O launcher é a rota canônica, publica `<manifest>.status.json` durante a execução e só retorna depois de todos os jobs alcançarem estado terminal. Resultado `PARTIAL` preserva jobs concluídos e recupera apenas os que falharam; colaboração direta é recuperação após falha concreta do launcher e exige espera equivalente.
   O ORCHESTRATOR é o único proprietário das leituras e escritas do tracker. Cada especialista recebe no prompt/cápsula o card, comentários, anexos e sinais frescos necessários e não consulta o Trello novamente; indisponibilidade do tracker dentro do agente de papel não invalida uma cápsula confirmada pelo ORCHESTRATOR.
6. Registro do recibo de lançamento e execução do papel selecionado.
7. Publicação e releitura da evidência do gate.
8. Nova releitura do lock e do estado.
9. Transição permitida somente após comentário confirmado, ou bloqueio explícito.
10. Atualização final da cápsula e do lock, ambas relidas.
11. Novo snapshot e novo plano com `plan --tracker-snapshot <arquivo> --continue-run-id <RUN_ID atual>` após cada transição técnica confirmada.
12. Lançamento imediato do próximo papel elegível até alcançar uma condição de parada canônica.
13. Espera e consumo do resultado de todos os agentes lançados; uma resposta do orquestrador nunca encerra enquanto um job estiver `queued` ou `running`.
14. Gate de encerramento com recibo dos jobs e plano produzido por snapshot posterior ao último evento: `pipeline.ps1 run-close-gate --receipt <arquivo> --format json`.

Se qualquer escrita/releitura falhar ou o estado mudar entre 1 e 9, não presuma sucesso e não repita cegamente. Consulte o estado oficial e reconcilie antes de continuar. Leituras idempotentes usam até três tentativas totais; escrita incerta é resolvida por referência, `RUN_ID` e estado oficial, nunca por duplicação.

## Continuação automática

O gatilho drena o trabalho independente elegível, e não apenas um papel ou um card. `work_slots` declara até três lanes: PO, UX/UI e técnica. PO e UX/UI podem atuar simultaneamente com a entrega técnica; a lane técnica mantém um único papel ativo entre DEV, Code Review e QA. A chegada a `ready_for_release` libera a próxima implementação sequencial enquanto o card aguarda validação humana; uma aprovação para PRD devolve prioridade à integração Git antes de outro DEV. Quando roteado para PO, `refinement_queue` contém todos os cards elegíveis em refinamento e o mesmo agente os processa sequencialmente. Handoffs `pipeline-po → pipeline-ux-ui`, `pipeline-ux-ui → pipeline-dev`, `pipeline-dev → pipeline-code-review` e `pipeline-code-review → pipeline-qa` continuam automaticamente quando seus gates passam.

Decisão de negócio, aprovação visual, aprovação para PRD, terceiro retorno e lock externo adiam somente o `blocker.scope` declarado: `card`, `delivery_group` ou `dependency_group`. Um grupo `optimization` continua nos membros independentes; um grupo `dependency` bloqueia todos os membros; `DEPENDS ON` bloqueia apenas o grupo posterior até a conclusão terminal do anterior. A simples existência de um próximo papel nunca encerra o loop.

Quando um gate humano canônico ou o terceiro retorno bloqueia apenas um card que permanece em DEV ou QA, esse card deixa de ocupar a capacidade técnica global. O próximo card independente em `PRONTO PARA DESENVOLVER` pode usar a lane; locks ativos e estados técnicos estruturalmente inválidos continuam preservando o WIP para evitar uma segunda branch incompatível.

Delegar não conclui trabalho. O orquestrador é proprietário do ciclo de vida de cada agente lançado: deve atravessar a barreira terminal do launcher, consumir cada handoff, aplicar o gate e despachar o papel seguinte. Não existe execução “em segundo plano” que autorize devolver o controle ao usuário. Review concluído continua para QA; QA aprovado libera a próxima unidade técnica sob WIP, e QA reprovado retorna imediatamente ao DEV.

Retorno técnico de Review ou QA não é gate: `changes_required` e `rejected` materializam correção pendente e devolvem a mesma lane ao DEV. Uma transição aprovada que ficou pendente por relógio, snapshot ou releitura aparece como slot operacional e deve ser reconciliada sem repetir o papel. Role gate ou transition gate reprovado fornece `recovery.actions`; execute-as e valide novamente. Somente depois de esgotar essa autorrecuperação limitada uma falha técnica pode ser reportada; ela continua sem exigir decisão humana.

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

As duas fontes aceitas iniciam uma execução separada com configuração explícita e referência real. O launcher `role-launch` usa uma tarefa efêmera do Codex e carimba deterministicamente o recibo com o identificador retornado. Em execução ao vivo, `not_observable`, herança implícita, divergência ou fallback falham no role gate antes de qualquer transição e acionam reparo ou relançamento com a mesma configuração; não são decisão humana. Em shadow, o planner exibe apenas a configuração solicitada e não afirma que um papel foi executado.

## Roteamento canônico

| Estado | Papel inicial | Observação |
|---|---|---|
| `refinement` | `pipeline-po` | Refinar ou responder dúvida. |
| `ux_ui` | `pipeline-ux-ui` | Classificar frontend, especificar ou validar gate. |
| `ready_for_development` | `pipeline-dev` | Iniciar implementação. |
| `in_development` | `pipeline-dev` ou `pipeline-code-review` | Review somente após implementação sinalizada como concluída. |
| `ready_for_validation` | `pipeline-qa` | Validar critérios e regressão. |
| `ready_for_release` | `pipeline-dev` | Com aprovação humana válida, concluir push, PR, checks, conflitos e merge antes de mover para `ready_for_production`. |

Retorno por dúvida de negócio roteia ao PO. Reprovação de review ou QA retorna ao DEV sem criar uma coluna adicional. No terceiro retorno do mesmo loop e escopo, registrar espera humana com `blocker.kind: loop_limit` e encerrar a automação daquele card.
