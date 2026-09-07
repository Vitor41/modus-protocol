---
name: pipeline-dev
description: Implementa uma fatia vertical completa para um card aprovado do Modus Protocol, com checkpoint pré-edição, baseline, feedback loops, testes, validações e evidências para revisão independente. Use em EM DESENVOLVIMENTO ou na preparação de release autorizada; não use para aprovar o próprio Code Review, QA ou ampliar escopo.
---

# Pipeline DEV

Entregue a menor fatia ponta a ponta que comprove os critérios sem transferir lacunas aos papéis seguintes.

## Checkpoint antes de editar

1. Confirme `RUN_ID`, card, lock, estado, branch, critérios e aprovação UX/UI quando aplicável.
2. Reuse a capsule; leia o índice de contexto e somente módulos, símbolos, testes e histórico necessários ao delta.
3. Inspecione mudanças preexistentes e preserve tudo que não pertence ao card.
4. Mapeie comportamento atual/desejado, pontos públicos de verificação, frontend, backend, banco, BI/dados, segurança e rollback.
5. Execute a capacidade `baseline` exclusivamente por `../../runtime/pipeline.ps1 command --name baseline --project-root <raiz>` e registre resultado real. O executor resolve o runtime oficial do projeto; não tente o executável cru nem trate o venv declarado como fallback.
6. Conclua `APTO PARA IMPLEMENTAR` ou `BLOQUEADO`. Nenhum arquivo é alterado antes de `APTO PARA IMPLEMENTAR`.

Leia `references/delivery-loop.md` antes da primeira edição. Leia `references/specialization-routing.md` somente se os impactos justificarem apoio especializado. Para bug difícil ou causa desconhecida, leia `references/difficult-bugs.md` antes de propor correção.

## Implementar e verificar

- Trabalhe em uma fatia vertical por vez e mantenha responsabilidade pela integração.
- Prefira testes em interfaces públicas e um loop rápido durante a edição.
- Execute validações proporcionais em UI, API, banco, segurança, build, lint ou tipos conforme o impacto.
- Para mudança visual, inspecione a interface renderizada nos estados e viewports aplicáveis; teste de unidade isolado não comprova UX.
- Revise o diff completo, procurando comportamento ausente, escopo extra, regressão e complexidade desnecessária.
- Execute regressão completa uma vez ao final quando aplicável.
- Não esconda falha como `not_applicable`; justifique somente quando a capacidade realmente não se aplica.

## Entregar

O card permanece em `in_development` até Code Review independente. Produza `schema/role-handoff.schema.json` com `role: pipeline-dev`, checkpoint, mudanças, testes, validações, especializações, diff revisado e riscos. Valide com `../../runtime/src/role-gate.mjs`.

Não inclua `review_approved` ou `qa_approved`, não mova diretamente para validação e não declare sucesso de uma ferramenta cuja saída não foi observada.

Preserve no handoff o `delivery_group` definido pelo PO quando existir. O DEV não altera a semântica de agrupamento; bloqueio técnico é de `card` por padrão e só recebe escopo de grupo quando uma dependência determinante já estiver explicitamente registrada.

No modo `release`, exija `APROVADO PARA PRD` vigente e commit fixado. Essa aprovação autoriza e exige integrar o candidato no repositório remoto: atualizar a branch contra a base, resolver conflitos se existirem, executar validações afetadas, fazer push, criar ou atualizar o PR, aguardar checks obrigatórios e fazer merge na branch padrão. Confirme branch/commit remotos e registre URL do PR e commit do merge. Somente então devolva `release_actions` com `push_confirmed`, `pr_confirmed`, `checks_passed`, `conflicts_resolved_or_absent` e `merge_confirmed`. Quando o planner emitir `cohesive-delivery-v0.2`, faça isso uma vez para o lote. Não execute deploy, acesso à VM, migration produtiva ou escrita em produção.
