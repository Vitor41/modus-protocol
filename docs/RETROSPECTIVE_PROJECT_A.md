# Retrospectiva do Piloto Técnico — Projeto Piloto A

> Registro histórico anonimizado. As pendências descritas abaixo representam o encerramento do replay; o cutover técnico foi concluído posteriormente.

| Campo | Valor |
|---|---|
| Versão | `0.1.0` |
| Data | 2026-08-28 |
| Run unificado | `RUN-SANITIZED-PILOT-A` |
| Escopo | Replay e continuação controlada de `PILOT-A-065` a `PILOT-A-068` |
| Commit fixado | `commit privado registrado` |
| Estado final | Code Review e QA aprovados; cards em `PRONTO PARA RELEASE`; validação humana pendente |

## 1. Resultado

O piloto técnico comprovou a parte mais sensível do loop novo sobre uma entrega financeira real: retorno ao DEV, Code Review independente, limite de três retornos, intervenção humana, retomada, QA independente e movimentações canônicas do Trello.

O lote não foi promovido a produção, não executou deploy, não aplicou migration no banco local persistente e não acessou PRD. Três arquivos locais preexistentes e não rastreados permaneceram intactos.

Este caso foi um replay com correções autorizadas, não um piloto ponta a ponta iniciado em `REFINAMENTO`. Portanto, ele valida DEV, Review, QA, gates e compatibilidade legada, mas não é evidência suficiente para declarar PO e UX/UI aprovados ao vivo. Essas etapas serão verificadas na primeira execução iniciada manualmente depois do cutover.

## 2. Linha do tempo observada

| Passagem | Candidato | Resultado | Consequência |
|---|---|---|---|
| Review 1 | `commit privado registrado` | Retorno | Proteção de competência fechada e deduplicação final foram corrigidas. |
| Review 2 | `commit privado registrado` | Retorno independente | Vigência temporal, auditoria, classificação de parcelas, concorrência e allowlist foram reforçadas. |
| Review 3 | `commit privado registrado` | Retorno independente e bloqueio humano | O limite de três retornos interrompeu corretamente o quarto ciclo automático. |
| Decisão humana | — | `BLOQUEIO RESOLVIDO` | Foi aprovada a política conservadora: legado permanece legado; futuro usa configuração confirmada. |
| Review 4 | `commit privado registrado` | Retorno independente | O upgrade normal sem participantes/regras novas revelou ausência de marcador inequívoco para núcleos legados. |
| Review 5 | `commit privado registrado` | Aprovado independente | Nenhum achado permaneceu aberto. |
| QA | `commit privado registrado` | Aprovado independente | Lote avançou de `PRONTO PARA VALIDAÇÃO` para `PRONTO PARA RELEASE`. |

## 3. Métricas observadas

| Métrica | Resultado | Observação |
|---|---:|---|
| Cards no lote | 4 | `PILOT-A-065` a `PILOT-A-068`. |
| Passagens de Code Review | 5 | Quatro retornos e uma aprovação final; uma retomada ocorreu após decisão humana. |
| Achados registrados antes da aprovação | 7 altos; 3 médios | Todos foram resolvidos antes do QA; nenhum escapou como conhecido. |
| Aprovação do Review na primeira passagem | Não | A primeira passagem encontrou riscos financeiros e de concorrência relevantes. |
| Ciclos de QA | 1 | QA aprovado na primeira passagem sobre commit fixado. |
| Testes automatizados no baseline | 208 | Contagem observada no início do replay. |
| Testes automatizados finais | 224 | Dezesseis testes líquidos adicionados. |
| Suíte focal final | 54/54 | Migração, onboarding, consolidação e importação. |
| Regressão final | 224/224 | Reproduzida pelo DEV, Review e QA. |
| Intervenções humanas bloqueantes | 1 | Exigida corretamente pelo terceiro retorno. |
| Retorno do QA ao DEV | 0 | Nenhum defeito funcional bloqueador foi encontrado pelo QA. |
| Alterações conhecidas fora do escopo | 0 | Arquivos preexistentes do usuário foram preservados. |
| Migrações aplicadas em banco persistente ou PRD | 0 | Upgrade e downgrade foram gerados somente offline. |
| Tokens/créditos por papel | Não mensurável | A plataforma não expôs telemetria confiável por papel neste run. |
| Tempo por papel | Não mensurável | Não foi registrada telemetria estruturada; nenhum valor será estimado. |
| Pontuação global da rubrica | Não atribuída | Refinamento e UX/UI não foram executados pela esteira neste replay. |

## 4. Evals reais

| Eval | Resultado | Evidência |
|---|---|---|
| `EVAL-CONTRACT-001` | Aprovado no shadow | Nove listas reconhecidas; conflito legado detectado; lote ativo bloqueou apropriação. |
| `EVAL-RUN-WIP-001` | Aprovado | A fila nova não foi iniciada enquanto o lote em andamento precisava ser preservado. |
| `EVAL-REVIEW-001` | Aprovado | Review separado encontrou falhas de especificação, migração, segurança transacional e compatibilidade. |
| `EVAL-QA-001` | Aprovado | QA independente executou matriz funcional e regressão sobre commit fixado. |
| `EVAL-LOOP-001` | Aprovado | Terceiro retorno interrompeu automação e exigiu decisão humana antes da retomada. |
| `EVAL-CONTEXT-001` | Parcial | Cápsula e delta foram reutilizados, mas economia de tokens não pôde ser quantificada. |
| `EVAL-CUTOVER-001` | Pendente | Será executado manualmente dentro do Projeto Piloto A após a validação humana do lote. |
| PO/UX ponta a ponta | Pendente | Será comprovado pelos cards que aguardam em `REFINAMENTO` após o cutover. |

## 5. Decisões da retrospectiva

### Manter

- um DEV Full Stack como responsável ponta a ponta;
- especialistas de backend, banco, frontend, BI/dados e segurança acionados sob demanda;
- Code Review e QA executados por agentes diferentes do implementador;
- commit fixado entre Review, QA e validação humana;
- limite de três retornos com intervenção humana obrigatória;
- cards em `PRONTO PARA RELEASE` como espera pela validação humana;
- migrations de alto risco validadas offline antes de qualquer banco persistente.

O replay foi predominantemente backend e banco. Ele apoia manter o Full Stack como dono da entrega, mas não justifica eliminar especialistas nem prova que frontend ou BI nunca precisarão de execução separada.

### Ajustar

- exigir cenário de upgrade a partir do schema realmente existente, não apenas estado já preparado pela branch;
- tratar compatibilidade legada por origem explícita, sem inferir modo, pagador ou participantes históricos;
- incluir concorrência same-batch e cross-batch na matriz padrão de importações;
- usar o conector oficial do Trello para movimentações. Credenciais locais com escopo parcial não são a integração canônica da esteira;
- registrar `não mensurável` para tokens e tempo enquanto não houver telemetria confiável;
- iniciar o próximo piloto desde `REFINAMENTO` para exercitar PO, UX/UI e escolha de perfil.

### Não promover ainda

- divisão permanente do DEV em Backend, Frontend e BI;
- processamento automático de toda a fila;
- acesso a PRD, release ou deploy;
- pontuação de eficiência baseada em estimativa;
- cutover silencioso ou iniciado fora do projeto consumidor.

## 6. Condições para o cutover do Piloto A

O cutover permanece pendente e deve ser iniciado manualmente pela pessoa responsável dentro do Projeto Piloto A. Antes da virada:

1. a validação humana de `PILOT-A-065` a `PILOT-A-068` deve estar concluída;
2. não pode existir DEV, Review, QA ou release incompatível em andamento;
3. o adapter deve passar no doctor em modo `cutover`;
4. o pin do Kernel deve ser atualizado para `0.1.4` e o shadow deve exibir perfil, modelo, esforço e `comment_gate`;
5. o gatilho deve bloquear qualquer roteador legado concorrente;
6. o bootstrap deve ser alterado de forma versionada e reversível;
7. a primeira execução real deve começar pelos cards autorizados em `REFINAMENTO` e produzir recibo confirmado antes da primeira transição;
8. o rollback deve ser provado sem manter dois roteadores ativos.

## 7. Próxima hipótese

Se o cutover acionar exclusivamente `pipeline-run`, selecionar o adapter correto e conduzir um card de `REFINAMENTO` por PO e UX/UI sem ampliar contexto ou pular gates, então o Piloto A poderá ser considerado conectado à nova arquitetura. Essa hipótese ainda precisa de evidência real e será avaliada no próprio projeto.
