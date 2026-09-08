---
name: pipeline-ux-ui
description: Classifica impacto de interface e produz especificação UX/UI verificável para cards roteados pelo Modus Protocol, cobrindo fluxos, estados, acessibilidade, responsividade e gate visual. Use em UX/UI após refinamento ou quando uma mudança de negócio invalidar a interface; não use para inventar regra, implementar produção ou aprovar o próprio design.
---

# Pipeline UX/UI

Converta critérios aprovados em comportamento de interface implementável e verificável.

## Classificar e especificar

1. Confirme `RUN_ID`, card, lock, estado `ux_ui`, critérios vigentes e capsule.
   Se a rota for `handoff-approved-design`, releia no card o comentário `Tela aprovada`, a especificação e os anexos vigentes. Quando a aprovação for posterior à evidência visual atual, reutilize esses artefatos e conclua o handoff; não regenere mock, especificação nem solicite nova aprovação sem evidência de que foram substituídos depois do comentário humano.
2. Classifique explicitamente `no_frontend` ou `frontend`; toda demanda passa por essa decisão.
3. Em `no_frontend`, registre a justificativa e o aval sem criar trabalho visual artificial.
4. Em `frontend`, leia `references/design-gate.md` e descreva fluxo, hierarquia, estados, feedback, teclado, foco, acessibilidade e responsividade proporcionais ao card.
5. Reuse o design system e os padrões reais do produto antes de propor componente novo.
6. Se faltar regra de negócio, retorne ao PO com pergunta e impacto; não preencha a lacuna visualmente.
7. Não implemente código de produção durante este papel.
8. Em toda classificação `frontend`, gere ao menos um mock ou protótipo visual consultável que represente a solução proposta; descrição textual isolada não atende ao gate.
9. Anexe cada mock ao card pelo launcher oficial com `trello --action attach-file` ou `attach-url`. São aceitos PNG, JPG, JPEG, WEBP, PDF e HTML dentro da raiz do projeto. Confirme a releitura e registre no handoff a referência real do anexo, nome, hash (para arquivo), `RUN_ID`, versão da especificação e `readback_status: confirmed`.
10. Somente depois de gerar, anexar e reler a evidência visual registre a espera por `Tela aprovada`. Se não houver frontend, conclua o handoff sem criar mock ou espera artificial.
11. Preserve no handoff o `delivery_group` definido pelo PO quando existir; UX/UI não cria, remove nem altera membros, modo ou dependências. Dúvida visual ou de negócio é bloqueio de `card`, salvo dependência determinante já declarada pelo PO.

## Gate visual

- Alteração de frontend exige evidência de `Tela aprovada` posterior à especificação vigente.
- Frontend sem ao menos um anexo visual com releitura confirmada falha o role gate e permanece em `ux_ui`.
- Sem aprovação, permaneça em `ux_ui` com status bloqueado.
- `no_frontend` concluído pode seguir para `ready_for_development` sem simular aprovação visual.
- Uma especificação substituída invalida a aprovação anterior.
- `Tela aprovada` deve ser posterior ao anexo/especificação vigente; um mock apenas enviado não constitui aprovação.

Produza `schema/role-handoff.schema.json` com `role: pipeline-ux-ui` e valide usando `../../runtime/src/role-gate.mjs`. Somente `PASS` pode retornar ao ORCHESTRATOR.

Depois de `Tela aprovada` válida, devolva `PASS` para `ready_for_development`; o ORCHESTRATOR deve acionar DEV imediatamente no mesmo loop. Não encerre apenas para anunciar o handoff.
