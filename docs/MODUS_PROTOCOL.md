# Modus Protocol

| Campo | Valor |
| --- | --- |
| Versão pública | `0.1.10` |
| Versão do Kernel | `0.1.10` |
| Estado | Candidata a release pública |
| Data | 2026-08-31 |
| Plataforma inicial | Codex local e ChatGPT desktop |
| Referências internas | Projeto Piloto B e Projeto Piloto A |

## 1. Propósito

Modus Protocol é um sistema versionado de governança e execução para desenvolvimento de software com agentes de IA.

Ela deve permitir que um projeto seja conectado a um núcleo comum sem copiar e evoluir isoladamente workflows, Skills, templates e políticas. O núcleo evolui uma vez; cada projeto preserva somente contexto, configurações e regras próprias.

A v0.1 define a arquitetura e os contratos, implementa as oito Skills mínimas e empacota o núcleo como plugin reproduzível. Um piloto funcional ponta a ponta e um segundo cutover de integração comprovaram roteamento, Review e QA independentes, loops, Trello direto e compatibilidade entre adapters. Os casos foram anonimizados para publicação.

Este documento é complementado por:

- [Contrato do Adaptador de Projeto v0.1](PROJECT_ADAPTER.md);
- [Catálogo de Skills v0.1](SKILL_CATALOG.md);
- [Especificação de Evals v0.1](EVALS.md);
- [Retrospectiva do Piloto Técnico do Piloto A](RETROSPECTIVE_PROJECT_A.md);
- [Roteiro de Integração e Cutover v0.1](INTEGRATION_ROADMAP.md);
- [Formato Físico do Adaptador v0.1](ADAPTER_FORMAT.md);
- [Instalação, Pinagem e Atualização v0.1](INSTALLATION_AND_UPDATES.md).

## 2. Objetivos

1. Unificar práticas já validadas no Projeto Piloto B e no Projeto Piloto A.
2. Melhorar a qualidade da implementação e reduzir devoluções ao DEV.
3. Reduzir tokens e releituras sem remover contexto necessário.
4. Manter papéis, decisões e handoffs auditáveis.
5. Escolher modelo e esforço de raciocínio de forma proporcional.
6. Permitir instalação e atualização controladas em projetos futuros.
7. Preparar o conteúdo para futura divulgação e adaptação por terceiros.

## 3. Não objetivos da v0.1

- Substituir o Trello por outro gerenciador.
- Executar deploy ou atuar em produção.
- Automatizar alterações em projetos existentes.
- Definir agora o formato final de todos os arquivos de configuração.
- Copiar integralmente bibliotecas externas de Skills.
- Criar um agente separado para toda tecnologia ou camada.
- Garantir compatibilidade imediata com todos os agentes de IA.

## 4. Princípios arquiteturais

### 4.1 Núcleo pequeno e adaptadores explícitos

O núcleo contém somente comportamento reutilizável. Board, stack, comandos, portas, domínio e políticas específicas pertencem ao adaptador do projeto.

### 4.2 Fatias verticais

O trabalho deve ser dividido em entregas pequenas, completas e verificáveis. Uma fatia pode atravessar interface, backend, banco e testes, mas permanece sob uma responsabilidade técnica ponta a ponta.

### 4.3 Especialização sob demanda

Full Stack é o papel de implementação padrão. Frontend, Backend, Banco, BI/Dados e Segurança são especializações acionadas por risco ou complexidade, não etapas obrigatórias para todo card.

### 4.4 Feedback é parte da implementação

Código sem teste, execução, inspeção ou outro sinal objetivo proporcional ao risco não está concluído. A esteira deve tornar o feedback loop explícito e curto.

### 4.5 Progressive disclosure

Cada execução carrega somente o papel, domínio e referências necessários. O `AGENTS.md` roteia; Skills ensinam o método; referências detalham somente o ramo acionado.

### 4.6 Uma fonte por regra

Uma regra possui uma fonte canônica. Outros documentos apontam para ela. Duplicação é tratada como risco de divergência e consumo desnecessário de contexto.

### 4.7 Atualização controlada

Nenhum arquivo de projeto consumidor é alterado silenciosamente. O adapter adota por padrão patches mais novos da mesma linha compatível, após instalação versionada do plugin; downgrade e mudanças incompatíveis continuam bloqueados. Projetos que exigem igualdade exata usam `update_policy: pinned`.

## 5. Arquitetura conceitual

```text
ESTEIRA UNIFICADA
│
├── Kernel
│   ├── governança
│   ├── máquina de estados
│   ├── limites de autonomia
│   ├── política de contexto
│   ├── gates de qualidade
│   └── roteamento de execução
│
├── Papéis e Skills comuns
│   ├── orchestrator
│   ├── po
│   ├── ux-ui
│   ├── dev
│   ├── code-review
│   ├── qa
│   ├── tdd
│   ├── diagnosing-bugs
│   ├── codebase-design
│   └── context-maintenance
│
├── Especializações
│   ├── frontend
│   ├── backend
│   ├── database-migrations
│   ├── bi-data
│   └── security
│
├── Infraestrutura
│   ├── RTK
│   ├── Ponytail
│   ├── templates
│   ├── validadores
│   └── evals
│
├── Componentes externos
│   ├── origem
│   ├── versão ou commit
│   ├── licença
│   ├── alterações locais
│   └── política de atualização
│
└── Adaptador de projeto
    ├── tracker e board
    ├── listas, labels e chaves
    ├── stack e arquitetura
    ├── comandos e ambientes
    ├── módulos de domínio
    ├── UX/UI do produto
    ├── release
    └── restrições adicionais
```

## 6. Responsabilidades das camadas

### 6.1 Kernel

O Kernel define:

- papéis e limites de autoridade;
- estados e transições genéricas;
- requisitos mínimos de handoff;
- gates humanos;
- controle de loops;
- proteção de segredos e produção;
- política de contexto;
- perfis de execução;
- contrato dos adaptadores;
- critérios para conclusão da execução.

O Kernel não define:

- IDs de Trello;
- nomes comerciais do projeto;
- stack específica;
- comandos concretos de teste;
- portas;
- padrões de branch particulares;
- regras financeiras ou de produto;
- credenciais ou caminhos de segredos.

### 6.2 Adaptador de projeto

Cada projeto declara:

- identidade e raiz do repositório;
- gerenciador de atividades e seus identificadores;
- mapeamento das colunas canônicas;
- labels de tipo e domínio;
- formato de chave do card;
- stack e limites arquiteturais;
- fonte de contexto por domínio;
- comandos de baseline, teste, lint, build e smoke;
- ambientes, portas e processo local;
- gates adicionais do domínio;
- política de versionamento e release;
- restrições próprias.

O contrato conceitual está detalhado em [PROJECT_ADAPTER.md](PROJECT_ADAPTER.md). Seu formato físico será decidido após os evals iniciais e deverá favorecer leitura humana, validação automática e compatibilidade com Git.

### 6.3 Componentes externos

RTK, Ponytail, Skills de UX/UI e referências externas são dependências, não o núcleo da esteira.

Cada dependência deverá possuir:

- repositório de origem;
- versão, tag ou commit fixado;
- licença preservada;
- motivo de adoção;
- escopo de atuação;
- alterações locais documentadas;
- validação antes de atualização;
- alternativa ou degradação segura quando indisponível.

## 7. Fluxo operacional

O fluxo lógico padrão é:

```text
ORCHESTRATOR → PO → UX/UI → DEV → CODE REVIEW → QA → validação humana
```

`CODE REVIEW` é uma etapa lógica executada enquanto o card está em `EM DESENVOLVIMENTO`. Ela não cria uma coluna nova no Trello.

O UX/UI recebe todo card refinado pelo PO. Ele registra `SEM FRONTEND` ou produz especificação e aguarda aprovação humana quando houver frontend.

## 8. Colunas canônicas do Trello

A primeira versão mantém exatamente as colunas atuais do Projeto Piloto B:

| Coluna | Responsável ou finalidade | Automação |
| --- | --- | --- |
| `IDEIAS` | Gestão humana da demanda inicial | Não |
| `REFINAMENTO` | PO e retornos de dúvidas de negócio | Sim |
| `UX/UI` | Classificação visual, especificação e aprovação de tela | Sim, com gate humano quando aplicável |
| `PRONTO PARA DESENVOLVER` | Entrada elegível do DEV | Sim |
| `EM DESENVOLVIMENTO` | Implementação, correções e Code Review | Sim |
| `PRONTO PARA VALIDAÇÃO` | Entrada elegível do QA | Sim |
| `PRONTO PARA RELEASE` | Entrega aprovada pelo QA aguardando humano | Gate humano |
| `PRONTO PARA PRD` | Release preparada, fora da automação de desenvolvimento | Leitura |
| `DONE` | Encerramento operacional humano | Não |

O adaptador Trello deverá mapear os IDs reais do board para esses estados. Os nomes canônicos permanecem estáveis mesmo que uma instalação futura use nomes visuais diferentes.

## 9. Movimentações dos cards

### 9.1 Fluxo principal

| Origem | Condição | Atuação | Destino |
| --- | --- | --- | --- |
| `IDEIAS` | Humano decide refinar | Gestão humana | `REFINAMENTO` |
| `REFINAMENTO` | Refinamento concluído | PO faz handoff | `UX/UI` |
| `UX/UI` | Sem alteração de frontend | UX/UI registra aval | `PRONTO PARA DESENVOLVER` |
| `UX/UI` | Com frontend e sem aprovação vigente | UX/UI especifica e aguarda | Permanece em `UX/UI` |
| `UX/UI` | `Tela aprovada` válida | UX/UI registra handoff | `PRONTO PARA DESENVOLVER` |
| `PRONTO PARA DESENVOLVER` | Entrada técnica válida | DEV inicia trabalho | `EM DESENVOLVIMENTO` |
| `EM DESENVOLVIMENTO` | Implementação e Code Review aprovados | DEV faz handoff | `PRONTO PARA VALIDAÇÃO` |
| `PRONTO PARA VALIDAÇÃO` | QA reprova | QA consolida evidências | `EM DESENVOLVIMENTO` |
| `PRONTO PARA VALIDAÇÃO` | QA aprova | QA registra evidências | `PRONTO PARA RELEASE` |
| `PRONTO PARA RELEASE` | Sem aprovação humana | Aguarda | Permanece |
| `PRONTO PARA RELEASE` | `APROVADO PARA PRD` válido | DEV finaliza release | `PRONTO PARA PRD` |
| `PRONTO PARA PRD` | Deploy e validação externa concluídos | Gestão humana | `DONE` |

### 9.2 Retornos de negócio e interface

| Origem | Motivo | Atuação | Destino |
| --- | --- | --- | --- |
| `UX/UI` | Dúvida de negócio | UX/UI devolve ao PO | `REFINAMENTO` |
| `REFINAMENTO` | Resposta mantém frontend | PO atualiza o card | `UX/UI` |
| `REFINAMENTO` | Resposta elimina frontend | PO registra a conclusão | `PRONTO PARA DESENVOLVER` |
| `EM DESENVOLVIMENTO` | DEV encontra dúvida de negócio | DEV devolve ao PO | `REFINAMENTO` |
| `REFINAMENTO` | Resposta do PO não altera frontend | PO atualiza critérios | `PRONTO PARA DESENVOLVER` |
| `REFINAMENTO` | Resposta do PO altera frontend | PO invalida o handoff visual anterior | `UX/UI` |

### 9.3 Code Review sem coluna adicional

Depois da implementação e dos testes do DEV:

1. O card permanece em `EM DESENVOLVIMENTO`.
2. A revisão compara o diff com um ponto fixo conhecido.
3. O eixo `SPEC` verifica escopo, critérios e comportamentos ausentes ou extras.
4. O eixo `STANDARDS` verifica arquitetura, padrões, segurança, clareza e complexidade.
5. Achados retornam ao DEV sem movimentação do card.
6. Somente a revisão aprovada permite o handoff para `PRONTO PARA VALIDAÇÃO`.

Para mudanças simples, os dois eixos podem ser executados por um único revisor. Para mudanças críticas ou complexas, podem usar contextos independentes e depois ser consolidados.

## 10. Gates humanos e bloqueios

A v0.1 reutiliza os gates do Projeto Piloto B, sem criar colunas adicionais.

### 10.1 Gatilhos humanos

- `Tela aprovada`: aprova a especificação UX/UI vigente.
- `APROVADO PARA PRD`: autoriza a finalização da branch validada, push, PR e merge conforme o adaptador.
- `BLOQUEIO RESOLVIDO:`: retoma um card bloqueado para decisão humana.
- `Aguardando resposta humana`: impede novos handoffs automáticos do card afetado.

O contrato exato de comparação, autoria e validade temporal dos comentários será definido no adaptador Trello. Como baseline, a aprovação deve ser posterior à evidência que pretende aprovar e perde validade quando essa evidência é substituída.

### 10.2 Loops automáticos

Loops previstos:

- `PO ↔ UX/UI`;
- `PO ↔ DEV`;
- `DEV ↔ QA`.

Cada retorno cria evidência nova e incrementa o ciclo. No terceiro retorno do mesmo loop e escopo, o card recebe `Aguardando resposta humana`. Não existe quarto ciclo automático.

O bloqueio é propriedade do card ou da unidade técnica inseparável. Os demais cards independentes continuam elegíveis.

## 11. Papéis

### 11.1 ORCHESTRATOR

Responsável por:

- consultar o estado oficial;
- verificar lock, dependências, gates e elegibilidade;
- formar o lote;
- escolher o papel ativo;
- classificar complexidade e perfil de execução;
- acionar especializações quando justificadas;
- preservar a ordem dos handoffs;
- impedir escrita paralela insegura;
- atualizar locks e resumos;
- encerrar quando não houver trabalho automático elegível.

O ORCHESTRATOR não resolve silenciosamente o trabalho especializado que deve encaminhar.

### 11.2 PO

Responsável por transformar a demanda em comportamento verificável, separar regras confirmadas de hipóteses, resolver ambiguidades de negócio dentro de sua autonomia e produzir critérios de aceite.

Não prescreve solução técnica e não altera código.

### 11.3 UX/UI

Responsável por classificar impacto de frontend, preservar padrões do produto, definir experiência, estados, acessibilidade, responsividade e evidência visual proporcional ao escopo.

Não inventa regra de negócio, não implementa código de produção e não aprova a própria especificação.

### 11.4 DEV Full Stack

É o responsável técnico ponta a ponta pela fatia vertical. Planeja, implementa, cria ou ajusta testes, executa validações, mantém o menor diff seguro e entrega o estado revisável.

O DEV usa especializações quando a complexidade exigir, mas continua responsável por integrar a solução.

### 11.5 CODE REVIEW

Responsável por avaliar separadamente aderência à especificação e qualidade técnica. Não substitui QA e não amplia o escopo da implementação.

Idealmente usa um contexto independente do implementador nas mudanças de maior risco.

### 11.6 QA

Responsável por derivar cenários, executar validações, relacionar critérios a evidências, verificar regressão e aprovar ou reprovar a entrega sem corrigir diretamente o código.

### 11.7 Humano

Responsável por decisões que excedem a autonomia, aprovação visual, autorização de release e ações produtivas.

## 12. Especializações técnicas

As especializações complementam o DEV:

| Especialização | Acionamento inicial |
| --- | --- |
| Frontend | Interação complexa, responsividade crítica, acessibilidade ou mudança transversal de componentes |
| Backend | Contrato de API, concorrência, integração, autorização ou arquitetura transversal |
| Banco/Migrations | Mudança estrutural, migração de dados, integridade, rollback ou compatibilidade histórica |
| BI/Dados | Métricas, granularidade, reconciliação, linhagem, snapshots, agregações ou memória de cálculo |
| Segurança | Autenticação, autorização, segredo, isolamento, exposição ou impacto relevante de confiança |

Uma mudança pode acionar mais de uma especialização. Isso não autoriza escrita paralela sobre os mesmos arquivos ou branch.

BI/Dados pode atuar como revisão especializada quando a implementação permanecer simples, ou como participante do planejamento quando o significado dos dados for central à mudança.

## 13. Processo do DEV

O processo padrão será refinado em uma Skill própria, mas deve preservar estes gates:

### Fase A: entendimento e checkpoint

- confirmar card, escopo, critérios, branch, lock e contexto;
- mapear comportamento atual e desejado;
- localizar os pontos públicos de verificação;
- executar baseline antes da primeira edição;
- mapear frontend, backend, banco, segurança, dados e testes;
- registrar riscos, rollback e dúvidas;
- concluir como `APTO PARA IMPLEMENTAR` ou `BLOQUEADO`.

Nenhum arquivo é alterado antes de `APTO PARA IMPLEMENTAR`.

### Fase B: implementação em fatias

- implementar uma fatia vertical por vez;
- preferir testes em interfaces públicas e pontos de verificação acordados;
- usar red → green quando houver um seam adequado;
- executar teste focal frequentemente;
- reutilizar código e dependências existentes antes de criar abstrações;
- manter segurança, validação, acessibilidade e tratamento de erro proporcionais;
- evitar escopo e arquitetura especulativos.

### Fase C: verificação e entrega

- executar validações afetadas;
- executar a suíte completa uma vez ao final, quando aplicável;
- revisar o diff;
- passar pelos eixos `SPEC` e `STANDARDS`;
- corrigir achados;
- registrar commit, comandos, resultados, riscos e evidências;
- fazer handoff ao QA.

### Bugs difíceis

Antes de formular uma correção, construir um feedback loop capaz de reproduzir exatamente o defeito. O loop deve ser executável, determinístico o suficiente e rápido. A correção deve deixar uma regressão verificável quando existir um ponto público adequado.

## 14. Política de contexto e tokens

### 14.1 Carregamento

Ordem conceitual:

1. `AGENTS.md` curto.
2. Skill do papel ativo.
3. Seções aplicáveis do workflow.
4. Card, último Context Capsule e comentários posteriores.
5. Índice do domínio.
6. Somente módulos necessários.
7. Símbolos, rotas, diffs e arquivos relacionados.
8. Histórico de release apenas quando necessário.

Não carregar preventivamente Skills de papéis que ainda não atuarão.

### 14.2 Context Capsule

Cada etapa ou ciclo produz um resumo incremental com:

- identificador da execução;
- card ou lote;
- estado e papel;
- objetivo;
- decisões e regras confirmadas;
- arquivos e commits;
- testes e evidências;
- falhas e riscos;
- próximo passo;
- fontes consultadas.

Na retomada, o capsule reduz releitura, mas não substitui evidências necessárias.

### 14.3 Eficiência operacional

- usar RTK para compactar saídas extensas quando ele preservar o sinal necessário;
- consultar a saída original em falha, ambiguidade ou truncamento relevante;
- pesquisar headings e símbolos antes de abrir arquivos extensos;
- registrar trechos relevantes, não logs integrais;
- interromper investigação quando os critérios estiverem comprovados;
- remover duplicações e instruções que não alteram comportamento.

## 15. Perfis de execução

As Skills não fixam modelos. Elas podem indicar o perfil necessário; o ORCHESTRATOR ou o executor aplica o mapeamento vigente.

| Perfil | Finalidade | Mapeamento inicial sugerido |
| --- | --- | --- |
| `RAPIDO` | Trabalho mecânico, leitura estruturada e alteração trivial | `gpt-5.6-luna` / `low` |
| `EQUILIBRADO` | Implementação bem especificada e execução de validações | `gpt-5.6-terra` / `medium` |
| `PROFUNDO` | Ambiguidade, arquitetura, UX/UI, investigação e revisão crítica | `gpt-5.6-sol` / `high` |
| `MAXIMO` | Problema excepcionalmente difícil ou auditoria de alto valor | `gpt-5.6-sol` / `max` |
| `PARALELO` | Frentes independentes com benefício mensurável de delegação | `gpt-5.6-sol` / `high`, com orquestração paralela |

Baseline por etapa:

| Etapa | Perfil padrão | Exceções |
| --- | --- | --- |
| ORCHESTRATOR | `EQUILIBRADO` | `RAPIDO` para roteamento puramente mecânico |
| PO | `PROFUNDO` | `MAXIMO` para domínio ou impacto excepcional |
| UX/UI | `PROFUNDO` | `MAXIMO` em auditoria ampla ou novo design system |
| DEV | `EQUILIBRADO` | `RAPIDO` em mudança fechada; `PROFUNDO` em arquitetura ou risco |
| CODE REVIEW | `EQUILIBRADO` | `PROFUNDO` em regra financeira, segurança ou mudança transversal |
| QA desenho de testes | `PROFUNDO` | `MAXIMO` apenas quando justificado |
| QA execução | `EQUILIBRADO` | `RAPIDO` para reteste determinístico |

`PARALELO` não é um nível superior automático. Só deve ser usado quando o trabalho puder ser dividido sem duplicação, coordenação excessiva ou escrita conflitante.

O Kernel resolve esse mapeamento de forma determinística e o planner o inclui em `execution_request`. Em execução ao vivo, cada papel recebe modelo e esforço explicitamente e produz recibo validável. Herança implícita, configuração não observável, divergência ou fallback bloqueiam o gate. O contrato completo está em [EXECUTION_AUDIT.md](EXECUTION_AUDIT.md).

## 16. Lock, execução e concorrência

Cada lote recebe um identificador de execução. O tracker guarda um lock operacional com papel, estado, responsável e atualização.

Regras iniciais:

- reler o lock antes de cada transição;
- não processar o mesmo lote com identificadores concorrentes;
- não expirar lock automaticamente sem uma política confiável;
- permitir retomada somente com card, capsule e estado consistentes;
- não permitir escrita paralela na mesma branch;
- permitir paralelismo somente em investigação ou revisão independente sem conflito;
- devolver o controle ao ORCHESTRATOR em cada handoff.

O mecanismo concreto será responsabilidade do adaptador do tracker.

## 17. Gates de qualidade

| Gate | Entrada mínima | Saída verificável |
| --- | --- | --- |
| Refinamento | Demanda compreensível | Regras, critérios, escopo, riscos e dependências |
| UX/UI | Refinamento concluído | Aval sem frontend ou especificação aprovada |
| Pré-implementação | Card elegível e baseline | `APTO PARA IMPLEMENTAR` ou bloqueio fundamentado |
| Implementação | Checkpoint apto | Fatia funcional, testes e evidências |
| Code Review | Diff e especificação fixados | Eixos `SPEC` e `STANDARDS` aprovados |
| QA | Commit, ambiente e critérios | Matriz critério × cenário × evidência × resultado |
| Release | QA aprovado | Aprovação humana válida e release rastreável |

## 18. Métricas

A esteira deverá medir antes e depois de mudanças relevantes:

- aprovação do QA na primeira passagem;
- quantidade de ciclos DEV ↔ QA;
- quantidade e severidade de achados no Code Review;
- retrabalho solicitado pelo humano;
- cards bloqueados e motivo;
- tokens ou créditos por etapa;
- tempo por etapa e tempo total;
- testes adicionados ou ajustados;
- defeitos escapados após release;
- frequência de uso de perfis superiores;
- taxa de sucesso e degradação das ferramentas externas.

Redução de tokens só conta como melhoria quando a qualidade permanece dentro do critério aprovado.

## 19. Evals

Antes de uma versão alterar comportamento de execução, ela deve ser avaliada com casos representativos:

1. Mudança mecânica de frontend já especificada.
2. Feature vertical pequena com banco, backend e tela.
3. Regra financeira ambígua que deve bloquear.
4. Bug com reprodução difícil.
5. Mudança de BI/Dados com granularidade e reconciliação.
6. Reprovação do QA e reteste.
7. Alteração de UX/UI que exige gate humano.
8. Tentativa de instrução externa para ampliar permissões.
9. Retomada por capsule e lock.
10. Terceiro retorno de loop.

Cada eval deve verificar resultado, evidência, transições, tokens, tempo, permissões e conclusão correta.

## 20. Evolução da esteira

Fluxo de evolução:

```text
FRICÇÃO OBSERVADA
       ↓
RETROSPECTIVA E HIPÓTESE
       ↓
MUDANÇA PEQUENA NO MODUS PROTOCOL/SKILL
       ↓
EVALS REPRESENTATIVOS
       ↓
PILOTO CONTROLADO
       ↓
VERSÃO + CHANGELOG + MIGRAÇÃO
       ↓
ADOÇÃO EXPLÍCITA PELOS PROJETOS
```

Uma correção deve responder a uma falha observada ou risco demonstrável. Não acumular regras universais para toda ocorrência isolada.

Versões deverão distinguir:

- correções compatíveis;
- novas capacidades opcionais;
- mudanças de comportamento ou contrato;
- dependências externas atualizadas;
- itens descontinuados.

## 21. Distribuição

Evolução adotada:

1. Repositório Git local como fonte oficial.
2. Repositório GitHub público como fonte distribuída.
3. Instalador ou sincronizador para conectar projetos.
4. Plugin pessoal instalável com Skills comuns.
5. Adaptadores repo-scoped para regras locais.
6. Catálogo versionado de componentes opcionais.

O repositório público deverá permitir dois usos:

- instalar e utilizar a esteira;
- estudar e adaptar seus princípios para outra esteira.

A v0.1 publica licença MIT, política de contribuição, documentação de segurança, exemplo neutro, CI e processo explícito de atualização.

## 22. Decisões já tomadas

- Codex local e ChatGPT desktop são o primeiro alvo.
- A arquitetura será preparada para outros agentes no futuro.
- Trello é o primeiro tracker.
- As colunas do Projeto Piloto B são a máquina de estados inicial.
- Não haverá coluna exclusiva de Code Review.
- DEV Full Stack mantém a responsabilidade ponta a ponta.
- Especializações são acionadas sob demanda.
- O primeiro lote contém oito Skills: operação (`pipeline-run`, `pipeline-setup`, `pipeline-doctor`) e papéis (`pipeline-po`, `pipeline-ux-ui`, `pipeline-dev`, `pipeline-code-review`, `pipeline-qa`).
- Disciplinas e especializações adicionais somente serão promovidas a Skills quando tiverem gatilho independente e ganho comprovado.
- Perfis semânticos desacoplam Skills dos modelos vigentes.
- Projetos consumidores fixam uma versão e atualizam explicitamente.
- O produto público se chama Modus Protocol; `unified-development-pipeline` permanece como identificador técnico compatível na série v0.1.
- A licença de distribuição é MIT.
- O repositório será publicado no GitHub.
- Projeto Piloto A e Projeto Piloto B deverão usar o mesmo núcleo; o gatilho `Processe a fila do Trello.` não poderá manter roteamento legado concorrente após o cutover.
- Projeto Piloto A será o primeiro piloto; `demanda financeira de referência` será o primeiro candidato ponta a ponta após compatibilidade e conclusão do lote vigente.
- O adapter canônico será `.pipeline/project.adapter.yaml`, escrito em YAML 1.2 e validado por JSON Schema Draft 2020-12.
- Projetos usarão pin exato do Kernel; Skills serão empacotadas em plugin local antes da distribuição pública.
- O replay técnico do Piloto A mantém DEV Full Stack como proprietário, com especialistas sob demanda; o caso não justifica criar papéis permanentes separados para Backend, Frontend ou BI.
- Tokens e tempo não serão estimados quando a plataforma não expuser telemetria confiável por papel.
- Movimentações do Trello devem usar a integração oficial autorizada; credenciais locais de escopo parcial não compõem a arquitetura canônica.

## 23. Evoluções posteriores à v0.1

- Suporte a trackers além do Trello.
- Estratégia de autenticação para ambientes sem provider local autorizado.
- Formato estruturado futuro de métricas; na v0.1 o registro canônico é uma retrospectiva Markdown versionada.
- Critérios quantitativos para promoção de uma versão.

## 24. Critério de conclusão da release v0.1

Modus Protocol v0.1 estará pronto para publicação quando:

- arquitetura e limites de camada estiverem aprovados;
- todas as colunas e movimentações do Trello estiverem validadas;
- papéis, gates, loops e responsabilidades estiverem sem sobreposição material;
- o contrato conceitual do adaptador estiver aprovado;
- o catálogo mínimo de Skills estiver definido;
- os evals iniciais tiverem entradas e resultados esperados;
- rollback estiver provado em ambiente isolado;
- identidade, licença, segurança, contribuição e CI estiverem versionados;
- nenhuma credencial, ID privado, caminho pessoal ou adapter real estiver presente;
- plugin e Skills passarem nos validadores e na suíte completa;
- o repositório remoto público estiver configurado.
