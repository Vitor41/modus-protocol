# Empacotamento do Plugin Local v0.1

O plugin `unified-development-pipeline` distribui as oito Skills, quatro schemas e seis executáveis do runtime sem transformar o artefato instalado em fonte editável.

## Fonte e artefato

| Item | Local |
|---|---|
| Skills canônicas | `skills/` |
| Runtime canônico | `runtime/src/` |
| Schemas canônicos | `schema/` |
| Manifest fonte | `packaging/plugin.json` |
| Marketplace local | `local-marketplace/.agents/plugins/marketplace.json` |
| Artefato gerado | `local-marketplace/plugins/unified-development-pipeline/` |

O artefato é ignorado pelo Git e sempre regenerado. Alterá-lo manualmente é proibido porque o próximo build descarta essas mudanças.

## Build reproduzível

O build requer Node.js 20+, dependências fixadas pelo lockfile e executa:

```text
node runtime/scripts/build-plugin.mjs
```

Ele:

1. verifica que existem exatamente as oito Skills aprovadas;
2. recria somente o destino conhecido e validado do plugin;
3. copia Skills e schemas da fonte canônica;
4. empacota doctor, setup, planner e role gate como ESM standalone;
5. remove a necessidade de `node_modules` no plugin;
6. grava `build-info.json` com catálogo, versões e hashes das entradas principais.

## Validações

A suíte comprova:

- catálogo exato de oito Skills;
- igualdade byte a byte entre Skills fonte e empacotadas;
- doctor standalone;
- role gate standalone;
- paridade de versão entre manifest, runtime e build-info;
- validade do manifest pelo validador oficial.

O cache instalado deve passar pelo mesmo validador antes de um projeto consumidor adotar a versão.

## Marketplace e instalação

Identidades locais:

- marketplace: `unified-development-pipeline-local`;
- plugin: `unified-development-pipeline`;
- versão atual: `0.1.4`.

Instalação inicial:

```text
codex plugin marketplace add <repo>/local-marketplace
codex plugin add unified-development-pipeline@unified-development-pipeline-local
```

O marketplace e o plugin foram instalados e confirmados localmente em 2026-08-28. Isso instala capacidades no Codex, mas não conecta, modifica ou autoriza cutover de projeto consumidor.

## Atualizações durante desenvolvimento

Após alterar a fonte:

1. executar testes e build;
2. validar o artefato;
3. ler/confirmar o nome do marketplace com o helper oficial;
4. aplicar um único cachebuster ao manifest gerado usando o helper oficial;
5. reinstalar `unified-development-pipeline@unified-development-pipeline-local`;
6. iniciar uma nova tarefa do Codex para carregar a versão atualizada.

O cachebuster não altera a versão funcional do Kernel. Releases promovidas incrementam SemVer; cachebuster serve apenas à iteração local.

## Limites

- O nome público é Modus Protocol, sob licença MIT, com repositório oficial em `github.com/Vitor41/modus-protocol`.
- Não há MCP ou app embutido; Trello será acessado pela integração autorizada disponível no ambiente.
- O plugin não inclui credenciais nem dados dos projetos.
- Dois adapters privados concluíram cutover técnico no Kernel `0.1.7`; somente evidências sanitizadas são publicadas.
