---
quick_task: 260715-rel01-runtime-version
status: complete
classification: PASS
date: 2026-07-15
code_commit: f1d4d39
---

# REL-01 — Resumo

## Classificação

**PASS.** A causa raiz era a dependência exclusiva de uma `APP_VERSION` manual, que podia permanecer apontando para o deploy anterior. O runtime agora resolve a versão efetiva por metadata do build/deploy antes de considerar o fallback manual.

## Manual gate

1. **Causa raiz:** `APP_VERSION` era a única fonte e não era atualizada automaticamente a cada build/deploy Heroku.
2. **Precedência:** `HEROKU_BUILD_COMMIT > HEROKU_SLUG_COMMIT > APP_VERSION > dev` (`dev` somente fora de produção).
3. **Heroku:** SHA válido de build prevalece sobre `APP_VERSION` antiga; slug commit é fallback legado.
4. **PM2/VPS:** continua usando apenas `APP_VERSION`; ecosystem inalterado.
5. **Inválidos:** vazio, whitespace, `null`, `undefined`, SHA Heroku malformado e placeholders production são rejeitados/fazem fallback sem vazamento.
6. **Health live:** retorna a versão resolvida e mantém o contrato JSON.
7. **Health ready:** retorna a mesma versão resolvida e mantém o contrato JSON.
8. **Sentry:** `release` recebe a mesma `env.APP_VERSION` resolvida.
9. **Focados:** env 53/53, health 9/9, Sentry 13/13 e PM2 6/6.
10. **Unitários completos:** 44/44 suítes, 730/730 testes.
11. **Health HTTP:** 1/1 suíte e 9/9 testes; doubles locais, sem banco/Supabase.
12. **Lint:** exit 0, 0 erros e 208 warnings, sem aumento do baseline.
13. **Build:** exit 0.
14. **Integridade:** nenhum model, migration, package, lockfile, Procfile ou PM2 diff.
15. **Arquivos:** helper canônico, `env.ts` e três specs diretamente afetadas.
16. **Commits:** runtime/testes `f1d4d39`; documentação no commit de fechamento `docs(observability): record automatic release versioning`.
17. **Divergência inicial:** `origin/main...HEAD = 0 0`; divergência final é reportada após o commit documental.
18. **Não ações:** Heroku CLI/API/Labs, deploy, push, tag, Redis, Event Bus, locking, providers, monetário, catálogo, Stripe, refunds e Phase 12 não foram tocados.

## Encerramento posterior

A orientação operacional posterior deste gate foi superada pelo encerramento formal da estabilização. O versionamento automático está resolvido e não há investigação ou ação adicional de `APP_VERSION` pendente.

## Commits

- `f1d4d39` — `fix(observability): resolve runtime version from deploy metadata`
- documentação — `docs(observability): record automatic release versioning` (commit deste fechamento)

Não houve push nem deploy.
