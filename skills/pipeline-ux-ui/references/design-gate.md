# Gate de design

## Especificação mínima

- objetivo e usuário do fluxo;
- entrada, ação principal, cancelamento e conclusão;
- estados inicial, carregando, vazio, erro, sucesso e desabilitado quando aplicáveis;
- validação e mensagens junto ao ponto de ação;
- navegação por teclado, ordem de foco, foco inicial e retorno de foco;
- nome acessível, contraste e comunicação não dependente apenas de cor;
- comportamento em viewports suportados;
- componentes e tokens existentes reutilizados;
- ao menos um mock/protótipo anexado ao card e relido por referência, que o humano, DEV e QA consigam consultar.

## Limites

Não transforme preferência estética em requisito universal. Diferencie padrão existente, decisão aprovada e recomendação. Se a interface depender de permissão, regra financeira ou conteúdo material ainda indefinido, retorne a parte afetada ao PO; somente o PO decide se a investigação exige pergunta humana.

## Aprovação

Associe a aprovação à versão da especificação. Registre a referência da evidência; não use apenas um booleano sem origem. Mudança posterior em fluxo, regra ou estados exige nova avaliação de validade.

Para `frontend`, a ordem é obrigatória: especificar → gerar mock → anexar e reler → solicitar `Tela aprovada`. Nunca solicite aprovação baseada somente em texto no comentário.
