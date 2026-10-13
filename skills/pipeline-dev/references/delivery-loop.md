# Loop de entrega do DEV

## 1. Fixar o alvo

Traduza cada critério em um ponto observável no produto e em evidência prevista. Identifique o menor corte que atravessa as camadas necessárias sem deixar comportamento parcial escondido.

## 2. Baseline

Execute o comando declarado pelo adapter antes de editar. Se falhar previamente, diagnostique e corrija causas locais autorizadas antes de concluir o checkpoint. Se provar que a falha é preexistente e independente, registre-a sem incorporá-la à entrega; se pertencer ao card, resolva-a. Só escale conforme a política de autonomia, nunca pela mera existência de uma saída não zero.

## 3. Fatias e feedback

Para cada fatia:

1. crie ou ajuste um teste/reprodução quando houver seam útil;
2. faça a menor mudança coerente;
3. execute o teste focal;
4. inspecione o comportamento observável;
5. só então avance.

Prefira reutilizar limites e componentes existentes. Extraia abstração apenas quando duplicação ou fronteira real justificar.

Repetir esse ciclo dentro do mesmo papel DEV é trabalho interno, não retorno entre papéis: não consome o contador de `loop_limit` e não cria gate humano. Se uma capacidade de inspeção falhar, tente ferramenta ou método local equivalente e preserve evidência observável; não alegue aprovação sem ela. Se a capacidade permanecer indisponível após recuperação segura, deixe o resultado técnico pendente para o ORCHESTRATOR, sem handoff de sucesso, e siga o timeout/watchdog aplicável.

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
