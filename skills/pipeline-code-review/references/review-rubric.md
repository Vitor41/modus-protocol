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

Severidade mede impacto, não necessidade de intervenção humana. Achados `critical` e `high` dentro do escopo retornam ao DEV; somente mudança estrutural fora do card, risco sistêmico não contido ou autorização externa ausente justificam bloqueio humano.

## Contrato do retorno

Um veredito `changes_required` é handoff de retorno, nunca conclusão: use `status: return`, preserve `in_development` e inclua blocker com motivo, `requires_human: false`, `kind: technical`, `scope: card` e `return_to: pipeline-dev`. Valide o arquivo completo antes de devolvê-lo ao ORCHESTRATOR; reparar apenas o status sem materializar o blocker continua inválido.
