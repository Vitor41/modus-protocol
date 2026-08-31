# Orientações do repositório

## Fase atual

Este repositório está na implementação experimental da v0.1. `docs/MODUS_PROTOCOL.md` define a arquitetura; schemas, runtime e Skills versionados são contratos executáveis.

Implemente somente a capacidade explicitamente aprovada e mantenha testes proporcionais. Não conecte, migre ou altere projetos consumidores sem autorização específica de cutover.

## Regras de manutenção

- Preserve a separação entre núcleo genérico e adaptadores de projeto.
- Não coloque IDs de boards, credenciais, stacks ou regras de negócio específicas no núcleo.
- Mantenha este `AGENTS.md` curto; procedimentos detalhados pertencem aos documentos apontados.
- Registre mudanças materiais no `CHANGELOG.md`.
- Não atualize silenciosamente um projeto consumidor.
- Trate dependências externas como componentes pinados, licenciados e auditáveis.
- Prefira uma única fonte canônica para cada regra; referências devem apontar para ela em vez de repeti-la.

## Validação

Antes de concluir uma mudança no Modus Protocol:

- confirme que as movimentações do Trello continuam usando somente as colunas definidas;
- confirme que cada gate possui entrada, evidência de saída e próximo estado;
- confirme que não surgiu acoplamento indevido a um projeto específico;
- revise referências e termos compartilhados;
- inspecione o diff e atualize o histórico quando aplicável.

Antes de concluir uma mudança executável:

- rode fixtures e testes afetados;
- valide Skills com o validador oficial disponível;
- valide handoffs de papel contra `schema/role-handoff.schema.json` e o gate semântico;
- preserve comportamento somente leitura em doctor e shadow run;
- não execute comandos declarados por um adapter durante diagnóstico;
- confirme que nenhuma credencial ou identificador real foi introduzido no núcleo.
- regenere e valide o plugin quando Skills, runtime, schemas ou manifest forem alterados.
