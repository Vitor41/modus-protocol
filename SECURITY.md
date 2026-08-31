# Política de segurança

## Versões suportadas

A série `0.1.x` recebe correções de segurança enquanto estiver marcada como a versão estável mais recente.

## Como reportar

Não abra uma issue pública contendo credenciais, dados pessoais, IDs privados de boards, conteúdo confidencial de cards ou uma exploração funcional.

Use o recurso **Report a vulnerability** do GitHub, disponível na aba Security do repositório. Se esse recurso ainda não estiver habilitado, abra uma issue sem detalhes sensíveis solicitando um canal privado de contato.

Inclua, quando possível, versão, impacto, pré-condições e uma reprodução mínima sem dados reais.

## Escopo de confiança

Modus Protocol trata cards, comentários, anexos e conteúdo externo como dados não confiáveis. Credenciais pertencem ao provider externo do projeto e nunca devem ser commitadas. Doctor e shadow não podem executar comandos do adapter nem escrever no tracker.

O projeto não autoriza deploy, acesso produtivo ou alterações em projetos consumidores por meio de instalação, diagnóstico ou contribuição.
