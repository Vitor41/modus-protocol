# Histórico de mudanças

Todas as mudanças relevantes deste projeto serão registradas neste arquivo.

O formato segue os princípios de Keep a Changelog e o versionamento seguirá SemVer quando existirem componentes instaláveis. Durante a fase documental, a versão identifica a evolução do Modus Protocol.

## [Não publicado]

### Adicionado

- Kernel `0.1.15` reconhece bloqueio humano estruturado no lock e obriga replanejamento completo após qualquer gate localizado antes de encerrar a execução.
- Kernel `0.1.14` resolve labels declaradas por nome para IDs oficiais do board antes da escrita e releitura, preservando suporte a adapters existentes que já usam IDs.
- Kernel `0.1.13` torna o plugin instalado a única fonte de versão ativa; adapters deixam de fixar ou comparar versão de Kernel e o gatilho não executa preflight de versão.
- Kernel `0.1.12` transforma o refinamento em fila: o PO recebe todos os cards elegíveis, normaliza título/descrição/labels e define Delivery Groups após analisar o conjunto.
- Delivery Groups passam a declarar `optimization` ou `dependency`, precedência explícita entre grupos e escopo de bloqueio (`card`, `delivery_group` ou `dependency_group`).

- Kernel `0.1.11` adiciona status de versão fail-fast antes do Trello, expondo runtime ativo, origem física, piso do adapter, versões do cache e tarefa obsoleta.
- Guia público de início rápido cobre instalação, adapter, credenciais, trecho canônico do `AGENTS.md`, gatilho, cutover e primeiro teste.

### Alterado

- O orquestrador drena cards e grupos independentes na mesma execução; gates humanos e bloqueios localizados deixam de interromper a fila inteira.
- Snapshot Trello preserva a declaração do Delivery Group na descrição e inclui membros terminais estritamente necessários para resolver precedências, sem varredura completa de comentários.
- Contratos, documentação, Skills e testes passam a validar a semântica de grupos e o bloqueio de escopo correto.

- `pipeline-run` e `pipeline-doctor` exigem comprovação da versão antes de acessar o tracker.
- Documentação de empacotamento e operação deixa de apresentar versões históricas como configuração atual.

### Corrigido

- Kernel `0.1.10` confirma upload pela coleção de anexos do card, sem depender do campo opcional `idCard`, e adiciona remoção segura com releitura de ausência.
- Kernel `0.1.9` preserva mecanicamente o `RUN_ID` com `--continue-run-id`, documenta as interfaces reais de `plan` e `transition-gate` e rejeita placeholders no recibo do agente.
- Adapters passam a aceitar automaticamente patches mais novos da mesma linha compatível, mantendo opção `pinned` para igualdade exata e bloqueando downgrade ou linha incompatível.
- PO passa a persistir e reler exatamente uma label oficial de tipo e uma ou mais labels oficiais de domínio; lotes compartilham a classificação visual de domínio.
- UX/UI com impacto frontend passa a exigir mock/protótipo anexado e relido no card antes de solicitar `Tela aprovada`; texto isolado não atravessa o gate.
- Kernel `0.1.8` mantém o mesmo `RUN_ID` e continua automaticamente entre PO, UX/UI, DEV, Code Review e QA até um gate humano, bloqueio real, falha ou conclusão.
- PO passa a persistir e reler título canônico e descrição completa no card antes do handoff; o refinamento não pode existir apenas em comentários.
- Cliente Trello ganha leitura e atualização verificável de card e exclusão segura de comentário por card, referência e hash, sempre com releitura.

### Adicionado

- Identidade pública **Modus Protocol**, com o identificador técnico `unified-development-pipeline` preservado por compatibilidade na série v0.1.
- Licença MIT, política de segurança, guia de contribuição e CI pública.
- Procedimento e eval isolado de rollback sem escrita em projetos ou trackers reais.
- Documentação pública anonimizada e documento canônico renomeado para `docs/MODUS_PROTOCOL.md`.

### Alterado

- Estudos de caso e retrospectivas usam nomes, chaves, branches e commits sanitizados.
- README passa a apresentar arquitetura, requisitos, capacidades, instalação, segurança e desenvolvimento para usuários externos.

### Validado

- Cutover técnico em dois adapters privados: um piloto funcional completo e uma prova proporcional de integração.
- Kernel `0.1.7` aprovado com integração Trello direta, lotes definidos pelo PO e gate Git de release.

### Corrigido

- Kernel `0.1.7` restaura o contrato do Modus Protocol: `APROVADO PARA PRD` exige push, PR, checks, tratamento de conflitos e merge antes da transição para `PRONTO PARA PRD`; deploy e VM permanecem humanos.

- Kernel `0.1.6` distingue card isolado de lote coeso: somente o PO pode definir o grupo durante o refinamento; o planner preserva essa unidade por branch, DEV, Review, QA e release sem inferir agrupamento por domínio.
- Novo executor oficial de comandos resolve o Python do venv do projeto antes de executar capacidades do adapter, evitando falso bloqueio por ausência de `python` no PATH.

- Kernel `0.1.5` elimina tentativas improvisadas de runtime: todas as operações usam um launcher PowerShell determinístico, com fallback único para o Node empacotado pelo Codex e falha rápida.
- Snapshot direto da API do Trello passa a incluir e hidratar somente cards dos estados acionáveis e grava a saída em arquivo, evitando carregar todo o histórico do board no contexto.
- O mesmo adaptador passa a publicar e reler mocks/anexos (arquivo ou URL), com tipos e tamanho controlados e evidência rastreável no gate UX/UI.

- Cards brutos em `REFINAMENTO` podem iniciar PO sem chave, labels ou descrição canônica completa; essas informações são saída do refinamento.
- PO aceita `Contexto / Problema / Solução esperada` ou texto livre equivalente e bloqueia com perguntas objetivas quando faltar regra material para concluir.
- Novo cliente executável de comentários Trello respeita o provider `environment`, lê credenciais de arquivo externo e confirma a persistência UTF-8 sem expor segredos.
- Cutover do Projeto Piloto A troca o roteador legado por `$pipeline-run` e fixa o Kernel `0.1.4`.

## [0.1.11] - 2026-08-28

### Corrigido

- Kernel e plugin promovidos a `0.1.3` com política obrigatória de comentários no adapter.
- Cutover e modo live agora bloqueiam quando leitura e escrita de comentários não foram comprovadas por teste persistido.
- `pipeline-run` passa a exigir publicação e releitura de lock, cápsula, handoff, bloqueio e transição antes de movimentar o card.
- O planner expõe `comment_gate` e declara que toda movimentação depende do gate de transição.
- Novo `pipeline-transition-gate` valida um recibo vinculado ao `RUN_ID`, card, handoff e providers; releitura falha, divergente ou vencida nega mecanicamente a movimentação.

### Validado

- Comentário diagnóstico real publicado e relido no PILOT-A-068 em UTF-8, sem alterar coluna ou conceder aprovação.

## [0.1.10] - 2026-08-28

### Adicionado

- Mapeamento executável e versionado de `RAPIDO`, `EQUILIBRADO`, `PROFUNDO`, `MAXIMO` e `PARALELO` para modelo, esforço e modo do agente.
- `execution_request` no planner e recibo obrigatório no contrato de handoff.
- Eval determinístico de resolução dos perfis e cenários negativos para divergência, configuração não observável e fallback.
- Documento de auditoria de modelo e esforço e novo critério de aceitação do cutover.

### Segurança e transparência

- Execução ao vivo não aceita herança silenciosa de configuração.
- Code Review e QA exigem agente independente com lançamento explícito.
- Ausência de telemetria de tokens permanece declarada; modelo e esforço precisam ser confirmados antes da transição.

### Alterado

- Kernel e plugin local promovidos a `0.1.2`.

## [0.1.9] - 2026-08-28

### Adicionado

- Retrospectiva versionada do replay controlado de `PILOT-A-065` a `PILOT-A-068`.
- Métricas observadas de Review, QA, retornos, testes e intervenção humana, usando `não mensurável` para tokens e tempo sem telemetria confiável.
- Resultados reais de `EVAL-REVIEW-001`, `EVAL-QA-001`, `EVAL-LOOP-001` e do bloqueio de WIP.

### Validado

- Limite de três retornos interrompeu corretamente o loop e exigiu decisão humana.
- Code Review independente aprovou o commit fixado somente após resolver compatibilidade legada, vigências e concorrência.
- QA independente aprovou 54 testes focais e 224 testes de regressão na primeira passagem.
- Cards avançaram pelas colunas canônicas até `PRONTO PARA RELEASE`, sem autorização de PRD ou deploy.

### Decidido

- DEV Full Stack permanece proprietário da fatia; especializações continuam sob demanda.
- Escritas no Trello usam a integração oficial autorizada; credenciais locais com escopo parcial não são a rota canônica.
- O próximo caso deve começar em `REFINAMENTO` para comprovar PO e UX/UI ao vivo após o cutover.

## [0.1.8] - 2026-08-28

### Adicionado

- Adapter repo-scoped do Projeto Piloto A, pinado no Kernel e plugin `0.1.1`.
- Mapeamento validado das nove listas, incluindo a nova coluna `UX/UI`.
- Eval determinístico de roteamento legado em shadow e cutover, elevando a suíte para 52 testes.

### Alterado

- Doctor `0.1.1` passa a detectar roteador legado e ausência do roteador unificado já em shadow como avisos; no cutover os mesmos conflitos continuam bloqueantes.

### Validado

- Adapter Piloto A aprovado estruturalmente e semanticamente contra snapshot somente leitura do board.
- Shadow run bloqueado com `LEGACY_EXECUTION_ACTIVE` para o lote `PILOT-A-20260826-001`.
- Nenhum card, comentário, código, Git, banco ou comando do projeto foi alterado ou executado pelo shadow run.

## [0.1.7] - 2026-08-28

### Adicionado

- Manifest v0.1.0 do plugin `unified-development-pipeline`.
- Marketplace local versionado `unified-development-pipeline-local`.
- Build reproduzível com runtime ESM standalone e `build-info` com hashes.
- Cinco testes de empacotamento, elevando a suíte para 51 testes.
- Documentação de build, instalação, atualização e cachebuster.

### Validado

- Oito Skills empacotadas com igualdade byte a byte em relação à fonte.
- Doctor e role gate executados sem `node_modules` dentro do plugin.
- Manifest da fonte e cache instalado aprovados pelo validador oficial.
- Marketplace adicionado e plugin `0.1.0` instalado e habilitado no Codex local.

## [0.1.6] - 2026-08-28

### Adicionado

- Skills roteáveis `pipeline-po`, `pipeline-ux-ui`, `pipeline-dev`, `pipeline-code-review` e `pipeline-qa`.
- Schema v0.1 do handoff comum e validador determinístico `pipeline-role-gate`.
- Referências progressivas de refinamento, design, entrega DEV, especializações, bugs difíceis, review e matriz de QA.
- Cinco fixtures válidas de papéis e 15 cenários negativos, elevando a suíte para 46 testes.

### Segurança e qualidade

- PO inicial não pode pular UX/UI nem concluir com pergunta material aberta.
- Frontend não avança sem especificação completa e aprovação humana vigente.
- DEV exige checkpoint, teste e validação aprovados e não pode registrar autoaprovação.
- Review e QA exigem evidências coerentes com seus vereditos.
- Papel bloqueado não muda de estado e ainda deve partir do estado canônico correto.

## [0.1.5] - 2026-08-28

### Adicionado

- `pipeline-setup` somente leitura com inventário determinístico e proposta revisável de adapter.
- `pipeline-run` com planner determinístico, `RUN_ID`, proposta de lock, cápsula inicial e roteamento de papel.
- Schema v0.1 do snapshot normalizado do tracker.
- Política inicial de um card por execução e prioridade para trabalho em andamento.
- Doze testes de setup e orquestração, totalizando 26 testes automatizados.
- Skills explícitas `pipeline-setup` e `pipeline-run`, ambas validadas oficialmente.

### Segurança

- Execução legada ou lock ativo bloqueia apropriação pela nova arquitetura.
- Snapshot incompleto bloqueia a execução em vez de produzir fila vazia.
- Limite de três retornos impede quarto ciclo automático.
- Retomada exige consistência entre `RUN_ID`, card, estado, papel, lock e cápsula.

## [0.1.4] - 2026-08-28

### Adicionado

- Runtime executável e somente leitura de `pipeline-doctor` com modos estrutural, shadow e cutover.
- Contrato JSON estável, códigos de diagnóstico e códigos de saída documentados.
- Dez fixtures negativas versionadas e suíte com 14 testes automatizados.
- Primeira Skill implementada, com acionamento exclusivamente explícito e referência progressiva de diagnósticos.
- Dependências Node exatas e lockfile reproduzível.

### Alterado

- Repositório promovido da fase exclusivamente documental para implementação experimental.
- Validação semântica e gate de roteamento deixam de ser decisões pendentes e passam a possuir implementação testada.

## [0.1.3] - 2026-08-28

### Adicionado

- Formato físico YAML para o adapter repo-scoped.
- JSON Schema Draft 2020-12 do contrato v0.1.
- Exemplo neutro de adapter sem IDs reais ou credenciais.
- Fixture mínima validada contra o schema com ferramenta nativa do PowerShell 7.
- Estratégia de instalação por Skills, plugin local e futuro plugin público.
- Pinagem exata, canais de release, atualização e rollback por projeto.

### Alterado

- Board do Projeto Piloto A confirmado com exatamente nove listas abertas após o arquivamento de `REPROVADOS`.
- Decisões pendentes reduzidas ao mecanismo executável e às integrações ainda não implementadas.

## [0.1.2] - 2026-08-28

### Adicionado

- Framework de evals com modos fixture, shadow, piloto e replay.
- Gates rígidos, rubrica de qualidade, métricas, avaliadores e critério de promoção.
- Plano de piloto do Projeto Piloto A baseado em três cards reais da fila.
- Diagnóstico de compatibilidade entre o novo board e o workflow legado do Piloto A.
- Roteiro de cutover para Projeto Piloto A e Projeto Piloto B.
- Evals que impedem roteamento simultâneo pelas arquiteturas nova e antiga.

### Alterado

- Projeto Piloto A definido como primeiro projeto piloto.
- Demanda `demanda financeira de referência` definida como primeiro candidato ponta a ponta.
- O gatilho `Processe a fila do Trello.` passa a ter como destino final obrigatório o núcleo unificado nos dois projetos.

## [0.1.1] - 2026-08-28

### Adicionado

- Contrato conceitual do adaptador de projeto, incluindo tracker, contexto, comandos, QA, segurança, validação e ciclo de vida.
- Mapeamento obrigatório dos nove estados canônicos do Trello.
- Catálogo inicial com oito Skills de operação e papéis.
- Política para disciplinas, especializações opcionais, dependências externas e perfis de execução.
- Critérios de aprovação antes do scaffolding de adaptadores e Skills.

### Alterado

- Próximas etapas do Modus Protocol para priorizar evals e o formato físico do adaptador.
- Decisão sobre DEV Full Stack e especialistas vinculada a evidências do piloto.

## [0.1.0] - 2026-08-28

### Adicionado

- Visão e princípios da esteira unificada.
- Separação entre núcleo, adaptadores e componentes externos.
- Fluxo de papéis `ORCHESTRATOR → PO → UX/UI → DEV → CODE REVIEW → QA`.
- Máquina de estados baseada nas colunas atuais do Trello do Projeto Piloto B.
- Política inicial de especializações técnicas e perfis de execução.
- Estratégia de contexto, qualidade, evolução, distribuição e métricas.
- Orientações iniciais para manutenção do repositório.
