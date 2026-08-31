# Contribuindo com o Modus Protocol

Obrigado por considerar uma contribuição.

## Antes de começar

- abra uma issue para mudanças de contrato, comportamento ou arquitetura;
- mantenha o Kernel genérico e regras de negócio nos adapters;
- não inclua credenciais, IDs reais de trackers, dados pessoais ou evidências privadas;
- preserve compatibilidade ou documente explicitamente a migração necessária;
- não altere projetos consumidores como parte de uma contribuição ao núcleo.

## Ambiente local

Requer Node.js 20+ e pnpm 11.

```powershell
cd runtime
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm run build:plugin
```

## Critério para pull request

- mudança pequena e explicada;
- testes proporcionais e suíte completa aprovada;
- skills alteradas validadas pelo validador oficial;
- schemas e fixtures coerentes;
- plugin regenerado quando skill, runtime, schema ou manifest mudar;
- `CHANGELOG.md` atualizado para mudança material;
- documentação e exemplo neutro sem dados privados.

Ao contribuir, você concorda que sua contribuição será distribuída sob a licença MIT do projeto.
