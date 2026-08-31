# Gate de refinamento

## Demanda ampla

Inventarie unidades, usuários, permissões, operações e resultados antes de propor o recorte. Itens com decisões ou ciclos independentes devem virar critérios ou cards separados; não os agrupe apenas porque chegaram na mesma frase.

## Regra ambígua

Registre:

1. o comportamento confirmado;
2. as interpretações ainda possíveis;
3. o impacto de cada decisão;
4. a pergunta mínima que fecha a ambiguidade;
5. o que pode continuar sem essa resposta.

Não converta comportamento atual do código em regra de negócio sem outra evidência.

## Critério verificável

Um critério deve identificar condição, ação/estímulo, resultado observável e evidência esperada. Evite “funcionar corretamente”, “melhorar UX” ou “tratar erros” sem exemplos e limites.

Inclua cenários negativos, autorização, vazio, erro e histórico somente quando forem aplicáveis ao risco real.

## Retorno

Compare a nova resposta com critérios e especificação vigentes. Declare o delta e invalide apenas os handoffs realmente afetados. Se a resposta alterar frontend, volte para UX/UI; se eliminar o impacto visual já classificado, encaminhe ao DEV.
