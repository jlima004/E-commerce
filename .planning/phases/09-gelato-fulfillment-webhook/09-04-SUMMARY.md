---
phase: 09
plan: 04
status: completed
manual_review_gate: true
updated_at: 2026-07-02T18:32:00-03:00
---

# 09-04 - Gelato Webhook Ingestion, Deduplication, Status And Tracking Update Contract

## Escopo executado

Executado somente o plano `.planning/phases/09-gelato-fulfillment-webhook/09-04-PLAN.md`.

Branch decision B preservada: uso mantido da branch `gsd/phase-09-gelato-fulfillment-webhook`.

Parada no manual gate após este summary. **`09-05` não foi iniciado.**

## Arquivos alterados

- `apps/backend/src/config/env.ts`
- `apps/backend/src/api/hooks/gelato/route.ts` (criado)
- `apps/backend/src/api/hooks/gelato/__tests__/gelato-webhook-route.unit.spec.ts` (criado)
- `apps/backend/src/modules/webhooks/service.ts`
- `apps/backend/src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts`
- `apps/backend/src/modules/gelato-fulfillment/service.ts`
- `apps/backend/src/modules/gelato-fulfillment/__tests__/gelato-fulfillment-webhook.unit.spec.ts` (criado)
- `apps/backend/integration-tests/http/gelato-webhook.spec.ts` (criado)
- `.planning/phases/09-gelato-fulfillment-webhook/09-04-SUMMARY.md`

Não alterados, conforme escopo autorizado:

- `apps/backend/medusa-config.ts`
- `apps/backend/src/workflows/order/webhook-order-entrypoint.ts`
- `apps/backend/src/jobs/gelato-dispatch-relay.ts`
- `apps/backend/package.json`
- `package-lock.json`
- `.planning/STATE.md`

## Auth via HTTP Header

Adicionados em `apps/backend/src/config/env.ts`:

- `GELATO_WEBHOOK_AUTH_HEADER_NAME` (default: `X-GELATO-WEBHOOK-SECRET`)
- `GELATO_WEBHOOK_SECRET`

Contrato aplicado:

- header dedicado configurável via env; **não** reutiliza `GELATO_API_KEY`;
- ausência de secret, header ausente ou header incorreto → rejeição **antes** de qualquer side effect de DB;
- comparação fail-closed com `timingSafeEqual`;
- header value, headers completos e raw body **nunca** persistidos.

## Route `POST /hooks/gelato`

Implementada em `apps/backend/src/api/hooks/gelato/route.ts`.

- aceita somente `order_status_updated`;
- eventos fora do MVP retornam `200` com `status: ignored` **sem** `WebhookEventLog` nem update de fulfillment;
- payload malformado retorna `400` sem side effect persistente;
- webhook autenticado forjado/incorreto retorna `401`/`403`/`503` sem side effect persistente.

## WebhookEventLog (`provider = gelato`)

- `external_event_id = payload.id`
- `deduplication_key = payload.id` quando presente
- `payload_hash` como fallback seguro (`payload_hash:{sha256}`) quando `id` ausente
- `entity_type = fulfillment`
- `entity_id = GelatoFulfillment.id` quando resolvido
- duplicate/replay sequencial/concorrente → no-op idempotente quando status final já existe

Metadata allowlist ampliada com campos Gelato saneados (`gelato_order_id`, `order_reference_id`, `fulfillment_id`, `provider_status`) e chaves proibidas reforçadas (secret/header/raw body/tracking público).

## Update de GelatoFulfillment

Helpers adicionados em `apps/backend/src/modules/gelato-fulfillment/service.ts`:

- lookup por `orderReferenceId = order_id` local
- validação de `orderId` Gelato contra `gelato_primary_order_id` / `connected_order_ids`
- split orders conectados atualizam o **mesmo** aggregate local (`connected_order_ids` merge)
- `tracking_summary` interno via `tracking_status` + status local; **sem** URL/código/token público
- mapping conservador: `shipped`, `delivered`, `in_production`, `partially_shipped`, `failed`, `canceled/cancelled`
- status terminal local **não** degrada com evento fora de ordem
- fulfillment desconhecido → `WebhookEventLog` saneado com `status = ignored`, sem corromper fulfillment existente

## Provas de tracking não público / sanitização

- payloads de teste com `trackingCode`/`trackingUrl` não aparecem em records persistidos
- summaries/logs não incluem raw body, payload completo, headers, secrets, CPF/CNPJ, endereço/email/telefone completos
- grep negativo **escopado aos arquivos deste slice** (`src/api/hooks/gelato`, helpers alterados, `integration-tests/http/gelato-webhook.spec.ts`): **PASS**

## Testes executados

### Unit (focado)

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath \
  src/api/hooks/gelato/__tests__/gelato-webhook-route.unit.spec.ts \
  src/modules/webhooks/__tests__/webhook-event-log.unit.spec.ts \
  src/modules/gelato-fulfillment/__tests__/gelato-fulfillment-webhook.unit.spec.ts
```

**Resultado: PASS (27/27)**

Cobertura inclui: header ausente/incorreto, secret ausente fail-closed, evento MVP, dedupe, replay concorrente, evento fora do MVP, payload malformado, fulfillment desconhecido, split order conectado, terminal não degradado, tracking interno não público.

### HTTP / integration (focado)

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath \
  integration-tests/http/gelato-webhook.spec.ts
```

**Resultado: PASS (6/6)**

### Build

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

**Resultado: PASS**

## Provas negativas

### Escopo exato do plano (comando literal)

```bash
bash -lc 'cd apps/backend && git grep -n -E "TrackingAccessToken|tracking_token|public.*tracking|/store/tracking|refund|Refund|ExchangeRequest|stripe listen|stripe trigger" -- src/api src/modules src/jobs integration-tests/http; status=$?; test $status -eq 1'
```

**Resultado: FAIL (exit 0)** — matches **pré-existentes** fora deste slice (`sentry.spec.ts`, `stripe-webhook-store.spec.ts`, `gelato-fulfillment.unit.spec.ts`, `webhooks/types.ts`, migration draft). Nenhum match introduzido nos arquivos autorizados do `09-04`.

### Gelato real em testes (comando literal)

```bash
bash -lc 'cd apps/backend && git grep -n -E "order\\.gelatoapis\\.com|GELATO_API_KEY|X-API-KEY" -- src/api/hooks/gelato/__tests__ src/modules/gelato-fulfillment/__tests__ integration-tests/http/gelato-webhook.spec.ts; status=$?; test $status -eq 1'
```

**Resultado: PASS**

### Arquivos proibidos / lockfile

```bash
bash -lc 'cd apps/backend && git diff -- medusa-config.ts src/workflows/order/webhook-order-entrypoint.ts src/jobs/gelato-dispatch-relay.ts package.json --exit-code && cd ../.. && git diff -- package-lock.json --exit-code'
```

**Resultado: PASS (sem diff)**

### Whitespace

```bash
git diff --check
```

**Resultado: PASS**

## Confirmações de escopo

- `09-05` **não** iniciado
- Phase 10 **não** criada
- tracking público / `TrackingAccessToken` / rota pública de tracking **não** implementados
- refund / exchange **não** implementados
- Gelato real / webhook smoke real / dashboard Gelato smoke **não** executados
- Stripe CLI smoke **não** executado
- Resend real / PostHog real **não** chamados
- migration real / `medusa db:migrate` **não** executados
- `package.json` / lockfile / `medusa-config.ts` / `webhook-order-entrypoint.ts` / `gelato-dispatch-relay.ts` **não** alterados
- `.planning/STATE.md` **não** alterado (fora da allowlist deste slice)

## Manual gate

Aguardando revisão humana explícita antes de iniciar `09-05`.
