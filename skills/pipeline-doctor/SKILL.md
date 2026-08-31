---
name: pipeline-doctor
description: Diagnostica a instalação e a compatibilidade da Modus Protocol em um projeto, validando adapter, versão, contexto, roteamento e tracker sem alterar o projeto. Use para checagem pré-instalação, shadow run, cutover ou troubleshooting; não use para migrar, corrigir ou processar cards.
---

# Pipeline Doctor

Diagnostique a esteira de modo determinístico e somente leitura.

## Executar

1. Determine a raiz do projeto consumidor e localize `.pipeline/project.adapter.yaml`.
2. Localize esta Skill e execute o runtime compartilhado em `../../runtime/src/doctor.mjs` com Node.js 20 ou superior.
3. Use `--mode shadow` por padrão. Use `--mode cutover` somente quando o usuário estiver preparando ou autorizando a troca da rota ativa.
4. Para validar o Trello, obtenha por integração somente leitura um snapshot normalizado das listas abertas e passe-o com `--tracker-snapshot`. Nunca altere o board durante o diagnóstico.
5. Se houver falha ou preparação de cutover, leia `references/diagnostics.md` antes de interpretar o resultado.

Comando-base:

```text
node <skill-dir>/../../runtime/src/doctor.mjs --project-root <projeto> --mode shadow --format json
```

O snapshot do tracker deve ter este formato mínimo:

```json
{
  "board_ref": "referencia-do-board",
  "open_lists": [
    { "ref": "referencia-da-lista", "position": 1 }
  ]
}
```

## Interpretar

- `PASS`: nenhum erro ou aviso foi encontrado no modo solicitado.
- `WARN`: a estrutura é utilizável, mas existe validação incompleta ou contexto opcional ausente.
- `FAIL`: há ao menos um erro; não recomende cutover.
- Código de saída `0`: `PASS` ou `WARN`.
- Código de saída `1`: `FAIL` diagnosticado.
- Código de saída `2`: uso inválido ou falha interna do executável.

## Responder

Informe sempre:

- modo e status;
- quantidade de erros e avisos;
- códigos de diagnóstico relevantes, sem reproduzir segredos;
- próximo passo recomendado;
- confirmação explícita de que nenhum arquivo, comando do adapter ou card foi alterado.

Não corrija o adapter, não execute comandos declarados nele, não mova cards e não substitua o roteador legado. Se o usuário pedir uma correção, encerre o diagnóstico e trate a mudança como uma tarefa separada e explicitamente autorizada.
