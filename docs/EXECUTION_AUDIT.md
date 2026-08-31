# Auditoria de modelo e esforço v0.1

Cada papel executado pela Esteira possui uma configuração solicitada e um recibo observado. Assim, a pessoa responsável confirma qual família de modelo e qual esforço foram usados sem inferir a configuração a partir do texto produzido.

## Mapeamento vigente

| Perfil semântico | Modelo | Esforço | Uso inicial |
|---|---|---|---|
| `RAPIDO` | `gpt-5.6-luna` | `low` | Trabalho mecânico e reteste determinístico |
| `EQUILIBRADO` | `gpt-5.6-terra` | `medium` | Implementação especificada e validação ordinária |
| `PROFUNDO` | `gpt-5.6-sol` | `high` | PO, UX/UI, arquitetura e revisão crítica |
| `MAXIMO` | `gpt-5.6-sol` | `max` | Exceção de alto risco ou auditoria de alto valor |
| `PARALELO` | `gpt-5.6-sol` | `high` | Frentes independentes; paralelismo é modo de orquestração |

O mapeamento possui a identidade `gpt-5.6-2026-08-28`. Skills solicitam perfis; somente o Kernel traduz perfil em configuração executável.

## Solicitação e observação

O planner inclui `execution_request` no plano:

```yaml
profile: PROFUNDO
execution_request:
  mapping_version: gpt-5.6-2026-08-28
  model: gpt-5.6-sol
  reasoning_effort: high
  agent_mode: independent
  configuration_source: kernel-profile-map
  fallback_policy: block
```

Isso comprova a decisão da Esteira, mas ainda não comprova a execução. O agente de papel recebe modelo e esforço como parâmetros explícitos. Seu handoff registra `execution.request` e `execution.observation`, incluindo a referência retornada pelo lançamento.

`confirmed` significa que o ambiente aceitou um lançamento explícito com os parâmetros registrados. Não significa acesso ao raciocínio interno do modelo. A Esteira audita configuração e evidência operacional, não expõe chain of thought.

## Regras do gate ao vivo

O role gate falha quando:

- perfil, modelo, esforço ou modo divergem do mapeamento versionado;
- o papel herdou silenciosamente a configuração da tarefa principal;
- modelo ou esforço são `not_observable`;
- houve fallback;
- Review ou QA não usam agente independente;
- o recibo não possui referência verificável.

Tokens e horários são registrados somente quando a plataforma os expõe. Ausência permanece `not_observable`; estimativas não são aceitas como telemetria.

## O que aparece para a pessoa responsável

Antes de executar um papel, `pipeline-run` informa `RUN_ID`, card, papel, perfil, modelo, esforço e modo do agente. Após o papel, informa o status do recibo e se houve fallback. O handoff validado é a evidência durável da execução.

No shadow run, somente a configuração solicitada aparece. Nenhum recibo efetivo é produzido porque nenhum papel é executado.

## Critério adicional do cutover

Antes do primeiro card real, o projeto consumidor deve:

1. fixar o Kernel e plugin `0.1.4`;
2. obter `PASS` no doctor de cutover;
3. executar um shadow e conferir a configuração solicitada;
4. confirmar que a capacidade de agente aceita modelo e esforço explícitos;
5. manter bloqueio de fallback e de configuração não observável;
6. validar o primeiro handoff ao vivo com recibo `confirmed` antes de mover o card.
