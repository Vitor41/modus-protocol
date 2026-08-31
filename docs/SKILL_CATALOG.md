# Catálogo de Skills v0.1

| Campo | Valor |
|---|---|
| Versão | `0.1.4` |
| Estado | Implementado e empacotado localmente |
| Escopo | Oito Skills mínimas implementadas e validadas |

## 1. Objetivo

Este catálogo define as primeiras Skills da esteira, seus limites e relações. Ele evita duas fontes comuns de desperdício: uma Skill monolítica que carrega todo o sistema e várias Skills que repetem o mesmo workflow.

Cada Skill deve ter um gatilho distinguível, uma entrega verificável e referências carregadas progressivamente. Estado do Trello, políticas comuns, templates e esquema do adaptador pertencem ao núcleo compartilhado, não a cópias dentro de cada papel.

## 2. Modos de acionamento

- **Explícito:** iniciado pela pessoa porque representa uma operação ou workflow completo.
- **Automático:** selecionado pelo agente quando a natureza da tarefa corresponde ao escopo.
- **Roteado:** selecionado pelo ORCHESTRATOR para a fase ativa; tecnicamente deve permanecer descobrível pelo modelo.

Workflows explícitos não devem depender de uma Skill explicit-only invocar outra Skill explicit-only. Os papéis necessários ao fluxo permanecem roteáveis pelo agente.

## 3. Catálogo mínimo de implementação

### 3.1 Operações da esteira

| Skill | Modo | Responsabilidade | Não faz | Perfil inicial |
|---|---|---|---|---|
| `pipeline-run` | Explícito | Iniciar ou retomar a execução, validar estado, criar `RUN_ID`, propor lock e cápsula e escolher o próximo papel. Implementada em `skills/pipeline-run`. | Não refina produto, desenha solução, programa, revisa nem testa. | `EQUILIBRADO` |
| `pipeline-setup` | Explícito | Inspecionar um projeto e produzir proposta de adaptador para revisão humana. Implementada em `skills/pipeline-setup`. | Não instala, sobrescreve configuração nem conecta serviços sem autorização. | `PROFUNDO` |
| `pipeline-doctor` | Explícito | Diagnosticar compatibilidade, referências, dependências e ambiente. Implementada em `skills/pipeline-doctor`. | Não corrige, executa comandos, processa cards ou atualiza silenciosamente. | `RAPIDO` ou `EQUILIBRADO` |

### 3.2 Papéis do fluxo

| Skill | Modo | Entrada principal | Saída ou gate | Não faz | Perfil inicial |
|---|---|---|---|---|---|
| `pipeline-po` | Roteado | Card, contexto de produto e dúvidas pendentes. | Escopo, critérios verificáveis, impactos e decisão de roteamento. Implementada. | Não escolhe implementação nem aprova UX. | `PROFUNDO` |
| `pipeline-ux-ui` | Roteado | Refinamento aprovado e referências visuais necessárias. | Fluxo, estados, especificação visual e evidência para aprovação de tela. Implementada. | Não implementa a solução final nem simula aprovação humana. | `PROFUNDO` |
| `pipeline-dev` | Roteado | Refinamento e UX aprovados quando aplicável. | Fatia vertical implementada, testes, evidências e capsule atualizada. Implementada. | Não aprova o próprio código nem encerra QA. | `EQUILIBRADO`, escalável |
| `pipeline-code-review` | Roteado | Diff, critérios, testes e arquitetura relevante. | Achados priorizados ou aprovação explícita do gate técnico. Implementada. | Não reescreve a solução durante uma revisão somente leitura. | `PROFUNDO` |
| `pipeline-qa` | Roteado | Critérios, build candidato, massa e instruções de ambiente. | Evidência por critério e veredito aprovado ou reprovado. Implementada. | Não corrige defeitos nem amplia escopo. | `EQUILIBRADO` |

Essas oito Skills formam o primeiro lote. `pipeline-run` coordena; as outras preservam separação de responsabilidade e contexto.

## 4. Disciplinas candidatas

Disciplinas só se tornam Skills separadas quando tiverem gatilho independente e ganho comprovado. Até lá podem ser referências internas da Skill de DEV ou de revisão.

| Candidata | Gatilho próprio esperado | Fase sugerida |
|---|---|---|
| `pipeline-diagnose` | Falha difícil, causa desconhecida ou recorrência. | Segunda onda |
| `pipeline-tdd` | Implementação guiada por testes ou correção com reprodução obrigatória. | Segunda onda |
| `pipeline-codebase-design` | Mudança estrutural, nova fronteira ou impacto transversal. | Segunda onda |
| `pipeline-context` | Construção, compactação ou recuperação de cápsula fora do fluxo padrão. | Avaliar após o piloto |

Não criar uma Skill apenas para armazenar recomendações genéricas. Se o conteúdo sempre for necessário a um único papel, ele pertence à referência progressiva desse papel.

## 5. Especializações opcionais

| Skill candidata | Quando acionar | Relação com o DEV |
|---|---|---|
| `pipeline-frontend` | Interação complexa, responsividade, acessibilidade ou fidelidade visual relevante. | Apoia a fatia; não assume o card. |
| `pipeline-backend` | Contratos, concorrência, integrações ou regras de domínio complexas. | Apoia a fatia; não assume o card. |
| `pipeline-database` | Migração, integridade, performance ou reversibilidade de dados. | Apoia DEV e revisão. |
| `pipeline-bi-data` | Modelagem analítica, métricas, ETL ou visualização de dados. | Apoia DEV e validação de dados. |
| `pipeline-security` | Autenticação, autorização, segredo, ameaça ou superfície sensível. | Apoia DEV, revisão e QA. |

O baseline permanece um DEV Full Stack responsável ponta a ponta. Especialistas entram por risco ou complexidade, entregam parecer ou contribuição delimitada e devolvem o controle ao papel principal. A separação permanente entre DEV frontend, backend e BI só será promovida se os evals mostrarem ganho superior ao custo de handoff.

## 6. Grafo de colaboração

```text
pipeline-setup ──> adaptador revisado
pipeline-doctor ─> diagnóstico

pipeline-run
  ├─> pipeline-po <──────────────┐
  ├─> pipeline-ux-ui ────────────┤ dúvida de produto
  ├─> pipeline-dev ──────────────┤
  │     └─> especialização opcional
  ├─> pipeline-code-review ──> pipeline-dev (achados)
  └─> pipeline-qa ───────────> pipeline-dev (falha)
```

Uma execução mantém uma Skill de papel ativa por vez. A transição registra um resumo verificável na cápsula antes de liberar o próximo papel. Especialização não altera coluna nem gate por conta própria.

## 7. Contrato comum de uma Skill

Toda Skill implementada deverá declarar:

- descrição precisa com gatilhos positivos e limites;
- modo de acionamento;
- entradas mínimas e precondições;
- sequência operacional curta;
- saída estruturada e critério de conclusão;
- referências condicionais e momento exato de leitura;
- ações proibidas e fronteira com Skills vizinhas;
- perfil semântico padrão e critérios de escalonamento;
- falhas que exigem retorno, bloqueio ou intervenção humana;
- casos de avaliação representativos.

O arquivo principal deve permanecer enxuto. Detalhes extensos, templates e variantes ficam em referências lidas somente quando o ramo correspondente for acionado.

## 8. Recursos compartilhados

Os seguintes itens não devem ser repetidos em cada Skill:

- máquina de estados e matriz de transições;
- esquema e validação do adaptador;
- protocolo de lock e `RUN_ID`;
- formato da cápsula de contexto;
- templates canônicos de comentários e evidências;
- perfis semânticos e política de escalonamento;
- registro de dependências externas;
- política comum de segurança e permissões.

Os recursos compartilhados serão extraídos conforme as próximas Skills forem implementadas. A estrutura evolui a partir de `runtime/`, `schema/` e `skills/` já criados, sem antecipar arquivos sem consumidor real.

```text
kernel/
├── references/
│   ├── state-machine.md
│   ├── adapter-schema.md
│   ├── context-capsule.md
│   └── execution-profiles.md
├── templates/
└── skills/
    └── <skill>/SKILL.md
```

## 9. Dependências externas

| Componente | Papel | Política |
|---|---|---|
| Ponytail | Apoio especializado de UX/UI. | Referenciar versão e integração; não copiar silenciosamente. |
| UI UX Pro Max | Referência ou capacidade complementar de design. | Carregamento sob demanda e versão auditável. |
| RTK | Redução e recuperação eficiente de contexto. | Tratar como infraestrutura; medir economia e perda de informação. |
| Skills de terceiros | Métodos especializados. | Avaliar licença, gatilho, sobreposição e custo antes de adotar. |

Uma dependência externa não controla o workflow, não movimenta cards por autoridade própria e não substitui os gates do núcleo.

## 10. Estratégia de perfis

| Situação | Perfil inicial | Regra de escalonamento |
|---|---|---|
| Triagem, leitura curta, validação estrutural | `RAPIDO` | Subir se houver ambiguidade ou risco. |
| Implementação comum e QA dirigido | `EQUILIBRADO` | Subir diante de impacto transversal ou falha persistente. |
| Refinamento, UX, arquitetura e review de risco | `PROFUNDO` | Subir para decisão excepcionalmente ambígua ou crítica. |
| Incidente crítico ou decisão irreversível | `MAXIMO` | Uso excepcional, com justificativa registrada. |
| Trabalho realmente independente | `PARALELO` | Somente com fronteiras, orçamento e consolidação definidos. |

Perfis são pedidos semânticos. O runtime resolve o modelo vigente e registra a escolha para avaliação posterior.

## 11. Avaliação antes da implementação

Cada Skill deverá ter pelo menos:

- um caso normal;
- um caso em que não deve ser acionada;
- um caso de fronteira com outra Skill;
- um caso de retorno ou falha;
- expectativa de saída e evidência;
- medição de tokens, tempo, retrabalho e defeitos escapados quando aplicável.

O catálogo será reduzido ou dividido conforme os evals. Quantidade de Skills não é uma métrica de maturidade.

## 12. Critério de aprovação

O catálogo estará pronto para scaffolding quando:

- os oito itens do primeiro lote tiverem fronteiras aprovadas;
- as descrições permitirem roteamento sem carregar seus corpos;
- não houver duplicação material do workflow;
- as especializações tiverem gatilhos objetivos;
- os recursos compartilhados e progressivos estiverem definidos;
- existirem evals para escolha de papel, retorno e não acionamento;
- houver autorização explícita para criar os diretórios e `SKILL.md` restantes.

As oito Skills mínimas cumpriram o critério individual, possuem fronteiras testadas e passaram na validação oficial. Plugin, shadow e replay técnico de Review/QA foram concluídos; a promoção para uso real ainda depende da validação humana do lote, do cutover e da prova ao vivo de PO/UX/UI.
