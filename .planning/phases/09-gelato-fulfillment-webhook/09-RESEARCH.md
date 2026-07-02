---
phase: 09-gelato-fulfillment-webhook
status: researched
created_at: 2026-07-02
scope: planning-only
runtime_executed: false
---

# Phase 09 Research - Gelato Fulfillment & Webhook

## Research Sources

Fontes primarias consultadas:

- Gelato API overview: `https://dashboard.gelato.com/docs`
- Gelato Order v4 create: `https://dashboard.gelato.com/docs/orders/v4/create`
- Gelato order details / split orders: `https://dashboard.gelato.com/docs/orders/order_details`
- Gelato webhooks: `https://dashboard.gelato.com/docs/webhooks`
- Context7 library: `/websites/dashboard_gelato` (Gelato API, high reputation)

No runtime, testes, migrations, instalacao, chamadas reais Gelato, webhooks reais ou Stripe CLI smoke foram executados durante esta pesquisa.

## Official API Findings

### Base URL And Auth

- Base URL oficial: `https://order.gelatoapis.com`.
- Autenticacao: header `X-API-KEY` em cada chamada, sempre via HTTPS.
- Implicacao para Phase 09: `GELATO_API_KEY` nunca pode ser logado, persistido em metadata ou exposto em erro; cliente Gelato deve ser injetavel para testes e deve aceitar fake client por default em suites.

### Create Order v4

Endpoint oficial:

```text
POST https://order.gelatoapis.com/v4/orders
```

Campos relevantes:

- `orderType`: opcional, default `order`; tambem aceita `draft`.
- `orderReferenceId`: referencia interna do pedido.
- `customerReferenceId`: referencia interna do cliente.
- `currency`: ISO 4217; `BRL` aparece como moeda suportada.
- `items[]`: obrigatorio.
- `items[].itemReferenceId`: obrigatorio e unico dentro do pedido Gelato.
- `items[].productUid`: obrigatorio.
- `items[].files[]`: condicional/necessario para produtos printaveis; `type` define area de impressao.
- `items[].quantity`: obrigatorio, minimo 1.
- `shippingAddress`: obrigatorio.
- `shipmentMethodUid`: opcional; se omitido a Gelato escolhe o mais barato disponivel, ou aceita `normal`, `standard`, `express`/UID vindo de Quote API.
- `metadata`: opcional, maximo 20 pares key/value, maximo 100 caracteres por key/value.

Brasil:

- `shippingAddress.country` deve ser ISO-3166 alpha-2.
- `federalTaxId` e obrigatorio para destinatario no Brasil.
- Para empresa no Brasil, `isBusiness = true`, `stateTaxId` e `registrationStateCode` entram como obrigatorios.

Implicacao:

- Phase 09 deve construir payload transiente com dados necessarios a Gelato, mas persistir somente resumo saneado/hash. CPF/CNPJ, endereco completo, e-mail e telefone nao devem entrar em logs/metadata persistidos do fulfillment.
- `LineItem.metadata.gelato_snapshot` fornece `productUid` e opcoes imutaveis, mas Phase 09 precisa planejar a fonte dos arquivos de impressao (`files[]`) a partir do contrato existente de catalogo/template. Se a fonte dos print files nao estiver materializada nos snapshots atuais, o slice `09-01` deve registrar blocker ou decisao tecnica antes de dispatch real.

### Draft / Confirm Pattern

A API v4 aceita `orderType = draft`; draft pode ser editado no dashboard e nao entra em producao ate conversao via UI ou Order Patch API. O default de `orderType` e `order`.

Decisao recomendada:

- Phase 09 deve usar `orderType = order` para dispatch automatico, porque a elegibilidade ja exige `Order` confirmada, `purchase_completed` local e e-mail `sent`.
- Usar draft/confirm exigiria uma decisao operacional separada e um novo estado manual, fora da Phase 09 MVP.

### connectedOrderIds / Split Orders

Gelato pode dividir um pedido em multiplas ordens conectadas quando itens precisam de hubs/embalagens diferentes. `connectedOrderIds` aparece em respostas de create/update/get/search. Cada parte tem `orderId` Gelato unico e o mesmo `orderReferenceId` interno.

Decisao recomendada:

- O fulfillment local deve ser agregado por `order_id`/`orderReferenceId`.
- `connectedOrderIds` devem ser persistidos como lista saneada dentro do mesmo `GelatoFulfillment`.
- Webhooks de cada parte conectada devem atualizar o mesmo fulfillment local, sem criar outro fulfillment ativo.

### Idempotency Support

Nao foi confirmado nas fontes primarias consultadas um header oficial de idempotencia para `POST /v4/orders`.

Decisao recomendada:

- Usar idempotencia local transacional: `idempotency_key = gelato-dispatch:{order_id}`.
- Criar claim local antes da chamada externa.
- Em crash/retry, nunca chamar Gelato se ja houver `gelato_primary_order_id` ou status local ativo/submetido.
- `orderReferenceId = order_id` deve ser usado para reconciliacao, mas nao deve substituir o guard local.

### Errors / Retry

Docs oficiais usam codigos HTTP convencionais:

- `2xx`: sucesso.
- `400`: erro estrutural/dado invalido.
- `401`: API key invalida.
- `404`: recurso inexistente.
- `429`: excesso de requisicoes; docs recomendam exponential backoff.
- `500`, `502`, `503`, `504`: erro server-side Gelato, tentar depois.

Decisao recomendada:

- Retry automatico para `429` e `5xx`.
- Falha persistente vai para `dead_letter` e alerta operacional minimo no proprio `GelatoFulfillment` (`requires_operator_attention = true`), sem iniciar o modulo amplo `OperationalAlert` da Phase 12.
- `400`, `401`, `404` devem ser classificados como nao transientes por default e gerar falha operacional saneada sem retry infinito.

## Webhook Findings

### Event Types (Official Names)

Nomes oficiais documentados usam underscores:

- `order_status_updated`
- `order_item_status_updated`
- `order_item_tracking_code_updated`
- `order_delivery_estimate_updated`
- `store_product_template_created`
- `store_product_template_updated`
- `store_product_template_deleted`
- `store_product_created`
- `store_product_updated`
- `store_product_deleted`

Decisao Phase 09 MVP:

- Aceitar apenas `order_status_updated`.
- Demais eventos permanecem fora do MVP, salvo decisao futura explicita.

### Event Payload (`order_status_updated`)

- `id`: identificador unico do evento.
- `event`: `order_status_updated`.
- `orderId`: ID Gelato.
- `storeId`: pode ser `null` para UI/API.
- `orderReferenceId`: ID interno do nosso sistema.
- `fulfillmentStatus`: status do pedido.
- `items[].itemReferenceId`
- `items[].fulfillmentStatus`
- `items[].fulfillments[].trackingCode`
- `items[].fulfillments[].trackingUrl`
- `items[].fulfillments[].shipmentMethodName`
- `items[].fulfillments[].shipmentMethodUid`
- `items[].fulfillments[].fulfillmentCountry`
- `items[].fulfillments[].fulfillmentStateProvince`
- `items[].fulfillments[].fulfillmentFacilityId`

Evento adicional documentado (`order_item_status_updated`) pode ser usado depois para granularidade por item, mas `FUL-03` fecha com `order_status_updated` agregando status/tracking por item no fulfillment local. Demais eventos listados acima permanecem fora do MVP Phase 09.

### Delivery / Response

Webhook Gelato envia HTTP POST para URL configurada, com corpo JSON. A documentacao informa que qualquer `2xx` indica recebimento; conteudo de resposta e ignorado.

### Dedupe

O campo `id` do webhook e o melhor `deduplication_key` oficial disponivel na pesquisa. Fallback por `payload_hash` so deve ser usado quando `id` estiver ausente e o evento for classificado como seguro para persistir/ignorar sem efeitos duplicados.

### Signature / Authenticity

Resolvido documentalmente via dashboard/API Portal Gelato (2026-07-02):

- O dashboard Gelato expoe configuracao de webhook com:
  - Authorization checkbox
  - Authorization Type: **HTTP Header**
  - Header Name (configuravel)
  - Header Value (configuravel)
- Nao ha HMAC/signature/timestamp confirmado nas fontes consultadas.
- Nao reutilizar `GELATO_API_KEY` como webhook secret.

Mecanismo escolhido para Phase 09:

- Header dedicado: `X-GELATO-WEBHOOK-SECRET`
- Env backend: `GELATO_WEBHOOK_AUTH_HEADER_NAME` (default esperado: `X-GELATO-WEBHOOK-SECRET`)
- Env backend: `GELATO_WEBHOOK_SECRET` (valor compartilhado configurado no dashboard)

Contrato de implementacao (`09-04`):

- Rejeitar antes de qualquer DB side effect se header ausente ou incorreto (fail-closed).
- Replay/dedupe via `WebhookEventLog` usando `payload.id`; `payload_hash` apenas como fallback seguro quando `id` ausente.
- Nao criar rota publica que aceite webhooks sem verificacao do header configurado.

## SDK / Provider Official Compatibility

Nao foi confirmado nas fontes oficiais consultadas um SDK Node oficial Gelato nem provider oficial Medusa compatível com este projeto. O stack aprovado ja recomendava chamada REST direta.

Decisao recomendada:

- Nao instalar SDK Gelato.
- Usar `fetch`/cliente fino injetavel e tipado.
- Nao alterar `package.json`/lockfile para Gelato.

## Local Architecture Fit

Padrões existentes que Phase 09 deve seguir:

- Modulos customizados Medusa com `model.define(...)`, `MedusaService`, `types.ts`, `service.ts` e migrations draft.
- `WebhookEventLog` ja suporta `WEBHOOK_PROVIDER.GELATO` e `WEBHOOK_ENTITY_TYPE.FULFILLMENT`.
- Relays existentes (`analytics-posthog-relay`, `email-resend-relay`) usam claim local, status lifecycle, fake client injetavel, retry/backoff/dead-letter e nenhum call real em testes.
- `AnalyticsEventLog` e `EmailDeliveryLog` ja implementam sanitizacao allowlist-first.
- `LineItem.metadata.gelato_snapshot` e obrigatorio e imutavel desde Phase 06.

## Planning Blockers / Pending Decisions

1. ~~Confirmar oficialmente autenticidade/assinatura de webhook Gelato antes de implementar rota publica.~~ **Resolvido documentalmente (2026-07-02):** auth via dashboard HTTP Header; header dedicado `X-GELATO-WEBHOOK-SECRET`; env `GELATO_WEBHOOK_AUTH_HEADER_NAME` + `GELATO_WEBHOOK_SECRET`; fail-closed antes de DB side effect; dedupe por `payload.id`.
2. Confirmar fonte final dos print files (`files[]`) para cada item Gelato se o snapshot atual nao contem URL/ID de arquivo de impressao suficiente.
3. Confirmar se a Phase 09 deve usar `shipmentMethodUid` fixo/configurado, Quote API anterior ou omissao para cheapest. O planejamento recomenda config/env allowlist ou omissao consciente, nunca valor hardcoded sem decisao.
4. Resolvido no planejamento: representar alerta operacional minimo no proprio `GelatoFulfillment` com `requires_operator_attention`, `operator_alert_code`, `operator_alert_message` e `operator_alerted_at`. O modulo amplo `OperationalAlert` permanece para Phase 12.

## Research Conclusion

A Phase 09 e planejavel em cinco slices pequenos:

1. Contrato/modelo/idempotencia/single-active.
2. Eligibility gate apos `Order` + `purchase_completed` + e-mail `sent`.
3. Relay assincrono de dispatch Gelato com retry/dead-letter.
4. Webhook Gelato idempotente com auth confirmada via dashboard HTTP Header; implementacao deve verificar fail-closed.
5. Validacao final, invariant tests e greps negativos.
