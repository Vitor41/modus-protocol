# Instalação, Pinagem e Atualização v0.1

| Campo | Decisão |
|---|---|
| Fonte única | Repositório Modus Protocol |
| Desenvolvimento | Skills centrais + plugin local reproduzível |
| Distribuição pública | Plugin versionado |
| Configuração por projeto | Adapter repo-scoped |
| Atualização | Explícita, avaliada e reversível |

## 1. Estratégia por estágio

### Estágio A — Desenvolvimento do núcleo

O repositório central contém contratos, referências, Skills e testes. Os projetos consumidores não recebem cópias das Skills. Durante a construção, evals rodam a partir da fonte central ou de um pacote local controlado.

### Estágio B — Plugin local implementado

As oito Skills mínimas são empacotadas em um plugin com manifest próprio, schemas e runtime standalone. O marketplace local permite instalar e testar a mesma build que será adotada pelos projetos.

Essa etapa evita depender de Skills repo-scoped duplicadas nos projetos consumidores. Skills locais antigas são desativadas somente no cutover de cada projeto.

### Estágio C — Plugin público

Após os dois pilotos, documentação, licença, segurança e atualização estarem aprovados, o plugin poderá ser publicado. O repositório continuará útil como referência e base para forks.

## 2. Fonte de verdade

| Item | Fonte canônica |
|---|---|
| Workflow e gates | Kernel central |
| Skills comuns | Pacote central/plugin |
| Versão ativa | Plugin instalado pelo Codex |
| Configuração local | `.pipeline/project.adapter.yaml` |
| Domínio e arquitetura | Documentação do projeto consumidor |
| Credenciais | Provedor externo autorizado |

O plugin instalado é um artefato. O repositório central é a origem. Alteração manual no cache instalado é proibida.

## 3. Identidade e versões

Identificador técnico estável:

```text
unified-development-pipeline
```

O produto público se chama **Modus Protocol**. O identificador permanece estável entre versões para não quebrar adapters já instalados. A versão do plugin segue SemVer e corresponde à release do Kernel incluída no pacote.

Adapter e plugin têm responsabilidades separadas:

- `schema_version`: contrato do adapter;
- `plugin.version`: artefato instalado que fornece o Kernel e as Skills.

O plugin instalado é a fonte única da versão em execução. O adapter não fixa nem compara versão do Kernel; campos legados `kernel.version` e `kernel.update_policy` são ignorados para facilitar migração de projetos existentes.

## 4. Instalação inicial

Fluxo de instalação; plugin e doctor já são executáveis, enquanto setup/cutover de projetos permanecem controlados:

1. obter uma release ou checkout identificado do repositório central;
2. verificar origem e integridade do pacote;
3. instalar o plugin local ou público;
4. executar doctor sem projeto para validar o pacote;
5. gerar proposta de adapter com `pipeline-setup`;
6. revisar e versionar o adapter no projeto;
7. executar doctor repo-scoped em modo shadow;
8. executar shadow run;
9. autorizar cutover do `AGENTS.md`;
10. executar teste do gatilho sem escrita.

Instalação do plugin não autoriza migrar nenhum projeto.

O passo a passo executável, incluindo o trecho exato do `AGENTS.md` e o gatilho `Processe a fila do Trello.`, está em [Início rápido](QUICKSTART.md).

Após instalar uma atualização, reinicie o Codex e abra uma nova tarefa. A Skill `pipeline-run` usa diretamente o runtime carregado pelo plugin, sem uma verificação de versão antes de acessar o tracker.

## 5. Atualização de um projeto

Cada atualização segue uma unidade por projeto:

1. ler changelog e notas de migração;
2. instalar a nova versão lado a lado somente em ambiente de teste, quando suportado;
3. rodar fixtures e evals de contrato;
4. rodar doctor e shadow run no projeto;
5. migrar o adapter se necessário;
6. revisar mudanças de Skills e permissões;
7. alterar o pin em commit dedicado;
8. executar um card controlado;
9. promover ou reverter.

Projetos consumidores podem adotar uma release em momentos diferentes, mas cada um possui exatamente uma versão ativa.

## 6. Rollback

Rollback restaura em conjunto:

- versão instalada do plugin;
- pin do adapter;
- schema compatível;
- bootstrap canônico, quando alterado pela release.

O processo preserva código funcional, histórico do Trello, locks e cápsulas. Uma execução iniciada por outra versão exige reconciliação humana antes de retomar.

## 7. Prevenção de duplicidade

Antes do cutover, doctor inventaria conflitos como:

- Skills com nomes centrais duplicados;
- Skills legadas ainda citadas por `AGENTS.md`;
- comandos antigos que respondem ao mesmo gatilho;
- múltiplos adapters;
- plugins com versões conflitantes.

Depois do cutover, qualquer conflito é `ERROR`. O Codex não mescla Skills de mesmo nome; por isso nomes duplicados não podem ser usados como mecanismo de override.

## 8. Canais de release

| Canal | Uso | Garantia |
|---|---|---|
| `dev` | Construção local e fixtures. | Pode mudar; nunca usado por card real. |
| `pilot` | Shadow e cards controlados. | Versão fixada e rollback obrigatório. |
| `stable` | Uso padrão após promoção. | Evals, dois pilotos e documentação aprovados. |

Não existem aliases móveis no adapter. O canal informa maturidade; a versão continua exata.

## 9. Artefatos do plugin

Estrutura prevista:

```text
unified-development-pipeline/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   ├── pipeline-run/
│   ├── pipeline-setup/
│   ├── pipeline-doctor/
│   ├── pipeline-po/
│   ├── pipeline-ux-ui/
│   ├── pipeline-dev/
│   ├── pipeline-code-review/
│   └── pipeline-qa/
├── references/
    └── schema/
```

O manifest, o marketplace local e o build reproduzível foram implementados. O artefato gerado não é fonte de edição; Skills, runtime e schemas continuam canônicos em seus diretórios na raiz. O processo detalhado está em [PLUGIN_PACKAGING.md](PLUGIN_PACKAGING.md).

## 10. Critério de publicação

A distribuição pode ser publicada quando:

- schema e adapter exemplo passarem na validação estrutural;
- `pipeline-doctor` tiver contrato de saída aprovado;
- nomes técnicos não colidirem com Skills existentes;
- a origem do plugin local estiver definida;
- instalação e rollback puderem ser testados sem tocar projetos consumidores;
- plugin, Skills, schemas e documentação passarem na CI.
