---
quick_task: 260716-cache01a-redis-cache-tls-shape
status: complete
classification: PASS
completed_at: 2026-07-16
---

# Summary — CACHE-01A

## Resultado

**PASS.** O CACHE-01A corrige exclusivamente o contrato TLS do provider de cache. A causa raiz era o reuso de um builder que aninhava `tls` em `redisOptions` para todos os módulos, embora o loader do `@medusajs/caching-redis@2.16.0` repasse ao ioredis as propriedades restantes no nível superior. O cache agora recebe o shape plano correto; Event Bus, Locking e Workflow preservam seus contratos válidos.

O workaround continua existindo como capacidade do código: `REDIS_CACHE_PROVIDER_DISABLED=true` omite somente o cache. A pendência operacional registrada originalmente por este gate foi superada pelo encerramento formal da estabilização; o cache Redis TLS está resolvido.

## Manual gate

1. **Contrato real do caching-redis 2.16:** o loader separa `redisUrl` e repassa o restante das propriedades como opções do ioredis; o contrato correto é `redisUrl + tls` no nível superior.
2. **Contrato dos outros três módulos:** Event Bus e Locking recebem `redisUrl + redisOptions`; Workflow recebe `redis: { redisUrl, redisOptions }`.
3. **Causa raiz confirmada:** o builder único entregava ao cache um wrapper que seu loader não desaninha, impedindo que `tls.rejectUnauthorized=false` chegasse ao campo TLS esperado pelo ioredis. A relação com o loop operacional será revalidada somente após deploy autorizado.
4. **Shape anterior:** o cache recebia `{ redisUrl, redisOptions: { tls: { rejectUnauthorized: false } } }`.
5. **Shape corrigido:** o cache recebe `{ redisUrl, tls: { rejectUnauthorized: false } }`; os demais consumidores mantêm o shape aninhado que seus loaders esperam.
6. **Comportamento com `redis://`:** todos os builders entregam somente `redisUrl`; nenhum TLS relaxado é adicionado, mesmo com a flag TLS literal `false`.
7. **Comportamento com `rediss://`:** sem opt-in literal, todos entregam somente `redisUrl`; com valor literal `false`, o cache recebe `tls` plano e os outros módulos recebem `redisOptions.tls` no seu nível contratual.
8. **Flag temporária:** `REDIS_CACHE_PROVIDER_DISABLED=true` continua omitindo somente o cache; Locking, Event Bus e Workflow permanecem registrados.
9. **Testes focados:** 2/2 suítes, 89/89 testes e 1/1 snapshot, exit 0.
10. **Unitários completos:** 44/44 suítes, 739/739 testes e 1/1 snapshot, exit 0; o baseline mínimo foi preservado e ampliado.
11. **Lint:** exit 0, 0 erros e 208 warnings, dentro do limite do gate.
12. **Build:** exit 0 após uma correção mecânica de alias de tipo; compilação final concluída com sucesso.
13. **Arquivos alterados:** o commit de código contém somente `apps/backend/src/infrastructure/redis-config.ts` e `apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts`; o fechamento documental contém somente `PLAN.md`, `VERIFICATION.md` e `SUMMARY.md` deste quick gate.
14. **Commits:** código `1a7f9d2c11e584948953b32c9e0a393da53bb36c` (`fix(redis): pass TLS options correctly to cache provider`); documentação: **este commit documental**.
15. **Stash INFRA-01 preservado:** `stash@{0}` com OID `0137d97c2e4db6a2c106c3e53b9b6f0dbb3d612e`, 19 caminhos; OID, nomes, estatística e patch binário permaneceram idênticos nas comparações.
16. **Ausências exigidas:** nenhuma config var, deploy, provider externo ou Phase 12 foi tocado; também não houve migration, package/lockfile, STATE, release command, push ou ativação do cache.

## Integridade e revisão

- Base do gate: `12dea994f81c4713ceaa68c2352de3e2956e412d`.
- Diff do commit de código: 2 arquivos, 190 inserções e 30 remoções.
- Revisão final: clean, 0 blockers e 0 warnings.
- `git diff --check`: limpo.
- Nenhuma URL completa, credencial ou hostname de teste foi registrado nos artefatos.

## Não-ações e encerramento posterior

Este gate não conclui o INFRA-01, não aplica o stash, não remove o workaround, não altera TLS global, secrets, URLs, APP_VERSION, release command, `Procfile`, models, migrations, packages ou lockfiles. Também não executa push, deploy, rollback, conexão com provider real, alteração de dados, `.planning/STATE.md` ou Phase 12.

A instrução de implantar, revalidar o runtime e decidir posteriormente sobre a flag foi superada pelo fechamento formal da estabilização. Não há reativação do cache nem prova adicional de Redis em `web.1`/`worker.1` pendente. O CACHE-01A permanece encerrado como gate documental histórico.
