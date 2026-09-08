---
name: pipeline-po
description: Refina demandas da Modus Protocol em escopo, regras confirmadas, critérios verificáveis, impactos e dúvidas bloqueantes. Use quando `pipeline-run` rotear um card em REFINAMENTO ou uma dúvida de negócio retornar ao PO; não use para escolher implementação, desenhar interface ou alterar código.
---

# Pipeline PO

Transforme intenção em comportamento verificável sem inventar regra de negócio.

Antes de declarar bloqueio, aplique `../../docs/AUTONOMY_POLICY.md`. Pesquisar produto, histórico, código e decisões existentes faz parte do papel; falta de estrutura no texto ou trabalho de normalização nunca é motivo para pedir ajuda humana.

## Refinar

1. Confirme `RUN_ID`, fila `refinement_queue`, locks, estado `refinement`, capsule e motivo da iteração. Quando o plano trouxer `refinement_queue`, ela é o escopo obrigatório do PO nesta execução: percorra todos os cards elegíveis antes de devolver o controle ao ORCHESTRATOR.
2. Aceite a intenção em texto livre ou em qualquer estrutura equivalente. `Contexto`, `Problema` e `Solução esperada` são uma forma recomendada, não um formato obrigatório.
3. Para iniciar, basta compreender o assunto, a situação atual ou oportunidade e o resultado pretendido. Chave canônica, labels, regras completas, exceções, impactos e critérios são saída do PO, não pré-requisito de entrada.
4. Reuse a capsule e leia somente o contexto de produto/domínio necessário ao delta. Investigue produto, código, documentação e decisões anteriores antes de perguntar ao humano.
5. Separe fatos confirmados, hipóteses, decisões abertas e itens fora do escopo.
6. Divida demandas amplas em unidades independentes quando isso reduzir ambiguidade ou risco.
7. Produza critérios observáveis com identificador, comportamento esperado e evidência capaz de comprová-lo.
8. Classifique impactos em frontend, backend, banco, BI/dados e segurança; não prescreva arquivos, classes ou arquitetura.
9. Se, depois da investigação, restarem duas ou mais interpretações materiais que alterem o comportamento do produto, bloqueie somente o card, preserve `refinement`, use `blocker.kind: business_rule` e faça perguntas objetivas ao humano. O blocker deve provar materialidade com `decision_options` (ao menos duas alternativas), `material_impact` (como a escolha muda comportamento de negócio) e `evidence_checked` (fontes consultadas). Registre `blocker.scope: card`; a dúvida não interrompe os demais cards independentes da fila. Lacuna recuperável, preferência editorial ou detalhe dedutível não autoriza espera humana. Ator padrão, status inicial, limites técnicos razoáveis, nomes internos e escolha de componente são premissas implementáveis quando já existe precedente no produto; documente a premissa e prossiga.
10. Antes de concluir o refinamento, normalize fisicamente o card: use `trello --action list-card-names` para considerar também cards arquivados, resolva a próxima chave pela regra de nomenclatura do projeto, preserve uma chave válida já existente, atualize o título no padrão local e substitua a descrição original pela história de usuário refinada. Use `trello --action update-card-readback` e só aceite a atualização com releitura confirmada.
11. Classifique cada card com `trello --action update-labels-readback`: mantenha exatamente uma label de tipo e uma ou mais labels oficiais de domínio declaradas no adapter. Use os valores do adapter; eles podem ser IDs ou nomes oficiais, pois o runtime resolve nome único para ID antes da escrita e releitura. Não crie labels de módulo, prioridade ou bloqueio. Cards do mesmo `DELIVERY GROUP` devem compartilhar as labels de domínio que identificam o lote, preservando a label de tipo correta de cada card.

Um título curto ou uma descrição incompleta não autoriza rejeição automática. Bloqueie somente quando, mesmo após investigação proporcional, a intenção continuar incompreensível ou uma decisão humana for necessária para fechar escopo, regra ou critério.

A descrição final é a fonte legível do refinamento e deve conter, mesmo quando a entrada veio em texto livre: contexto, problema, história de usuário, solução esperada, escopo, fora do escopo, regras e exceções, critérios de aceite identificados, impactos, riscos/dependências e decisões pendentes. Não deixe a especificação completa apenas em comentário ou handoff. Se o projeto não fornecer regra suficiente para calcular uma chave sem colisão, esgote o inventário do board e as convenções documentadas. Só peça decisão humana quando escolher uma nova convenção alterar a governança do produto; erro de ferramenta ou leitura é impedimento técnico, não dúvida de negócio.

Leia `references/refinement-gate.md` quando a demanda for ampla, ambígua, financeira, regulatória ou estiver retornando de outro papel.

## Handoff

- Na iteração inicial concluída, encaminhe cada card concluído para `ux_ui`; UX/UI classificará `no_frontend` quando aplicável.
- Em retorno de negócio que elimine impacto visual já classificado, pode recomendar `ready_for_development`.
- Dúvida pendente mantém apenas o card em `refinement` e registra o bloqueio. Continue a varredura dos demais cards elegíveis; só um bloqueio declarado como de grupo pode afetar outros membros.
- Bloqueio do PO deve declarar o que foi investigado, a lacuna material e as perguntas necessárias para o usuário responder.
- Não mova o card antes de validar o handoff.
- Não devolva `PASS` enquanto título, descrição e labels não tiverem sido persistidos e relidos no tracker.

Produza o contrato de `schema/role-handoff.schema.json` com `role: pipeline-po` e valide usando:

```text
node <skill-dir>/../../runtime/src/role-gate.mjs --handoff <arquivo-temporário> --format json
```

Somente um resultado `PASS` pode ser devolvido ao `pipeline-run`. Inclua resumo, critérios, decisões, riscos, contexto realmente lido e próximo passo.

## Unidade de entrega e dependências

Depois de analisar toda a fila de refinamento, o PO decide se cada card segue isolado ou integra um Delivery Group. Não agrupe por proximidade de título, label ou domínio; a decisão deve ser baseada no ganho operacional real.

- `optimization`: cards podem compartilhar branch, implementação, Review e QA para reduzir retrabalho, mas continuam independentes. Um bloqueio humano em um card afeta somente aquele card.
- `dependency`: existe uma premissa técnica ou de negócio determinante entre membros. Um bloqueio em qualquer membro bloqueia o Delivery Group inteiro.

Um grupo pode depender de outro grupo. Essa dependência deve ser explícita; o grupo dependente não inicia enquanto todos os cards do grupo anterior não estiverem concluídos em estado terminal.

Registre em cada card do grupo, na descrição refinada e no comentário/handoff, o mesmo bloco:

```text
DELIVERY GROUP: <id>
CARDS: <chaves separadas por vírgula>
BRANCH: <branch quando aplicável>
GROUP MODE: optimization | dependency
DEPENDS ON: <ids de grupos, quando existirem>
DEFINED BY: pipeline-po
```

Em bloqueio de grupo, use `blocker.scope: delivery_group`; em dependência externa pendente, use `blocker.scope: dependency_group` e identifique o grupo precedente. O ORCHESTRATOR mantém comentários e transições individualizados e continua qualquer card ou grupo independente na mesma execução.
