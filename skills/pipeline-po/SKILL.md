---
name: pipeline-po
description: Refina demandas da Modus Protocol em escopo, regras confirmadas, critérios verificáveis, impactos e dúvidas bloqueantes. Use quando `pipeline-run` rotear um card em REFINAMENTO ou uma dúvida de negócio retornar ao PO; não use para escolher implementação, desenhar interface ou alterar código.
---

# Pipeline PO

Transforme intenção em comportamento verificável sem inventar regra de negócio.

## Refinar

1. Confirme `RUN_ID`, card, lock, estado `refinement`, capsule e motivo da iteração.
2. Aceite a intenção em texto livre ou em qualquer estrutura equivalente. `Contexto`, `Problema` e `Solução esperada` são uma forma recomendada, não um formato obrigatório.
3. Para iniciar, basta compreender o assunto, a situação atual ou oportunidade e o resultado pretendido. Chave canônica, labels, regras completas, exceções, impactos e critérios são saída do PO, não pré-requisito de entrada.
4. Reuse a capsule e leia somente o contexto de produto/domínio necessário ao delta. Investigue produto, código, documentação e decisões anteriores antes de perguntar ao humano.
5. Separe fatos confirmados, hipóteses, decisões abertas e itens fora do escopo.
6. Divida demandas amplas em unidades independentes quando isso reduzir ambiguidade ou risco.
7. Produza critérios observáveis com identificador, comportamento esperado e evidência capaz de comprová-lo.
8. Classifique impactos em frontend, backend, banco, BI/dados e segurança; não prescreva arquivos, classes ou arquitetura.
9. Se faltar regra ou decisão material para concluir, bloqueie o card, preserve `refinement` e faça perguntas objetivas ao humano. Não invente nem escolha silenciosamente uma regra plausível.

Um título curto ou uma descrição incompleta não autoriza rejeição automática. Bloqueie somente quando, mesmo após investigação proporcional, a intenção continuar incompreensível ou uma decisão humana for necessária para fechar escopo, regra ou critério.

Leia `references/refinement-gate.md` quando a demanda for ampla, ambígua, financeira, regulatória ou estiver retornando de outro papel.

## Handoff

- Na iteração inicial concluída, encaminhe sempre para `ux_ui`; UX/UI classificará `no_frontend` quando aplicável.
- Em retorno de negócio que elimine impacto visual já classificado, pode recomendar `ready_for_development`.
- Dúvida pendente mantém o card em `refinement` e registra o bloqueio.
- Bloqueio do PO deve declarar o que foi investigado, a lacuna material e as perguntas necessárias para o usuário responder.
- Não mova o card antes de validar o handoff.

Produza o contrato de `schema/role-handoff.schema.json` com `role: pipeline-po` e valide usando:

```text
node <skill-dir>/../../runtime/src/role-gate.mjs --handoff <arquivo-temporário> --format json
```

Somente um resultado `PASS` pode ser devolvido ao `pipeline-run`. Inclua resumo, critérios, decisões, riscos, contexto realmente lido e próximo passo.

## Unidade de entrega

O PO define se a demanda segue isolada ou integra um lote coeso. Agrupe somente quando os cards compartilham objetivo, branch, implementação e validação a ponto de ciclos separados gerarem retrabalho; uma label ampla de domínio, sozinha, não basta. Registre em cada card do lote o mesmo bloco `DELIVERY GROUP`, `CARDS`, `BRANCH` e `DEFINED BY: pipeline-po`. Preserve critérios verificáveis por card. Depois de registrado, o ORCHESTRATOR usa um único `RUN_ID`, branch, DEV, Code Review e QA para o lote e mantém comentários e transições individualizados.
