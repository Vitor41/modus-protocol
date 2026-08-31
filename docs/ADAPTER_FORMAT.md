# Formato Físico do Adaptador v0.1

| Campo | Decisão |
|---|---|
| Arquivo canônico | `.pipeline/project.adapter.yaml` |
| Formato de autoria | YAML 1.2 |
| Contrato | JSON Schema Draft 2020-12 |
| Schema | `schema/project-adapter.schema.json` |
| Pinagem | Versão exata do Kernel |
| Segredos | Proibidos no arquivo |

## 1. Decisão

YAML foi escolhido para o adaptador por ser legível, compacto e adequado a configuração repo-scoped. A economia de ruído também reduz tokens quando o arquivo precisa entrar no contexto.

JSON Schema foi escolhido como contrato porque separa o formato humano da validação estrutural, possui amplo suporte de ferramentas e permite gerar mensagens de erro, autocomplete e documentação.

O schema valida estrutura e limites locais. `pipeline-doctor` implementa validações semânticas que JSON Schema não resolve, como existência de caminhos, unicidade dos IDs de listas, correspondência do board por snapshot e presença de roteadores legados.

## 2. Localização

Cada projeto consumidor terá:

```text
<project-root>/
├── AGENTS.md
└── .pipeline/
    └── project.adapter.yaml
```

O nome e a localização são fixos na v0.1 para impedir descoberta ambígua. Não haverá busca recursiva por múltiplos adapters.

## 3. Pinagem

O bloco `kernel` usa versão SemVer exata:

```yaml
kernel:
  name: unified-development-pipeline
  version: "0.1.4"
  distribution: local-plugin
  plugin_name: unified-development-pipeline
```

Intervalos como `^0.1`, `latest` ou branch móvel são proibidos no projeto consumidor. Atualização exige validação, alteração explícita do pin e commit próprio.

`schema_version` evolui separadamente da versão do Kernel. Uma versão nova do Kernel pode continuar aceitando schema `0.1`; uma mudança incompatível do adapter exige migração declarada.

## 4. Resolução do gatilho

O adapter fixa o contrato:

```yaml
trigger:
  process_queue: Processe a fila do Trello.
  skill: pipeline-run
```

O `AGENTS.md` fino informa que a frase exata deve ser roteada para a Skill central. A Skill valida o adapter antes de qualquer leitura ou escrita no Trello.

Se o plugin, a Skill ou a versão pinada não estiver disponível, a execução bloqueia com diagnóstico. Ela não recorre à esteira antiga.

## 5. Referências e credenciais

Board, listas e labels podem ser versionados no adapter do projeto porque são identificadores operacionais, não credenciais. O exemplo público usa placeholders.

Tokens, chaves, senhas, cookies e strings de conexão são proibidos. `credential_provider` declara apenas a origem autorizada, como o conector Trello do Codex, MCP aprovado ou ambiente local já provisionado. Quando o provider for `environment`, `tracker.environment.credential_file` aponta para um arquivo relativo contido no projeto; o adapter nunca contém os valores.

O runtime nunca imprime o valor resolvido de uma credencial.

Exemplo de provider local:

```yaml
tracker:
  credential_provider: environment
  environment:
    credential_file: trello_key/trello.env
  comments:
    read_provider: environment
    write_provider: environment
```

`tracker.comments` é obrigatório e declara providers de leitura/escrita, eventos mínimos, UTF-8 e releitura após publicação. Leitura e escrita podem usar providers diferentes. Para Trello via `environment`, o runtime fornece um cliente que lista, escreve e relê comentários sem expor credenciais. O modo live somente é liberado após um comentário diagnóstico ser publicado e relido; a transição ocorre depois do comentário do handoff, nunca antes.

## 6. Comandos seguros

Comandos são arrays de argumentos, não strings de shell:

```yaml
commands:
  test_full:
    working_directory: .
    argv: [python, -m, unittest, discover, -s, tests]
    timeout_seconds: 600
    expected_exit_codes: [0]
    output: artifact
```

Esse formato reduz interpretação acidental de operadores de shell. O executor ainda deve aplicar sandbox, permissões e validação de caminho.

Skills escolhem capacidades nomeadas; não constroem comandos específicos do projeto.

## 7. Validação em duas camadas

### 7.1 Estrutural

O JSON Schema verifica:

- campos obrigatórios e tipos;
- nomes canônicos;
- versão e distribuição;
- nove estados do tracker;
- gatilho exato;
- caminhos relativos;
- timeouts e códigos de saída;
- gates de release e segurança não enfraquecíveis;
- valores permitidos para perfis e especializações.

O repositório inclui a fixture [valid-minimal.json](../tests/fixtures/adapters/valid-minimal.json). No PowerShell 7, o contrato pode ser verificado sem instalar dependências:

```powershell
$adapter = Get-Content -Raw tests/fixtures/adapters/valid-minimal.json
$adapter | Test-Json -SchemaFile schema/project-adapter.schema.json
```

A saída esperada é `True`. A fixture JSON representa o mesmo modelo de dados do YAML e existe somente para testar o schema com ferramentas nativas.

### 7.2 Semântica

`pipeline-doctor` verifica:

- adapter localizado na raiz Git correta;
- versão central instalada igual ao pin;
- todos os caminhos obrigatórios existentes;
- board acessível pelo provedor declarado;
- leitura e escrita de comentários comprovadas por referência persistida;
- exatamente nove listas operacionais abertas;
- cada referência de lista existente, única e no board correto;
- ordem das colunas compatível;
- labels e padrões de card sem conflito;
- comandos executáveis ou diagnosticáveis sem executá-los;
- nenhum segredo provável no adapter;
- nenhuma Skill ou instrução legada ainda roteável;
- `AGENTS.md` apontando exclusivamente para a arquitetura nova após cutover.

Validação externa começa somente leitura. Desde a v0.1.4, a integração fornece ao doctor um snapshot normalizado; a consulta autenticada direta ainda será implementada. Doctor não corrige nem migra automaticamente. O contrato executável está em [DOCTOR.md](DOCTOR.md).

## 8. Severidade

| Nível | Efeito | Exemplos |
|---|---|---|
| `ERROR` | Bloqueia qualquer execução. | Versão incompatível, lista ausente, comentário não verificável, segredo, roteador concorrente. |
| `WARNING` | Permite shadow; bloqueia cutover até revisão. | Referência opcional ausente, componente sem licença registrada. |
| `INFO` | Observação sem impacto. | Capability opcional não configurada. |

## 9. Compatibilidade

Regras da série `0.x`:

- alteração incompatível incrementa a versão minor do schema;
- campo opcional novo pode manter a versão;
- remoção ou mudança semântica exige migrador explícito;
- Kernel declara quais versões do schema aceita;
- adapter mais novo que o runtime sempre bloqueia;
- adapter mais antigo somente executa quando a compatibilidade estiver declarada e testada.

## 10. Bootstrap candidato

O trecho conceitual que substituirá o roteamento legado em cada projeto é:

```markdown
## Esteira unificada

Quando o usuário enviar exatamente `Processe a fila do Trello.`, use a Skill
`pipeline-run`. Antes de qualquer ação, valide `.pipeline/project.adapter.yaml`.
Se o Kernel pinado não estiver disponível ou houver roteamento legado concorrente,
bloqueie sem alterar Trello, código ou Git.
```

O exemplo é neutro e pode ser usado como ponto de partida, mas cada bootstrap e adapter deve ser revisado e testado em shadow antes do cutover.

## 11. Referências oficiais

A decisão considera que o Codex carrega instruções por `AGENTS.md`, descobre Skills repo-scoped em `.agents/skills` e usa progressive disclosure. Para distribuição, Skills são o formato de autoria e plugins são o pacote instalável quando o workflow estiver estável:

- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [Build plugins](https://learn.chatgpt.com/docs/build-plugins)
