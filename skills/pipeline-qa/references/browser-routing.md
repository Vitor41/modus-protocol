# Rotas executáveis de navegador para QA local

O runtime do Modus fornece as duas rotas; não dependa de extensão/provider de browser exposto ao subagente. Ambas usam navegador real, perfil exclusivo do `RUN_ID`, dados de autenticação próprios do QA e só aceitam navegação `http(s)` para `localhost`, `127.0.0.1` ou `::1`.

## Executor local autorizado

As duas rotas iniciam um processo de navegador e abrem conexões HTTP/WebSocket de loopback. O comando herda o sandbox ativo do Codex; trocar Playwright por CDP dentro do mesmo sandbox não remove uma restrição de rede/processo. Use um executor local autorizado e mantenha um único processo `qa-browser --action serve` ativo durante a validação: iniciar cada ação em um comando novo pode encerrar o navegador filho junto com o processo anterior. Playwright e CDP oferecem as mesmas ações: `preflight`, `navigate`, `inspect`, `screenshot`, `click`, `fill`, `upload`, `press` e `viewport`.

- Rode o preflight pela execução local autorizada do Codex. Se a ferramenta de shell expuser `sandbox_permissions`, solicite `require_escalated` somente para o comando `pipeline.ps1 qa-browser`, com justificativa de acesso ao app em loopback e ao perfil temporário do RUN. Se o sandbox padrão devolver `EPERM`, `EACCES`, `ERR_NETWORK_ACCESS_DENIED`, timeout de `connectOverCDP`, `fetch failed` ou `unsettled top-level await`, reconcilie o servidor/perfil e repita o mesmo comando uma vez por essa rota local autorizada. Não amplie permissões do projeto nem use a sessão pessoal.
- Use a rota CDP somente depois que o preflight Playwright falhar também na execução local autorizada. Execute a contingência pelo mesmo executor local autorizado. Se esse executor ou a elevação não estiver disponível, registre a capability ausente como limitação do executor; não declare que o browser ou a aplicação estão indisponíveis.
- Depois de cada falha, confirme processos, porta e perfil antes de retry/failover. Não faça retries cegos nem mantenha duas rotas ativas em paralelo.

## Principal: Playwright em perfil persistente isolado

O runtime usa a dependência pinada `playwright-core` e o Chrome/Edge instalado no host. Ele mantém um processo de navegador próprio, iniciado com perfil em `.pipeline/tmp/qa-browser/<RUN_ID>/playwright/profile`; a página, cookies e armazenamento de sessão permanecem vivos até `shutdown` e nunca são compartilhados com o usuário.

Inicie uma sessão persistente no terminal local autorizado e mantenha-a aberta. A configuração (`route`, raiz e `RUN_ID`) vale para todas as solicitações daquela sessão:

```powershell
../../runtime/pipeline.ps1 qa-browser --action serve --route playwright --project-root <raiz> --run-id <RUN_ID>
```

Envie um objeto JSON por linha ao mesmo terminal; leia uma resposta JSON por linha. Não inicie um novo `pipeline.ps1` para cada ação. Para upload, primeiro grave somente conteúdo sintético dentro de `.pipeline/tmp/qa-browser/<RUN_ID>/playwright/fixtures/`; o campo `filePath` é relativo a `fixtures`, e caminhos absolutos, traversal, symlinks ou arquivos fora do RUN são recusados:

```powershell
{"id":"preflight","action":"preflight","url":"http://127.0.0.1:8001/<rota>","output":"preflight.png"}
{"id":"read","action":"inspect"}
{"id":"login","action":"fill","selector":"input[name=password]","valueEnv":"MODUS_QA_PASSWORD"}
{"id":"import","action":"upload","selector":"input[type=file]","filePath":"fixture.csv"}
{"id":"finish","action":"click","selector":"button[type=submit]"}
{"id":"close","action":"shutdown"}
```

`PASS` no preflight confirma que o navegador iniciou, carregou a página local, encontrou `body` visível e gravou screenshot. As operações `inspect`, `click`, `fill`, `press` e `viewport` usam a mesma sessão viva, retornando estado observado e evidência. Para campos secretos, configure uma variável de ambiente no executor e use `valueEnv`; nunca envie o valor secreto no JSON, argumento ou comentário. `shutdown` encerra o navegador e remove o perfil isolado. Se a sessão do terminal terminar inesperadamente, confira processo, porta e perfil antes de reiniciar ou trocar de rota.

Não use `inspect` como substituto de interação quando o critério exigir um fluxo. O QA interpreta visualmente as capturas pela ferramenta de imagem disponível no host e relaciona cada arquivo ao critério. O runtime não declara aprovação por conta própria.

## Contingência: Chrome QA isolado via CDP

Se Playwright estiver indisponível ou seu preflight falhar por limitação demonstrável, envie `shutdown` e reconcilie primeiro servidor, processo, perfil e dados que a rota principal possa ter alterado. Depois inicie uma sessão persistente separada com `--route cdp`. O runtime inicia Chrome/Edge headless com perfil dedicado e porta CDP efêmera em loopback; não requer provider de browser, extensão nem sessão pessoal. O perfil fica em `.pipeline/tmp/qa-browser/<RUN_ID>/cdp/profile`.

```powershell
../../runtime/pipeline.ps1 qa-browser --action serve --route cdp --project-root <raiz> --run-id <RUN_ID>
```

A contingência recebe as mesmas linhas JSON da sessão persistente, inclusive `upload`, e fornece `preflight`, `inspect`, `click`, `fill`, `press`, `viewport`, screenshots e `shutdown`. O controlador CDP permite somente teclas de navegação comuns; se um fluxo depender de recurso não coberto por essa interface, tente conclui-lo por Playwright depois de recuperar sua falha ou registre a capability concreta indisponível. Não migre para o Chrome pessoal.

## Encerramento e failover

- O preflight é sequencial: Playwright primeiro; CDP apenas se necessário. Nunca controle as duas rotas em paralelo.
- Após ação com possível efeito persistente, reconcilie o estado da aplicação antes de repetir a ação ou trocar de rota.
- Ao concluir, envie `{"action":"shutdown"}` no terminal da sessão e confirme resposta `PASS`; isso encerra e remove o perfil da rota utilizada, preservando screenshots para o handoff.

```powershell
{"action":"shutdown"}
```

- `shutdown`/`stop` encerra somente o processo Chrome criado pela rota (validando PID e diretório de perfil), apaga perfil, cookies, estado da sessão e fixtures temporárias, e preserva screenshots para o handoff. Capturas usam nomes únicos quando `output` não é informado; não sobrescreva evidência de outra ação. Se o processo já não for o processo associado ao perfil esperado, não o encerre.
- Um erro deve indicar rota, ação e capability que faltou. Só depois de falha concreta de ambas as rotas classifique o QA como `blocked` técnico localizado; isso não é decisão humana nem bloqueia cards independentes.
- Registre rota, browser, viewport, URL local sem parâmetros secretos, critérios observados, screenshots e limpeza no handoff. Nunca registre cookies, credenciais, parâmetros sensíveis ou dados pessoais.
