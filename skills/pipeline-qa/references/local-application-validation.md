# Validar aplicação local

Use esta sequência quando um critério depender de comportamento integrado de frontend, backend ou autenticação. As declarações do adapter e as instruções versionadas do projeto definem comandos, portas, healthcheck, navegador, dados de teste e limites; esta referência define como o QA deve aplicá-los.

## Preparar o ambiente

1. Fixe o projeto, diretório de trabalho e commit candidato do handoff. Confirme que o servidor disponível corresponde a esse projeto e revisão; uma URL aberta, sozinha, não prova isso.
2. Prefira um serviço de QA já disponível e autorizado pelo usuário. Se precisar iniciar um servidor, escolha um `environment` do adapter destinado a QA, use sua estratégia de porta livre e somente portas declaradas (normalmente 8001 ou superiores). Não ocupe, encerre ou substitua um processo existente; não use a porta de desenvolvimento do usuário sem confirmar identidade, revisão e segurança dos dados.
3. Acompanhe o processo iniciado, valide o healthcheck configurado e encerre somente o processo filho que esta execução iniciou. Se inicialização ou healthcheck falhar, diagnostique a causa e tente uma alternativa local segura documentada pelo projeto antes de classificar impedimento.
   - No Windows, se o controlador falhar ao preparar um Job Object antes do spawn, capture a exceção original, a etapa/API (criação, `KILL_ON_JOB_CLOSE`, associação do processo ou início do filho) e o código Win32 retornado por `GetLastWin32Error()`. Não reduza a causa a “Job Object falhou” e não faça retry idêntico sem mudança. Corrija a etapa identificada ou use uma alternativa documentada e materialmente diferente; nunca inicie servidor sem rastreamento para contornar o erro.
4. Não instale dependências nem invente comandos para contornar o adapter. `TestClient`, chamada direta de função ou teste ASGI podem complementar testes de backend, mas não comprovam renderização, responsividade, foco, JavaScript ou experiência real no navegador.

## Autenticação e massa

- Use primeiro uma identidade QA/local já existente e documentada. Não reutilize conta ou sessão de produção.
- Se não existir identidade, o QA pode criar a conta e os dados sintéticos necessários sem pedir autorização humana item a item quando o adapter/runbook identificar o perfil como QA local e o destino efetivo for o banco de testes do projeto. Confirme o destino antes da primeira escrita; conceda somente os privilégios requeridos pelos critérios. Nunca use produção. Se o destino não puder ser confirmado como QA, não escreva e reporte o impedimento técnico localizado.
- Prefixe usuários e registros criados com o identificador QA declarado pelo adapter, vinculado ao card/run. Prefira fixtures, seeders ou interfaces suportadas pelo projeto; evite escrita SQL direta se houver caminho de aplicação. Não altere contas, registros financeiros, históricos ou dados que não pertençam à execução.
- A massa persistente é descartável por padrão: antes de encerrar QA, comentar o resultado ou mover o card, remova contas, registros, arquivos e fixtures criados pela execução e confirme por releitura que não restaram. A limpeza é limitada ao prefixo/refs criados por esse QA (`own-data-only`); nunca remova dados preexistentes ou de outra execução. Preserve evidência não sensível da limpeza; nunca copie senhas, tokens ou dados financeiros reais para logs/handoffs. Se a limpeza falhar, o QA não pode aprovar nem liberar a transição.
- Registre no handoff `deliverable.cleanup`: `not_required` e arrays vazios quando não houve escrita persistente; caso contrário `completed`, as refs criadas e removidas e uma referência à evidência da verificação final. Não conclua o papel sem esse recibo.

## Validar backend e interface

- Backend: cubra autorização permitida/negada, validação, respostas e erros, persistência/releitura, atomicidade/idempotência e isolamento quando aplicáveis. Consulte o banco apenas para confirmar efeitos previstos, sem modificar dados alheios ao teste.
- Interface integrada: abra a aplicação no navegador autorizado, autentique-se com identidade QA ou sessão local explicitamente disponibilizada, navegue pelos fluxos do card e observe o resultado renderizado. Cubra desktop e móvel quando exigido pelo adapter/critério; valide teclado, foco, mensagens, estados e interação relevantes. Colete capturas ou outra evidência visual ligada ao critério e inspecione erros de console/rede quando suportado.
- Uma sessão existente do usuário pode ser reutilizada apenas dentro do escopo explicitamente autorizado e sem realizar operações sobre dados reais. Para ações que persistam dados, use massa QA isolada; se isso não puder ser assegurado, não submeta o formulário e não declare o critério aprovado.
- Registre por critério o navegador/viewport, commit, passos, resultado observado e referência de evidência. Distinga evidência visual real de teste automatizado de API ou template.

Não declare `approved` enquanto critérios visuais aplicáveis permanecerem sem observação visual real. Se a sessão, servidor, identidade ou banco não puder ser usado após recuperação segura, `blocked` deve descrever exatamente a capability/precondição ausente, não presumir defeito do produto nem pedir decisão humana quando for problema técnico recuperável.
