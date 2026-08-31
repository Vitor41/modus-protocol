---
name: pipeline-setup
description: Inspeciona um projeto de software e produz uma proposta revisável de `.pipeline/project.adapter.yaml`, inventariando stack, comandos, contexto e decisões pendentes sem instalar a esteira ou alterar o projeto. Use ao preparar a conexão inicial ou reavaliar um adapter; não use para cutover, migração automática ou processamento de cards.
---

# Pipeline Setup

Produza uma proposta rastreável sem transformar inferências em configuração ativa.

## Preparar a proposta

1. Determine a raiz exata do projeto consumidor.
2. Execute `../../runtime/src/setup.mjs --project-root <projeto> --format yaml` com Node.js 20 ou superior.
3. Use o inventário determinístico como baseline e complemente apenas com inspeções locais, somente leitura e relevantes às decisões pendentes.
4. Leia `references/proposal-contract.md` antes de apresentar ou comparar uma proposta.
5. Marque como não resolvido tudo que não estiver comprovado por arquivos, ferramentas somente leitura ou resposta humana.
6. Se existir adapter, trate a saída como comparação; não sobrescreva nem migre o arquivo.

## Evidência e inferência

- Cite o arquivo que sustenta cada stack ou comando inferido.
- Não execute comandos descobertos durante o setup.
- Não copie credenciais, valores de `.env`, cookies, tokens ou strings de conexão.
- IDs de board/listas podem entrar somente após consulta ao tracker autorizado e devem permanecer no adapter do projeto, nunca no núcleo.
- Não considere placeholders `REVIEW_REQUIRED_*` como configuração válida para instalação.

## Entregar

Apresente:

- inventário observado;
- proposta de adapter;
- decisões obrigatórias ainda abertas;
- riscos ou divergências com a esteira existente;
- confirmação de que nenhum arquivo, serviço, Git ou tracker foi alterado.

Gravar o adapter, criar `AGENTS.md`, instalar plugin ou desativar uma esteira anterior exige uma tarefa de instalação/cutover explicitamente autorizada e separada.
