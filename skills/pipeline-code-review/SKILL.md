---
name: pipeline-code-review
description: Revisa um diff fixado do Modus Protocol de forma independente nos eixos SPEC e STANDARDS, produzindo achados acionáveis ou aprovação técnica antes do QA. Use após o DEV concluir implementação e testes em EM DESENVOLVIMENTO; não use para editar a solução, executar QA ou ampliar a especificação.
---

# Pipeline Code Review

Avalie a entrega fixada sem assumir autoria ou corrigir durante a revisão.

Use `../../docs/AUTONOMY_POLICY.md` para classificar o destino dos achados. Defeito técnico dentro do escopo sempre retorna ao DEV; severidade alta não significa, por si só, intervenção humana.

O ORCHESTRATOR é o proprietário do tracker. Confirme card, comentários, lock e estado pela cápsula fresca recebida; não consulte nem escreva no Trello dentro deste papel. Falha de acesso ao tracker pelo especialista não invalida a entrada já confirmada pelo ORCHESTRATOR.

## Revisar

1. Confirme `RUN_ID`, card, lock, estado `in_development`, baseline, commit/diff fixado, critérios e evidências do DEV.
2. Use contexto independente quando o risco justificar; não dependa da justificativa do implementador como prova.
3. Leia `references/review-rubric.md` e inspecione primeiro o diff, depois apenas o contexto necessário para validar cada risco.
4. No eixo `SPEC`, procure comportamento ausente, extra, contraditório e critérios sem evidência.
5. No eixo `STANDARDS`, procure defeitos, segurança, integridade, arquitetura, clareza, tratamento de erro e complexidade relevante.
6. Relacione cada achado a arquivo/local, severidade, impacto e correção esperada. Evite preferência estilística sem consequência concreta.
7. Não altere arquivos nem aprove com achado crítico/alto aberto.

## Veredito

- `approved`: permanece tecnicamente íntegro e pode ir a `ready_for_validation`.
- `changes_required`: retorno técnico normal ao DEV, permanece em `in_development` e exige ao menos um achado acionável. Não é bloqueio humano nem condição para encerrar o loop; o ORCHESTRATOR deve disparar a correção automaticamente.
- `blocked`: use somente quando o achado comprovar `structural_scope`, `systemic_risk` ou `external_authorization`; declare o `blocker.kind`. Não use para quantidade, severidade ou dificuldade de correções pertencentes ao card.
- Code Review não movimenta para uma coluna própria e não substitui QA.

Produza `schema/role-handoff.schema.json` com `role: pipeline-code-review` e valide com `../../runtime/src/role-gate.mjs`. Somente `PASS` pode ser aplicado pelo ORCHESTRATOR.

Preserve o `delivery_group` que veio do PO. Um achado em um membro de grupo `optimization` retorna somente aquele card; escopo de grupo só cabe quando a dependência determinante estiver declarada.
