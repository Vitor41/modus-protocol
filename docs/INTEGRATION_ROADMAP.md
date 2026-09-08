# Roteiro de Integração e Cutover v0.1

| Campo | Valor |
|---|---|
| Versão | `0.2.1` |
| Estado | Cutover técnico concluído nos dois projetos e rollback isolado aprovado |
| Projetos obrigatórios | Projeto Piloto A e Projeto Piloto B |

## 1. Resultado final obrigatório

Ao final da iniciativa, os dois projetos consumidores estarão conectados à mesma versão do núcleo. Quando a pessoa executar exatamente:

```text
Processe a fila do Trello.
```

no contexto do Projeto Piloto A ou do Projeto Piloto B, o roteamento deverá:

1. localizar o adaptador versionado do projeto atual;
2. validar compatibilidade com o núcleo instalado;
3. acionar `pipeline-run`;
4. acessar somente o board declarado pelo adaptador;
5. aplicar a máquina de estados, papéis, gates e Skills da nova arquitetura;
6. carregar contexto específico somente pelo adaptador;
7. recusar execução se houver ambiguidade entre arquitetura antiga e nova.

Não haverá duas esteiras operacionais competindo pelo mesmo gatilho.

## 2. Arquitetura de destino

```text
Gatilho no projeto
       ↓
AGENTS.md fino do projeto
       ↓
pipeline-run central, versão fixada
       ↓
adaptador local do projeto
       ↓
Trello + contexto + comandos + políticas locais
```

O núcleo e as Skills comuns evoluem no repositório da Esteira. Cada projeto mantém somente:

- bootstrap fino no `AGENTS.md`;
- adaptador repo-scoped;
- contexto e regras de domínio;
- referências locais exigidas pelo adaptador;
- pin da versão adotada.

Workflow, papéis e Skills comuns não devem ser copiados e editados separadamente nos projetos consumidores.

## 3. Política para a esteira legada

Após o cutover de um projeto:

- o gatilho oficial aponta somente para `pipeline-run`;
- Skills legadas deixam de ser descobríveis ou roteáveis;
- documentos antigos recebem estado `superseded` ou são movidos para área histórica;
- nenhum arquivo legado pode continuar se declarando fonte canônica da operação;
- histórico útil é preservado, sem manter autoridade concorrente;
- uma checagem automática reprova referências ativas aos roteadores antigos.

A forma física de desativação será escolhida durante a implementação. Remoção definitiva não será feita sem inventário, Git limpo quanto ao escopo e autorização explícita.

## 4. Ordem de migração

### 4.1 Projeto Piloto A

Será o primeiro projeto porque possui fila real adequada aos evals e já adota leitura progressiva, Skills por papel, `RUN_ID`, lock, cápsula e checkpoint.

Etapas:

| Etapa | Estado em 2026-08-28 |
|---|---|
| 1. Concluir tecnicamente o lote legado em andamento | Concluído até QA; validação humana pendente em `PRONTO PARA RELEASE`. |
| 2. Resolver incompatibilidades de colunas e gates | Concluído no núcleo e comprovado no replay. |
| 3. Criar e validar o adaptador | Concluído. |
| 4. Executar shadow run | Concluído; bloqueio de WIP funcionou. |
| 5. Executar piloto controlado | Parcialmente concluído como replay real de DEV/Review/QA; PO/UX/UI serão provados após o cutover. |
| 6. Aprovar retrospectiva | Concluído tecnicamente em [RETROSPECTIVE_PROJECT_A.md](RETROSPECTIVE_PROJECT_A.md). |
| 7. Realizar cutover do gatilho | Concluído. |
| 8. Provar rollback | Concluído em fixture isolada, sem tocar projeto ou board real. |

### 4.2 Projeto Piloto B

Integrado em 2026-08-28 preservando as colunas e movimentações que originaram a máquina canônica. O teste funcional completo do Piloto A foi reutilizado; no Projeto Piloto B foi executada uma prova proporcional de integração, sem criar card artificial.

Evidências do cutover:

1. `.agents`, workflow, RTK, Ponytail e UI/UX Pro Max inventariados e preservados como referências sem autoridade concorrente;
2. adapter repo-scoped pinado no Kernel compatível;
3. `AGENTS.md` direcionando o gatilho exclusivamente para `pipeline-run`;
4. board com nove listas canônicas reconhecido pela API direta;
5. comentário diagnóstico em card sanitizado gravado e relido pelo provider declarado;
6. doctor de cutover em `PASS`, sem erro ou aviso;
7. compile e suíte completa do projeto aprovados, com `76 passed`;
8. ponto Git de rollback registrado no repositório consumidor.

A observação da primeira demanda funcional futura permanece como estabilização, não como bloqueio da integração.

## 5. Cutover por projeto

O cutover é uma alteração versionada e revisável:

1. congelar o snapshot da configuração legada;
2. confirmar que não há lote ativo incompatível;
3. validar adapter, dependências e versão central;
4. executar `pipeline-doctor` sem erros bloqueantes;
5. executar o gatilho em modo shadow e comprovar o roteamento novo;
6. alterar o bootstrap canônico do projeto;
7. desativar a descoberta da esteira legada;
8. executar teste de aceitação somente leitura;
9. conferir perfil, modelo, esforço e modo do agente propostos pelo planner;
10. autorizar a primeira execução real e exigir recibo confirmado antes da transição;
11. registrar versão, resultado e ponto de rollback.

Não realizar cutover no meio de DEV, review, QA, aprovação humana ou release.

No Piloto A, os cards `PILOT-A-065` a `PILOT-A-068` permanecem em `PRONTO PARA RELEASE` aguardando validação humana. Preparação documental pode avançar, mas a virada do gatilho só ocorre depois dessa validação e por acionamento explícito dentro do projeto consumidor.

## 6. Rollback

Cada projeto mantém um ponto Git anterior ao cutover e instrução de restauração testada. O rollback deve:

- restaurar bootstrap, pin e adaptador compatíveis;
- não reverter código funcional de cards não relacionados;
- não apagar comentários, locks ou histórico do Trello;
- bloquear retomada automática se o `RUN_ID` foi criado por outra versão;
- exigir revisão humana antes de reprocessar uma unidade parcialmente executada.

Rollback não significa manter os dois roteadores ativos simultaneamente.

## 7. Evals de integração

| Eval | Verificação | Resultado obrigatório |
|---|---|---|
| `EVAL-CUTOVER-001` | Gatilho no Projeto Piloto A. | Somente `pipeline-run` + adaptador Piloto A são acionados. |
| `EVAL-CUTOVER-002` | Gatilho no Projeto Piloto B. | Somente `pipeline-run` + adapter do projeto são acionados. |
| `EVAL-CUTOVER-003` | Referência legada ainda ativa. | Doctor bloqueia e identifica a origem concorrente. |
| `EVAL-CUTOVER-004` | Versão do adapter incompatível. | Nenhum card é alterado; instrução de migração é exibida. |
| `EVAL-CUTOVER-005` | Execução iniciada antes do rollback. | Retomada automática é bloqueada até reconciliação humana. |
| `EVAL-PARITY-001` | Mesma transição nos dois projetos. | Resultado canônico igual; somente detalhes do adaptador variam. |

## 8. Critério de conclusão

A integração estará concluída somente quando:

- Projeto Piloto A e Projeto Piloto B estiverem pinados em versão compatível do mesmo núcleo;
- o gatilho oficial acionar a arquitetura nova nos dois projetos;
- nenhuma Skill ou workflow legado permanecer roteável pelo gatilho;
- os dois adapters passarem no doctor;
- os nove estados e gates funcionarem em ambos;
- um piloto real ponta a ponta tiver aprovado o Kernel e cada adapter adicional tiver prova de integração proporcional;
- paridade, atualização e rollback tiverem sido testados;
- a documentação canônica de cada projeto apontar para a esteira unificada.
