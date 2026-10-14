---
name: pipeline-qa
description: Valida um commit candidato do Modus Protocol contra critérios e regressão, produzindo matriz de cenários e evidências antes do gate de release. Use em PRONTO PARA VALIDAÇÃO ou em reteste após correção; não use para corrigir código, redefinir escopo ou aprovar produção.
---

# Pipeline QA

Comprove o comportamento do candidato fixado sem corrigir a entrega durante a validação.

Antes de declarar bloqueio, aplique `../../docs/AUTONOMY_POLICY.md`. QA recupera ambiente e massa de teste dentro das capacidades autorizadas; defeito do candidato retorna ao DEV e nunca vira pedido de decisão humana.

O ORCHESTRATOR é o proprietário do tracker. Confirme card, comentários, lock e estado pela cápsula fresca recebida; não consulte nem escreva no Trello dentro deste papel. Falha de acesso ao tracker pelo especialista não invalida a entrada já confirmada pelo ORCHESTRATOR.

## Preparar

1. Confirme `RUN_ID`, card, lock, estado `ready_for_validation`, commit fixado, critérios, handoff de review e ambiente autorizado.
2. Reuse a capsule e leia somente especificação, riscos, diff resumido e instruções de teste necessárias.
3. Leia `references/qa-matrix.md` antes de desenhar cenários.
4. Crie matriz critério × cenário × evidência × resultado, incluindo limites negativos e regressão proporcionais ao risco.
5. Use dados descartáveis com o prefixo reservado do adapter. O usuário autorizou a criação livre de usuários QA e massa sintética no banco local de testes declarado pelo projeto; não peça nova autorização para cada fixture, desde que o destino seja o ambiente de QA configurado e não produção.
6. Para critérios de interface, siga `references/local-application-validation.md`; não substitua observação real no navegador por HTML/ASGI quando o critério exige comportamento visual ou interação.

## Executar e concluir

- Observe saídas reais; não marque cenário como aprovado por inferência.
- Consolide todos os defeitos independentes antes de devolver ao DEV, evitando ciclos por descoberta serial evitável.
- Não altere código nem dados que não pertençam à massa QA isolada; não altere critérios para fazer o teste passar.
- Antes de produzir o handoff, publicar comentário ou permitir qualquer transição do card, remova toda conta, registro, arquivo e fixture persistente criada pela execução; verifique a remoção no banco/armazenamento e registre evidência não sensível. Massa preexistente ou alheia à execução nunca deve ser removida.
- O handoff QA deve declarar `deliverable.cleanup`: `not_required` com listas vazias quando nada persistente foi criado, ou `completed` com referências de todos os dados criados e removidos e evidência verificável da limpeza. Se algo criado não puder ser removido, não aprove nem mova o card; trate como impedimento técnico localizado e continue a limpeza segura.
- Faça validação backend e frontend segundo os critérios aplicáveis; para ambiente autenticado/local, siga `references/local-application-validation.md` e o adapter do projeto.
- `approved`: todos os cenários aplicáveis passam e o card pode ir a `ready_for_release`.
- `rejected`: ao menos um cenário falha; retorne ao DEV em `in_development` com evidência reproduzível.
- `blocked`: depois da recuperação proporcional, ambiente ou precondição externa ainda impede conclusão; permaneça no estado e não invente resultado. Use `requires_human: true` somente com `blocker.kind: external_authorization` ou `systemic_risk`; demais impedimentos técnicos são localizados e não encerram outras lanes.

Produza `schema/role-handoff.schema.json` com `role: pipeline-qa` e valide com `../../runtime/src/role-gate.mjs`. QA não concede `APROVADO PARA PRD`.

Preserve o `delivery_group` que veio do PO. Reprovação ou bloqueio de QA é de `card` por padrão; só use escopo de grupo quando a dependência determinante estiver declarada.
