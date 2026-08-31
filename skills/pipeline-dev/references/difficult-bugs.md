# Bugs difíceis

Antes da correção:

1. descreva o sintoma e a condição exata;
2. produza um feedback loop reproduzível e rápido;
3. confirme que o loop falha pelo motivo esperado;
4. reduza hipóteses com evidência, sem editar por tentativa aleatória;
5. corrija a causa no menor limite seguro;
6. deixe regressão automatizada em ponto público quando viável;
7. prove que a reprodução passa e que a regressão afetada permanece verde.

Se não for possível reproduzir, entregue diagnóstico e próximo experimento; não apresente uma alteração especulativa como correção.
