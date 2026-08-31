# Loop de entrega do DEV

## 1. Fixar o alvo

Traduza cada critério em um ponto observável no produto e em evidência prevista. Identifique o menor corte que atravessa as camadas necessárias sem deixar comportamento parcial escondido.

## 2. Baseline

Execute o comando declarado pelo adapter antes de editar. Se falhar previamente, registre a falha conhecida e prove que ela é independente; caso contrário, bloqueie. Não “adote” uma falha sem evidência.

## 3. Fatias e feedback

Para cada fatia:

1. crie ou ajuste um teste/reprodução quando houver seam útil;
2. faça a menor mudança coerente;
3. execute o teste focal;
4. inspecione o comportamento observável;
5. só então avance.

Prefira reutilizar limites e componentes existentes. Extraia abstração apenas quando duplicação ou fronteira real justificar.

## 4. Verificação afetada

Mapeie critério → código → teste/inspeção → evidência. Valide os canais afetados, não uma lista fixa. Mudança de banco exige integridade e reversibilidade; mudança visual exige renderização; regra de autorização exige cenários permitidos e negados.

## 5. Entrega revisável

Revise o diff e registre:

- arquivos e finalidade;
- comandos e resultados;
- critérios comprovados;
- riscos residuais;
- qualquer capacidade não executada e motivo;
- commit quando criado;
- próximo papel: Code Review.

Uma entrega curta sem essas evidências transfere custo ao reviewer e ao QA e não atende ao gate.
