# Runtime de Operações v0.1

Esta versão implementa as operações centrais e os gates executáveis da esteira:

| Operação | Executável | Efeito próprio |
|---|---|---|
| `pipeline-setup` | `runtime/src/setup.mjs` | Inventário e proposta em stdout; nenhuma escrita. |
| `pipeline-doctor` | `runtime/src/doctor.mjs` | Diagnóstico somente leitura. |
| `pipeline-run` | `runtime/src/run-planner.mjs` | Plano, `RUN_ID`, lock proposto, cápsula inicial e roteamento; nenhuma aplicação direta. |
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

- `READY`: um card foi selecionado;
- `EMPTY`: não existe trabalho automático elegível;
- `BLOCKED`: contrato, doctor, execução ativa ou snapshot impedem a operação.

Quando existe execução unificada ativa, `READY` só representa retomada se `RUN_ID`, card, estado, papel, lock e cápsula permanecerem consistentes. Execução legada ativa, cápsula ausente ou divergência de estado produz `BLOCKED`.

## Política de lote v0.1

A política é `single-card-v0.1`. O planner ordena:

1. release já aprovada;
2. QA pendente;
3. implementação/review em andamento;
4. entrada de DEV;
5. UX/UI;
6. refinamento.

Dentro do mesmo estado, prevalecem posição do card e chave. Cards adicionais permanecem em `deferred`; não recebem lock nem transição.

Essa política reduz WIP e impede que uma fila nova interrompa entrega em validação. Processamento automático de lote permanece fora da v0.1 até os três pilotos controlados aprovados.

## Snapshot do tracker

O contrato está em [tracker-snapshot.schema.json](../schema/tracker-snapshot.schema.json). Ele contém somente dados normalizados necessários ao roteamento, sem descrições, anexos, credenciais ou conteúdo arbitrário.

O integrador é responsável por derivar sinais como aprovação humana, implementação concluída e espera humana a partir de evidência real. Ausência de sinal equivale a “não comprovado”, nunca a aprovação.

## Limites atuais

- O runtime possui cliente Trello determinístico, mas lê credenciais somente do provider externo declarado no adapter e nunca as incorpora ao núcleo.
- Movimentações reais foram comprovadas no Piloto A; métricas de PO e UX/UI continuam sendo consolidadas nas execuções iniciadas em `REFINAMENTO`.
- O protocolo físico de comentários e o gate executável exigem escrita + releitura antes da transição e foram comprovados nos dois projetos.
- Piloto A e Projeto Piloto B possuem adapters repo-scoped pinados no Kernel `0.1.7`, com roteamento exclusivo para `pipeline-run`.
