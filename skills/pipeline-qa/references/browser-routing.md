# Rotas executáveis de navegador para QA local

O runtime do Modus fornece as duas rotas; não dependa de extensão/provider de browser exposto ao subagente. Ambas usam navegador real, perfil exclusivo do `RUN_ID`, dados de autenticação próprios do QA e só aceitam navegação `http(s)` para `localhost`, `127.0.0.1` ou `::1`.

## Principal: Playwright em perfil persistente isolado

O runtime usa a dependência pinada `playwright-core` e o Chrome/Edge instalado no host. Ele mantém um processo de navegador próprio, iniciado com perfil em `.pipeline/tmp/qa-browser/<RUN_ID>/playwright/profile`, e reconecta o Playwright entre operações; a página, cookies e armazenamento de sessão permanecem vivos até `stop` e nunca são compartilhados com o usuário.

Faça primeiro o preflight contra a URL local rastreada:

```powershell
../../runtime/pipeline.ps1 qa-browser --action preflight --route playwright --project-root <raiz> --run-id <RUN_ID> --url http://127.0.0.1:8001/<rota> --output preflight.png
```

`PASS` confirma que o navegador iniciou, carregou a página local, encontrou `body` visível e gravou screenshot. Em seguida use `inspect` para ler título, texto e controles reais; `click`, `fill`, `press` e `viewport` executam interação; cada ação retorna screenshot e estado observado. Para campos secretos, passe o nome de uma variável de ambiente com `--value-env`, nunca o valor como argumento ou comentário. Exemplo:

```powershell
../../runtime/pipeline.ps1 qa-browser --action fill --route playwright --project-root <raiz> --run-id <RUN_ID> --selector "input[name=password]" --value-env MODUS_QA_PASSWORD
```

Não use `inspect` como substituto de interação quando o critério exigir um fluxo. O QA interpreta visualmente as capturas pela ferramenta de imagem disponível no host e relaciona cada arquivo ao critério. O runtime não declara aprovação por conta própria.

## Contingência: Chrome QA isolado via CDP

Se Playwright estiver indisponível ou seu preflight falhar por limitação demonstrável, reconcilie primeiro servidor, perfil e dados que a rota principal possa ter alterado. Depois rode o mesmo `qa-browser` com `--route cdp`. O runtime inicia Chrome/Edge headless com perfil dedicado e porta CDP efêmera em loopback; não requer provider de browser, extensão nem sessão pessoal. O perfil fica em `.pipeline/tmp/qa-browser/<RUN_ID>/cdp/profile`.

```powershell
../../runtime/pipeline.ps1 qa-browser --action preflight --route cdp --project-root <raiz> --run-id <RUN_ID> --url http://127.0.0.1:8001/<rota> --output preflight-cdp.png
```

A contingência fornece `inspect`, `click`, `fill`, `press`, `viewport` e screenshots pelas mesmas opções. O controlador CDP permite somente teclas de navegação comuns; se um fluxo depender de recurso não coberto por essa interface, tente conclui-lo por Playwright depois de recuperar sua falha ou registre a capability concreta indisponível. Não migre para o Chrome pessoal.

## Encerramento e failover

- O preflight é sequencial: Playwright primeiro; CDP apenas se necessário. Nunca controle as duas rotas em paralelo.
- Após ação com possível efeito persistente, reconcilie o estado da aplicação antes de repetir a ação ou trocar de rota.
- Ao concluir, encerre e remova o perfil da rota utilizada:

```powershell
../../runtime/pipeline.ps1 qa-browser --action stop --route playwright --project-root <raiz> --run-id <RUN_ID>
```

- `stop` encerra somente o processo Chrome criado pela rota (validando PID e diretório de perfil), apaga perfil, cookies e estado da sessão e preserva screenshots para o handoff. Se o processo já não for o processo associado ao perfil esperado, não o encerre.
- Um erro deve indicar rota, ação e capability que faltou. Só depois de falha concreta de ambas as rotas classifique o QA como `blocked` técnico localizado; isso não é decisão humana nem bloqueia cards independentes.
- Registre rota, browser, viewport, URL local sem parâmetros secretos, critérios observados, screenshots e limpeza no handoff. Nunca registre cookies, credenciais, parâmetros sensíveis ou dados pessoais.
