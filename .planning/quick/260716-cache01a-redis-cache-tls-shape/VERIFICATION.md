---
quick_task: 260716-cache01a-redis-cache-tls-shape
status: passed
classification: PASS
verified_at: 2026-07-16
---

# Verificação — CACHE-01A

## Resultado

**PASS.** O contrato TLS do `@medusajs/caching-redis@2.16.0` foi separado dos contratos dos demais consumidores Redis. O cache agora recebe `redisUrl` e `tls` no nível superior; Event Bus e Locking preservam `redisUrl` mais `redisOptions`; Workflow preserva o mesmo contrato aninhado dentro de `redis`. Testes focados e completos, lint, build, integridade, revisão de código e preservação do stash passaram.

Este gate corrige o código, mas não ativa o cache em produção. O workaround `REDIS_CACHE_PROVIDER_DISABLED=true` continua aceito e a ativação operacional permanece pendente para gate separado.

## Baseline e superfície

- Branch: `main`.
- Base capturada antes da implementação: `12dea994f81c4713ceaa68c2352de3e2956e412d`.
- Commit de código verificado: `1a7f9d2c11e584948953b32c9e0a393da53bb36c` (`fix(redis): pass TLS options correctly to cache provider`).
- Divergência verificada antes do commit documental: `origin/main...HEAD = 0 1`.
- O commit de código altera exclusivamente:
  - `apps/backend/src/infrastructure/redis-config.ts`;
  - `apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts`.
- Estatística do commit de código: 2 arquivos, 190 inserções e 30 remoções.
- `git diff --check`: sem erros.
- A documentação deste quick gate fica limitada a `PLAN.md`, `VERIFICATION.md` e `SUMMARY.md` no diretório do CACHE-01A.

## Contratos reais dos loaders instalados

Os quatro pacotes inspecionados estão instalados na versão 2.16.0.

| Consumidor | Leitura real do loader | Shape final verificado |
|---|---|---|
| Caching Redis | separa `redisUrl` e repassa todas as demais propriedades como opções do ioredis | `{ redisUrl, tls }` |
| Event Bus Redis | lê `redisUrl` e `redisOptions` | `{ redisUrl, redisOptions }` |
| Locking Redis | lê `redisUrl` e `redisOptions` | `{ redisUrl, redisOptions }` |
| Workflow Engine Redis | lê as opções em `options.redis`, incluindo `redisUrl` e `redisOptions` | `{ redis: { redisUrl, redisOptions } }` |

Nenhum teste de contrato inicializou os loaders, abriu socket ou conectou a Redis. A regressão simula somente em memória a desestruturação feita pelo loader do cache.

## Causa raiz e correção

A causa raiz do defeito de configuração foi confirmada: um único builder produzia o shape padrão para os quatro consumidores. O cache recebia anteriormente:

```ts
{
  redisUrl,
  redisOptions: {
    tls: { rejectUnauthorized: false },
  },
}
```

O loader do cache separa somente `redisUrl` e entrega o restante diretamente ao ioredis. Assim, o wrapper `redisOptions` não convertia o TLS aninhado na opção `tls` que o cliente esperava. Essa incompatibilidade explica o relaxamento TLS não aplicado ao cache e é consistente com o loop operacional que motivou o workaround; a confirmação operacional em produção não faz parte deste gate sem deploy.

O shape corrigido para o cache é:

```ts
{
  redisUrl,
  tls: { rejectUnauthorized: false },
}
```

Dois builders tipados passam a tornar a fronteira explícita:

- `buildCachingRedisProviderOptions` produz o contrato plano do cache;
- `buildStandardRedisModuleOptions` produz o contrato aninhado de Locking e Event Bus, reutilizado dentro de `redis` pelo Workflow.

## Matriz TLS e workaround

| Cenário | Cache | Event Bus e Locking | Workflow |
|---|---|---|---|
| `redis://`, inclusive com flag TLS literal `false` | somente `redisUrl` | somente `redisUrl` | `redis: { redisUrl }` |
| `rediss://` sem flag TLS literal `false` | somente `redisUrl` | somente `redisUrl` | `redis: { redisUrl }` |
| `rediss://` com flag TLS literal `false` | `redisUrl` + `tls.rejectUnauthorized=false` no nível superior | `redisUrl` + `redisOptions.tls.rejectUnauthorized=false` | `redis: { redisUrl, redisOptions: { tls } }` |

Somente o valor literal `false` habilita o relaxamento para `rediss://`. Nenhum relaxamento implícito foi introduzido para `redis://` ou para outros valores, e nenhuma configuração TLS global foi criada.

Com `REDIS_CACHE_PROVIDER_DISABLED=true`, somente o módulo de cache é omitido; Locking, Event Bus e Workflow continuam registrados e mantêm seus shapes. Sem a flag, os quatro módulos Redis são registrados e nenhum fallback local ou in-memory aparece.

## Validações

| Gate | Resultado |
|---|---|
| Focados finais (`redis-config` + `env`) | 2/2 suítes; 89/89 testes; 1/1 snapshot; exit 0 |
| Unitários completos | 44/44 suítes; 739/739 testes; 1/1 snapshot; exit 0 |
| Lint | exit 0; 0 erros; 208 warnings |
| Build | exit 0; backend compilado com sucesso |
| Revisão final de código | clean; 0 blockers; 0 warnings |
| Integridade Git | `git diff --check` limpo; commit de código limitado aos dois arquivos autorizados |

O build final passou depois de uma correção mecânica de alias de tipo dentro da mesma superfície autorizada. Os testes foram repetidos sobre o estado final.

As regressões cobrem explicitamente o shape plano do cache, a ausência de `redisOptions` no restante repassado ao ioredis, os shapes aninhados dos outros três consumidores, `redis://`, `rediss://` com e sem opt-in literal, o workaround transitório e a sanitização de evidências. Nenhuma URL completa, credencial ou hostname de teste é reproduzido neste documento.

## Preservação do INFRA-01

- Stash preservado: `stash@{0}`, OID `0137d97c2e4db6a2c106c3e53b9b6f0dbb3d612e`.
- Mensagem preservada: `infra01-blocked-cache-runtime-unproven-20260715`.
- Inventário: 19 caminhos.
- Comparações inicial versus final versus estado corrente: OID, nomes, estatística e patch binário idênticos.
- O stash não foi aplicado, alterado, renomeado ou removido.

## Auditorias negativas

- Nenhuma config var foi alterada; o workaround não foi removido.
- Nenhum deploy, push, rollback, tag ou ativação operacional foi executado.
- Nenhum provider externo foi conectado, consultado ou modificado; nenhuma conexão Redis real ocorreu.
- Nenhum model, migration, dado ou schema foi alterado.
- Nenhum `package.json`, lockfile, dependência ou versão instalada foi alterado.
- Nenhum release command, `Procfile`, APP_VERSION, secret, URL ou configuração TLS global foi alterado.
- `.planning/STATE.md`, INFRA-01 e Phase 12 não foram retomados nem modificados.
- Pagamentos, catálogo, refunds e demais domínios adjacentes ficaram fora do diff.

## Pendência operacional

A ativação do cache continua deliberadamente pendente. Um gate posterior, com aprovação própria, deverá implantar o código corrigido, validar o runtime e somente então decidir sobre a retirada de `REDIS_CACHE_PROVIDER_DISABLED=true`. Este PASS não autoriza nenhuma dessas ações.
