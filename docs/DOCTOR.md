# Pipeline Doctor v0.1

`pipeline-doctor` é o diagnóstico determinístico e somente leitura da Modus Protocol. Ele valida o adapter em três profundidades sem executar comandos do projeto, corrigir arquivos ou escrever no Trello.

## Modos

| Modo | Escopo | Uso |
|---|---|---|
| `structural` | YAML/JSON, schema e chaves sensíveis | Fixtures e autoria do adapter |
| `shadow` | Estrutura, semântica local, roteamento e snapshot opcional | Diagnóstico padrão antes do piloto |
| `cutover` | Tudo do shadow, tracker obrigatório e rota exclusiva | Gate antes de substituir a esteira antiga |

`WARN` é aceito pelo executável com código de saída `0`, mas não representa autorização de cutover. No modo `cutover`, a ausência do snapshot do tracker é `ERROR`.

## Execução

Requer Node.js 20 ou superior e dependências instaladas em `runtime/`.

```text
node runtime/src/doctor.mjs --project-root <projeto> --mode shadow
node runtime/src/doctor.mjs --project-root <projeto> --mode cutover --tracker-snapshot <arquivo> --format json
```

Opções:

- `--adapter`: substitui `.pipeline/project.adapter.yaml`;
- `--schema`: usa outro schema, útil em testes de compatibilidade;
- `--tracker-snapshot`: recebe uma captura normalizada e somente leitura das listas abertas;
- `--format text|json`: escolhe saída humana ou estável para automação.

## Contrato de saída

A saída JSON possui `contract_version`, identidade e versão da ferramenta, modo, alvo, status, contadores e diagnósticos. Cada diagnóstico contém código, severidade, caminho, mensagem e orientação. A ordenação é determinística.

Códigos de saída:

- `0`: `PASS` ou `WARN`;
- `1`: `FAIL` diagnosticado;
- `2`: argumento inválido ou falha interna.

O catálogo compacto de códigos fica junto da Skill em [diagnostics.md](../skills/pipeline-doctor/references/diagnostics.md).

## Limites deliberados da v0.1

- O doctor recebe o snapshot do Trello; a consulta autenticada será acoplada posteriormente pela integração somente leitura.
- Ele verifica existência e coerência declarativa de comandos, mas nunca os executa.
- Para o provider `environment`, verifica que o arquivo externo declarado existe e permanece dentro do projeto, sem ler ou exibir seus valores.
- O detector de roteamento inspeciona a vizinhança do gatilho canônico no `AGENTS.md`. Em shadow, rota legada e ausência de `$pipeline-run` são avisos de preparação; no cutover tornam-se erros.
- O doctor não é migrador nem instalador.

## Testes

A suíte contém um exemplo público, uma execução completa de cutover, um caso shadow de roteamento legado e dez mutações negativas versionadas. As mutações cobrem contrato, segurança, contexto, tracker, regex, perfis, ambientes e compatibilidade do Kernel.
