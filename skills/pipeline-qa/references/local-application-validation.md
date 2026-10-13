# Validar aplicação local

Use esta sequência quando um critério depender de comportamento integrado de frontend, backend ou autenticação. As declarações do adapter e as instruções versionadas do projeto definem comandos, portas, healthcheck, navegador, dados de teste e limites; esta referência define como o QA deve aplicá-los.

## Preparar o ambiente

1. Fixe o projeto, diretório de trabalho e commit candidato do handoff. Confirme que o servidor disponível corresponde a esse projeto e revisão; uma URL aberta, sozinha, não prova isso.
2. Prefira um serviço de QA já disponível e autorizado pelo usuário. Se precisar iniciar um servidor, escolha um `environment` do adapter destinado a QA, use sua estratégia de porta livre e somente portas declaradas (normalmente 8001 ou superiores). Não ocupe, encerre ou substitua um processo existente; não use a porta de desenvolvimento do usuário sem confirmar identidade, revisão e segurança dos dados.
3. Acompanhe o processo iniciado, valide o healthcheck configurado e encerre somente o processo filho que esta execução iniciou. Se inicialização ou healthcheck falhar, diagnostique a causa e tente uma alternativa local segura documentada pelo projeto antes de classificar impedimento.
4. Não instale dependências nem invente comandos para contornar o adapter. `TestClient`, chamada direta de função ou teste ASGI podem complementar testes de backend, mas não comprovam renderização, responsividade, foco, JavaScript ou experiência real no navegador.

## Autenticação e massa

- Use primeiro uma identidade QA/local já existente e documentada. Não reutilize conta ou sessão de produção.
- Se não existir identidade, o QA pode preparar uma conta de teste somente quando o adapter ou runbook comprovar que o banco conectado é local/não produtivo, a operação está autorizada para QA e o caminho de criação é seguro. Verifique o destino antes de escrever; conceda somente os privilégios requeridos pelos critérios. Se o destino não puder ser provado como isolado, não crie usuário nem altere dados: reporte o impedimento técnico localizado.
- Prefixe usuários e registros criados com o identificador QA declarado pelo adapter, vinculado ao card/run. Prefira fixtures, seeders ou interfaces suportadas pelo projeto; evite escrita SQL direta se houver caminho de aplicação. Não altere contas, registros financeiros, históricos ou dados que não pertençam à execução.
- Limpe apenas os dados descartáveis criados pelo próprio QA, conforme o contrato `own-data-only`. Preserve evidência não sensível da limpeza; nunca copie senhas, tokens ou dados financeiros reais para logs/handoffs.

## Validar backend e interface

- Backend: cubra autorização permitida/negada, validação, respostas e erros, persistência/releitura, atomicidade/idempotência e isolamento quando aplicáveis. Consulte o banco apenas para confirmar efeitos previstos, sem modificar dados alheios ao teste.
- Interface integrada: abra a aplicação no navegador autorizado, autentique-se com identidade QA ou sessão local explicitamente disponibilizada, navegue pelos fluxos do card e observe o resultado renderizado. Cubra desktop e móvel quando exigido pelo adapter/critério; valide teclado, foco, mensagens, estados e interação relevantes. Colete capturas ou outra evidência visual ligada ao critério e inspecione erros de console/rede quando suportado.
- Uma sessão existente do usuário pode ser reutilizada apenas dentro do escopo explicitamente autorizado e sem realizar operações sobre dados reais. Para ações que persistam dados, use massa QA isolada; se isso não puder ser assegurado, não submeta o formulário e não declare o critério aprovado.
- Registre por critério o navegador/viewport, commit, passos, resultado observado e referência de evidência. Distinga evidência visual real de teste automatizado de API ou template.

Não declare `approved` enquanto critérios visuais aplicáveis permanecerem sem observação visual real. Se a sessão, servidor, identidade ou banco não puder ser usado após recuperação segura, `blocked` deve descrever exatamente a capability/precondição ausente, não presumir defeito do produto nem pedir decisão humana quando for problema técnico recuperável.
