# Matriz de QA

Cada linha deve conter:

- identificador do critério;
- cenário e precondições;
- dados usados por referência, sem segredo;
- canal de evidência;
- resultado observado `passed`, `failed` ou `blocked`.

## Cobertura proporcional

Inclua quando aplicável:

- caminho principal e limites;
- autorização permitida e negada;
- vazio, erro e recuperação;
- responsividade, teclado e foco;
- quando a HU citar tela, módulo ou componente de referência, comparação visual e comportamental com essa referência: estrutura, tokens, cores, botões, foco e estados podem variar somente no conteúdo previsto pelo card;
- persistência, histórico e reconciliação;
- regressão da área e integrações afetadas;
- limpeza da massa `QA_*` criada pela própria execução.

Não multiplique combinações sem risco real. Prefira cenários que discriminem comportamentos e comprovem critérios.

## Reprovação acionável

Registre passos mínimos, esperado, observado, ambiente, commit e evidência. Agrupe falhas independentes antes do retorno. Se a causa for ambiente, tente recuperar as precondições locais autorizadas; persistindo, classifique como impedimento técnico localizado. Só solicite humano quando faltar autorização externa ou houver risco sistêmico.

Uma divergência visual material em relação à referência citada é reprovação técnica para DEV, não nova decisão humana. Preferência sem referência, critério ou impacto observável é recomendação não bloqueante.
