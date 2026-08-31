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
