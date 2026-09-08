# Runtime de Operações v0.2

Esta versão implementa as operações centrais e os gates executáveis da esteira:

| Operação | Executável | Efeito próprio |
|---|---|---|
| `pipeline-setup` | `runtime/src/setup.mjs` | Inventário e proposta em stdout; nenhuma escrita. |
| `pipeline-doctor` | `runtime/src/doctor.mjs` | Diagnóstico somente leitura. |
| `pipeline-run` | `runtime/src/run-planner.mjs` | Plano, `RUN_ID`, lock proposto, cápsula inicial e roteamento; nenhuma aplicação direta. |
| Status de versão | `runtime/src/version-status.mjs` | Exibe runtime e origem carregados para diagnóstico manual; não participa do gatilho operacional. |
| Gate de papel | `runtime/src/role-gate.mjs` | Validação de handoff; nenhuma transição direta. |
| Gate de transição | `runtime/src/transition-gate.mjs` | Valida o recibo de comentário persistido e relido; autoriza ou nega, sem movimentar o tracker. |
| Comentários Trello | `runtime/src/trello-comments.mjs` | Lista, publica e relê comentários pelo provider `environment`, sem imprimir credenciais. |

## Pipeline Setup

O setup detecta sinais estáveis em manifests e arquivos conhecidos. Ele pode inferir linguagens, frameworks e comandos comuns, mas registra como decisão toda informação que não possa comprovar.

```text
node runtime/src/setup.mjs --project-root <projeto> --format yaml
```

O adapter candidato usa placeholders `REVIEW_REQUIRED_*` para tracker, Git e padrões ainda desconhecidos. Esses placeholders tornam a pendência visível e nunca devem ser instalados como configuração final.

## Pipeline Run Planner

O planner recebe um adapter validado e um snapshot normalizado do tracker:

```text
node runtime/src/run-planner.mjs --project-root <projeto> --tracker-snapshot <arquivo> --mode shadow --format json
```

O modo `live` exige que o doctor passe em modo `cutover`. Mesmo assim, o executável apenas produz o plano; a Skill aplica lock, cápsula, papel e transição por integrações autorizadas após reler o estado oficial.

O plano `READY` inclui `execution_request` com perfil, modelo, esforço e modo do agente. O role gate exige o recibo confirmado descrito em [EXECUTION_AUDIT.md](EXECUTION_AUDIT.md) antes de qualquer transição ao vivo.

Após handoff técnico, replaneje com `--continue-run-id <RUN_ID atual>`. A saída deve preservar `run_id` e declarar `continuing: true`; o planner não infere continuidade apenas pela coluna.

O plano também inclui `comment_gate`. Em modo live, o snapshot precisa comprovar leitura e escrita de comentários com `evidence_ref` e `verified_at`. O ORCHESTRATOR publica e relê lock, cápsula, handoff/bloqueio e transição; falha nessa confirmação preserva a coluna atual.

Imediatamente antes da movimentação, o integrador materializa um recibo conforme [tracker-transition-receipt.schema.json](../schema/tracker-transition-receipt.schema.json) e executa:

```text
node runtime/src/transition-gate.mjs --receipt <arquivo> --adapter <arquivo> --format json
```

Somente `PASS / GRANTED` autoriza a chamada de movimento. O recibo vincula comentário, `RUN_ID`, card, handoff, providers e timestamps; confirmações fora de ordem, futuras ou com mais de 15 minutos são negadas.

Status:

- `READY`: existe uma agenda em `work_slots`; `selected` é apenas o primeiro slot para compatibilidade;
- `EMPTY`: não existe trabalho automático elegível;
- `BLOCKED`: uma falha global comprovada de contrato, doctor ou snapshot impede iniciar com segurança.

Quando existe execução unificada ativa, o planner retoma diretamente se `RUN_ID`, card, estado, papel, lock e cápsula permanecerem consistentes. Se o tracker comprovar que o card já mudou de lista ou papel, a execução antiga é reconciliada: o `RUN_ID` é preservado, lock/cápsula obsoletos não prevalecem e o contexto operacional é reconstruído. Cápsula ausente não transforma uma fila atual e legível em gate humano. Execução legada ativa continua bloqueante.

## Política de lanes, fila e Delivery Groups v0.2

O planner mantém até três capacidades independentes:

- uma execução de PO que esgota sequencialmente todos os cards elegíveis em refinamento;
- uma execução de UX/UI;
- uma unidade técnica com WIP igual a um, cobrindo entrada em DEV, implementação, Code Review, QA e release.

Quando as três capacidades possuem trabalho elegível, `work_slots` contém as três e o orquestrador deve lançá-las antes de aguardar resultados. A lane técnica prioriza:

1. release já aprovada;
2. QA pendente;
3. implementação/review em andamento;
4. entrada de DEV;
5. nenhuma nova entrega técnica enquanto existir uma unidade em andamento ou aguardando aprovação para PRD.

Dentro do mesmo estado, prevalecem posição do card e chave. Quando a rota selecionada é `pipeline-po`, o plano entrega uma `refinement_queue` com todos os cards elegíveis em `REFINAMENTO`: o PO precisa normalizar, refinar, rotular e decidir grupos para a fila inteira antes de devolver o controle.

Depois disso, o orquestrador drena o trabalho independente na mesma execução. Um gate humano ou falha localizada vira `blocked` com escopo explícito, mas não encerra as outras lanes. Uma nova entrega em `PRONTO PARA DESENVOLVER` só começa quando a unidade técnica anterior sai do fluxo automatizado, evitando branches funcionais simultâneas.

Quando colaboração não estiver exposta, o launcher recebe um manifest de até três jobs:

```text
pipeline.ps1 role-launch --project-root <projeto> --manifest <arquivo-json> --format json
```

Cada job declara `lane`, `role`, `promptFile`, `executionRequest` e `handoff`. O launcher inicia todos em paralelo e devolve um recibo individual com o ID real de cada tarefa.

`DELIVERY GROUP` é declarado somente pelo PO e pode ser:

- `optimization`: compartilha esforço técnico quando conveniente, sem criar dependência. Um card bloqueado não interrompe os demais membros.
- `dependency`: representa uma premissa determinante. Um bloqueio em qualquer membro bloqueia todos os membros do grupo.

`DEPENDS ON` declara precedência entre grupos; o grupo posterior espera a conclusão terminal de todos os membros do anterior. O planner só agrega para a mesma execução os membros que estão na mesma rota e estado, preservando o avanço individual quando a semântica for `optimization`.

## Snapshot do tracker

O contrato está em [tracker-snapshot.schema.json](../schema/tracker-snapshot.schema.json). Ele contém somente dados normalizados necessários ao roteamento, sem descrições, anexos, credenciais ou conteúdo arbitrário. Quando necessário para resolver precedência, inclui `delivery_groups` e membros terminais do grupo, sem executar leitura completa de comentários do board.

O integrador deriva sinais da lista atual e dos eventos válidos nessa fase. Para cada card acionável, lê histórico de movimentação, comentários e anexos; registra a lista e o horário observados. Bloqueios de fases anteriores são ignorados. O handoff que provoca uma transição pertence à fronteira da nova fase por uma janela máxima de quinze minutos; assim, `pipeline-dev PASS` seguido da entrada em desenvolvimento materializa `implementation_complete` e conduz ao Review. Uma nova evidência visual invalida aprovação visual anterior; `BLOQUEIO RESOLVIDO:` posterior encerra a espera de regra. Ausência de sinal equivale a “não comprovado”, nunca a aprovação.

Um handoff concluído que declara transição mas permanece na lista de origem materializa `pending_transition`. O planner emite um slot operacional que relê o comentário e retoma somente gate e movimento, sem consumir outro agente de papel. O gate aceita até cinco segundos de diferença de relógio entre o timestamp do Trello e o do host; a confirmação causal e o hash continuam obrigatórios. Review `changes_required` e QA `rejected` são retornos automáticos ao DEV, não bloqueios.

## Limites atuais

- O runtime possui cliente Trello determinístico, mas lê credenciais somente do provider externo declarado no adapter e nunca as incorpora ao núcleo.
- Movimentações reais foram comprovadas no Piloto A; métricas de PO e UX/UI continuam sendo consolidadas nas execuções iniciadas em `REFINAMENTO`.
- O protocolo físico de comentários e o gate executável exigem escrita + releitura antes da transição e foram comprovados nos dois projetos.
- Piloto A e Projeto Piloto B possuem adapters repo-scoped, com roteamento exclusivo para `pipeline-run`; uma atualização do plugin passa a ser a fonte única do runtime em ambos.
