---
phase: 10
plan: 01
status: completed
manual_review_gate: true
updated_at: 2026-07-02T20:12:00-03:00
---

# 10-01 - TrackingAccessToken Contract, Model, Hash, Expiry And Revocation

## Escopo executado

Executado somente o plano `.planning/phases/10-secure-guest-tracking/10-01-PLAN.md`.

Branch ativa no pré-check: `gsd/phase-10-secure-guest-tracking`

Pré-check:

- `node`: v22.23.1 (`/home/jlima/.nvm/versions/node/v22.23.1/bin/node`)
- `npm`: 10.9.8 (`/home/jlima/.nvm/versions/node/v22.23.1/bin/npm`)

## Arquivos criados/alterados

- `apps/backend/src/modules/tracking-access-token/index.ts`
- `apps/backend/src/modules/tracking-access-token/models/tracking-access-token.ts`
- `apps/backend/src/modules/tracking-access-token/service.ts`
- `apps/backend/src/modules/tracking-access-token/types.ts`
- `apps/backend/src/modules/tracking-access-token/migrations/TBD-tracking-access-token.ts`
- `apps/backend/src/modules/tracking-access-token/__tests__/tracking-access-token.unit.spec.ts`
- `apps/backend/src/config/env.ts`
- `apps/backend/medusa-config.ts`
- `apps/backend/src/modules/README.md`
- `.planning/phases/10-secure-guest-tracking/10-01-SUMMARY.md`

## Contrato do modelo

Modulo local criado: `tracking-access-token` (`TRACKING_ACCESS_TOKEN_MODULE`)

Tabela/modelo `tracking_access_token`:

- `id` com prefixo `trkacc`
- `order_id`
- `gelato_fulfillment_id`
- `token_hash` (unico; nunca plaintext)
- `status`: `active | expired | revoked`
- `expires_at`
- `revoked_at`
- `last_used_at`
- `created_for`: `guest_tracking`
- `created_at`
- `updated_at`
- `deleted_at`

Indexes:

- unique `token_hash`
- index `order_id`
- index `gelato_fulfillment_id`
- index `status, expires_at`

Campos proibidos ausentes do modelo: plaintext token, token prefix/suffix, IP bruto, user-agent completo, e-mail, telefone, CPF/CNPJ, endereco, dados de pagamento, payload Gelato/Order bruto, headers, cookies e secrets.

## Contrato de hash

- Geracao: `crypto.randomBytes(32)` codificado em base64url
- Hash: `HMAC-SHA256(TRACKING_TOKEN_PEPPER, token)` persistido como hex
- Comparacao: recomputa hash candidato e usa `timingSafeEqual` (comprimento diferente falha antes da comparacao)
- Mint one-shot: `mintTrackingAccessToken()` retorna `plaintext_token` apenas no resultado transient; persistencia via `buildTrackingAccessTokenRecord()` aceita somente `token_hash`
- Verificacao ativa: `verifyTrackingAccessTokenCandidate()` + `assertActiveTrackingAccessToken()`

Helpers de lifecycle:

- `buildTrackingAccessTokenRevocationUpdate()`
- `buildTrackingAccessTokenExpiryUpdate()`
- `buildTrackingAccessTokenLastUsedUpdate()`
- `isTrackingAccessTokenExpired()`

Sanitizers:

- `assertNoSensitiveTrackingAccessTokenMetadata()`
- `sanitizeTrackingAccessTokenMetadata()` (allowlist: `correlation_id`, `recovery_origin`, `source`)
- `sanitizeTrackingAccessTokenError()` / `sanitizeTrackingAccessTokenErrorText()`

## Env contract

- `TRACKING_TOKEN_PEPPER` adicionado a `AppEnv` e ao schema Zod de `parseEnv()` como opcional (trim; nunca logado)
- Fail-closed em runtime production-like via `resolveTrackingTokenPepper()`:
  - `NODE_ENV=production` sem pepper -> `Missing required variable: TRACKING_TOKEN_PEPPER`
  - pepper curto em production -> `Invalid TRACKING_TOKEN_PEPPER: must be at least 32 characters`
- Modulo registrado em `medusa-config.ts` com key `tracking_access_token`

## Migration draft (nao aplicada)

- Arquivo: `apps/backend/src/modules/tracking-access-token/migrations/TBD-tracking-access-token.ts`
- Classe: `MigrationTBDTrackingAccessToken`
- `medusa db:migrate` **nao executado**
- `medusa db:generate` **nao executado**

## Testes

Comando:

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/tracking-access-token/__tests__/tracking-access-token.unit.spec.ts
```

Resultado: **38/38 PASS**

Cobertura principal:

- plaintext nunca persiste no record
- `token_hash` obrigatorio e presente
- `expires_at` obrigatorio
- token revogado/expirado rejeitado
- `timingSafeEqual` usado na comparacao constante-time
- sanitizers rejeitam campos proibidos
- scan negativo: nenhuma rota publica `/store/tracking` criada

## Build

Comando:

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Resultado: **PASS** (`Backend build completed successfully`)

## Provas negativas

| Prova | Resultado |
|-------|-----------|
| Plaintext token nao persistido | PASS (`mintTrackingAccessToken` + grep JSON record) |
| `token_hash` existe | PASS (modelo, migration draft, record builder) |
| Compare constante-time | PASS (`compareTrackingAccessTokenHash` + mock `timingSafeEqual`) |
| Token expirado/revogado rejeitado | PASS (`assertActiveTrackingAccessToken`) |
| Nenhuma rota publica de tracking | PASS (scan `apps/backend/src/api`) |
| Sem refund/exchange/Phase 11 | PASS (escopo nao tocado) |
| `package.json` / lockfile sem diff | PASS |
| `git diff --check` | PASS |

## Fora de escopo confirmado

- **10-02** nao iniciado (sem rota publica `POST /store/tracking/lookup`, sem rate limit)
- **10-03** nao iniciado
- **Phase 11** nao iniciada
- Sem refund, exchange, Gelato real, webhook smoke real, deploy
- Sem migration real aplicada

## Manual gate

Parado no manual gate apos execucao do slice **10-01** apenas. Proximo passo permitido somente com aprovacao humana explicita para **10-02** ou revisao deste summary.
