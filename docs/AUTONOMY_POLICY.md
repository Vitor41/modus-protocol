# Política de autonomia dos especialistas

Esta é a fonte canônica para decidir quando o Modus Protocol resolve, retorna trabalho entre papéis ou solicita intervenção humana. Qualidade continua obrigatória; o que muda é quem resolve o desvio.

## Princípio

Problema técnico dentro do escopo aprovado é trabalho da equipe, não gate humano. O especialista investiga, corrige, comprova e continua o loop. Um handoff inválido, teste falho, conflito corrigível, evidência incompleta, estado obsoleto ou indisponibilidade transitória nunca se torna decisão humana apenas porque impediu um gate na primeira tentativa.

## Autonomia obrigatória

Resolva sem solicitar ajuda humana:

- falha transitória em leitura idempotente, releitura ou snapshot;
- divergência mecânica de timestamp, formato, receipt, capsule, lock ou handoff;
- artefato, mock, label, comentário ou evidência ausente que o próprio papel consegue produzir ou reconciliar;
- baseline, teste, build, lint, typecheck ou cenário de QA falho por causa pertencente ao card;
- achado de Code Review ou QA dentro do escopo aprovado;
- bug de implementação, refatoração local, conflito de Git ou ajuste de migração compatível necessário para entregar o card;
- ambiente local recuperável por comandos já autorizados no adapter.

Use até três tentativas totais para leituras idempotentes do tracker. Para lançamento de papel, tente no máximo duas vezes com a mesma configuração e sem fallback de modelo; se existir artefato, prefira repará-lo uma vez a repetir trabalho. Escritas de efeito externo nunca recebem repetição cega: releia a referência ou o estado oficial e reconcilie.

Falha técnica ainda não resolvida após esse orçamento vira impedimento técnico localizado, com diagnóstico e próximo experimento. Ela não pede decisão humana e não encerra lanes independentes.

## Intervenção humana

`requires_human: true` só é válido com um `blocker.kind` explícito:

- `business_rule`: duas ou mais interpretações materiais permanecem possíveis após investigação;
- `screen_approval`: evidência visual vigente aguarda aprovação;
- `production_approval`: entrega validada aguarda autorização para integração/release;
- `loop_limit`: o mesmo retorno atingiu o limite canônico;
- `structural_scope`: a solução exige ampliar o escopo ou alterar contrato, classe/fundação transversal ou arquitetura aprovada além do card;
- `systemic_risk`: há risco plausível de perda de dados, quebra sistêmica, segurança ou regressão ampla que não pode ser contido no escopo;
- `external_authorization`: falta credencial, permissão ou autorização para uma ação externa necessária.

Uma refatoração local ou correção arquitetural contida no card permanece autônoma. Somente mudança transversal de arquitetura, contrato ou escopo usa `structural_scope`.

## Aplicação do gate

Gate reprovado preserva qualidade, mas não define sozinho uma parada. O resultado deve indicar a recuperação:

- reparar handoff ou receipt e validar novamente;
- reler estado/evidência oficial e replanejar;
- retornar ao especialista responsável;
- retomar integração de release já autorizada.

O orquestrador só encerra toda a execução quando não houver trabalho automático elegível ou uma falha global comprovada impedir todas as lanes depois das recuperações limitadas.
