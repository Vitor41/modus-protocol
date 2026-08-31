# Modus Protocol

Modus Protocol é um sistema versionado de governança e execução para desenvolvimento de software com agentes de IA. Ele conecta projetos diferentes a um Kernel comum sem copiar workflows, skills e políticas para cada repositório.

Repositório oficial: [github.com/Vitor41/modus-protocol](https://github.com/Vitor41/modus-protocol).

> Estado: v0.1 candidata à primeira publicação pública. O Kernel e o plugin estão na versão `0.1.7`.

## O que ele resolve

- transforma uma fila do Trello em handoffs verificáveis entre PO, UX/UI, DEV, Code Review e QA;
- mantém regras de domínio no projeto consumidor e comportamento comum no Kernel;
- carrega contexto progressivamente para reduzir releitura e consumo desnecessário;
- exige evidências antes de movimentar cards;
- audita modelo, esforço, locks, cápsulas, testes e gates humanos;
- bloqueia deploy, produção, segredos e ações destrutivas fora da autorização recebida.

## Arquitetura

```text
gatilho do projeto
       ↓
AGENTS.md fino
       ↓
pipeline-run do Modus Protocol
       ↓
.pipeline/project.adapter.yaml
       ↓
Trello + contexto + comandos + políticas locais
```

`unified-development-pipeline` permanece como identificador técnico compatível do plugin e do Kernel na série v0.1. O nome público e a interface são **Modus Protocol**. Essa separação evita quebrar adapters já instalados.

## Capacidades da v0.1

- oito skills empacotadas;
- adapter YAML validado por JSON Schema;
- doctor estrutural, shadow e cutover;
- planner determinístico e perfis de execução;
- cliente Trello com snapshot, comentários, anexos e movimentação com releitura;
- gates de papel e transição;
- lotes coesos definidos exclusivamente pelo PO;
- release condicionada a push, PR, checks, conflitos resolvidos e merge;
- runtime standalone e build reproduzível do plugin.

## Requisitos

- Codex com suporte a plugins locais;
- PowerShell 7 no Windows para o launcher atual;
- Node.js 22.13 ou superior para desenvolver e empacotar o Kernel; o runtime gerado continua compatível com Node.js 20+;
- pnpm 11 para instalar as dependências de desenvolvimento;
- Trello com credenciais fornecidas externamente pelo projeto consumidor.

## Começando

1. Leia [Modus Protocol v0.1](docs/MODUS_PROTOCOL.md).
2. Consulte [instalação e atualizações](docs/INSTALLATION_AND_UPDATES.md).
3. Copie e adapte somente o [adapter neutro](examples/project.adapter.example.yaml).
4. Execute o doctor em modo estrutural e depois em shadow.
5. Faça cutover somente após revisão explícita do adapter e do `AGENTS.md`.

Instalar o plugin nunca autoriza modificar um projeto, escrever no Trello ou acessar produção.

## Desenvolvimento

```powershell
cd runtime
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm run build:plugin
```

Antes de contribuir, leia [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilidades e riscos de exposição devem seguir [SECURITY.md](SECURITY.md).

## Documentação

- [Documento canônico](docs/MODUS_PROTOCOL.md)
- [Adapter de projeto](docs/PROJECT_ADAPTER.md)
- [Formato físico do adapter](docs/ADAPTER_FORMAT.md)
- [Catálogo de skills](docs/SKILL_CATALOG.md)
- [Evals](docs/EVALS.md)
- [Runtime operacional](docs/OPERATIONS_RUNTIME.md)
- [Empacotamento do plugin](docs/PLUGIN_PACKAGING.md)
- [Instalação e atualizações](docs/INSTALLATION_AND_UPDATES.md)
- [Rollback](docs/ROLLBACK.md)
- [Histórico de mudanças](CHANGELOG.md)

## Segurança e limites

- nenhuma credencial pertence ao repositório;
- adapters reais permanecem nos projetos consumidores;
- doctor e shadow são somente leitura;
- nenhuma automação executa deploy ou alteração produtiva;
- conteúdo do Trello é tratado como dado não confiável;
- toda adoção ou atualização de projeto é explícita e reversível.

## Licença

Distribuído sob a [licença MIT](LICENSE).
