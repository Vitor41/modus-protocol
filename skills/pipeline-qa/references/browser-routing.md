# Rotas de navegador para QA local

Use duas rotas ordenadas para comprovar interface integrada. O adapter do projeto pode restringir as opções, mas não pode transformar uma rota não disponível em evidência presumida.

## Rota principal: navegador automatizado isolado

1. Verifique se o adapter declara o comando/dependência já disponível para Playwright ou automação equivalente e se o navegador pode abrir a origem local do servidor rastreado. Não instale pacotes, baixe browsers nem altere o projeto consumidor para habilitar a rota.
2. Inicie um contexto/perfil efêmero exclusivo do `RUN_ID` (ou um `user-data-dir` temporário dedicado), sem cookies, extensões ou armazenamento do usuário. Restrinja a navegação à origem local declarada e autentique somente com a identidade QA da execução.
3. Faça o preflight antes de testar: confirme processo e revisão do servidor, URL/porta, renderização de uma página autenticada e captura de screenshot. Se o preflight passar, use esta rota para os critérios visuais e de interação.
4. Ao terminar ou falhar, feche somente o contexto/browser e processos filhos iniciados por esta execução; remova perfil temporário e dados de teste próprios após confirmar limpeza. Guarde evidências não sensíveis referenciadas por critério.

## Contingência: perfil QA dedicado no Chrome

Use somente se a rota principal não estiver instalada/disponível ou falhar no preflight por uma limitação demonstrável do executor. A contingência exige uma integração de navegador suportada pelo runtime e um perfil do Chrome dedicado exclusivamente a QA, separado do perfil pessoal do usuário. Um tab novo no Chrome pessoal não é isolamento.

1. Confirme que o provider/extensão de controle está visível para o agente QA, que o perfil é o perfil QA dedicado e que a origem local abre. Não presuma que uma sessão do Chrome visível ao usuário também esteja visível ao subagente.
2. Use uma aba dedicada dentro desse perfil, autentique com a conta QA e valide os mesmos critérios/evidências requeridos na rota principal.
3. Não migre cookies/sessão do perfil pessoal, não controle abas pessoais e não use navegação no perfil pessoal como atalho. Feche somente a aba QA criada pela execução; preserve o perfil dedicado, salvo se ele também for temporário e de propriedade do run.

## Failover e conclusão

- Faça preflight sequencial: principal primeiro; contingência somente após registrar a capacidade ausente ou falha concreta da principal. Nunca execute ambas em paralelo contra a mesma conta ou dados.
- Se uma rota falhar depois de abrir a aplicação ou alterar estado, reconcilie primeiro: identifique a aba/processo/contexto e os dados QA criados, feche apenas recursos próprios, limpe os dados persistidos e confirme readback antes de iniciar a contingência. Não repita ações sem saber se a primeira tentativa teve efeito.
- Se a contingência também falhar, emita `blocked` técnico localizado com rota tentada, capability exata indisponível, preflight observado e recuperação tentada. Não peça decisão humana para uma falha técnica recuperável, não declare aprovação visual e não bloqueie cards/lane independentes.
- Registre no handoff qual rota foi usada, resultado dos preflights, browser/viewport, evidência por critério e limpeza. Credenciais, cookies, tokens e dados pessoais não entram em screenshots, logs ou handoffs.
