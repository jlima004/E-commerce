---
gate: apply-real-migrations
date: 2026-07-03
branch: ops/apply-real-migrations-2026-07-03
status: partial-success-manual-review-required
phase_12: not-started
runtime_changes: none
deploy: none
---

# Gate Operacional — Aplicação de Migrations Reais (2026-07-03)

## Resultado

**Parcialmente concluído.** Seis migrations customizadas foram aplicadas nesta execução (além de `Migration20260629000000`, já aplicada em 2026-06-29). **Duas migrations de fases fechadas não foram aplicadas** porque os módulos `webhooks` e `checkout-completion` **não estão registrados** em `apps/backend/medusa-config.ts`. Registrar esses módulos exigiria alteração de runtime — fora do escopo deste gate.

O gate para aqui para **revisão manual** antes de qualquer próximo passo (registro de módulos, reaplicação das migrations pendentes ou deploy).

---

## Branch

| Item | Valor |
|------|-------|
| Branch operacional | `ops/apply-real-migrations-2026-07-03` |
| Base | `gsd/phase-11-refunds-exchanges-admin` |
| Working tree pós-gate | limpo (`git status --short` vazio; apenas este summary adicionado) |

---

## Pré-check

| Check | Resultado |
|-------|-----------|
| `git status --short` (início) | limpo |
| `git branch --show-current` | `gsd/phase-11-refunds-exchanges-admin` → trocado para branch ops |
| `which node` | `/home/jlima/.nvm/versions/node/v22.23.1/bin/node` (WSL/Linux) |
| `which npm` | `/home/jlima/.nvm/versions/node/v22.23.1/bin/npm` |
| `node -v` | v22.23.1 |
| `npm -v` | 10.9.8 |
| Phase 12 | não iniciada (confirmado via `STATE.md` e `11-CLOSURE.md`) |

---

## Inventário de migrations

Paths reais no projeto: `apps/backend/src/modules/*/migrations/*` (nenhum arquivo em `apps/backend/migrations/`).

| # | Módulo | Arquivo | Fase | Status antes | Status depois |
|---|--------|---------|------|--------------|---------------|
| 1 | PaymentAttempt | `Migration20260629000000.ts` | 04 | **já aplicada** (2026-06-29) | aplicada |
| 2 | WebhookEventLog | `Migration20260701000000.ts` | 05 | pendente | **NÃO aplicada** |
| 3 | CheckoutCompletionLog | `Migration20260702000000.ts` | 06 | pendente | **NÃO aplicada** |
| 4 | AnalyticsEventLog | `Migration20260701010000.ts` | 07 | pendente | **aplicada** (esta execução) |
| 5 | EmailDeliveryLog | `Migration20260701181000.ts` | 08 | pendente | **aplicada** (esta execução) |
| 6 | GelatoFulfillment | `TBD-gelato-fulfillment.ts` | 09 | draft pendente | **aplicada** (esta execução) |
| 7 | TrackingAccessToken | `TBD-tracking-access-token.ts` | 10 | draft pendente | **aplicada** (esta execução) |
| 8 | RefundRequest | `TBD-refund-request.ts` | 11 | draft pendente | **aplicada** (esta execução) |
| 9 | ExchangeRequest | `TBD-exchange-request.ts` | 11 | draft pendente | **aplicada** (esta execução) |

### Ordem esperada de aplicação (dependências)

```
PaymentAttempt
  → WebhookEventLog
    → CheckoutCompletionLog
      → AnalyticsEventLog
        → EmailDeliveryLog
          → GelatoFulfillment (FK lógicas: order_id, checkout_completion_log_id, analytics_event_log_id, email_delivery_log_id)
            → TrackingAccessToken (gelato_fulfillment_id)
              → RefundRequest / ExchangeRequest (order_id, payment_attempt_id)
```

### Migrations ignoradas e motivo

| Migration | Motivo |
|-----------|--------|
| `Migration20260701000000` (WebhookEventLog) | Módulo `./src/modules/webhooks` **ausente** de `medusa-config.ts`; runner não executa migrations de módulos não registrados. Correção exige registro em runtime — fora do escopo. |
| `Migration20260702000000` (CheckoutCompletionLog) | Módulo `./src/modules/checkout-completion` **ausente** de `medusa-config.ts`; mesma limitação. |

### Migrations draft `TBD-*`

O runner Medusa **reconheceu e aplicou** os arquivos `TBD-*` sem renomeação (`Migrating TBD-gelato-fulfillment`, etc.). Nenhuma alteração de arquivo de migration foi necessária.

### Correspondência com fases fechadas

Todas as migrations pendentes mapeiam para fases 04–11 (fechadas). Nenhuma migration Phase 12 identificada. Gate de fase: **PASS**.

---

## Backup

| Campo | Valor |
|-------|-------|
| Método | `pg_dump --format=custom --no-owner --no-acl` |
| Timestamp | 2026-07-03 ~16:13:29 -03 |
| Path local (fora do repo) | `/home/jlima/backups/ecommerce/medusa_backend_2026-07-03_161329.dump` |
| Tamanho | 426K |
| Conexão | `DATABASE_MIGRATION_URL` (direct/session; porta 5432; pooler 6543 bloqueado pelo script) |

Variável confirmada presente; host/porta/db verificados sem imprimir credenciais.

> **Nota:** O `.env` local aponta para Postgres em `127.0.0.1:5432` / `medusa_backend` (dev local), não Supabase remoto. O script `db:migrate:safe` validou URL direct/session (não pooler).

---

## Preflight DB

| Check | Resultado |
|-------|-----------|
| Conectividade | OK |
| Tabelas de controle | `mikro_orm_migrations`, `link_module_migrations`, `script_migrations` |
| Migration parcial | nenhuma detectada |
| `npm run db:migrate:safe -- --check-only` | PASS |
| Build pré-migration | PASS (`ADMIN_DISABLED=true`, ~23s) |

### Estado de tabelas custom — antes

| Tabela | Antes |
|--------|-------|
| `payment_attempt` | exists |
| `webhook_event_log` | missing |
| `checkout_completion_log` | missing |
| `analytics_event_log` | missing |
| `email_delivery_log` | missing |
| `gelato_fulfillment` | missing |
| `tracking_access_token` | missing |
| `refund_request` | missing |
| `exchange_request` | missing |

### Estado de tabelas custom — depois

| Tabela | Depois | Índices |
|--------|--------|---------|
| `payment_attempt` | exists | 6 |
| `webhook_event_log` | **missing** | — |
| `checkout_completion_log` | **missing** | — |
| `analytics_event_log` | exists | 8 |
| `email_delivery_log` | exists | 9 |
| `gelato_fulfillment` | exists | 9 |
| `tracking_access_token` | exists | 5 |
| `refund_request` | exists | 6 |
| `exchange_request` | exists | 4 |

---

## Aplicação

| Item | Valor |
|------|-------|
| Comando | `cd apps/backend && npm run db:migrate:safe` |
| Implementação | `node scripts/run-migrations.mjs` → `npx medusa db:migrate` com `DATABASE_URL` sobrescrito por `DATABASE_MIGRATION_URL` no subprocesso |
| Execuções | 1 |
| Exit code | 0 |
| Seed / reset / drop / truncate | não executados |
| Deploy | não executado |

### Migrations aplicadas nesta execução (registro `mikro_orm_migrations`)

- `Migration20260701010000`
- `Migration20260701181000`
- `TBD-gelato-fulfillment`
- `TBD-tracking-access-token`
- `TBD-refund-request`
- `TBD-exchange-request`

### Migrations já aplicadas (pré-gate)

- `Migration20260629000000` (PaymentAttempt, 2026-06-29)

---

## Pós-migration — smoke mínimo

| Check | Resultado |
|-------|-----------|
| `GET /health/live` | HTTP 200 |
| `GET /health/ready` | HTTP 200 — `postgres: up`, `redis: up` |
| Build pós-migration | não reexecutado (nenhuma alteração de código) |
| Schema read-only | tabelas/índices confirmados via `information_schema` / `pg_indexes` |
| `git diff --check` | PASS |
| `package.json` / `package-lock.json` | sem diff |

Nenhuma mutação de negócio: sem Orders, pagamentos, refunds, webhooks reais, Gelato, Correios.

---

## Confirmações de escopo

| Restrição | Status |
|-----------|--------|
| Runtime novo | **não** — nenhum arquivo de código alterado |
| Phase 12 | **não iniciada** |
| Stripe real / Stripe CLI | **não** |
| Gelato real | **não** |
| Correios API | **não** |
| Deploy | **não** |
| `package.json` / lockfile | **sem alteração** |
| Secrets em logs/summary | **não impressos** |

---

## Deferidos / remanescentes

1. **Registro de módulos em `medusa-config.ts`** — adicionar `webhooks` e `checkout-completion` requer gate de runtime separado (fora deste escopo migration-only).
2. **Aplicar migrations pendentes** após registro:
   - `Migration20260701000000` → `webhook_event_log`
   - `Migration20260702000000` → `checkout_completion_log`
3. **Renomeação `TBD-*` → `Migration{timestamp}`** — não necessária nesta execução; runner aceitou nomes draft. Opcional para higiene futura.
4. **Supabase production** — este gate rodou contra DB local do `.env`. Aplicar o mesmo procedimento em Supabase direct/session exige `DATABASE_MIGRATION_URL` de produção/staging em gate separado.
5. **GelatoFulfillment sem `checkout_completion_log`** — tabela `gelato_fulfillment` foi criada com coluna `checkout_completion_log_id` NOT NULL, mas a tabela referenciada ainda não existe. Fluxos que persistem GelatoFulfillment falharão até `checkout_completion_log` existir.

---

## Rollback plan (não executado)

### Restaurar backup completo

```bash
# Parar app/worker antes do restore
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$DATABASE_MIGRATION_URL" \
  /home/jlima/backups/ecommerce/medusa_backend_2026-07-03_161329.dump
```

Substituir `$DATABASE_MIGRATION_URL` pela variável de ambiente real (não colar URL no terminal histórico).

### Rollback seletivo (apenas migrations desta execução)

Requer revisão manual dos `down()` de cada migration aplicada hoje. **Não automatizar** sem análise de dependências. Ordem inversa sugerida:

1. `TBD-exchange-request`
2. `TBD-refund-request`
3. `TBD-tracking-access-token`
4. `TBD-gelato-fulfillment`
5. `Migration20260701181000`
6. `Migration20260701010000`

Remover entradas correspondentes de `mikro_orm_migrations` somente se o `down()` foi executado com sucesso.

### Se migration falhar parcialmente

1. **Parar imediatamente** — não reexecutar `db:migrate:safe`.
2. Registrar estado em `mikro_orm_migrations` e tabelas afetadas.
3. Restaurar backup completo ou executar `down()` documentado.
4. Não prosseguir para deploy ou Phase 12.

---

## Próximo passo recomendado (manual gate)

1. Revisar este summary e aceitar o escopo parcial **ou** aprovar gate separado para registrar `webhooks` + `checkout-completion` em `medusa-config.ts`.
2. Reexecutar `npm run db:migrate:safe` uma vez após registro para aplicar as duas migrations restantes.
3. Validar existência de `webhook_event_log` e `checkout_completion_log` + smoke read-only.
4. Somente então considerar deploy ou gates de integração real (Stripe/Gelato).

**Não prosseguir automaticamente.**
