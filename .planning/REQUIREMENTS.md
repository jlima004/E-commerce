# Requirements: Milestone v1.1 — Backend Storefront Readiness

**Definido:** 2026-08-06
**Status:** aberto; **26 requisitos concluídos** (FND-01..FND-08, AUTH-01..AUTH-09, CART-01..CART-09); **65 abertos**
**Escopo:** somente backend; o Frontend Milestone 1 permanece bloqueado

> Decisões existentes em PRD/SRS/rastreabilidade não equivalem a implementação. Requisitos só podem ser concluídos com a evidência prevista no roadmap e gate de closure da phase correspondente.

## Objetivo

Deixar o backend completamente preparado para o início do Frontend Milestone 1, eliminando dependências backend ainda abertas e entregando Store API, contratos, persistência, segurança, testes e artefatos de handoff suficientes para que o frontend possa começar sem inventar endpoints, regras ou schemas.

## Requisitos do milestone

### Phase 13 — Storefront Contract Foundation & Surface Lockdown

| ID | Classe | Requisito verificável | Status |
|---|---|---|---|
| FND-01 | Contrato | Auditar a superfície Store instalada e classificar cada operação nativa como autorizada, bloqueada, estendida ou fora do Frontend M1. | COMPLETE |
| FND-02 | Segurança | Aplicar allowlist explícita e provar que nenhuma rota nativa alternativa contorna autenticação, capability, concorrência, checkout ou a proibição de criar `Order`. | COMPLETE |
| FND-03 | Contrato | Padronizar `StoreErrorResponse`, códigos estáveis, `fieldErrors`, status HTTP e `x-correlation-id` sanitizado. | COMPLETE |
| FND-04 | Persistência | Definir e persistir registros de idempotência escopados por operação, ator e recurso, com fingerprint, resultado e retenção. | COMPLETE |
| FND-05 | Segurança | Rejeitar reutilização de `Idempotency-Key` com payload semanticamente incompatível e impedir que idempotência substitua locks/constraints. | COMPLETE |
| FND-06 | Persistência | Definir primitivo de versão monotônica e optimistic concurrency reutilizável pelos recursos Store concorrentes. | COMPLETE |
| FND-07 | Contrato | Fixar BFF same-origin como consumidor storefront, com security schemes e headers transversais explícitos, sem autorizar browser → Medusa direto. | COMPLETE |
| FND-08 | Contrato | Preparar a fundação do Store OpenAPI `1.1.0`, incluindo schemas monetários BRL com unidade explícita e operação/erro/header estáveis. | COMPLETE |

`requirements-completed:` `[FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08]`

Phase 13 closure artifact: `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CLOSURE.md` — CLOSED — HUMAN APPROVED.

### Phase 14 — Customer Auth & Verification

| ID | Classe | Requisito verificável | Status |
|---|---|---|---|
| AUTH-01 | Runtime | Coordenar cadastro de identidade e criação de `Customer` sem tratar registration JWT como Customer criado. | COMPLETE |
| AUTH-02 | Runtime | Aplicar a política flexível: sessão inicial não verificada pode comprar; login posterior após logout/expiração fica bloqueado até verificação. | COMPLETE |
| AUTH-03 | Contrato | Documentar login e fronteira de logout BFF-only, sem criar uma operação Store artificial quando o logout for responsabilidade do BFF. | COMPLETE |
| AUTH-04 | Segurança | Implementar solicitação e conclusão de reset de senha com token expiráveis/uso único e resposta anti-enumeração. | COMPLETE |
| AUTH-05 | Segurança | Revogar credenciais/tokens anteriores após reset ou alteração de senha e provar rejeição da sessão antiga. | COMPLETE |
| AUTH-06 | Segurança | Permitir refresh somente para JWT válido, não expirado e não revogado. | COMPLETE |
| AUTH-07 | Runtime | Permitir solicitar, reenviar, confirmar e consultar verificação de e-mail com estados públicos estáveis. | COMPLETE |
| AUTH-08 | Persistência | Avaliar e, se necessário, materializar estado próprio de verificação e outbox de notificações auth com tokens hash-only. | COMPLETE |
| AUTH-09 | Segurança | Aplicar rate limit e anti-enumeração consistentes a cadastro, login, reset, resend e verificação. | COMPLETE |

`requirements-completed:` `[AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09]`

Phase 14 closure artifact: `.planning/phases/14-customer-auth-verification/14-CLOSURE.md` — CLOSED — HUMAN APPROVED.

### Phase 15 — Guest Cart Capability & Concurrency

| ID | Classe | Requisito verificável | Status |
|---|---|---|---|
| CART-01 | Persistência | Substituir `req.session.active_cart_id` como prova principal de posse por capability CSPRNG de pelo menos 32 bytes, persistida somente como hash. | COMPLETE |
| CART-02 | Segurança | Transportar a capability apenas em `x-indicio-guest-cart-token`, nunca em JSON, URL, logs, Sentry, analytics ou exemplos. | COMPLETE |
| CART-03 | Runtime | Validar ownership, expiração e revogação da capability e encerrá-la quando o carrinho expirar, for consumido ou concluído. | COMPLETE |
| CART-04 | Runtime | Criar/recuperar carrinho convidado de forma lazy e idempotente, retornando o estado canônico do carrinho. | COMPLETE |
| CART-05 | Runtime | Expor add/update/delete/clear de line item reutilizando operações Medusa nativas quando adequadas, sem segundo motor de carrinho. | COMPLETE |
| CART-06 | Runtime | Aceitar quantidade inteira entre 1 e 99, tratar remoção explicitamente e rejeitar negativos, decimais e valores acima do teto. | COMPLETE |
| CART-07 | Persistência | Incrementar versão monotônica em toda mudança estrutural relevante do carrinho. | COMPLETE |
| CART-08 | Contrato | Retornar `ETag`, exigir `If-Match` nas mutações e responder `412 CART_VERSION_MISMATCH` com snapshot canônico seguro. | COMPLETE |
| CART-09 | Runtime | Invalidar quote, seleção de frete e tentativa de pagamento incompatíveis após mutação estrutural e provar ausência de bypass por rota nativa. | COMPLETE |

`requirements-completed:` `[CART-01, CART-02, CART-03, CART-04, CART-05, CART-06, CART-07, CART-08, CART-09]`

Phase 15: **CLOSED — HUMAN APPROVED**.

Phase 15 closure artifact: `.planning/phases/15-guest-cart-capability-concurrency/15-CLOSURE.md` — CLOSED — HUMAN APPROVED.

Phase 16: **NOT AUTHORIZED**. Phase-16 requirement statuses remain unchanged.

### Phase 16 — Cart Merge & Review

| ID | Classe | Requisito verificável |
|---|---|---|
| MRG-01 | Runtime | Substituir attach simples como contrato principal por merge autenticado, transacional e idempotente. |
| MRG-02 | Contrato | Retornar exatamente `MERGED`, `MERGED_PARTIAL`, `GUEST_CART_ATTACHED`, `CUSTOMER_CART_PRESERVED` ou `NO_ITEMS`. |
| MRG-03 | Runtime | Somar quantidades por variante até 99 sem duplicar itens em retry. |
| MRG-04 | Runtime | Rejeitar individualmente variantes inválidas/indisponíveis e preservar itens válidos no merge parcial. |
| MRG-05 | Persistência | Garantir rollback completo em falha e consumir/revogar capability somente após commit bem-sucedido. |
| MRG-06 | Persistência | Persistir `requiresReview`, itens rejeitados e reconhecimento versionado. |
| MRG-07 | Runtime | Bloquear checkout enquanto `requiresReview=true` e permitir acknowledge idempotente. |
| MRG-08 | Contrato | Deprecar controladamente `/store/customers/me/cart/attach`, sem remoção silenciosa ou bypass do merge. |

### Phase 17 — Authenticated BR Checkout & Privacy

| ID | Classe | Requisito verificável |
|---|---|---|
| CHK-01 | Segurança | Exigir `Customer` autenticado antes de draft, validação, frete e pagamento do Frontend M1. |
| CHK-02 | Runtime | Separar atualização parcial válida do draft e validação final atômica. |
| CHK-03 | Contrato | Modelar endereço de pessoa física no Brasil com campos, UF, CEP e erros por campo estáveis. |
| CHK-04 | Runtime | Aceitar somente CPF no M1 e validar dígitos/checksum server-side; CNPJ permanece fora de escopo. |
| CHK-05 | Segurança | Remover CPF cru de `shipping_address.metadata` e proteger o valor com AES-256-GCM ou mecanismo equivalente, chave externa e `key_version`. |
| CHK-06 | Persistência | Materializar dados sensíveis de checkout/order e constraints conforme revisão prévia do `DB_MODEL_v1.21.md`. |
| CHK-07 | Segurança | Purgar CPF de carrinho abandonado após 7 dias e preservar somente o snapshot criptografado necessário no `Order`. |
| CHK-08 | Contrato | Retornar CPF somente mascarado e provar ausência em Stripe, Gelato, PostHog, Sentry, logs e respostas não autorizadas. |
| CHK-09 | Persistência | Persistir recibos de consentimento por finalidade com versão, timestamp, Customer/cart e sem user agent. |
| CHK-10 | Contrato | Retornar `checkout_data_complete` derivado, `fieldErrors` estáveis e bloquear total final zero. |

### Phase 18 — Gelato Shipping Quote & Selection

| ID | Classe | Requisito verificável |
|---|---|---|
| SHP-01 | Runtime | Confirmar em RESEARCH a API de cotação Gelato ou integração equivalente antes de fixar implementação/provider contract. |
| SHP-02 | Runtime | Cotar frete por carrinho, endereço e itens validados, vinculando resultado à versão do carrinho. |
| SHP-03 | Contrato | Retornar opções públicas saneadas com referência opaca, preço BRL/unidade, prazo e TTL máximo de 30 minutos, sem provider ID. |
| SHP-04 | Persistência | Persistir quote e seleção autoritativa, incluindo expiração e snapshot de contexto. |
| SHP-05 | Runtime | Selecionar somente referência elegível/não expirada e recalcular total autoritativo e `ETag`. |
| SHP-06 | Runtime | Revogar quote/seleção após mudança relevante de item, endereço ou versão e não restaurar seleção antiga silenciosamente. |
| SHP-07 | Runtime | Preservar seleção no `Order` e fazer dispatch Gelato usar o método efetivamente escolhido. |
| SHP-08 | Segurança | Falhar explicitamente em indisponibilidade/timeout do provider, sem fallback logístico inventado. |

### Phase 19 — Storefront PaymentAttempt Hardening

| ID | Classe | Requisito verificável |
|---|---|---|
| PAY-01 | Segurança | Exigir `Customer` autenticado para pagamento M1 e remover guest payment/Pix do novo contrato storefront, preservando-os apenas fora do M1 quando aplicável. |
| PAY-02 | Runtime | Criar ou reutilizar tentativa de cartão compatível de forma idempotente por `Idempotency-Key`. |
| PAY-03 | Segurança | Derivar amount/currency/totais no backend e rejeitar autoridade monetária, cart/customer/order/provider IDs no body. |
| PAY-04 | Contrato | Remover provider IDs das respostas públicas e retornar `client_secret` somente na resposta segura necessária ao BFF, marcado sensível. |
| PAY-05 | Persistência | Vincular tentativa a Customer, versão do cart, shipping snapshot, consent state e fingerprint compatível. |
| PAY-06 | Runtime | Expor consulta reduzida de status antes de retry após erro incerto. |
| PAY-07 | Runtime | Expor invalidação idempotente; cancelamento Stripe é best effort e não apaga evidência local. |
| PAY-08 | Runtime | Permitir retry seguro somente quando o estado público e o contexto autorizarem nova tentativa. |
| PAY-09 | Segurança | Provar que criação/status/invalidação de PaymentAttempt nunca criam `Order`. |

### Phase 20 — Async Payment Confirmation

| ID | Classe | Requisito verificável |
|---|---|---|
| CONF-01 | Segurança | Emitir `confirmationToken` CSPRNG de 32 bytes, BFF-only, hash-only, uso único e TTL de 30 minutos. |
| CONF-02 | Persistência | Vincular token a Customer, tentativa, versão e contexto financeiro, com consumo atômico. |
| CONF-03 | Runtime | Trocar token idempotentemente por `confirmationSessionRef` opaca e BFF-only. |
| CONF-04 | Segurança | Consultar confirmação por POST body, validar Customer/TTL e impedir referência sensível em URL ou resposta browser-facing. |
| CONF-05 | Contrato | Expor estados públicos canônicos, `retryAfterMs`, `Retry-After` e erros sanitizados. |
| CONF-06 | Segurança | Aplicar rate limit ao exchange/polling e impedir enumeração de token, sessão, tentativa ou pedido. |
| CONF-07 | Runtime | Tornar polling refresh-safe e multi-tab-safe sem duplicar cobrança, `Order` ou efeitos financeiros. |
| CONF-08 | Runtime | Classificar sucesso tardio de tentativa invalidada como `RECONCILIATION_REQUIRED`, bloquear nova cobrança automática e gerar alerta crítico. |
| CONF-09 | Observabilidade | Correlacionar confirmação, webhook, `PaymentAttempt`, `CheckoutCompletionLog`, `Order` e alerta sem logar tokens/provider IDs. |
| CONF-10 | Runtime | Retornar `ORDER_CONFIRMED` somente após `Order` persistido; falhas de Resend/PostHog/Gelato não alteram essa verdade. |

### Phase 21 — Order Confirmation & Catalog Handoff

| ID | Classe | Requisito verificável |
|---|---|---|
| ORD-01 | Persistência | Criar referência pública de pedido opaca, não sequencial e não utilizável como credencial isolada. |
| ORD-02 | Segurança | Autorizar resumo somente ao Customer proprietário e por TTL de acesso direto de 24 horas. |
| ORD-03 | Contrato | Expor `ConfirmedOrderSummary` reduzido, mascarado e sem CPF cru, metadata Gelato ou provider IDs. |
| ORD-04 | Runtime | Permitir ao mesmo Customer consultar em outro dispositivo sem depender do cookie original de confirmação. |
| CAT-01 | Contrato | Materializar resolução canônica e exata de produto por handle, sem busca fuzzy ou seleção arbitrária. |
| CAT-02 | Contrato | Fechar DTOs públicos de catálogo e provar ausência de metadata interna/indisponibilidade vazada. |
| CAT-03 | Persistência | Registrar evento/outbox idempotente de revalidação de catálogo após mutação pública relevante. |
| CAT-04 | Segurança | Entregar webhook outbound com HMAC, timestamp, replay protection, retry e payload saneado, sem bloquear a mutação Admin quando a entrega falhar. |

### Phase 22 — Contract Kit, Verification & Release

| ID | Classe | Requisito verificável |
|---|---|---|
| KIT-01 | Contrato | Gerar Store OpenAPI `1.1.0` e atualizar Webhooks OpenAPI quando aplicável, somente a partir do registry TypeScript. |
| KIT-02 | Contrato | Fixar operationIds, schemas fechados, security schemes, headers, erros e unidades monetárias de todas as operações M1. |
| KIT-03 | Handoff | Gerar tipos TypeScript e schemas Zod equivalentes ao OpenAPI, sem criar projeto Next.js. |
| KIT-04 | Handoff | Criar fixtures positivas/negativas sintéticas e mocks validados, livres de secrets, PII e provider IDs. |
| KIT-05 | Teste | Implementar contract tests de auth, cart, checkout, shipping, payment, confirmation e catalog revalidation. |
| KIT-06 | Teste | Executar testes unitários, HTTP integration, modules e provas PostgreSQL/migrations/constraints pertinentes. |
| KIT-07 | Segurança | Executar provas negativas de bypass nativo, capability, CPF, tokens, ownership, redaction e criação de `Order`. |
| KIT-08 | Teste | Passar OpenAPI drift/check/lint, lint do código, build e `git diff --check` sem writer imediatamente antes/dentro do gate read-only. |
| KIT-09 | Handoff | Entregar kit equivalente a `docs/contracts/frontend-m1/` com OpenAPI, types, Zod, fixtures, mocks, README e `CONTRACT_VERSION`. |
| KIT-10 | Observabilidade | Validar logs, correlation IDs, rate limits, alertas e ausência de dados proibidos em telemetry. |
| KIT-11 | Release | Executar validação controlada de providers somente em gate posterior explicitamente autorizado e classificar ausência de prova como `BLOCKED`. |
| KIT-12 | Release | Autorizar release/Heroku e Frontend M1 somente após todos os gates finais PASS e autorização humana explícita. |

## Resumo por classe

| Classe | Total |
|---|---:|
| Runtime | 28 |
| Segurança | 20 |
| Persistência | 14 |
| Contrato | 19 |
| Observabilidade | 2 |
| Teste | 3 |
| Handoff | 3 |
| Release | 2 |
| **Total** | **91** |

> A contagem por classe foi validada mecanicamente nesta abertura. A rastreabilidade e a conclusão permanecem por ID.

## Rastreabilidade dos 54 requisitos FE

| FE ID | Responsabilidade | Phase | Requirement(s) | Operação/schema/artefato alvo | Teste/evidência mínima |
|---|---|---:|---|---|---|
| FE-FND-001 | Frontend/BFF | 22 | KIT-03 | tipos TS/handoff; projeto Next.js fora do escopo | build futuro do frontend; backend entrega tipos |
| FE-FND-002 | Backend + BFF | 13 | FND-07 | security schemes e limite BFF | teste de arquitetura/contrato |
| FE-FND-003 | Backend | 22 | KIT-03, KIT-04 | OpenAPI → types/Zod/fixtures | equivalência OpenAPI/Zod/fixture |
| FE-FND-004 | Frontend/BFF | 13 | FND-07 | regra sem browser → Medusa | evidência de limite; sem nova rota |
| FE-FND-005 | Backend | 13 | FND-03 | `x-correlation-id`, `StoreErrorResponse` | HTTP + redaction |
| FE-FND-006 | Backend + BFF | 22 | KIT-04, KIT-10 | env/handoff sem secrets | secret scan |
| FE-FND-007 | Backend | 22 | KIT-01, KIT-08 | Store OpenAPI `1.1.0`, drift | `openapi:check` |
| FE-CAT-001 | Backend | 21 | CAT-02 | `storeProductsList` | sellable/unpublished fixtures |
| FE-CAT-002 | Backend | 21 | CAT-01, CAT-02 | list/retrieve/handle; Product/Variant | handle inexistente/variante indisponível |
| FE-CAT-003 | Backend | 21 | CAT-02 | DTO fechado | ausência Gelato/provider metadata |
| FE-CAT-004 | Backend + BFF receiver | 21 | CAT-03, CAT-04 | `CatalogRevalidationEvent` | HMAC/dedup/timestamp/retry |
| FE-CAT-005 | Backend | 13, 21 | FND-03, CAT-02 | erro sanitizado catálogo | falha interna sem vazamento |
| FE-CART-001 | Backend | 15 | CART-04 | `createActiveStoreCart` | criação/retry/GET vazio |
| FE-CART-002 | Backend | 15 | CART-01, CART-02, CART-03 | guest capability | valid/missing/wrong/revoked/expired |
| FE-CART-003 | Backend | 15 | CART-05 | add/update/delete/clear | quatro mutações + variante inválida |
| FE-CART-004 | Backend | 15 | CART-06 | quantity schema | 1/99/0/-1/100/decimal |
| FE-CART-005 | Backend | 15 | CART-07, CART-08 | cart version/ETag | aba stale recebe 412 |
| FE-CART-006 | Backend | 16 | MRG-01–MRG-05 | `CartMergeRequest/Response` | outcomes/rollback/concurrency |
| FE-CART-007 | Backend | 16 | MRG-06, MRG-07 | `CartReviewState` | bloqueio + acknowledge |
| FE-CART-008 | Backend | 15 | CART-08 | `If-Match`, erro com snapshot | current/stale version |
| FE-AUTH-001 | Backend | 14 | AUTH-01 | register identity + create Customer | sucesso/falha coordenada |
| FE-AUTH-002 | Backend + BFF logout | 14 | AUTH-02, AUTH-03 | login; logout BFF-only | verified/unverified/invalid |
| FE-AUTH-003 | Backend | 14 | AUTH-04, AUTH-05 | reset/update | known/unknown/expired/used |
| FE-AUTH-004 | Backend | 14 | AUTH-02, AUTH-07, AUTH-08 | verification state/operations | compra inicial/relogin bloqueado |
| FE-AUTH-005 | Backend | 14 | AUTH-06 | refresh token | valid/expired/revoked/malformed |
| FE-AUTH-006 | Backend | 14 | AUTH-05 | credential revocation | JWT antigo rejeitado |
| FE-AUTH-007 | BFF + backend token semantics | 14 | AUTH-06 | `AuthSessionEnvelope` BFF | limite absoluto de 30 dias |
| FE-CHK-001 | Backend | 17 | CHK-01 | auth guards | guest rejeitado antes de mutação |
| FE-CHK-002 | Backend | 17 | CHK-02, CHK-10 | draft/final schemas | partial/final atomic failure |
| FE-CHK-003 | Backend | 17 | CHK-03 | `BrazilianShippingAddress` | BR válido/não-BR/campos |
| FE-CHK-004 | Backend | 17 | CHK-04–CHK-08 | CPF protegido/mascarado | validação/crypto/purge/redaction |
| FE-CHK-005 | BFF/external CEP | 17 | CHK-03 | nenhum endpoint Store de CEP | ViaCEP/BrasilAPI/manual no BFF |
| FE-CHK-006 | Backend | 17 | CHK-09 | `ConsentReceipt` | versões/timestamp/sem user agent |
| FE-SHP-001 | Backend/provider | 18 | SHP-01–SHP-03 | quote operation | options/unavailable/timeout/stale |
| FE-SHP-002 | Backend | 18 | SHP-04, SHP-05 | select operation | valid/foreign/expired/ref total |
| FE-SHP-003 | Backend | 18 | SHP-06 | invalidation semantics | item/address change revoga |
| FE-SHP-004 | Backend | 18 | SHP-08 | shipping errors | falha explícita sem fallback |
| FE-PAY-001 | Backend + Stripe/BFF | 19 | PAY-01, PAY-02, PAY-04 | `createCardPaymentAttempt` | success/provider unavailable |
| FE-PAY-002 | Backend + BFF memory | 19 | PAY-04 | sensitive `client_secret` | ausência logs/storage/examples |
| FE-PAY-003 | BFF/Stripe + backend | 19 | PAY-04, PAY-08 | return flow seguro | 3DS/redirect sem query sensível |
| FE-PAY-004 | Backend | 19 | PAY-02, PAY-03, PAY-05 | compatibility/idempotency | same key/incompatible context |
| FE-PAY-005 | Backend | 19 | PAY-06, PAY-08 | payment status POST | ambiguidade/retry permitido |
| FE-PAY-006 | Backend | 15, 19 | CART-09, PAY-07 | invalidation operation | mudança estrutural/retry idempotente |
| FE-CONF-001 | Backend/BFF | 20 | CONF-01–CONF-04 | exchange token/session | valid/used/expired/retry |
| FE-CONF-002 | Backend | 20 | CONF-05, CONF-06 | status polling | Retry-After/429/expiry |
| FE-CONF-003 | Backend | 20 | CONF-10 | webhook + state | client success antes do webhook não confirma |
| FE-CONF-004 | Backend/BFF | 20 | CONF-03, CONF-07 | server-side session | concorrência sem duplicidade |
| FE-CONF-005 | Backend | 20 | CONF-08, CONF-09 | reconciliation/alert | late success invalidado |
| FE-CONF-006 | Backend | 21 | ORD-01–ORD-04 | `ConfirmedOrderSummary` | owner/non-owner/TTL/masking |
| FE-CNT-001 | Backend + jurídico/frontend | 17, 22 | CHK-09, KIT-12 | versão de Privacidade | gate jurídico externo |
| FE-CNT-002 | Backend | 17 | CHK-09 | recibo Termos de Compra | versão/timestamp/Customer/cart |
| FE-CNT-003 | Backend | 17 | CHK-09 | recibo Política de Trocas | versão/timestamp/Customer/cart |
| FE-CNT-004 | Frontend/operacional | 22 | KIT-09 | README/canal; sem nova Store route | canal publicado no handoff |
| FE-CNT-005 | Jurídico/humano | 22 | KIT-12 | gate jurídico | aprovação explícita antes do go-live |

**Cobertura FE:** 54/54 com responsabilidade explícita; nenhum item está marcado como entregue apenas por decisão documental. Os itens FE-AUTH apontam para requisitos AUTH agora concluídos pela closure da Phase 14; isso não significa implementação do frontend.

## Fora de escopo v1.1

- implementação do frontend Next.js;
- Pix no Frontend M1;
- checkout guest no Frontend M1;
- tracking UI e histórico de pedidos;
- saved addresses, cupons/promoções e pedidos zero;
- CNPJ, multi-country e multi-currency;
- troca self-service, novo Admin ou Correios automático;
- reescrita arbitrária do webhook Stripe ou do pipeline `Order → purchase_completed → Resend → Gelato`;
- deploy, providers reais, secrets/config de produção e movimentação da tag/Release `v1.0` nesta abertura.

## Coverage

- Requisitos v1.1: **74 abertos, 17 concluídos** (FND-01..FND-08, AUTH-01..AUTH-09).
- Mapeados a exatamente uma phase: 91.
- FE requirements com responsabilidade explícita: 54/54.
- Phases: 13–22, lineares.
- Phase 13: 8/8 COMPLETE; CLOSED — HUMAN APPROVED.
- Phase 14: 9/9 COMPLETE; CLOSED — HUMAN APPROVED.
- Phase 15: **CLOSED — HUMAN APPROVED**.
- Phase 16..22: not started / not authorized; Phase 16 remains **NOT AUTHORIZED**.
- Frontend Milestone 1: BLOCKED.
