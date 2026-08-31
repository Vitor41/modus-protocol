---
name: pipeline-code-review
description: Revisa um diff fixado do Modus Protocol de forma independente nos eixos SPEC e STANDARDS, produzindo achados acionáveis ou aprovação técnica antes do QA. Use após o DEV concluir implementação e testes em EM DESENVOLVIMENTO; não use para editar a solução, executar QA ou ampliar a especificação.
---

# Pipeline Code Review

Avalie a entrega fixada sem assumir autoria ou corrigir durante a revisão.

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
- `changes_required`: retorna ao DEV e permanece em `in_development`; exige ao menos um achado acionável.
- Code Review não movimenta para uma coluna própria e não substitui QA.

Produza `schema/role-handoff.schema.json` com `role: pipeline-code-review` e valide com `../../runtime/src/role-gate.mjs`. Somente `PASS` pode ser aplicado pelo ORCHESTRATOR.
