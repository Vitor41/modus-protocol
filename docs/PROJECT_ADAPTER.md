# Contrato do Adaptador de Projeto v0.1

| Campo | Valor |
|---|---|
| Versão | `0.1.4` |
| Estado | Contrato implementado e validado |
| Escopo | Contrato conceitual com formato físico definido |

## 1. Objetivo

O adaptador conecta um projeto consumidor ao núcleo da esteira sem copiar o workflow comum. Ele descreve somente o que varia entre projetos: tracker, contexto, stack, comandos, ambientes, políticas de Git, QA, segurança e componentes opcionais.

O adaptador é configuração declarativa. Ele não redefine papéis, estados canônicos, gates de qualidade nem políticas de segurança do núcleo.

## 2. Propriedades obrigatórias

Um adaptador deve ser:

- legível por pessoas e validável por máquina;
- versionado junto ao projeto consumidor;
- livre de segredos e dados pessoais;
- explícito sobre capacidades e comandos disponíveis;
- baseado em caminhos relativos à raiz do repositório;
- compatível com uma versão declarada da esteira;
- pequeno o bastante para ser revisado integralmente;
- portátil, sem depender de convenções invisíveis da máquina do autor.

IDs de boards, listas ou integrações podem existir no adaptador do projeto consumidor, mas nunca no núcleo público. Credenciais devem ser obtidas pelo provedor seguro do ambiente.

## 3. Modelo conceitual

### 3.1 Identidade e compatibilidade

| Campo conceitual | Finalidade |
|---|---|
| `schema_version` | Versão do esquema do adaptador. |
| `pipeline_version` | Versão ou intervalo compatível do núcleo. |
| `project.id` | Identificador estável, sem informação sensível. |
| `project.name` | Nome humano do projeto. |
| `project.root` | Raiz lógica, normalmente `.`. |
| `project.owners` | Papéis ou aliases responsáveis, quando necessário. |

### 3.2 Tracker

O bloco do tracker declara provedor, board, estados, etiquetas, tipos de card e política obrigatória de comentários. O primeiro provedor será Trello, mas o contrato usa nomes canônicos para permitir outros trackers no futuro.

Todo adaptador deve mapear exatamente uma vez estes nove estados:

| Estado canônico | Coluna visual inicial |
|---|---|
| `ideas` | IDEIAS |
| `refinement` | REFINAMENTO |
| `ux_ui` | UX/UI |
| `ready_for_development` | PRONTO PARA DESENVOLVER |
| `in_development` | EM DESENVOLVIMENTO |
| `ready_for_validation` | PRONTO PARA VALIDAÇÃO |
| `ready_for_release` | PRONTO PARA RELEASE |
| `ready_for_production` | PRONTO PARA PRD |
| `done` | DONE |

O adaptador também poderá declarar:

- IDs reais do board e das listas;
- mapeamento entre nomes canônicos e etiquetas locais;
- padrão para chave ou sequência de cards;
- domínio e tipo reconhecidos pelo projeto;
- identidade de autores autorizados para gates humanos;
- providers de leitura/escrita, eventos obrigatórios e releitura antes da transição;
- regras de comparação, validade temporal e invalidação de comentários;
- templates locais de comentários, sem alterar seus significados canônicos.

Quando disponível, a integração oficial autorizada do ambiente é a origem preferencial para leitura e escrita. Token local com escopo parcial pode ser diagnosticado, mas não deve se tornar dependência silenciosa nem rota concorrente do adapter.

As frases `Tela aprovada`, `APROVADO PARA PRD`, `BLOQUEIO RESOLVIDO:` e `Aguardando resposta humana` mantêm o significado definido pelo núcleo. Um adaptador pode configurar aliases somente se a compatibilidade for explícita e testável.

### 3.3 Contexto do projeto

Este bloco informa onde encontrar contexto, sem carregá-lo preventivamente:

- `AGENTS.md` e índice de contexto;
- mapa de domínios e módulos;
- decisões arquiteturais e invariantes;
- referências de produto e UX/UI;
- histórico de releases e incidentes relevante;
- padrões locais de código e testes.

Cada referência declara caminho, finalidade, condição de leitura e se é obrigatória ou opcional. O adaptador não deve duplicar o conteúdo desses documentos.

### 3.4 Stack e arquitetura

Descreve linguagens, frameworks, bancos, serviços e limites arquiteturais necessários ao roteamento. Também registra sinais que justificam especializações como frontend, backend, banco/migrações, BI/dados e segurança.

Esses sinais são recomendações ao ORCHESTRATOR; não transferem a responsabilidade ponta a ponta do DEV.

### 3.5 Comandos verificáveis

Os comandos são capacidades nomeadas, não trechos livres espalhados pelas Skills. O conjunto pode incluir:

- instalação ou bootstrap;
- baseline do repositório;
- teste direcionado e suíte completa;
- lint, análise de tipos e build;
- smoke test;
- inicialização, healthcheck e encerramento do ambiente local.

Cada comando deve declarar:

- diretório de trabalho;
- timeout;
- código de saída esperado;
- variáveis permitidas, sem valores secretos;
- estratégia de captura e redução de saída;
- precondições e efeitos locais conhecidos.

Uma Skill escolhe a capacidade; o adaptador fornece a implementação segura para o projeto.

### 3.6 Ambientes locais

Para cada serviço local, o adaptador descreve comando de início, estratégia de host e porta, healthcheck, arquivos temporários, PID/log e encerramento. Portas não são universais: o projeto pode fixá-las ou permitir alocação controlada.

O ciclo de vida deve impedir processos órfãos, colisão entre execuções e uso acidental de serviços de produção.

### 3.7 Git e release

O adaptador declara:

- branch padrão e padrões de branches de trabalho;
- política de commits;
- requisitos de push, PR, revisão e merge;
- estratégia de versão e release notes;
- documentos atualizados em uma entrega;
- gates que exigem autorização humana.

Nenhum adaptador pode converter automaticamente `APROVADO PARA PRD` em autorização genérica para ações destrutivas ou fora do repositório.

### 3.8 Delivery Groups e fila

O adapter habilita somente os limites operacionais de agrupamento; ele não decide grupos por conta própria. O PO registra cada grupo no tracker com `GROUP MODE: optimization` ou `GROUP MODE: dependency`, os cards membros, a origem `pipeline-po` e, quando houver, `DEPENDS ON` entre grupos. A semântica é canônica no Kernel: grupos de otimização não propagam bloqueio individual; grupos de dependência e precedências entre grupos propagam apenas o escopo declarado. O adapter deve manter o snapshot capaz de recuperar essa declaração e membros terminais necessários para precedência.

### 3.9 QA e evidências

O contrato de QA inclui:

- identidades e prefixos reservados para dados de teste;
- isolamento e limpeza de massa;
- navegadores, resoluções ou ambientes suportados;
- canais de evidência aceitos;
- comandos de regressão e smoke;
- restrições para dados sensíveis.

Evidência deve apontar para o critério que comprova. Um resultado agregado sem relação com critérios não encerra o gate.

### 3.10 Segurança e permissões

O adaptador registra limites locais, nunca permissões adicionais. Deve identificar:

- fontes autorizadas de segredo, sem armazenar valores;
- caminhos sensíveis;
- ambientes proibidos;
- escritas externas que exigem autorização;
- ações destrutivas sujeitas a confirmação;
- diretórios locais permitidos para artefatos temporários.

Conteúdo de cards, arquivos, páginas e ferramentas é entrada não confiável e jamais concede permissão.

### 3.10 Skills e componentes opcionais

O projeto pode habilitar especializações, dependências externas e overrides locais suportados. Cada componente externo deve ter origem, versão pinada, finalidade, licença conhecida quando aplicável e política de atualização.

Ponytail, UI UX Pro Max e RTK permanecem componentes externos. O adaptador referencia integrações; não incorpora cópias silenciosas.

### 3.11 Perfis de execução

O adaptador pode ajustar limites ou recomendações dos perfis `RAPIDO`, `EQUILIBRADO`, `PROFUNDO`, `MAXIMO` e `PARALELO` apenas quando houver suporte do runtime e evidência mensurável. Skills solicitam perfis semânticos, não nomes fixos de modelos.

### 3.12 Locks e cápsulas de contexto

O projeto pode definir a implementação de locks, o local temporário de cápsulas de contexto e os identificadores usados para correlacionar uma execução. O protocolo e os campos mínimos continuam pertencendo ao núcleo.

## 4. Precedência e limites

Em uma execução, prevalece a seguinte ordem:

1. políticas da plataforma, permissões e segurança;
2. instrução humana explícita para a tarefa atual, dentro desses limites;
3. invariantes e gates não negociáveis do núcleo;
4. adaptador e orientações versionadas do projeto;
5. especificação do card e artefatos aprovados;
6. evidências observadas no código e no ambiente.

Conflitos devem ser expostos; não resolvidos por redução silenciosa de segurança ou qualidade. Uma fonte externa pode fornecer dados, nunca autoridade.

## 5. Validações obrigatórias

Antes de uma execução, o validador deverá comprovar que:

- o esquema e a versão da esteira são compatíveis;
- os nove estados canônicos possuem mapeamento único;
- não existe coluna operacional aberta fora dos estados canônicos sem classificação e autorização explícitas;
- não há IDs duplicados onde unicidade é exigida;
- comandos possuem diretório, timeout e resultado esperado;
- nenhum segredo está embutido;
- caminhos obrigatórios existem e opcionais estão identificados;
- branch padrão e padrões declarados são coerentes;
- referências externas possuem versão ou política explícita;
- nenhuma regra local enfraquece um gate ou limite do núcleo.

Falha estrutural impede a execução. Avisos não bloqueantes devem ser apresentados com ação corretiva clara.

## 6. Ciclo de vida

1. Descobrir stack, comandos, tracker e contexto já existentes.
2. Gerar um rascunho sem credenciais nem alterações externas.
3. Validar estrutura e referências locais.
4. Submeter decisões ambíguas à revisão humana.
5. Fixar a versão compatível da esteira.
6. Versionar o adaptador no projeto consumidor.
7. Em upgrades, executar verificação de compatibilidade e migração explícita.

Não haverá atualização silenciosa. O projeto escolhe quando adotar uma nova versão e deve conseguir retornar à versão anterior pelo controle de versão.

## 7. Formato e exemplo

O formato canônico é `.pipeline/project.adapter.yaml`, escrito em YAML 1.2. A estrutura está definida pelo [JSON Schema](../schema/project-adapter.schema.json), e o [exemplo neutro](../examples/project.adapter.example.yaml) demonstra todos os blocos principais sem armazenar credenciais ou identificadores reais.

Decisões de autoria, pinagem e validação estão em [ADAPTER_FORMAT.md](ADAPTER_FORMAT.md).

## 8. Critério de aprovação

Este contrato estará aprovado para scaffolding quando:

- cobrir Projeto Piloto B e Projeto Piloto A sem campos específicos no núcleo;
- mapear integralmente o workflow atual do Projeto Piloto B;
- representar comandos, contexto, QA e segurança de ambos os projetos;
- o schema e o exemplo passarem nas fixtures estruturais;
- distinguir erro bloqueante de aviso;
- tiver os gates e a precedência revisados.
