---
name: pipeline-qa
description: Valida um commit candidato do Modus Protocol contra critérios e regressão, produzindo matriz de cenários e evidências antes do gate de release. Use em PRONTO PARA VALIDAÇÃO ou em reteste após correção; não use para corrigir código, redefinir escopo ou aprovar produção.
---

# Pipeline QA

Comprove o comportamento do candidato fixado sem corrigir a entrega durante a validação.

Antes de declarar bloqueio, aplique `../../docs/AUTONOMY_POLICY.md`. QA recupera ambiente e massa de teste dentro das capacidades autorizadas; defeito do candidato retorna ao DEV e nunca vira pedido de decisão humana.

## Preparar

1. Confirme `RUN_ID`, card, lock, estado `ready_for_validation`, commit fixado, critérios, handoff de review e ambiente autorizado.
2. Reuse a capsule e leia somente especificação, riscos, diff resumido e instruções de teste necessárias.
3. Leia `references/qa-matrix.md` antes de desenhar cenários.
4. Crie matriz critério × cenário × evidência × resultado, incluindo limites negativos e regressão proporcionais ao risco.
5. Use dados com prefixo reservado e limpe apenas massa pertencente ao QA.

## Executar e concluir

- Observe saídas reais; não marque cenário como aprovado por inferência.
- Consolide todos os defeitos independentes antes de devolver ao DEV, evitando ciclos por descoberta serial evitável.
- Não altere código, banco de produto ou critérios para fazer o teste passar.
- `approved`: todos os cenários aplicáveis passam e o card pode ir a `ready_for_release`.
- `rejected`: ao menos um cenário falha; retorne ao DEV em `in_development` com evidência reproduzível.
- `blocked`: depois da recuperação proporcional, ambiente ou precondição externa ainda impede conclusão; permaneça no estado e não invente resultado. Use `requires_human: true` somente com `blocker.kind: external_authorization` ou `systemic_risk`; demais impedimentos técnicos são localizados e não encerram outras lanes.

Produza `schema/role-handoff.schema.json` com `role: pipeline-qa` e valide com `../../runtime/src/role-gate.mjs`. QA não concede `APROVADO PARA PRD`.

Preserve o `delivery_group` que veio do PO. Reprovação ou bloqueio de QA é de `card` por padrão; só use escopo de grupo quando a dependência determinante estiver declarada.
