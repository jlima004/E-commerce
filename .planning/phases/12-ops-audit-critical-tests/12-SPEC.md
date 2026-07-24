---
phase: 12-ops-audit-critical-tests
artifact: spec
status: complete-checker-passed-awaiting-human-review
created_at: 2026-07-21
scope: spec-sdd-only
requirements: [OPS-01, OPS-02, TEST-01]
plans: 6
plans_executed: 0
implementation_prompt: not-started
execution_status: blocked
manual_review_gate: true
---

# Phase 12 SPEC — Ops, Audit & Critical Tests

## 0. Autoridade e gate

Este documento fixa os contratos externamente observáveis da Phase 12. Não autoriza código, testes, migrations, dependências, execução dos planos, PostgreSQL/Docker, provider, deploy, push ou produção.

O contrato canônico e revisado de `OperationalAlert.severity` é `low | medium | high | critical`. `low` e `medium` existem para suporte de schema e API, mas os detectores MVP emitem somente `high` e `critical`. O enum independente de `AdminActionLog.severity` permanece `info | warning | critical`.

Este gate documental está completo, com checker PASS e aguardando revisão humana. Implementation prompt e execução continuam bloqueados.

## 1. Scope e requirements

| Requirement | Contrato verificável |
|---|---|
| OPS-01 | Falhas Gelato persistentes e pagamentos travados que satisfaçam predicados fechados produzem um `OperationalAlert` deduplicado, sanitizado e consultável por Admin autenticado. |
| OPS-02 | Cada tentativa aceita nas três rotas Admin customizadas gera um `intent` append-only antes do domínio e zero ou um fato terminal correlacionado, com actor derivado somente da autenticação. |
| TEST-01 | Suítes nomeadas provam INV-1/2/3/4/8/9/10 nos níveis HTTP, unit e PostgreSQL definidos; evidência cross-dyno é limitada à constraint compartilhada e não a execução multi-dyno real. |

### Fora de escopo

- alert email/Resend, PagerDuty, Slack ou qualquer entrega externa;
- dashboard React/Admin UI;
- interceptor genérico `/admin/*`, monkey patch ou wrapper de rotas nativas;
- API key como ator Admin;
- reconciliação Stripe/REL-02 ou Pix sweeper amplo;
- providers reais Stripe, Gelato, Resend, PostHog ou Correios;
- auto-refund, auto-cancel de Order ou mudança automática de `order_status`;
- reprocessamento Gelato ou nova rota `reprocess_fulfillment`;
- ack/resolve/ignore via rota mutável;
- deploy, produção, Supabase/Heroku, push ou tag;
- dependências, package/lockfiles ou Jest config;
- implementação prompt e execução dos seis planos.

## 2. OperationalAlert contract

### 2.1 Valores aceitos

```text
type: payment_stuck | fulfillment_failed
severity: low | medium | high | critical
status: open | acknowledged | resolved | ignored
entity_type: payment_attempt | fulfillment
```

Emissão MVP:

- `payment_stuck` emite `high`;
- `fulfillment_failed` com `dead_letter` emite `critical`;
- `fulfillment_failed` somente com `requires_operator_attention=true` emite `high`;
- `fulfillment_failed` com stale reconhecido emite `high`;
- `low` e `medium` existem como suporte de schema e API, mas nenhum detector desta entrega os emite.

Ordem monotônica obrigatória: `low = 1`, `medium = 2`, `high = 3`, `critical = 4`.

### 2.2 Semântica de ocorrência

Uma chave lógica é `(type, entity_type, entity_id)` e corresponde a uma única linha durante toda a vida do alerta.

| Evento | Resultado observável |
|---|---|
| primeira observação | cria `open`, `occurrence_count=1`, `first_seen_at=last_seen_at=observed_at` |
| repetição open | mantém `open`, incrementa uma vez, avança `last_seen_at`, nunca reduz severity |
| repetição acknowledged | mantém `acknowledged`, incrementa e avança `last_seen_at`; preserva dados de acknowledgement |
| repetição resolved/ignored | reabre a mesma linha como `open`, incrementa, preserva `first_seen_at`, avança `last_seen_at` e limpa todos os timestamps/atores de ack/resolve/ignore |
| severity maior | promove monotonicamente pela ordem `low=1 < medium=2 < high=3 < critical=4` |
| severity menor | preserva a maior severity persistida |

Não há criação de uma segunda linha para a mesma chave. `first_seen_at` nunca muda. `last_seen_at` nunca regride.

### 2.3 Lifecycle executável nesta fase

As únicas transições executadas pela Phase 12 são:

- inexistente → `open`, por detecção;
- `resolved | ignored` → `open`, por nova ocorrência;
- atualização de ocorrência em `open | acknowledged` sem mudar o status.

`acknowledged`, `resolved` e `ignored` são suporte de schema para uma entrega futura. Não existem endpoints nem transições automáticas que movam um alerta para esses estados nesta fase. Não se inventam rotas de mutação.

## 3. OperationalAlert Admin API

Todas as rotas usam a autenticação Admin padrão Medusa. Sem autenticação válida, a resposta é `401` e o service não é consultado.

### 3.1 `GET /admin/operational-alerts`

Query parameters permitidos:

| Campo | Tipo | Default | Regra |
|---|---|---:|---|
| `type` | enum | ausente | `payment_stuck` ou `fulfillment_failed` |
| `status` | enum | ausente | `open`, `acknowledged`, `resolved`, `ignored` |
| `severity` | enum | ausente | `low`, `medium`, `high`, `critical` |
| `entity_type` | enum | ausente | `payment_attempt` ou `fulfillment` |
| `entity_id` | string | ausente | ID interno não vazio, máximo 128 caracteres |
| `last_seen_at_from` | ISO-8601 | ausente | instante válido e inclusivo |
| `last_seen_at_to` | ISO-8601 | ausente | instante válido e inclusivo; não anterior a `from` |
| `limit` | inteiro | `20` | `1..100` |
| `offset` | inteiro | `0` | `>=0`, máximo `100000` |

Parâmetro desconhecido, enum inválido, data inválida, range invertido ou paginação fora do limite retorna `400` com erro saneado `OPERATIONAL_ALERT_QUERY_INVALID`. Nenhuma consulta parcial é executada.

Ordenação fixa: `last_seen_at DESC, id DESC`. Não há parâmetro de sort nesta fase.

Resposta `200`:

```json
{
  "operational_alerts": ["<OperationalAlertSafe>"],
  "count": 1,
  "limit": 20,
  "offset": 0
}
```

`count` é a contagem total após filtros, antes de limit/offset.

### 3.2 `GET /admin/operational-alerts/:id`

- ID: string interna no formato `opalert_<token alfanumérico ou underscore/hífen>`, máximo 128 caracteres;
- ID malformado: `400`, `OPERATIONAL_ALERT_ID_INVALID`;
- existente: `200`, envelope `{ "operational_alert": OperationalAlertSafe }`;
- ausente: `404`, `OPERATIONAL_ALERT_NOT_FOUND`.

### 3.3 Allowlist de resposta

`OperationalAlertSafe` contém somente:

```text
id, type, severity, status,
entity_type, entity_id,
message_code, message, error_code,
metadata,
first_seen_at, last_seen_at, occurrence_count,
acknowledged_at, acknowledged_by,
resolved_at, resolved_by,
ignored_at, ignored_by,
created_at, updated_at
```

`metadata` só pode conter IDs internos e códigos do detector definidos no SDD. Payload bruto, stack, DSN, segredo, token, `client_secret`, QR/copia-e-cola Pix, PAN, endereço, documento fiscal, email e dados Gelato/Stripe brutos são proibidos.

## 4. Detecção `fulfillment_failed`

### 4.1 Predicados

Um `GelatoFulfillment` elegível produz alerta quando pelo menos um fato local é verdadeiro:

1. `status === "dead_letter"`;
2. `requires_operator_attention === true`;
3. o fluxo atual de stale dispatch persistiu `requires_operator_attention=true` e seu `operator_alert_code` allowlisted indica stale reconhecido (`GELATO_DISPATCH_STALE` ou o código factual equivalente já emitido pelo relay).

Stale apenas por idade, sem a transição local persistida de operator attention, não é suficiente.

### 4.2 Promoção

| Fato | Severity | message_code | error_code |
|---|---|---|---|
| `dead_letter` | `critical` | `FULFILLMENT_DEAD_LETTER` | `last_error_code` saneado ou `GELATO_FULFILLMENT_FAILED` |
| operator attention/stale reconhecido | `high` | `FULFILLMENT_OPERATOR_ATTENTION` | `operator_alert_code` saneado |

- chave: `fulfillment_failed + fulfillment + GelatoFulfillment.id`;
- promoção imediata ocorre depois de persistir a verdade Gelato;
- scanner de backstop reapresenta o mesmo DTO ao upsert;
- falha do upsert não reverte Gelato e é logada de forma saneada;
- nenhuma chamada Gelato ou reprocessamento é feito pela detecção/scanner.

## 5. Detecção `payment_stuck`

Toda ocorrência usa `entity_type=payment_attempt`, `entity_id=PaymentAttempt.id`, severity `high` e não cria Order, refund ou cancelamento.

### 5.1 CCL failed — imediato

```text
PaymentAttempt.status = payment_confirmed_by_webhook
PaymentAttempt.order_id IS NULL
CheckoutCompletionLog.status = failed
```

Alerta imediato, sem janela adicional. `message_code=PAYMENT_CONFIRMED_CHECKOUT_FAILED`.

### 5.2 CCL processing stale

Além do payment confirmado sem Order:

```text
CheckoutCompletionLog.status = processing
locked_at é timestamp válido
now - locked_at >= 15 * 60_000
```

`locked_at` ausente/inválido ou idade menor que 15 minutos não alerta. `message_code=PAYMENT_CONFIRMED_CHECKOUT_STALE`.

### 5.3 CCL ausente

Somente alerta quando existe exatamente um `WebhookEventLog` correlacionado ao mesmo PaymentIntent com:

```text
provider = stripe
event_type = payment_intent.succeeded
received_at válido
now - received_at >= 15 * 60_000
```

A correlação deve ser inequívoca por ID interno/metadata allowlisted já persistida; zero candidatos, múltiplos candidatos, IDs divergentes, timestamp inválido ou evento fresco não geram alerta. `PaymentAttempt.updated_at` é proibido como relógio. `message_code=PAYMENT_CONFIRMED_CHECKOUT_MISSING`.

### 5.4 Pix vencido

```text
payment_method_type = pix
expires_at é timestamp válido
now > expires_at
order_id IS NULL
status IN (
  awaiting_pix_payment,
  awaiting_webhook_confirmation,
  payment_instructions_displayed,
  payment_client_confirmed,
  client_action_required
)
```

Qualquer status fora da allowlist, `expires_at` ausente/inválido ou `now <= expires_at` não alerta. `message_code=PIX_PAYMENT_EXPIRED_WITHOUT_ORDER`.

## 6. Admin actor contract

Actor válido:

```text
req.auth_context.actor_type === "user"
trim(req.auth_context.actor_id) !== ""
```

Falham fechado antes de append e domínio:

- `auth_context`/actor ausente;
- `actor_type = api-key` ou qualquer valor diferente de `user`;
- `actor_id` ausente, não string ou vazio após trim.

O erro é saneado (`ADMIN_ACTOR_REQUIRED` ou `ADMIN_ACTOR_TYPE_FORBIDDEN`) e produz apenas log de segurança estruturado. Nenhuma linha de auditoria com identidade inventada é criada. `admin_id`, `requested_by_operator_id` e `created_by_operator_id` vindos do body são proibidos e nunca definem actor.

## 7. AdminActionLog contract

### 7.1 Valores

```text
audit_stage: intent | outcome | reconciliation
result: requested | succeeded | failed | blocked
action: refund_order | update_exchange | reject_exchange | cancel_exchange
```

`approve_exchange` e `reprocess_fulfillment` não são aceitos.

### 7.2 Semântica

- `intent`: fato pré-domínio, `result=requested`, criado após actor/body válidos e IDs pré-gerados;
- `outcome`: fato pós-domínio, com resultado derivado do que realmente ocorreu;
- `reconciliation`: fato terminal pós-request, derivado somente de estado local inequívoco;
- `action_attempt_id`: identifica uma tentativa e correlaciona seu intent ao terminal;
- `correlation_id`: agrupa a request/logs, sem uniqueness;
- `idempotency_key`: chave funcional opcional; pode repetir em tentativas diferentes;
- `reused_idempotency`: booleano allowlisted em metadata, nunca mecanismo de overwrite;
- retry: novo `action_attempt_id`, podendo preservar correlation/idempotency;
- fato terminal: uma linha cujo stage é `outcome` ou `reconciliation`.

Cardinalidade por tentativa:

```text
1 intent + 0 ou 1 fato terminal
```

Outcome e reconciliation competem pela mesma constraint parcial. A linha terminal vencedora é canônica e nunca é sobrescrita.

## 8. Contrato por rota

### 8.1 `POST /admin/refunds/request`

- actor e body são validados;
- `RefundRequest.id` é pré-gerado;
- `action=refund_order`, `entity_type=refund_request`, `entity_id=<id pré-gerado>`;
- intent ocorre antes da reserva;
- reserva bem-sucedida produz terminal `outcome/result=requested`, inclusive replay idempotente;
- business guard produz `blocked`; exceção de domínio produz `failed`;
- confirmação Stripe posterior não é ação Admin e não cria outro AdminActionLog.

Snapshots permitidos: `previous_state={}` e `new_state={status:"requested", amount, currency_code}`, com amount/currency já validados e sem dump financeiro.

### 8.2 `POST /admin/exchanges`

- `ExchangeRequest.id` é pré-gerado;
- `action=update_exchange`, `entity_type=exchange_request`;
- criação persistida produz `succeeded`;
- guard produz `blocked`; exceção produz `failed`;
- snapshot novo: `status`, `reverse_logistics_provider`, `reverse_tracking_code`, `reverse_authorization_code`, `reverse_label_reference`; notes/affected_items/body bruto não entram.

### 8.3 `POST /admin/exchanges/:id`

Seleção factual pelo delta solicitado e confirmado:

| Delta | Action |
|---|---|
| status novo `rejected` | `reject_exchange` |
| status novo `canceled` | `cancel_exchange` |
| qualquer outra alteração permitida | `update_exchange` |

`previous_state` e `new_state` contêm somente `status`, `reverse_logistics_provider`, `reverse_tracking_code`, `reverse_authorization_code` e `reverse_label_reference`. O snapshot after é capturado do registro retornado/persistido, não do body.

## 9. Strategy B — contrato de falhas

| Etapa que falha | Domínio executado? | Resposta HTTP | Estado do audit |
|---|---:|---|---|
| actor guard | não | erro saneado de auth/policy | nenhuma linha |
| validação de body | não | erro original saneado | nenhuma linha |
| intent append | não | erro saneado de auditoria | nenhuma linha confiável |
| domínio | tentou no máximo uma vez | erro original saneado do domínio | intent + failed; se append failed falhar, intent órfão |
| outcome após domínio bem-sucedido | sim, uma vez | sucesso original, mesmo status/body | intent órfão; log estruturado saneado |
| terminal concorrente | não repetir | resultado canônico da operação | um único terminal canônico |

Falha de audit outcome jamais autoriza retry interno do callback de domínio.

## 10. Reconciliation contract

```text
job: admin-action-log-reconciliation
cron: */5 * * * *
ADMIN_ACTION_ORPHAN_AFTER_MS: 15 * 60_000
mode: worker-only
release migration mode: no-op
provider calls: none
```

A janela de 15 minutos é operacional local, não SLA externo.

Regras:

- `RefundRequest` existente pelo ID esperado → `reconciliation/requested`;
- Exchange create existente pelo ID esperado → `reconciliation/succeeded`;
- update/reject/cancel → `succeeded` apenas se o estado atual prova inequivocamente o `new_state` allowlisted;
- RefundRequest ou ExchangeRequest ausente, isoladamente, nunca prova `failed` e deixa intent órfão;
- estado divergente, sobrescrito ou ambíguo deixa intent órfão;
- terminal existente → no-op e retorno do terminal canônico;
- disputa concorrente → constraint escolhe um terminal; os perdedores recuperam e devolvem o canônico;
- nenhuma linha é atualizada/removida e nenhum domínio/provider é chamado.

## 11. TEST-01 acceptance contract

| INV | Nível mínimo | Critério observável |
|---|---|---|
| INV-1 | HTTP/workflow entrypoint | checkout/client confirmation/evento não sucedido não cria Order; confirmação webhook canônica pode alcançar Order birth |
| INV-2 | unit + HTTP entrypoint | `pix_expired` e todos os cinco estados Pix não terminais criam zero Order |
| INV-3 | HTTP route/unit | raw body e assinatura válida obrigatórios; ausência/invalidez falha antes de DB/workflow |
| INV-4 | HTTP + PostgreSQL transacional | replay/dedupe produz um WebhookEventLog/claim CCL canônico sob concorrência |
| INV-8 | HTTP + PostgreSQL transacional | double trigger/retry mantém no máximo um GelatoFulfillment ativo por Order |
| INV-9 | HTTP/module | reservation e `refund.created` não finalizam dinheiro; somente refund object terminal canônico confirma |
| INV-10 | HTTP/module snapshot | refund parcial/total não altera `order_status` para `canceled` |

Classificação obrigatória da evidência:

- HTTP: contrato de rota/workflow com doubles locais;
- unit: predicados, guards, sequencing e state machines;
- PostgreSQL transacional: constraints, triggers, claims e concorrência no banco descartável;
- cross-dyno por inferência: permitido apenas dizer que processos compartilhando o mesmo PostgreSQL observam a mesma constraint;
- cross-dyno real: não executado e não alegado.

## 12. Critério de conclusão desta etapa documental

O SPEC cobre OPS-01, OPS-02 e TEST-01. O checker documental retorna **PASS**, com 0 blockers e 0 warnings, e o gate permanece `awaiting human review`; implementation prompt e execução continuam não iniciados.
