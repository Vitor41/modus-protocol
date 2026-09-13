# Rubrica de Code Review

## SPEC

- cada critério possui implementação e evidência compatível;
- fluxos negativos, autorização e estados relevantes não foram omitidos;
- não existe comportamento novo fora do escopo;
- regras confirmadas não foram substituídas por suposição;
- UX/UI aprovada foi preservada quando aplicável.

## STANDARDS

- correção e integridade de dados;
- autenticação, autorização, exposição e segredo;
- transações, concorrência, idempotência e rollback quando aplicáveis;
- compatibilidade histórica e migrações;
- erros observáveis sem vazamento sensível;
- arquitetura e dependências existentes reutilizadas;
- testes nos limites públicos relevantes;
- complexidade proporcional ao problema.

## Severidade

- `critical`: perda, exposição, produção ou falha sistêmica provável;
- `high`: requisito central incorreto, vulnerabilidade ou regressão material;
- `medium`: defeito real de escopo limitado ou manutenção arriscada;
- `low`: melhoria concreta, não preferência estética.

Um achado deve permitir ação: explique condição, impacto e mudança esperada. Não escreva a solução completa nem modifique o diff durante a revisão.

## Proporcionalidade e decisão

Classifique no texto de cada achado se há defeito no candidato atual, lacuna de evidência ou melhoria opcional. Descreva a condição, o comportamento afetado e a prova observada; uma falha de teste sob código artificialmente alterado demonstra sensibilidade insuficiente do teste, não um defeito presente no candidato.

- `critical` e `high` impedem aprovação enquanto permanecerem abertos.
- `medium` justifica retorno quando demonstra violação verificável de critério aprovado ou risco concreto que precisa ser resolvido antes da entrega. A expressão genérica "manutenção arriscada" não é suficiente.
- `low` é recomendação não bloqueante. Registre-a em um handoff `approved` quando não houver outro impedimento, sem consumir um ciclo de correção apenas por ela.

Uma lacuna de testes bloqueia somente quando um comportamento material aprovado permanece sem prova confiável. Identifique esse comportamento, explique por que a evidência existente não o comprova e indique a menor verificação suficiente. Aceite evidência equivalente fiel ao limite público relevante; não exija uma biblioteca, um harness específico ou resistência a toda mutação imaginável. Inspeção textual não equivale a executar uma interação, mas a ausência de um teste automatizado específico, isoladamente, também não prova que o produto falha.

Mutações podem revelar testes que não exercitam o fluxo alegado. Use-as como diagnóstico direcionado ao risco, sem convertê-las em requisito universal ou ampliar sucessivamente o escopo de validação. Preserve as regressões necessárias para defeitos corrigidos, integridade, autorização, concorrência e contratos centrais. Para interfaces, considere a evidência renderizada e comportamental disponível, além dos testes automatizados.

Consolide na primeira revisão os achados sustentáveis do diff completo. No reteste, distinga pendência anterior, regressão introduzida pela correção e descoberta tardia; justifique o impacto de um novo bloqueio. Um achado material novo continua válido, mas melhorar indefinidamente a prova sem risco adicional demonstrado não impede encaminhar a entrega ao QA independente.

Severidade mede impacto, não necessidade de intervenção humana. Achados `critical` e `high` dentro do escopo retornam ao DEV; somente mudança estrutural fora do card, risco sistêmico não contido ou autorização externa ausente justificam bloqueio humano.

## Contrato do retorno

Um veredito `changes_required` é handoff de retorno, nunca conclusão: use `status: return`, preserve `in_development` e inclua blocker com motivo, `requires_human: false`, `kind: technical`, `scope: card` e `return_to: pipeline-dev`. Valide o arquivo completo antes de devolvê-lo ao ORCHESTRATOR; reparar apenas o status sem materializar o blocker continua inválido.
