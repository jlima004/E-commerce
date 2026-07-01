<!-- gsd-project-start source:PROJECT.md -->

## Project

**E-commerce POD de Camisetas — Backend MVP**

Backend headless de um e-commerce Print-on-Demand (POD) de camisetas para o mercado brasileiro, construído sobre Medusa v2. Este escopo entrega **apenas o backend MVP**: catálogo, carrinho, checkout (convidado e autenticado), pagamento via Stripe (cartão e Pix), criação confiável de pedidos pós-webhook, fulfillment via Gelato, tracking, reembolsos/trocas operacionais pelo Admin e observabilidade. O frontend (storefront) virá depois — o backend deve expor contratos de API estáveis para consumo futuro.

**Core Value:** Um pedido (Order) só existe e só é enviado à produção (Gelato) após confirmação de pagamento confiável, validada e idempotente pelo webhook canônico do Stripe — sem cobrança fantasma, sem pedido duplicado, sem fulfillment indevido.

### Constraints

- **Tech stack**: Medusa v2 + Node.js + TypeScript — base obrigatória; integrações via módulos Medusa.
- **Persistência**: PostgreSQL/Supabase + Redis — fila/cache e estado transacional.
- **Pagamento**: Stripe apenas (cartão e Pix); Order nunca criado antes do webhook confiável.
- **Fulfillment**: Gelato apenas; um Order não pode gerar mais de um pedido Gelato ativo (salvo reprocessamento manual controlado).
- **Segurança**: tokens de tracking nunca em texto puro; secrets, dados completos de cartão e tokens puros nunca em logs.
- **Mercado**: Brasil/BRL, single-currency, sem venda internacional.
- **Compatibilidade**: contratos de API devem antecipar o consumo da storefront futura (PRD Frontend v1.1).

<!-- gsd-project-end -->

<!-- gsd-stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | **22.x LTS** (20.x also supported; 20.x is Medusa's default) | Runtime | Medusa v2 requires Node **20+**. Supported LTS lines: 20.x / 22.x / 24.x / 25.x. Pin via `engines` in `package.json`. 22.x is the sweet spot for a 2026 greenfield (long support window, fully supported). [HIGH] |
| **TypeScript** | **^5.6** (whatever `create-medusa-app` pins) | Language | Medusa v2 is TS-first; modules, workflows, and data models are authored in TS. Let the scaffolder set the version, then keep it pinned. [HIGH] |
| **Medusa** (`@medusajs/medusa` + `@medusajs/framework`) | **2.15.x** (latest 2.15.5) | Commerce framework | The base constraint of the project. v2 is a modular framework (modules + workflows + subscribers + links), not the v1 monolith. Always install the matched set of `@medusajs/*` 2.15.x packages together. [HIGH] |
| **@medusajs/cli** | 2.15.x (matched) | Dev/build/migrations | Provides `medusa develop`, `medusa db:migrate`, `medusa start`. Scaffold with `npx create-medusa-app@latest`. [HIGH] |
| **@medusajs/dashboard** (Admin) | 2.15.x (bundled) | Admin UI | Built and served by the backend; deploy on its own subdomain per PROJECT.md. In-scope (it's part of the backend), and where operators do refunds/exchanges. [HIGH] |
| **PostgreSQL** | **15+** (Supabase runs 15/17) | Primary database | Medusa's only supported relational DB. Use **Supabase** as managed Postgres — connect Medusa via the pooled connection string (`DATABASE_URL`). [HIGH] |
| **Redis** | **7.x** | Cache + Event Bus + **Workflow Engine** + queues | In production Medusa needs Redis-backed infrastructure modules (in-memory defaults are dev-only). Critical here: the **Redis Workflow Engine** persists long-running/async workflow state — essential for the webhook-driven Order/fulfillment invariants. [HIGH] |
| **Stripe** (`stripe` Node SDK) | **^19.x** (19.1.0) | Payments (card + **Pix**) | Brazil's Pix is natively supported by Stripe (presentment currency **BRL**, real-time payment, refunds supported, **no manual capture**). Integrated through Medusa's official Stripe Module Provider. [HIGH] |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@medusajs/medusa/payment-stripe** (bundled provider) | 2.15.x | Stripe payment provider for the Payment Module | Register under the Payment Module's `providers`. Options: `apiKey` (req), `webhookSecret` (req in prod), `capture` (default false), `automatic_payment_methods` (set **true** to surface Pix + card from the Stripe Dashboard), `payment_description`. Webhook route is auto-exposed at `/hooks/payment/stripe_stripe`. [HIGH] |
| **@medusajs/medusa/event-bus-redis** | 2.15.x | Redis event bus | Production event delivery to subscribers. Configure `EVENTS_REDIS_URL` + `jobOptions.removeOnComplete/removeOnFail`. [HIGH] |
| **@medusajs/medusa/workflow-engine-redis** | 2.15.x | Durable workflow engine | Persists workflow execution + enables retries/compensation — backbone for "Order only after confirmed webhook" and "Gelato only after durable purchase_completed". [HIGH] |
| **@medusajs/medusa/cache-redis** *(or `caching-redis`)* | 2.15.x | Cache provider | Production caching. [HIGH] |
| **@medusajs/file-s3** | 2.15.x | Product image storage provider | Point Medusa's File Module at **Supabase Storage's S3-compatible endpoint** (bucket, region, endpoint, access key/secret). Cleanest way to satisfy "imagens em Supabase Storage" without writing a custom file provider. [MEDIUM — verify S3 endpoint/credentials wiring during the storage phase] |
| **@supabase/supabase-js** | **^2.x** | Supabase Storage SDK (alternative path) | Only if you implement a **custom Medusa File Module provider** instead of the S3 provider (e.g., to use signed URLs / RLS-aware uploads). Prefer the S3 provider first. [MEDIUM] |
| **resend** (Node SDK) | **^4.x** (latest 4.x) | Transactional email | Confirmation email before Gelato attempt (`EmailDeliveryLog`). Supports a per-send **`idempotencyKey`** (pattern `welcome-user/123`) — use it keyed by order/payment_intent to prevent duplicate confirmation emails. [HIGH on SDK + idempotency; MEDIUM on exact patch — pin at install] |
| **posthog-node** | **5.38.x** (5.38.2) | Product analytics (server-side) | Emit the durable `purchase_completed` **domain event** from the backend outbox (`AnalyticsEventLog`), independent of any frontend PostHog. Requires Node ^20.20 \|\| >=22.22. [HIGH] |
| **@sentry/node** | **10.x** (10.59.x) | Error monitoring | Backend exception + performance monitoring. Wire into the Medusa server bootstrap and a global error handler / subscriber. No official Medusa-Sentry plugin needed — use the Node SDK directly. [HIGH] |
| **Gelato REST API** (direct, via `fetch`/`axios`) | API **v4** (orders) | POD fulfillment | **No official Gelato npm SDK.** Call the REST API directly inside a **custom Medusa fulfillment module**. Order base URL `https://order.gelatoapis.com` (`POST /v4/orders`), auth header `X-API-KEY`. Webhook `order_status_updated` carries `trackingCode`/`trackingUrl` for tracking. [HIGH] |
| **axios** *(optional)* | ^1.x | HTTP client for Gelato | Optional convenience; Node 22 `fetch` is sufficient. Add a small retry/backoff wrapper for Gelato calls. [HIGH] |
| **zod** | ^3.x (bundled via Medusa) | Request/payload validation | Validate Stripe/Gelato webhook payloads and custom API route inputs. Medusa already depends on it. [HIGH] |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **@medusajs/test-utils** + **Jest** | Integration tests for modules/workflows | Medusa's official testing path (`medusaIntegrationTestRunner`). Use it to lock in the payment → Order → fulfillment invariants. [HIGH] |
| **create-medusa-app** | Project scaffolding | `npx create-medusa-app@latest` (CLI from 2.13.3+). Generates the canonical v2 layout, runs migrations, creates admin user. [HIGH] |
| **PM2** | Process manager on the VPS | **6.x**. Run **two processes**: the HTTP **server** and a dedicated **worker** (`workerMode`) so background jobs/subscribers don't block API. Use `pm2 start ... --name medusa-server` / `medusa-worker`, `pm2 save`, `pm2 startup`. [HIGH] |
| **Nginx** | Reverse proxy / TLS termination | Stable (1.26+). Proxy the store API and Admin subdomain; **must** forward the raw body for Stripe webhook signature verification (don't let proxies mangle the body). Terminate TLS (Let's Encrypt/Certbot). [HIGH] |
| **dotenv / env files** | Config | Medusa loads `.env` per `NODE_ENV`. Keep secrets out of logs (project constraint). [HIGH] |

## Installation

# 1) Scaffold the Medusa v2 backend (Node 20+/22 LTS active)

# 2) Production infrastructure providers (Redis) + Stripe provider is bundled in @medusajs/medusa

#    (these are part of @medusajs/medusa; ensure the version matches your installed Medusa)

#    No separate install for payment-stripe / event-bus-redis / workflow-engine-redis —

#    they are subpath exports of @medusajs/medusa. Just register them in medusa-config.ts.

# 3) Integrations

# 4) Product image storage — choose ONE:

#    (a) Supabase Storage via S3-compatible endpoint (recommended)

#    (b) Custom file provider using Supabase SDK (only if you need signed URLs/RLS)

# npm install @supabase/supabase-js@^2

# 5) Gelato: no SDK — call REST directly. axios optional:

# 6) Dev / process / proxy (system-level)

# Nginx + Certbot installed via the OS package manager (apt)

## Medusa v2 Architecture Specifics (what the roadmap must respect)

- **Modules** = isolated domains with their own data models + service, registered in `medusa-config.ts`. Build custom modules for: **Gelato fulfillment**, **PaymentAttempt**, **WebhookEventLog**, **CheckoutCompletionLog**, **AnalyticsEventLog (outbox)**, **EmailDeliveryLog**, **TrackingAccessToken**, **OperationalAlert/AdminActionLog**. Each module is self-contained; modules must **not** import each other's services directly.
- **Data models** are defined with `model.define(...)` in a module and migrated via `medusa db:generate <module>` + `medusa db:migrate`. (Follows the Prisma-like conventions in the workspace rule: ids, timestamps, indexes, unique constraints.)
- **Module Links** (`defineLink`) connect data across module boundaries instead of foreign keys — e.g., link a custom `gelato_order` / `payment_attempt` to the core **Order** / **Payment** models. This is the v2-correct way to associate custom data with core commerce entities. Use the **Query** graph (`query.graph`) to read across links; never reach into another module's DB.
- **Workflows** (`createWorkflow` + steps with compensation) orchestrate multi-step, side-effectful processes with **durable state + retries + rollback**. Put the critical invariants here: *confirm payment → idempotently create Order → record purchase_completed → trigger Gelato → send email*. The **Redis workflow engine** makes these durable across restarts.
- **Subscribers** react to events (e.g., `order.placed`, or custom emitted events) for async side effects (analytics flush, email). Subscribers run in **worker mode** — hence the separate PM2 worker process.
- **Scheduled jobs** (cron-like) for outbox reconciliation / retrying failed Gelato calls or unflushed analytics.
- **Payment Module provider pattern (v2):** payment flows through **Payment Collection → Payment Session → Payment**. The provider is a module provider under the Payment Module. **Webhooks** hit the framework route `/hooks/payment/stripe_stripe` and Medusa maps them to payment status — but for the project's invariant you should treat the **Stripe `payment_intent.succeeded` webhook as the canonical trigger** and create the Order via your own idempotent workflow keyed on `payment_intent_id`.
- **Custom API routes** under `src/api/**` (file-based) expose the stable contracts the future storefront will consume, plus your dedicated webhook receivers (`/webhooks/stripe`, `/webhooks/gelato`) if you want full control over verification + logging beyond the built-in payment hook.

## Brazil-Specific Concerns (Pix / BRL)

- **Pix is async by nature.** Stripe Pix flows go `requires_action` (QR/copy-paste code shown) → `processing` → **`succeeded`** (or expires). There is **no manual capture** for Pix. This means card "authorize-then-capture" assumptions don't apply — the **webhook is the only reliable confirmation**. This aligns perfectly with the project's core invariant (Order created only after the canonical Stripe webhook). [HIGH]
- **Currency must be BRL** end to end (catalog prices, Stripe PaymentIntent, Gelato order currency). Single-currency per scope. [HIGH]
- **Enable Pix in the Stripe Dashboard** for the account (and request access if needed); with `automatic_payment_methods: true` Stripe will present Pix to BRL customers. Card + Pix is the exact MVP payment scope. [HIGH]
- **Gelato fulfills in Brazil.** Webhook examples show domestic BR shipping (e.g., `DHL Express Domestic BR`, `fulfillmentCountry: "BR"`), confirming Gelato has BR production/shipping for apparel. Map Gelato `productUid`s for t-shirts during catalog modeling (the obligatory Gelato metadata in PROJECT.md). [HIGH]
- **Idempotency everywhere on the money path:** Stripe webhook dedupe (`WebhookEventLog`), Order creation keyed on `payment_intent_id` (`CheckoutCompletionLog`), Resend `idempotencyKey`, single active Gelato order per Order. The stack supports all of this natively (workflow engine + Resend idempotency key). [HIGH]

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Supabase (managed Postgres) | Neon, Railway, self-hosted Postgres on the VPS | If you want DB co-located on the same VPS (lower latency, more ops burden) or already standardized on Neon. Supabase wins here because it **also** provides Storage for images in one platform. |
| `@medusajs/file-s3` → Supabase Storage (S3 endpoint) | Custom File Module provider via `@supabase/supabase-js`; or AWS S3 / Cloudflare R2 | Custom provider only if you need Supabase signed URLs / RLS semantics. R2/S3 if you later leave Supabase. |
| Stripe (card + Pix) | Mercado Pago, PagSeguro, Asaas (Brazilian PSPs) | Those are often *cheaper/native* for Pix in Brazil, but there is **no first-party Medusa provider** — you'd build a custom payment module provider. Stripe chosen because it has an **official Medusa provider** + native Pix + one integration for card+Pix. Revisit if Stripe Pix pricing/availability becomes a blocker. |
| Direct Gelato REST in a custom module | `ekkolon/gelato-admin-node` (community SDK) | Community SDK (Medium reputation, zero-dep) can speed up DTOs, but adds a dependency you don't control on the money/fulfillment path. Prefer thin direct REST you fully own. |
| PM2 (server + worker) | systemd units, Docker Compose, Kubernetes | systemd if you prefer OS-native supervision; Docker/K8s if you containerize later. PM2 matches the PROJECT.md infra choice and is simplest for a single VPS. |
| Redis workflow engine | In-memory workflow engine | In-memory is **dev only** — it loses workflow state on restart, which would break the durable Order/fulfillment guarantees. Never use in-memory in production. |
| posthog-node (server outbox) | Frontend-only PostHog | Frontend analytics is unreliable for `purchase_completed`; the backend outbox is a domain requirement. (Frontend PostHog is a separate future-storefront concern, out of scope.) |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Medusa v1 / `medusa-*` legacy plugins** | v1 is a different architecture (monolith, no modules/workflows/links). v1 plugins are **incompatible** with v2. | v2 modules + workflows + `@medusajs/*` 2.15.x packages |
| **In-memory event bus / cache / workflow engine in production** | Dev defaults; lose state on restart → duplicated/lost work, broken idempotency invariants | Redis-backed `event-bus-redis`, `cache-redis`, `workflow-engine-redis` |
| **Creating the Order synchronously at checkout (before webhook)** | Violates the core invariant; Pix can't be captured synchronously and cards can fail post-auth → phantom charges / orphan orders | Webhook-driven, idempotent Order-creation **workflow** keyed on `payment_intent_id` |
| **Manual capture flow for Pix** | Pix does **not** support manual capture | Treat `payment_intent.succeeded` webhook as canonical confirmation |
| **Reaching into another module's DB / importing another module's service** | Breaks v2 module isolation; brittle | **Module Links** (`defineLink`) + **Query graph** (`query.graph`) |
| **Storefront frameworks (Next.js storefront, `@medusajs/*-storefront`, Stripe.js/Elements in this repo)** | Out of scope this milestone; storefront is a later milestone | Expose stable **API contracts** only; client-side Stripe lives in the future storefront |
| **Putting webhook receivers behind body-parsing proxies that alter the raw body** | Breaks Stripe signature verification | Nginx pass-through of raw body; verify with `webhookSecret` |
| **Logging secrets / full card data / plaintext tracking tokens** | Project security constraint | Hash/encrypt tracking tokens; redact secrets in logs/Sentry |

## Stack Patterns by Variant

- One PM2 ecosystem with **two apps**: `medusa-server` (`MEDUSA_WORKER_MODE=server`) and `medusa-worker` (`MEDUSA_WORKER_MODE=worker`), Redis + (optionally) Postgres local or Supabase remote.
- Because the workflow engine is Redis-backed, the worker can safely own long-running webhook→Order→Gelato workflows.
- Use the **pooled** (PgBouncer/Supavisor) connection string for the app; use the **direct** connection for migrations. Set `connection.pool` sizing conservatively to avoid exhausting Supabase limits.
- Split server and worker onto separate hosts (Redis shared), keep Supabase managed. No code changes — just `MEDUSA_WORKER_MODE` + infra.
- Swap to a Brazilian PSP by writing a **custom Payment Module provider** (same Payment Collection/Session contract) — the rest of the workflow (webhook→Order→Gelato) stays unchanged.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@medusajs/medusa@2.15.x` | all `@medusajs/*@2.15.x` | **Keep the entire `@medusajs/*` set on the same minor.** Mixing 2.x minors causes runtime/type drift. |
| `@medusajs/medusa@2.15.x` | Node **20.x / 22.x / 24.x / 25.x** | Default 20.x; pin with `engines`. PostgreSQL 14+ (use 15+). |
| `posthog-node@5.38.x` | Node **^20.20 \|\| >=22.22** | Slightly higher Node minor floor than Medusa — another reason to standardize on **22.x LTS**. |
| `stripe@^19` | Node 18+ | Pin a Stripe **API version** in the SDK config; Pix in payment method configs is current (Basil API line). |
| `@sentry/node@10.x` | Node 18+ | v10 line current; init early in bootstrap. |
| `resend@^4` | Node 18+ | Per-send `idempotencyKey` supported. |
| `@medusajs/file-s3` ↔ Supabase Storage | S3-compatible endpoint | Verify Supabase S3 endpoint + access keys during the storage phase. [MEDIUM] |

## Sources

- `/websites/medusajs_resources` (Context7, High reputation) — Redis cache/event-bus/workflow-engine modules, Stripe Module Provider options (`apiKey`, `webhookSecret`, `capture`, `automatic_payment_methods`), payment webhook route `/hooks/payment/stripe_stripe`, Payment Collection/Session, links between Payment and Customer (v2.5.0+). [HIGH]
- medusajs.com docs / GitHub releases (official, web) — **Medusa 2.15.5** latest; **Node 20+** required (20/22/24/25 LTS supported; 20.x default); `create-medusa-app`; `medusa start` must run from `.medusa/server`; worker mode. [HIGH]
- `/websites/stripe` (Context7, High) + docs.stripe.com — **Pix**: BRL presentment, real-time payment, refunds yes, **manual capture no**; enable via `payment_method_types`/automatic methods; Pix added to Payment Method Configurations (2025 Basil changelog). [HIGH]
- `/stripe/stripe-node` (Context7) — Stripe Node SDK **v19.1.0**. [HIGH]
- `/websites/dashboard_gelato` (Context7, High) — Gelato **v4** `POST /v4/orders`, `X-API-KEY` auth, base `https://order.gelatoapis.com`, `order_status_updated` webhook with `trackingCode`/`trackingUrl`, BR domestic shipping in examples. [HIGH]
- `/websites/resend` (Context7, High) — Resend Node SDK send + per-send `idempotencyKey`. [HIGH on API; MEDIUM on exact patch]
- posthog.com docs + npm (web) — **posthog-node 5.38.2**, Node `^20.20 || >=22.22`, server-side capture. [HIGH]
- npm / newreleases (web) — **@sentry/node 10.59.x** current. [HIGH]
- `ekkolon/gelato-admin-node` (Context7, Medium reputation) — community Gelato SDK; noted as alternative, not recommended for the money path. [MEDIUM]

<!-- gsd-stack-end -->

<!-- gsd-conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- gsd-conventions-end -->

<!-- gsd-architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- gsd-architecture-end -->

<!-- gsd-skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.cursor/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- gsd-skills-end -->

<!-- gsd-workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- gsd-workflow-end -->

<!-- gsd-profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- gsd-profile-end -->

@RTK.md
