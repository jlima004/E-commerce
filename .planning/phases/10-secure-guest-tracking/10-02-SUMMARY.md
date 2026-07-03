---
phase: 10
plan: 02
status: completed
manual_review_gate: true
updated_at: 2026-07-02T20:42:00-03:00
---

# 10-02 - Public Token-Gated Tracking Route With Sanitized Response

## Escopo executado

Executado somente o plano `.planning/phases/10-secure-guest-tracking/10-02-PLAN.md`.

Branch ativa no pré-check: `gsd/phase-10-secure-guest-tracking`

Pré-check:

- `git status`: limpo antes do início
- `node`: v22.23.1 (`/home/jlima/.nvm/versions/node/v22.23.1/bin/node`)
- `npm`: 10.9.8 (`/home/jlima/.nvm/versions/node/v22.23.1/bin/npm`)

## Arquivos alterados/criados

- `apps/backend/src/api/store/tracking/lookup/route.ts` (criado)
- `apps/backend/src/api/store/tracking/serializers.ts` (criado)
- `apps/backend/src/api/middlewares.ts` (alterado)
- `apps/backend/src/modules/tracking-access-token/lookup.ts` (criado)
- `apps/backend/src/modules/tracking-access-token/lookup-body.ts` (criado)
- `apps/backend/src/modules/tracking-access-token/__tests__/tracking-access-token.unit.spec.ts` (alterado)
- `apps/backend/integration-tests/http/tracking-access-token.spec.ts` (criado)
- `.planning/phases/10-secure-guest-tracking/10-02-SUMMARY.md` (criado)

## Rota criada

```http
POST /store/tracking/lookup
Content-Type: application/json
```

Handler: `apps/backend/src/api/store/tracking/lookup/route.ts`

Middleware registrado em `apps/backend/src/api/middlewares.ts`:

- matcher: `POST /store/tracking/lookup`
- guard: rejeita `token`/`tracking_token` em query/path antes do handler

## Contrato POST body-only

Request aceito:

```json
{ "token": "one-time-visible-token-value" }
```

Regras:

- somente a chave `token` é aceita;
- body com campos extras é rejeitado (`INVALID_DATA`);
- rejeita explicitamente `order_id`, `cart_id`, payment ids, e-mail, telefone, CPF/CNPJ, endereço e identificadores extras;
- token não é lido de path/query;
- validação em `lookup-body.ts`, resolução HMAC + comparação constante em `lookup.ts`.

Resposta de falha de token (inválido, desconhecido, expirado, revogado, malformado ou token em URL):

```json
{
  "type": "not_allowed",
  "code": "tracking_lookup_unavailable",
  "message": "Nao foi possivel localizar o rastreio com este token."
}
```

Shape idêntico para todos os casos de token inválido/inexistente/inativo.

## Serializer allowlist-only

Arquivo: `apps/backend/src/api/store/tracking/serializers.ts`

Campos públicos permitidos:

- `order_reference` (somente `display_id` seguro; nunca `order_xxx` interno)
- `order_status`
- `fulfillment_status`
- `tracking_status`
- `item_count`
- `item_labels`
- `updated_at`
- `message` (mensagem segura quando tracking ainda não está disponível)

Campos sensíveis bloqueados na resposta:

- token submetido
- `token_hash`
- `order_id` interno
- e-mail, telefone, CPF/CNPJ, endereço
- payment data / Stripe / Pix
- payload bruto de Order/Gelato
- `trackingCode` / `trackingUrl`
- headers, cookies, secrets

`assertPublicTrackingLookupResponseAllowlisted()` garante allowlist estrita antes do `200`.

## Provas de lookup alternativo rejeitado

Via `parseTrackingLookupRequestBody()` + testes HTTP:

| Tentativa | Resultado |
|-----------|-----------|
| `{}` sem token | rejeitado |
| `{ "order_id": ... }` | rejeitado |
| `{ "email": ... }` | rejeitado |
| `{ "phone": ... }` | rejeitado |
| `{ "cpf": ... }` | rejeitado |
| `{ "cnpj": ... }` | rejeitado |
| `{ "shipping_address": ... }` | rejeitado |
| `{ "token": ..., "order_id": ... }` | rejeitado |

Token em query/path: rejeitado pelo guard middleware com o mesmo shape público seguro.

## Testes executados

### Unit (10-01 + ajuste de prova negativa)

```bash
cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/tracking-access-token/__tests__/tracking-access-token.unit.spec.ts
```

Resultado: **38/38 PASS**

### HTTP integration (10-02)

```bash
cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/tracking-access-token.spec.ts
```

Resultado: **6/6 PASS**

Cobertura principal:

- token válido retorna tracking público saneado + `last_used_at` atualizado
- token inválido/desconhecido/expirado/revogado rejeitados com mesmo shape
- sem token / lookup por order_id/e-mail/telefone/CPF/CNPJ/endereço rejeitados
- extra fields no body rejeitados
- resposta não vaza token, hash, trackingCode/Url, PII, payment ou payload bruto
- route template de access log permanece `/store/tracking/lookup` (sem token)

## Build

```bash
cd apps/backend && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build
```

Resultado: **PASS** (`Backend build completed successfully`)

## Greps negativos

| Prova | Resultado | Notas |
|-------|-----------|-------|
| Grep amplo solicitado (`src/api/store/tracking`, `src/modules/tracking-access-token`, spec HTTP) | **FAIL (falso positivo esperado)** | Matches em `service.ts` (10-01) na allowlist de chaves proibidas (`pix_*`), não na superfície da rota 10-02 |
| Grep focado 10-02 (`route`, `serializers`, `lookup*.ts`, spec HTTP) | **PASS** | Nenhum match |
| `git diff medusa-config.ts env.ts package.json` | **PASS** | Sem diff |
| `git diff package-lock.json` | **PASS** | Sem diff |
| `git diff --check` | **PASS** | Sem conflict markers |

## Fora de escopo confirmado

- **10-03 / rate limit / enumeration hardening**: não iniciado
- **Phase 11**: não iniciada
- **refund / exchange**: não implementados
- **Gelato real / webhook smoke real**: não executados
- **migration real / `medusa db:migrate`**: não aplicados
- **deploy**: não executado
- **`package.json` / lockfile / `medusa-config.ts` / `env.ts`**: não alterados

## Manual gate

Parado no manual gate após execução do slice **10-02** apenas. Próximo passo permitido somente com aprovação humana explícita para **10-03** ou revisão deste summary.
