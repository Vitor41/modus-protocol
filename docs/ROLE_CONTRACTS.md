# Contratos dos Papéis v0.1

As cinco Skills de papel compartilham um handoff validável. O objetivo é impedir que uma resposta convincente, porém incompleta, atravesse um gate sem evidência.

## Contrato comum

O schema [role-handoff.schema.json](../schema/role-handoff.schema.json) exige:

- `RUN_ID`, card, papel, perfil e tipo de iteração;
- solicitação de execução e recibo observado de modelo, esforço, agente e fallback;
- estado de origem e transição recomendada;
- status `completed`, `blocked` ou `return`;
- capsule reutilizada e caminhos realmente lidos;
- evidências, riscos, resumo e próximo passo;
- entrega específica do papel ou bloqueio explícito.

O gate é somente leitura:

```text
node runtime/src/role-gate.mjs --handoff <arquivo> --format json
```

`PASS` permite que o ORCHESTRATOR considere o handoff. Ele não aplica transição, não escreve no tracker e não substitui avaliação humana de regra de negócio ou design.

## Saída por papel

| Papel | Evidência mínima | Transição de sucesso |
|---|---|---|
| PO | Escopo, regras, critérios, impactos e ausência de pergunta material aberta | `refinement → ux_ui` |
| UX/UI | Classificação; em frontend, fluxo, estados, acessibilidade, responsividade e aprovação vigente | `ux_ui → ready_for_development` |
| DEV | Checkpoint, baseline, mudanças, testes, validações e diff revisado | Permanece em `in_development` para review |
| Code Review | Diff fixado, eixos SPEC/STANDARDS, testes observados e veredito | `in_development → ready_for_validation` |
| QA | Commit fixado e matriz critério × cenário × evidência × resultado | `ready_for_validation → ready_for_release` |

Retornos seguem a máquina canônica. Papel bloqueado permanece no estado atual. Code Review reprovado e QA reprovado retornam ao DEV sem criar coluna adicional.

## Proteções de qualidade

- PO inicial não pula UX/UI, mesmo quando suspeita que não há frontend.
- UX/UI não aprova a própria especificação.
- DEV não edita antes de `APTO PARA IMPLEMENTAR`, não conclui com falha e não registra autoaprovação de Review/QA.
- Review não reprova sem achado acionável e não aprova com achado crítico/alto.
- QA não aprova cenário falho nem reprova sem falha reproduzível.
- Chaves com aparência de segredo são rejeitadas sem exibir o valor.
- Herança implícita, modelo/esforço não confirmados, divergência do perfil e fallback são rejeitados.

## Estratégia do DEV

O baseline permanece DEV Full Stack responsável pela fatia vertical. Especializações de frontend, backend, banco, BI/dados e segurança entram por sinais objetivos e devolvem contribuição delimitada; não criam handoffs obrigatórios para todo card.

Esse desenho reduz duas causas de retrabalho observadas: entrega sem feedback suficiente e fragmentação de responsabilidade entre camadas. A Skill de DEV carrega referências adicionais somente quando começa a editar, investiga bug difícil ou detecta risco especializado.

## Auditoria da execução

O mapeamento e o significado de `confirmed` estão definidos em [EXECUTION_AUDIT.md](EXECUTION_AUDIT.md). Review e QA exigem `agent_mode: independent`; os demais papéis usam agente delegado para que modelo e esforço possam ser selecionados e comprovados por etapa.

## Limites atuais

- O gate valida completude e coerência interna; aderência semântica ao produto ainda exige judge/humano nos casos definidos pelos evals.
- As cinco Skills foram exercitadas por fixtures; DEV, Review e QA também possuem evidência em piloto controlado, e PO/UX/UI seguem cobertos por gates determinísticos e execuções reais proporcionais.
- Tokens e tempo permanecem `not_observable` quando a plataforma não os expõe; modelo e esforço não podem usar essa exceção em execução ao vivo.
