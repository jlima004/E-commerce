---
gate: apply-real-migrations
date: 2026-07-03
branch: ops/apply-real-migrations-2026-07-03
status: success-manual-gate
phase_12: not-started
runtime_changes: module-registration-only
deploy: none
---

# Gate Operacional — Registro de Módulos + Migrations Pendentes (2026-07-03)

## Resultado

**Concluído com sucesso.** Os módulos `webhooks` e `checkout-completion` foram registrados em `medusa-config.ts`. As duas migrations pendentes foram aplicadas no DB local. Build e smoke de health passaram. Nenhuma alteração em `package.json` / lockfile.

O gate para aqui no **manual gate** — sem deploy, sem Phase 12, sem integrações reais.

---

## Branch

| Item | Valor |
|------|-------|
| Branch operacional | `ops/apply-real-migrations-2026-07-03` |
| Working tree pós-gate | `apps/backend/medusa-config.ts` + este summary (não commitados) |

---

## Pré-check

| Check | Resultado |
|-------|-----------|
| `git status --short` (início) | limpo |
| `git branch --show-current` | `ops/apply-real-migrations-2026-07-03` |
| `which node` | `/home/jlima/.nvm/versions/node/v22.23.1/bin/node` (WSL/Linux) |
| `which npm` | `/home/jlima/.nvm/versions/node/v22.23.1/bin/npm` |
| `node -v` | v22.23.1 |
| `npm -v` | 10.9.8 |
| Phase 12 | não iniciada |

---

## Pré-validação (antes de alterar)

| Check | Resultado |
|-------|-----------|
| `apps/backend/src/modules/webhooks` | existe |
| `apps/backend/src/modules/checkout-completion` | existe |
| `Migration20260701000000.ts` | existe |
| `Migration20260702000000.ts` | existe |
| `webhook_event_log` (antes) | **missing** |
| `checkout_completion_log` (antes) | **missing** |

---

## Alteração de runtime (escopo aprovado)

Registro em `apps/backend/medusa-config.ts`:

| Módulo | Key | Resolve |
|--------|-----|---------|
| webhooks | `webhooks` | `./src/modules/webhooks` |
| checkout-completion | `checkout_completion` | `./src/modules/checkout-completion` |

Nenhum outro arquivo de código alterado (service/model/migration/env/package).

---

## Build

| Item | Resultado |
|------|-----------|
| Comando | `cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build` |
| Exit code | 0 |
| Duração | ~24s |
| Status | **PASS** |

---

## Migration

| Item | Valor |
|------|-------|
| Comando | `cd apps/backend && npm run db:migrate:safe` |
| Execuções | 1 |
| Exit code | 0 |
| Target | DB local (`DATABASE_MIGRATION_URL` / `.env`) |
| Supabase/produção | **não migrado** |

### Migrations aplicadas nesta execução

| Migration | Tabela | Executed at |
|-----------|--------|-------------|
| `Migration20260701000000` | `webhook_event_log` | 2026-07-03T19:31:30.057Z |
| `Migration20260702000000` | `checkout_completion_log` | 2026-07-03T19:31:30.235Z |

Demais módulos: skipped (já up-to-date).

---

## Tabelas — antes / depois

| Tabela | Antes | Depois |
|--------|-------|--------|
| `webhook_event_log` | missing | **exists** |
| `checkout_completion_log` | missing | **exists** |

### Índices principais — `webhook_event_log`

- `webhook_event_log_pkey`
- `IDX_webhook_event_log_provider_deduplication_key_unique`
- `IDX_webhook_event_log_provider_external_event_id_unique`
- `IDX_webhook_event_log_provider_payload_hash`
- `IDX_webhook_event_log_entity`
- `IDX_webhook_event_log_event_type`
- `IDX_webhook_event_log_status_received_at`

### Constraints — `webhook_event_log`

- PK + checks: `provider`, `entity_type`, `status`, `processing_attempts`

### Índices principais — `checkout_completion_log`

- `checkout_completion_log_pkey`
- `IDX_checkout_completion_log_idempotency_key_unique`
- `IDX_checkout_completion_log_payment_intent_id`
- `IDX_checkout_completion_log_cart_id`
- `IDX_checkout_completion_log_payment_attempt_id`
- `IDX_checkout_completion_log_order_id`
- `IDX_checkout_completion_log_status_locked_at`

### Constraints — `checkout_completion_log`

- PK + checks: `operation`, `status`

---

## Pós-migration — smoke mínimo

| Check | Resultado |
|-------|-----------|
| `GET /health/live` | HTTP **200** |
| `GET /health/ready` | HTTP **200** — `postgres: up`, `redis: up` |
| Mutação de negócio | **nenhuma** |

---

## Validação documental

| Check | Resultado |
|-------|-----------|
| `git diff --check` | PASS |
| `package.json` / `package-lock.json` / `apps/backend/package.json` | **sem diff** |
| Arquivos alterados | `apps/backend/medusa-config.ts`, `.planning/ops/apply-real-migrations-2026-07-03-SUMMARY.md` |

---

## Confirmações de escopo

| Restrição | Status |
|-----------|--------|
| Runtime novo além de registro de módulos | **não** |
| Regras de negócio alteradas | **não** |
| Phase 12 | **não iniciada** |
| Stripe real / Stripe CLI | **não** |
| Gelato real | **não** |
| Correios API | **não** |
| Order / refund / webhook real | **não** |
| Deploy | **não** |
| Supabase/produção migrado | **não** |
| `package.json` / lockfile | **sem alteração** |

---

## Contexto do gate anterior (mesma branch, execução ~16:13)

Na execução anterior deste gate (migration-only, sem registro de módulos), seis migrations foram aplicadas; `webhook_event_log` e `checkout_completion_log` ficaram pendentes. Backup disponível em:

`/home/jlima/backups/ecommerce/medusa_backend_2026-07-03_161329.dump`

---

## Próximo passo recomendado (manual gate)

1. Revisar diff de `medusa-config.ts` e este summary.
2. Commitar na branch ops se aprovado.
3. Considerar gate separado para Supabase/produção (`DATABASE_MIGRATION_URL` de staging/prod).
4. Considerar deploy ou gates de integração real (Stripe/Gelato) somente após aprovação explícita.

**Não prosseguir automaticamente para Phase 12, deploy ou integrações reais.**
