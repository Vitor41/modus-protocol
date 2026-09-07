# Início rápido

Este guia conecta um projeto ao Modus Protocol e deixa explícito como disparar a fila. Instalar o plugin não autoriza alterar um projeto; o cutover deve ser revisado e aprovado pelo responsável.

## 1. Instale o plugin

Em um checkout identificado do repositório, gere primeiro o artefato local reproduzível:

```powershell
pnpm --dir runtime install --frozen-lockfile
pnpm --dir runtime run build:plugin
```

Depois registre o marketplace e instale o plugin:

```powershell
codex plugin marketplace add <caminho-absoluto-do-repositorio>\local-marketplace
codex plugin add unified-development-pipeline@unified-development-pipeline-local
```

Depois da instalação ou atualização, reinicie completamente o Codex e crie uma nova tarefa. Skills já carregadas em uma tarefa aberta não são substituídas.

## 2. Crie o adapter do projeto

Copie `examples/project.adapter.example.yaml` para `<projeto>/.pipeline/project.adapter.yaml` e preencha identidade, versão mínima do Kernel, board e listas, chaves e labels, providers, contexto, comandos, Git, QA e segurança.

Credenciais nunca entram no adapter nem no Git. Com provider `environment`, declare apenas `tracker.environment.credential_file`, apontando para um arquivo local ignorado pelo Git.

## 3. Configure o gatilho

Adicione ao `AGENTS.md` da raiz do projeto:

```markdown
## Modus Protocol

Ao receber exatamente `Processe a fila do Trello.`, use exclusivamente `$pipeline-run` com `.pipeline/project.adapter.yaml`.
Não use uma esteira, skill ou comando legado como fallback.
Antes de acessar o Trello, execute o status de versão exigido pela skill e interrompa se a tarefa estiver usando um runtime incompatível ou obsoleto.
```

O texto que inicia o processamento é exatamente:

```text
Processe a fila do Trello.
```

O gatilho entra no roteador. O loop continua automaticamente entre PO, UX/UI, DEV, Code Review e QA e só para diante de gate humano, dúvida real, limite de retorno ou falha comprovada.

## 4. Valide antes do cutover

Em uma nova tarefa do Codex, execute primeiro:

```powershell
<runtime-do-plugin>\pipeline.ps1 doctor --project-root <projeto> --mode structural --format json
```

O resultado deve ser `PASS`. Depois execute doctor shadow com snapshot somente leitura e um shadow run. O gatilho operacional usa diretamente o plugin carregado pela nova tarefa.

## 5. Faça o cutover e o primeiro teste

Após revisar adapter, `AGENTS.md`, Trello e rollback:

1. remova do gatilho qualquer roteador legado concorrente;
2. confirme o doctor em modo `cutover`;
3. abra uma nova tarefa do Codex na raiz do projeto;
4. envie `Processe a fila do Trello.`;
5. confira versão, origem, `RUN_ID`, card/lote, papel, modelo e esforço;
6. confirme no Trello comentários, anexos e movimentos por releitura.

Para atualizar, leia o changelog, reinstale a release, reinicie o Codex e abra nova tarefa. Não altere o adapter apenas para refletir versão: o plugin ativo é a fonte única. Consulte [Instalação e atualizações](INSTALLATION_AND_UPDATES.md) e [Rollback](ROLLBACK.md).
