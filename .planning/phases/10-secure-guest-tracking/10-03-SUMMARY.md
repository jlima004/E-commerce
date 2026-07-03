---
phase: 10
plan: 03
status: completed
manual_review_gate: true
updated_at: 2026-07-02T21:30:00-03:00
---

# 10-03 - Rate Limit, Enumeration Protection And Final Validation

## Escopo executado

Executado somente o plano `.planning/phases/10-secure-guest-tracking/10-03-PLAN.md`.

Branch ativa no pré-check: `gsd/phase-10-secure-guest-tracking`

Pré-check:

- `git status`: limpo antes do início
- `node`: v22.23.1 (`/home/jlima/.nvm/versions/node/v22.23.1/bin/node`)
- `npm`: 10.9.8 (`/home/jlima/.nvm/versions/node/v22.23.1/bin/npm`)

## Arquivos alterados/criados

- `apps/backend/src/modules/tracking-access-token/lookup-rate-limit.ts` (criado)
- `apps/backend/src/modules/tracking-access-token/lookup.ts` (alterado)
- `apps/backend/src/api/store/tracking/lookup/route.ts` (alterado)
- `apps/backend/src/modules/tracking-access-token/__tests__/tracking-access-token.unit.spec.ts` (alterado)
- `apps/backend/integration-tests/http/tracking-access-token.spec.ts` (alterado)
- `.planning/phases/10-secure-guest-tracking/10-03-SUMMARY.md` (criado)

## Mecanismo de rate limit / enumeration guard

Arquivo principal: `lookup-rate-limit.ts`

Fluxo em `POST /store/tracking/lookup`:

1. Deriva um bucket público **antes** do lookup caro.
2. Se o bucket já atingiu o limite (`count >= maxAttempts`), responde **429** imediatamente.
3. Falhas públicas incrementam o mesmo contador:
   - token em query/path;
   - body malformado / campos proibidos;
   - token inválido, desconhecido, expirado ou revogado.
4. Lookup bem-sucedido **não** incrementa o contador.
5. Quando o incremento cruza o limite, a resposta da tentativa corrente passa a ser **429** (não 401/400).

Configuração padrão:

- `maxAttempts`: 10
- `windowMs`: 15 minutos
- store: `Map` in-memory keyed by bucket HMAC (sem migration; adequado ao gate atual)
- prune: buckets com `windowStartMs < currentWindowStartMs - windowMs` são removidos antes/depois de cada incremento de falha — retém no máximo a janela atual e a anterior

Helpers de teste: `configureTrackingLookupRateLimitForTests`, `resetTrackingLookupRateLimitForTests`, `listInMemoryTrackingLookupRateLimitBucketKeysForTests`, `listInMemoryTrackingLookupRateLimitBucketsForTests`, `pruneExpiredTrackingLookupRateLimitBuckets`.

## Bucket usado e por que não persiste PII bruta

Bucket key:

```text
HMAC-SHA256(
  TRACKING_TOKEN_PEPPER,
  `${clientIp}|${userAgentSummary}|${windowStartMs}`
)
```

Entradas derivadas (nunca persistidas):

- **IP**: lido de `x-forwarded-for` / `x-real-ip` / `req.ip` / socket — usado só dentro do HMAC.
- **User-agent**: resumido ao primeiro token de produto (`mozilla/5.0`, `curl/8.5.0`, etc.), truncado a 48 chars — nunca o UA completo.

Persistido no store in-memory:

```json
{ "count": <number>, "windowStartMs": <number> }
```

Chave do store: digest hex de 64 chars (sem IP, sem UA, sem token).

O store permanece sem PII bruta — apenas `{ count, windowStartMs }` keyed by digest HMAC. O prune não adiciona IP, UA completo, token ou metadata sensível.

### Limitação operacional

Rate limit é **process-local** (Map in-memory). Em deploy com múltiplos dynos/instâncias, cada processo mantém contadores independentes — um bucket Redis/DB-backed deve ser gate futuro se a escala horizontal exigir limite global consistente.

## Erro 429 seguro

Status HTTP: **429**

Body: **idêntico** ao de token inválido (`tracking_lookup_unavailable`) — não revela existência, expiração ou revogação do token.

```json
{
  "type": "not_allowed",
  "code": "tracking_lookup_unavailable",
  "message": "Nao foi possivel localizar o rastreio com este token."
}
```

Implementação: `buildTrackingLookupRateLimitedResponseBody()` em `lookup.ts` reutiliza o mesmo builder do 401.

## Prova de resposta indistinguível (invalid / unknown / expired / revoked)

Coberto pelos testes HTTP existentes (10-02) + revalidados neste slice:

- invalid, unknown, expired e revoked → **401** + body idêntico;
- rate-limited → **429** + **mesmo body** (sem vazamento de existência).

Integration spec: `rejects invalid, unknown, expired and revoked tokens with the same public shape` e `rate-limits repeated invalid token attempts without revealing token existence`.

## Testes executados e resultados

### Unit

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/tracking-access-token/__tests__/tracking-access-token.unit.spec.ts
```

Resultado: **PASS — 45/45**

Novos casos de rate limit:

- bucket HMAC não contém IP/UA completos;
- store persiste só `{ count, windowStartMs }` keyed by digest;
- limite ativado após falhas repetidas na mesma janela;
- bucket expirado é removido do store in-memory (prune);
- apenas buckets da janela atual/anterior permanecem após cleanup;
- cleanup não persiste IP, UA completo ou token;
- rate limit continua funcionando após cleanup.

### HTTP integration

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/tracking-access-token.spec.ts
```

Resultado: **PASS — 11/11**

Novos casos:

- repeated invalid token attempts são rate-limited;
- repeated malformed attempts são rate-limited;
- rate-limit response não revela existência do token;
- token válido ainda funciona antes do limite;
- raw IP / full user-agent / token não persistem no bucket;
- rota não emite token via logging/Sentry paths.

## Build executado e resultado

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Resultado: **PASS** — `Backend build completed successfully`

## Greps negativos e resultados

### Grep bloqueante de superfície runtime

Escopo: handler + lookup helpers (sem tests, sem blocklists de serializer).

```bash
cd apps/backend && git grep -n -E "/store/tracking/:[^ ]+|trackingCode|trackingUrl|client_secret|copia-e-cola|refund|Refund|ExchangeRequest|stripe listen|stripe trigger" \
  -- src/api/store/tracking/lookup/route.ts \
     src/modules/tracking-access-token/lookup.ts \
     src/modules/tracking-access-token/lookup-rate-limit.ts \
     src/modules/tracking-access-token/lookup-body.ts
```

Resultado: **PASS (exit 1 — zero matches)**

### Grep amplo informativo (comando aprovado na validação)

```bash
cd apps/backend && git grep -n -E "/store/tracking/:[^ ]+|trackingCode|trackingUrl|client_secret|copia-e-cola|refund|Refund|ExchangeRequest|stripe listen|stripe trigger" \
  -- src/api/store/tracking src/modules/tracking-access-token integration-tests/http/tracking-access-token.spec.ts
```

Resultado: **matches documentados — falsos positivos allowlisted**

| Arquivo | Motivo | Bloqueante? |
|---------|--------|-------------|
| `integration-tests/http/tracking-access-token.spec.ts` | canaries `SENSITIVE_CANARIES` + asserções `expect(...).not.toContain(...)` | Não — test-only |
| `src/api/store/tracking/serializers.ts` | chaves na blocklist `FORBIDDEN_*` (negação, não exposição) | Não — allowlist guard |

Superfície runtime de lookup/rate-limit permanece limpa no grep bloqueante.

### Config / lockfile inalterados

```bash
cd apps/backend && git diff -- medusa-config.ts src/config/env.ts package.json --exit-code
cd ../.. && git diff -- package-lock.json --exit-code
```

Resultado: **PASS (exit 0 — sem diff)**

### Whitespace

```bash
git diff --check
```

Resultado: **PASS**

## Prova de token hash-only / plaintext não persistido

Revalidado pelos unit tests existentes (10-01):

- `mintTrackingAccessToken` retorna plaintext só no resultado efêmero;
- `buildTrackingAccessTokenRecord` rejeita chaves `token` / `plaintext_token`;
- modelo/migration draft contém apenas `token_hash`.

Rate-limit store não recebe token candidato — apenas digest de bucket + contador.

## Prova de comparação constante

Revalidado em `tracking-access-token.unit.spec.ts`:

- `compareTrackingAccessTokenHash` usa `timingSafeEqual`;
- comprimento divergente retorna `false` sem chamar `timingSafeEqual`;
- lookup usa comparação dummy em tokens desconhecidos (`lookup.ts`).

## Prova de token inválido / expirado / revogado rejeitado

HTTP integration + unit tests de `assertActiveTrackingAccessToken`, `verifyTrackingAccessTokenCandidate`, `lookupTrackingAccessTokenByCandidate`.

Todos retornam o body público indistinguível (`tracking_lookup_unavailable`).

## Prova de order_id / e-mail / telefone / CPF / CNPJ / endereço sem lookup

HTTP integration: `rejects missing token and lookup attempts by order_id, email, phone, CPF, CNPJ or address`.

`parseTrackingLookupRequestBody` rejeita chaves proibidas com `INVALID_DATA`; rota não consulta Order por identificadores alternativos.

## Prova de resposta pública saneada

HTTP integration: `returns sanitized public tracking for a valid token` + `assertPublicTrackingLookupResponseAllowlisted`.

Resposta allowlist-only; sem endereço completo, e-mail, telefone, CPF/CNPJ, payment data, secrets, headers, payload Gelato bruto, token, token_hash, trackingCode ou trackingUrl.

## Prova de logs / Sentry saneados

- Rota de lookup não chama `req.log`, `captureException` ou `captureMessage`.
- Falhas esperadas (401/429) retornam resposta controlada — não propagam exceção para Sentry high-cardinality (exceto `INVALID_DATA` em body malformado **antes** do limite, comportamento herdado de 10-02).
- Access log middleware continua usando route template `/store/tracking/lookup` (sem token em path/query) — teste HTTP preservado.
- Rate-limit module não faz `console.*` nem persiste UA/IP brutos.
- Map in-memory possui prune de buckets expirados (`pruneExpiredTrackingLookupRateLimitBuckets`) executado antes/depois de cada incremento de falha.

## Confirmações de escopo negativo

Não iniciado / não alterado neste slice:

- Phase 11
- refund / exchange / admin ops
- Gelato real
- webhook smoke real
- migration real (`medusa db:migrate` não executado)
- deploy
- `medusa-config.ts`, `env.ts`, `package.json`, `package-lock.json`
- closure da Phase 10 (manual gate permanece aberto)

## Manual gate

Phase 10 plano 10-03 concluído. Aguardando revisão humana antes de closure da Phase 10 ou qualquer trabalho em Phase 11.
