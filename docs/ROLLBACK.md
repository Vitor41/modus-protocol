# Rollback do Modus Protocol

Rollback restaura a versão anterior do protocolo em um projeto consumidor sem apagar código funcional, comentários, locks ou histórico do tracker.

## Princípios

- um único roteador permanece ativo em cada instante;
- plugin, pin do Kernel, schema e bootstrap são restaurados como uma unidade;
- execução iniciada por outra versão não é retomada automaticamente;
- o tracker não é revertido; divergências exigem reconciliação humana;
- rollback não autoriza deploy, produção ou ações destrutivas.

## Procedimento por projeto

1. Interrompa novas execuções e registre o `RUN_ID` ativo, se existir.
2. Confirme que não há papel escrevendo no repositório ou no tracker.
3. Identifique o commit anterior ao cutover ou à atualização.
4. Crie uma branch de rollback a partir do estado atual; não use reset destrutivo.
5. Restaure nessa branch somente `AGENTS.md`, `.pipeline/project.adapter.yaml` e arquivos de bootstrap afetados.
6. Instale a versão anterior compatível do plugin.
7. Execute doctor estrutural e shadow sem escrever no tracker.
8. Confirme que existe exatamente um roteador para o gatilho.
9. Se houver execução incompatível, bloqueie a retomada e reconcilie manualmente estado, lock e cápsula.
10. Revise o diff, versione a reversão e só então promova a mudança.

## Prova segura da v0.1

A prova oficial usa uma cópia temporária ou worktree isolada com fixtures sanitizadas. Ela restaura o bootstrap anterior, verifica que o doctor detecta a rota legada ou a incompatibilidade esperada e descarta o ambiente isolado. Projetos e boards reais não são modificados.

## Critério de aprovação

- nenhum arquivo funcional do consumidor alterado;
- nenhuma escrita no tracker;
- nenhuma credencial copiada;
- rota anterior recuperável;
- rota nova reinstalável;
- retomada entre versões bloqueada até decisão humana.
