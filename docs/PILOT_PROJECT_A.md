# Piloto Controlado — Projeto Piloto A

> Registro histórico anonimizado. Os estados pendentes descritos abaixo representam o momento do replay; o cutover técnico foi concluído posteriormente.

| Campo | Valor |
|---|---|
| Versão | `0.1.4` |
| Estado | Replay técnico aprovado em Review e QA; validação humana e cutover pendentes |
| Snapshot observado | 2026-08-28 |
| Tracker | Trello, shadow somente leitura e movimentações autorizadas no replay |

## 1. Objetivo

Usar atividades reais do Projeto Piloto A para validar o adaptador, o novo papel de UX/UI, o roteamento de especialistas, a qualidade do DEV e o custo de contexto antes de migrar o projeto para a esteira unificada.

O piloto não começa alterando todo o projeto. Primeiro prova compatibilidade em shadow run; depois executa um único card autorizado; por fim compara os resultados com a esteira atual.

## 2. Estado observado

### 2.1 Board

O board contém exatamente os nove estados canônicos abertos na ordem correta, incluindo a nova coluna `UX/UI`. A antiga coluna `REPROVADOS`, detectada no primeiro snapshot, foi arquivada pela gestão em 2026-08-28.

Na fila de `REFINAMENTO` foram observadas três demandas:

1. `demanda financeira de referência`;
2. `Melhorar componente de select de ANO`;
3. `Alguns pdf de extrato tem senha.`

`UX/UI`, `PRONTO PARA DESENVOLVER` e `EM DESENVOLVIMENTO` estavam vazias no snapshot.

### 2.2 Execução em andamento

Os cards `PILOT-A-065`, `PILOT-A-066`, `PILOT-A-067` e `PILOT-A-068` foram retomados sob autorização explícita, passaram por Code Review e QA independentes e estão em `PRONTO PARA RELEASE`, aguardando validação humana. O repositório permanece na branch `branch privada do piloto`, no commit fixado `commit privado registrado`, com os arquivos preexistentes não rastreados preservados.

Pelo workflow, nenhum release, PRD ou novo lote automático deve começar enquanto a branch candidata permanece reservada à validação humana. Os cards já existentes em `REFINAMENTO` serão usados somente quando a pessoa responsável iniciar o cutover e o primeiro run no próprio Piloto A.

### 2.3 Divergências de contrato

| Área | Board atual | Documentação/Skills atuais | Resultado esperado do doctor |
|---|---|---|---|
| UX/UI | Coluna existe. | Fluxo ainda declara `PO → DEV → QA`; não há papel nem Skill de UX/UI. | Bloqueio de compatibilidade. |
| Estados | Nove estados canônicos existem. | Workflow lista somente oito e pula UX/UI. | Solicitar atualização versionada. |
| Transição do PO | Deve passar por UX/UI quando houver frontend. | PO move diretamente para `PRONTO PARA DESENVOLVER`. | Impedir execução ao vivo. |
| Gate visual | `Tela aprovada` é exigido pelo núcleo. | Não está definido no Piloto A. | Exigir regra de autoria e validade. |
| Code Review | Gate lógico obrigatório. | Não existe como papel separado no Piloto A. | Exigir integração antes do DEV ao vivo. |

Essas divergências são o primeiro caso real de `EVAL-CONTRACT-001`.

### 2.4 Resultado do primeiro shadow

Em 2026-08-28 foi criado, sob autorização, o adapter repo-scoped `.pipeline/project.adapter.yaml`, pinado no Kernel `0.1.1`. O adapter passou na validação estrutural e o snapshot somente leitura confirmou as nove listas na ordem canônica.

Antes do cutover, o pin deve ser atualizado de `0.1.1` para `0.1.4` para habilitar a auditoria obrigatória de modelo/esforço, o gate físico de comentários e o cliente Trello via `environment`. A atualização foi autorizada como preparação do teste de cutover.

O doctor reportou `LEGACY_ROUTER_CONFLICT` e `UNIFIED_ROUTER_PENDING` como avisos de preparação. O planner encerrou com `BLOCKED / LEGACY_EXECUTION_ACTIVE` por causa do lote `PILOT-A-20260826-001`, sem executar papel, comando do projeto ou escrita no tracker. O snapshot temporário foi removido após o teste.

## 3. Casos reais selecionados

### 3.1 Candidato A — demanda financeira de referência

**Recomendação:** primeiro piloto ponta a ponta, depois de satisfeitas as precondições.

Por que é adequado:

- exige refinamento de uma demanda curta e ainda sem chave/labels normalizadas;
- possui impacto visual claro e deve passar por `UX/UI`;
- troca formulário embutido por modal e exige estados, foco, teclado, responsividade e feedback;
- contém regra funcional: o seletor de usuário deve mostrar somente participantes;
- atravessa template, rota, validação backend e testes, formando uma fatia vertical controlável;
- permite avaliar se o DEV Full Stack mantém responsabilidade sem carregar especialistas permanentes.

Roteamento esperado:

```text
pipeline-po
  -> pipeline-ux-ui
  -> gate humano "Tela aprovada"
  -> pipeline-dev
  -> pipeline-code-review
  -> pipeline-qa
  -> PRONTO PARA RELEASE
```

O refinamento deve decidir se `Gastos da Casa` e `Outros Gastos` pertencem ao mesmo card/lote e confirmar permissões, participantes elegíveis e comportamento de edição. O PO não deve inventar essas regras.

### 3.2 Candidato B — Melhorar componente de select de ANO

**Uso:** eval de discovery, refinamento e bloqueio correto.

A demanda pede inventário de todos os selects e decisão individual entre anos futuros e históricos. A saída inicial correta não é editar todos os componentes. O PO deve:

- localizar cada ocorrência relevante;
- classificar criação/planejamento versus filtro/histórico;
- preservar anos passados onde necessários;
- propor uma matriz de decisão;
- solicitar decisão humana para ocorrências ambíguas;
- impedir implementação ampla antes dessa aprovação.

Esse caso avalia `pipeline-po`, `pipeline-context`, busca antes de leitura extensa e controle de escopo. Pode se tornar um piloto mecânico posterior quando a matriz estiver aprovada.

### 3.3 Candidato C — Alguns pdf de extrato tem senha

**Uso:** eval de segurança, importação e especialização sob demanda.

O caso deve acionar apoio de segurança e importações sem transferir a propriedade do card. O refinamento precisa definir:

- detecção inequívoca de PDF criptografado;
- solicitação condicional da senha;
- ciclo de vida exclusivamente efêmero;
- proibição de log, persistência, auditoria ou capsule contendo a senha;
- mensagens para senha ausente ou incorreta;
- limpeza de arquivo e memória transitória;
- escopo restrito a PDF neste ciclo;
- testes com arquivos protegidos e não protegidos.

Perfil esperado: `PROFUNDO` no refinamento e no review; DEV começa em `EQUILIBRADO` e escala somente diante de falha difícil ou risco comprovado.

### 3.4 Replay executado — PILOT-A-065 a PILOT-A-068

Após autorização explícita, a nova esteira retomou o lote para testar o loop de DEV, Code Review e QA. O limite de três retornos bloqueou corretamente a automação, a decisão humana preservou o legado sem inventar configuração histórica, e o run foi retomado até aprovação independente.

Resultados finais:

- commit fixado `commit privado registrado`;
- quatro retornos de Review antes da aprovação final;
- 7 achados altos e 3 médios registrados e resolvidos;
- 54 testes focais e 224 testes completos aprovados;
- QA aprovado na primeira passagem;
- migrations geradas apenas offline;
- nenhuma alteração em PRD ou banco persistente;
- cards movidos pelas colunas canônicas até `PRONTO PARA RELEASE`.

A retrospectiva completa está em [RETROSPECTIVE_PROJECT_A.md](RETROSPECTIVE_PROJECT_A.md).

## 4. Fases do piloto

### Fase 0 — Compatibilidade

1. Concluir ou encerrar corretamente o lote atual `PILOT-A-065`–`PILOT-A-068`.
2. Preservar e classificar as alterações preexistentes do repositório.
3. Atualizar o contrato local para incluir `UX/UI`, Code Review e gates.
4. Criar e validar o adaptador do Piloto A.
5. Demonstrar que a versão anterior pode ser restaurada.

Nenhum card da nova fila é movimentado nesta fase.

### Fase 1 — Shadow run

Executar leitura e planejamento dos três candidatos sem escrita externa. Comparar:

- ordem de prioridade;
- papel e perfil escolhidos;
- contexto carregado;
- decisões, bloqueios e especializações;
- transições propostas;
- tokens e tempo;
- qualidade dos artefatos de PO e UX/UI.

O shadow run precisa reprovar a tentativa de pular a nova coluna `UX/UI`.

### Fase 2 — Um card real

Após autorização explícita, executar somente o Candidato A. Lote automático e processamento dos demais cards ficam desligados. Cada gate produz evidência e permite interrupção.

Critérios adicionais:

- zero alteração fora do card;
- zero perda das mudanças preexistentes;
- aprovação humana de UX/UI antes do DEV;
- Code Review separado do DEV;
- QA sobre commit fixado;
- nenhum push, PR ou merge antes de `APROVADO PARA PRD`;
- relatório de métricas por papel.

### Fase 3 — Expansão controlada

Se o Candidato A for promovido, usar o Candidato B para um caso mecânico refinado e o Candidato C para risco de segurança. O processamento automático de lote só será considerado após três execuções aprovadas sem violação rígida.

### Fase 4 — Cutover do Projeto Piloto A

Depois da aprovação dos evals e do piloto, substituir o roteamento legado pelo bootstrap da esteira unificada. O gatilho `Processe a fila do Trello.` deverá acionar exclusivamente `pipeline-run` com o adaptador do Piloto A. A aceitação e o rollback seguem [INTEGRATION_ROADMAP.md](INTEGRATION_ROADMAP.md).

O cutover será iniciado manualmente pela pessoa responsável dentro do Projeto Piloto A. Os cards já existentes em `REFINAMENTO` servirão como teste real de acionamento de `pipeline-run`, adapter, PO e UX/UI.

## 5. Baseline de comparação

A esteira atual do Piloto A já fornece baseline valioso:

- AGENTS enxuto e leitura progressiva;
- uma Skill ativa por papel;
- `RUN_ID`, lock e cápsula de contexto;
- checkpoint pré-implementação;
- QA com evidência por critério;
- limites de timeout e lifecycle local;
- preservação financeira, histórica e de permissões.

O piloto deve provar ganho principalmente em:

- inclusão disciplinada de UX/UI;
- Code Review independente;
- menos devoluções ao DEV;
- melhor escolha de perfil;
- especialização sem handoff excessivo;
- menor consumo de contexto;
- detecção automática de incompatibilidade entre board e documentos.

## 6. Critério de sucesso

O piloto completo do Piloto A é aprovado quando:

- `EVAL-CONTRACT-001` detecta todas as divergências conhecidas;
- o shadow run dos três cards passa em todos os gates rígidos;
- o Candidato A chega a `PRONTO PARA RELEASE` sem pular papel ou gate;
- pontuação ponta a ponta é pelo menos `85` e nenhuma dimensão fica abaixo de `70`;
- não ocorre defeito crítico ou alto escapado;
- o humano não precisa devolver a entrega por erro básico de implementação;
- tokens e tempo são medidos por papel, sem estimativas inventadas;
- perfil, modelo, esforço e recibo confirmado são exibidos por papel; herança ou fallback bloqueiam o gate;
- o teste de cutover comprova que o gatilho não pode acionar a arquitetura legada;
- uma retrospectiva define manter, ajustar ou reverter cada mudança da esteira.

O replay técnico já aprovou Review, QA, loop, WIP e preservação do legado. A pontuação ponta a ponta não foi atribuída porque PO/UX/UI não participaram desse replay e tokens/tempo não foram mensuráveis. Esses itens permanecem no teste de cutover.

## 7. Gates ainda pendentes

- validação humana visual e funcional de `PILOT-A-065` a `PILOT-A-068`;
- acionamento manual do cutover dentro do Piloto A;
- alteração versionada do bootstrap e desativação do roteador legado;
- doctor em modo `cutover`, teste do gatilho e prova de rollback;
- primeiro card iniciado em `REFINAMENTO` para validar PO e UX/UI ao vivo.

Continuam não autorizados push, PR, merge, release, deploy, acesso a PRD ou processamento automático da fila inteira.
