# Contrato de design system vivo

O design system de cada produto pertence ao seu repositório consumidor; o Kernel não contém cores, componentes ou telas de um projeto específico. O adapter deve apontar, por contexto, para a documentação vigente e para a forma segura de observar a interface já entregue.

Antes de criar uma especificação ou mock de frontend, UX/UI identifica e registra as referências aplicáveis: shell da aplicação, navegação, cabeçalho, tipografia, cores/tokens, grids e espaçamentos, botões, campos, selects, modais, tabelas, feedbacks, ícones, estados de carregamento/erro/vazio e requisitos de acessibilidade e responsividade. Referência existente prevalece sobre recriação aproximada.

O protótipo representa a aplicação logada na versão atual: a área não afetada permanece visualmente fiel e estática; a interação é limitada ao fluxo do card. Ao introduzir componente realmente novo, atualize a documentação de design do projeto com propósito, tokens, variantes, estados, acessibilidade e exemplos antes de entregá-lo para aprovação. A ausência dessa documentação é tarefa técnica de UX/UI a recuperar, não gate humano, salvo quando revelar uma regra de negócio material ausente.
