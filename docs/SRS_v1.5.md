# SRS — E-commerce Headless Print-on-Demand da Indicio Cult

| Campo | Valor |
|---|---|
| Documento | Software Requirements Specification |
| Projeto | E-commerce headless Print-on-Demand da Indicio Cult |
| Versão | 1.5.2 — requisitos do Frontend Milestone 1 |
| Data da revisão | 2026-08-06 |
| Status | Canônico de requisitos — backend v1.0 entregue; extensão Frontend M1 aprovada e pendente de materialização |
| Mercado inicial | Brasil |
| Moeda | BRL |
| Backend | Medusa v2, Node.js e TypeScript |
| Frontend planejado | Next.js App Router, TypeScript e BFF same-origin |
| Runtime atual | Heroku (`release`, `web` e `worker`) |
| Persistência | Supabase PostgreSQL |
| Cache e processamento assíncrono | Redis |
| Contratos | OpenAPI 3.1.2 — Store, Admin e Webhooks |
| Base | PRD Backend v1.1.1 · PRD Frontend v1.1.2 · DB Model v1.21 · Blocos A–J e R |

> **Estado normativo:** este SRS distingue rigorosamente o backend `v1.0` efetivamente entregue dos requisitos adicionais aprovados para o Frontend Milestone 1. Requisitos marcados como **Aprovado — pendente** não estão implementados até que código, persistência, OpenAPI, schemas, fixtures e testes correspondentes sejam materializados.

> **Gate vigente:** `DECISIONS COMPLETE, ARTIFACTS PENDING`. Esta revisão fecha a especificação de requisitos, mas não concede `PASS DOCUMENTAL`, `PASS PARA MOCK DEVELOPMENT` ou `PASS PARA INTEGRAÇÃO`.

> **Invariante central:** a storefront nunca cria, confirma ou infere um `Order`. Um `Order` somente existe após confirmação confiável, validada e idempotente do pagamento pelo webhook canônico da Stripe.

---

## Sumário

1. [Introdução](#1-introdução)
2. [Escopo e estado de entrega](#2-escopo-e-estado-de-entrega)
3. [Atores e responsabilidades](#3-atores-e-responsabilidades)
4. [Arquitetura do sistema](#4-arquitetura-do-sistema)
5. [Interfaces e contratos](#5-interfaces-e-contratos)
6. [Fluxos de uso](#6-fluxos-de-uso)
7. [Requisitos funcionais](#7-requisitos-funcionais)
8. [Dados e invariantes](#8-dados-e-invariantes)
9. [Estados do sistema](#9-estados-do-sistema)
10. [Requisitos não funcionais](#10-requisitos-não-funcionais)
11. [Segurança, privacidade e retenção](#11-segurança-privacidade-e-retenção)
12. [Erros e semântica HTTP](#12-erros-e-semântica-http)
13. [Observabilidade e auditoria](#13-observabilidade-e-auditoria)
14. [Integrações externas](#14-integrações-externas)
15. [Testes, contratos e gates](#15-testes-contratos-e-gates)
16. [Deploy, release e operação](#16-deploy-release-e-operação)
17. [Critérios de aceite e estado atual](#17-critérios-de-aceite-e-estado-atual)
18. [Fora do escopo](#18-fora-do-escopo)
19. [Riscos e decisões pendentes](#19-riscos-e-decisões-pendentes)
20. [Rastreabilidade e referências](#20-rastreabilidade-e-referências)

---

## 1. Introdução

### 1.1 Propósito

Este documento especifica requisitos funcionais, técnicos, de segurança e operacionais para o sistema completo da Indicio Cult.

O SRS cobre:

- o backend `v1.0` entregue;
- a extensão obrigatória da Store API para o Frontend Milestone 1;
- o limite entre navegador, BFF e Medusa;
- identidade, carrinho, checkout, frete, pagamento e confirmação;
- pedidos, fulfillment, tracking e pós-venda;
- contratos executáveis e requisitos de teste;
- privacidade, retenção, observabilidade e operação.

### 1.2 Valor central

O sistema DEVE proteger a cadeia financeira e operacional:

```text
pagamento confirmado por webhook confiável
→ criação idempotente de um único Order
→ efeitos locais duráveis
→ integrações externas reprocessáveis
→ produção Gelato somente quando elegível
```

O sistema DEVE impedir:

- `Order` sem pagamento confirmado;
- cobrança com total, frete ou versão desatualizados;
- dois pedidos para o mesmo pagamento;
- reutilização indevida de `client_secret`;
- fulfillment duplicado;
- envio prematuro à Gelato;
- dependência de PostHog, Resend ou Gelato para preservar verdade transacional;
- exposição de capabilities, credenciais ou dados pessoais.

### 1.3 Terminologia normativa

- **DEVE:** requisito obrigatório.
- **NÃO DEVE:** comportamento proibido.
- **DEVERIA:** recomendação não bloqueante, salvo referência explícita em gate.
- **PODE:** capacidade opcional.

### 1.4 Estados de implementação

| Estado | Significado |
|---|---|
| Entregue | Implementado e aceito nos gates do backend v1.0 |
| Aprovado — pendente | Decisão fechada para o Frontend M1, sem todos os artefatos executáveis |
| Implementado, ativação diferida | Implementado, mas dependente de habilitação externa |
| Posterior | Planejado para milestone futuro |
| Fora do escopo | Não pertence ao produto atual |

### 1.5 Ordem de autoridade

Quando houver conflito, prevalece:

1. código e migrations versionados para comportamento entregue;
2. OpenAPI executável para interfaces implementadas;
3. `docs/PRD_Backend_v1.1.md`;
4. este SRS;
5. `docs/PRD_frontend_v1.1.md` para experiência e BFF;
6. `docs/DB_MODEL_v1.21.md`;
7. decisões e gates em `.planning/`.

Requisito aprovado sem artefato não pode ser tratado como interface disponível.

---

## 2. Escopo e estado de entrega

### 2.1 Sistema completo

O sistema é composto por:

- storefront Next.js;
- BFF same-origin;
- backend Medusa v2;
- Admin Dashboard;
- PostgreSQL via Supabase;
- Supabase Storage;
- Redis;
- Stripe;
- Resend;
- Gelato;
- PostHog;
- Sentry;
- logística reversa operacional dos Correios.

### 2.2 Backend v1.0 entregue

O backend entregue inclui:

- catálogo, variantes, preços, publicação e mídia;
- carrinho convidado e autenticado;
- associação segura de carrinho convidado;
- checkout brasileiro base;
- `PaymentAttempt` de cartão e Pix;
- webhook Stripe autenticado e idempotente;
- criação concorrente e idempotente do `Order`;
- outbox de `purchase_completed`;
- outbox de e-mail;
- fulfillment e webhook Gelato;
- tracking público por token;
- reembolsos, trocas, alertas e auditoria;
- health, logs, Sentry e contratos OpenAPI;
- runtime Heroku com `release`, `web` e `worker`.

### 2.3 Extensão obrigatória do Frontend Milestone 1

O backend DEVE acrescentar:

- contratos de identidade e Customer;
- verificação flexível de e-mail;
- capability opaca para carrinho convidado;
- mutações completas de itens;
- controle concorrente por `ETag` e `If-Match`;
- merge transacional e revisão de carrinho;
- checkout exclusivamente autenticado;
- draft e validação final separados;
- endereço brasileiro estruturado;
- CPF criptografado e mascarado;
- consentimentos versionados;
- cotação e seleção autoritativa de frete;
- status e invalidação de tentativa de pagamento;
- token e sessão de confirmação BFF-only;
- polling de confirmação e reconciliação;
- resumo reduzido do pedido confirmado;
- resolução canônica de produto para URL pública;
- evento assinado de revalidação de catálogo;
- schemas, erros e headers transversais completos.

### 2.4 Limites do Frontend Milestone 1

O visitante PODE navegar e operar um carrinho convidado.

O visitante NÃO DEVE:

- persistir endereço de checkout;
- cotar ou selecionar frete;
- criar `PaymentAttempt`;
- confirmar pagamento.

Autenticação é obrigatória antes de checkout, frete e pagamento.

### 2.5 Limitações externas

- Pix depende da elegibilidade da conta Stripe;
- envio real pelo Resend ainda requer prova externa;
- dispatch real Gelato ainda requer prova externa;
- entrega real PostHog ainda requer prova externa;
- exercício externo do Sentry ainda requer prova;
- rollback real não foi exercitado;
- Correios permanece manual/semiautomático.

Essas limitações não reabrem o backend v1.0, mas podem bloquear go-live do sistema completo.

---

## 3. Atores e responsabilidades

| Ator | Responsabilidade |
|---|---|
| Visitante | navegar e montar carrinho convidado |
| Cliente em cadastro | criar identidade e Customer |
| Cliente autenticado | merge, checkout, frete, pagamento e confirmação |
| Navegador | consumir somente o BFF |
| BFF Next.js | guardar cookies, JWT, publishable key e capabilities; adaptar contratos |
| Backend Medusa | autoridade de catálogo, identidade, preço, frete, pagamento e pedido |
| Operador Admin | catálogo, pedidos, reembolsos, trocas e alertas |
| Stripe | dados de cartão, pagamento e eventos financeiros |
| Gelato | produção, envio e tracking |
| Resend | e-mails transacionais e de identidade |
| PostHog | analytics sanitizado |
| Sentry | erros sanitizados |
| Worker | jobs, retries, relays, scanners e reconciliação |
| Operador técnico | release, health, contratos e incidentes |

### 3.1 Limite navegador → BFF

O navegador NÃO DEVE receber ou armazenar:

- JWT de Customer;
- `guestCartToken`;
- `confirmationToken`;
- `confirmationSessionRef`;
- secret key Stripe;
- publishable key do Medusa;
- CPF em storage;
- referências internas de provider.

O navegador PODE receber o `client_secret` exclusivamente em memória para Stripe.js.

### 3.2 Limite BFF → Backend

O BFF DEVE:

- enviar `x-publishable-api-key`;
- enviar Customer JWT quando exigido;
- enviar `x-indicio-guest-cart-token` quando aplicável;
- gerar `Idempotency-Key`;
- propagar `If-Match`;
- gerar ou propagar `x-correlation-id`;
- aplicar timeout;
- validar resposta com schema executável;
- não confiar em valores monetários do navegador.

---

## 4. Arquitetura do sistema

### 4.1 Arquitetura-alvo

```text
Navegador
  │ same-origin
  ▼
Next.js App Router / BFF
  ├── cookies HttpOnly
  ├── adapters + Zod
  ├── publishable key Medusa
  ├── Customer JWT
  ├── guest cart capability
  └── confirmation session envelope
  │ HTTPS
  ▼
Heroku web.1 / Medusa
  ├── /auth
  ├── Store API
  ├── Admin API
  ├── Stripe/Gelato webhooks
  ├── OpenAPI/Swagger
  ├── health
  ├── PostgreSQL
  ├── Redis
  ├── Storage
  └── Sentry

Heroku worker.1
  ├── PostHog relay
  ├── Resend relay
  ├── Gelato dispatch/reconciliation
  ├── operational scanners
  └── catalog revalidation delivery

Heroku release
  └── db:migrate:safe
```

### 4.2 Processos

| Processo | Requisito |
|---|---|
| `release` | DEVE executar migrações seguras antes da nova formação |
| `web` | DEVE servir HTTP, Admin, webhooks, health e docs habilitadas |
| `worker` | DEVE executar jobs, retries, dispatch e reconciliação |

### 4.3 Componentes persistentes entregues

- `PaymentAttempt`;
- `WebhookEventLog`;
- `CheckoutCompletionLog`;
- `AnalyticsEventLog`;
- `EmailDeliveryLog`;
- `GelatoFulfillment`;
- `TrackingAccessToken`;
- `RefundRequest`;
- `ExchangeRequest`;
- `OperationalAlert`;
- `AdminActionLog`.

### 4.4 Persistência adicional prevista

A implementação do Frontend M1 DEVE materializar entidades ou mecanismos equivalentes para:

- acesso convidado ao carrinho;
- revisão de merge;
- recibos de consentimento;
- cotações de frete;
- tokens e sessões de confirmação;
- verificação de e-mail;
- entrega de revalidação do catálogo;
- registros de idempotência quando o mecanismo atual for insuficiente.

O DB Model DEVE ser atualizado antes da implementação que introduza nova persistência.

### 4.5 Separação de responsabilidades

- o processo HTTP NÃO DEVE aguardar integrações downstream desnecessárias;
- jobs DEVEM ser reprocessáveis;
- estado financeiro, pedido, fulfillment e provider DEVEM permanecer separados;
- o BFF NÃO DEVE implementar regra financeira autoritativa;
- o backend NÃO DEVE depender de cookies do frontend como fonte de verdade.

---

## 5. Interfaces e contratos

### 5.1 OpenAPI

O sistema mantém documentos OpenAPI 3.1.2 separados:

| Superfície | Endpoint quando habilitado |
|---|---|
| Store | `/openapi/store.json` |
| Admin | `/openapi/admin.json` |
| Webhooks | `/openapi/webhooks.json` |

Requisitos:

- registries TypeScript são fonte de geração;
- JSONs são determinísticos e versionados;
- artefatos gerados não são editados manualmente;
- cada documento é autocontido;
- schemas internos não vazam para Store;
- exemplos não contêm secrets, tokens reutilizáveis ou PII;
- operações nativas utilizadas pelo frontend DEVEM constar no contrato coordenado.

### 5.2 Versão do contrato

- contrato atual as-built: `1.0.0-draft.1`;
- contrato executável do Frontend M1: `1.1.0`;
- breaking change de dinheiro ou autenticação exige `2.0.0`;
- depreciação mínima: uma release coordenada ou 30 dias, o maior.

### 5.3 Autenticação por superfície

| Superfície | Mecanismo |
|---|---|
| Store pública | publishable API key |
| Carrinho convidado | publishable key + capability |
| Store autenticada | publishable key + Customer JWT |
| Admin sensível | usuário Admin autenticado |
| Stripe webhook | assinatura sobre raw body |
| Gelato webhook | segredo/header canônico |
| Revalidação Next.js | HMAC, timestamp e event ID |

### 5.4 Headers transversais

| Header | Requisito |
|---|---|
| `x-publishable-api-key` | obrigatório nas rotas Store aplicáveis |
| `Authorization` | Customer JWT ou token de propósito específico |
| `x-indicio-guest-cart-token` | capability sensível de carrinho convidado |
| `If-Match` | obrigatório em mutações concorrentes |
| `ETag` | versão canônica do recurso |
| `Idempotency-Key` | obrigatório em mutações repetíveis |
| `x-correlation-id` | rastreabilidade sanitizada |
| `Retry-After` | rate limit e polling |
| `Content-Type` | `application/json` |

### 5.5 Regra de disponibilidade

Uma operação está disponível somente quando:

1. existe no registry;
2. existe no OpenAPI gerado;
3. possui segurança e schemas completos;
4. possui fixtures e Zod equivalentes;
5. possui contract test;
6. passa gates de drift.

---

## 6. Fluxos de uso

### 6.1 Catálogo e produto

```text
BFF consulta Store API
→ backend filtra produtos publicados e variantes vendáveis
→ retorna campos públicos fechados
→ BFF valida e adapta
→ metadata Gelato permanece interna
```

### 6.2 Carrinho convidado

```text
primeira adição
→ BFF cria carrinho com idempotência
→ backend retorna cart + ETag + guest capability
→ BFF guarda capability em cookie HttpOnly
→ BFF adiciona item com If-Match
```

### 6.3 Cadastro, login e merge

```text
identidade
→ registration JWT
→ Customer
→ sessão inicial
→ solicitação de verificação
→ merge transacional do carrinho
→ revisão quando necessária
```

### 6.4 Checkout

```text
Customer autenticado
→ draft parcial
→ validação final
→ CPF e consentimentos protegidos
→ cotação de frete
→ seleção de frete
→ totais recalculados
```

### 6.5 Pagamento e confirmação

```text
criar PaymentAttempt
→ receber client_secret + confirmationToken no BFF
→ trocar token por confirmationSessionRef
→ criar cookie HttpOnly
→ confirmar com Stripe.js
→ polling seguro
→ webhook Stripe
→ Order
→ resumo confirmado
```

### 6.6 Alteração estrutural

```text
item/endereço/frete muda
→ versão muda
→ cotação e seleção são revogadas
→ PaymentAttempt incompatível é invalidado
→ nova validação e tentativa são exigidas
```

### 6.7 Webhook Stripe

```text
raw body
→ assinatura
→ deduplicação
→ validação do snapshot da tentativa
→ coordenação concorrente
→ um único Order
→ outboxes locais
→ confirmação ORDER_CONFIRMED
```

### 6.8 Fulfillment

```text
Order confirmado
→ purchase_completed local
→ elegibilidade Gelato
→ dispatch idempotente
→ webhook Gelato
→ tracking
```

### 6.9 Revalidação de catálogo

```text
mudança pública no catálogo
→ evento local durável
→ worker assina payload
→ envia ao endpoint Next.js
→ retry idempotente
```

---

## 7. Requisitos funcionais

### 7.1 Catálogo e mídia

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-CAT-001 | Admin DEVE gerenciar produtos, variantes, preços e publicação | Entregue | CRUD/publicação disponíveis |
| SRS-BE-CAT-002 | Store DEVE expor somente produtos e variantes vendáveis | Entregue | itens inelegíveis não aparecem como compráveis |
| SRS-BE-CAT-003 | Store DEVE usar conjunto fechado de campos públicos | Aprovado — pendente | contrato não permite expansão de metadata interna |
| SRS-BE-CAT-004 | Mídia pública DEVE usar Supabase Storage | Entregue | URLs autorizadas são retornadas |
| SRS-BE-CAT-005 | Metadata Gelato NÃO DEVE ser pública | Entregue | ausência verificada por contrato |
| SRS-BE-CAT-006 | Produto DEVE possuir resolução canônica por handle ou operação equivalente | Aprovado — pendente | rota de produto não depende de inferência frontend |
| SRS-BE-CAT-007 | Mudanças públicas DEVEM emitir revalidação assinada | Aprovado — pendente | evento idempotente e reprocessável |

### 7.2 Identidade e autenticação

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-AUTH-001 | Identidade e Customer DEVEM ser criados em etapas coordenadas | Aprovado — pendente | registration JWT não substitui Customer |
| SRS-BE-AUTH-002 | Login DEVE aplicar política de verificação flexível | Aprovado — pendente | sessão inicial compra; novo login não verificado é bloqueado |
| SRS-BE-AUTH-003 | Sistema DEVE solicitar, reenviar e confirmar verificação | Aprovado — pendente | tokens são uso único e expiráveis |
| SRS-BE-AUTH-004 | Reset de senha DEVE ser anti-enumeração | Aprovado — pendente | resposta não revela existência de conta |
| SRS-BE-AUTH-005 | Refresh DEVE exigir JWT válido e não revogado | Aprovado — pendente | token expirado não é renovado |
| SRS-BE-AUTH-006 | Alteração de senha DEVE revogar tokens anteriores | Aprovado — pendente | sessão antiga deixa de autorizar |
| SRS-BE-AUTH-007 | Endpoints de identidade DEVEM possuir rate limit | Aprovado — pendente | `429` com `Retry-After` |

### 7.3 Carrinho convidado e mutações

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-CART-001 | Carrinho convidado DEVE usar capability opaca | Aprovado — pendente | token CSPRNG e somente hash persistido |
| SRS-BE-CART-002 | Criação DEVE ser idempotente | Aprovado — pendente | mesma chave retorna mesmo contexto válido |
| SRS-BE-CART-003 | Capability NÃO DEVE aparecer em body, URL ou logs | Aprovado — pendente | testes negativos passam |
| SRS-BE-CART-004 | Sistema DEVE adicionar, atualizar, remover e esvaziar itens | Aprovado — pendente | Store OpenAPI cobre quatro mutações |
| SRS-BE-CART-005 | Quantidade DEVE ser inteira entre 1 e 99 | Aprovado — pendente | valores fora da faixa são rejeitados |
| SRS-BE-CART-006 | Backend DEVE derivar preço e elegibilidade pela variante | Entregue parcialmente | preço enviado pelo cliente não é autoridade |
| SRS-BE-CART-007 | Mutações DEVEM usar `If-Match` e retornar `ETag` | Aprovado — pendente | versão stale retorna `412` |
| SRS-BE-CART-008 | Resposta DEVE substituir estado cliente pelo carrinho canônico | Aprovado — pendente | novo total e versão são retornados |

### 7.4 Merge e revisão

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-MRG-001 | Merge DEVE exigir Customer JWT e capability válida | Aprovado — pendente | carrinho alheio é rejeitado |
| SRS-BE-MRG-002 | Merge DEVE ser transacional e idempotente | Aprovado — pendente | retry não duplica quantidade |
| SRS-BE-MRG-003 | Quantidades iguais DEVEM ser somadas até 99 | Aprovado — pendente | excesso gera rejeição controlada |
| SRS-BE-MRG-004 | Itens inválidos DEVEM ser rejeitados individualmente | Aprovado — pendente | merge parcial preserva itens válidos |
| SRS-BE-MRG-005 | Resultado DEVE declarar outcome fechado | Aprovado — pendente | outcome pertence ao conjunto aprovado |
| SRS-BE-MRG-006 | Capability DEVE ser consumida no commit bem-sucedido | Aprovado — pendente | token não reutilizável após merge |
| SRS-BE-MRG-007 | `requiresReview` DEVE bloquear checkout | Aprovado — pendente | checkout retorna `CART_REVIEW_REQUIRED` |
| SRS-BE-MRG-008 | Reconhecimento DEVE ser persistente e versionado | Aprovado — pendente | refresh preserva estado reconhecido |

### 7.5 Checkout brasileiro

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-CHK-001 | Checkout DEVE exigir Customer autenticado | Aprovado — pendente | convidado recebe `401`/fluxo equivalente |
| SRS-BE-CHK-002 | Draft e validação final DEVEM ser operações separadas | Aprovado — pendente | draft parcial não equivale à validação final |
| SRS-BE-CHK-003 | Draft DEVE persistir somente campos presentes e válidos | Aprovado — pendente | CPF inválido não é persistido |
| SRS-BE-CHK-004 | Validação final DEVE ser atômica | Aprovado — pendente | erro não aplica persistência parcial |
| SRS-BE-CHK-005 | Endereço DEVE ser estruturado para pessoa física no Brasil | Aprovado — pendente | todos os campos obrigatórios são validados |
| SRS-BE-CHK-006 | E-mail DEVE vir da conta e ser read-only | Aprovado — pendente | body não altera identidade |
| SRS-BE-CHK-007 | `checkout_data_complete` DEVE ser derivado | Entregue parcialmente | cliente não controla flag |
| SRS-BE-CHK-008 | Total final zero DEVE ser rejeitado no M1 | Aprovado — pendente | `ZERO_TOTAL_NOT_SUPPORTED` |

### 7.6 CPF e consentimentos

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-PII-001 | CPF DEVE ser validado no backend | Aprovado — pendente | dígitos verificadores inválidos são rejeitados |
| SRS-BE-PII-002 | CPF DEVE ser criptografado em campo próprio | Aprovado — pendente | banco não contém valor em claro |
| SRS-BE-PII-003 | Store DEVE retornar somente CPF mascarado | Aprovado — pendente | schema usa `MaskedFederalTaxId` |
| SRS-BE-PII-004 | CPF abandonado DEVE ser purgado após 7 dias | Aprovado — pendente | job e teste de retenção existem |
| SRS-BE-CNS-001 | Consentimentos obrigatórios DEVEM ser versionados | Aprovado — pendente | versão e timestamp são persistidos |
| SRS-BE-CNS-002 | Consentimentos opcionais DEVEM ser separados por finalidade | Aprovado — pendente | nenhum opt-in agregado |
| SRS-BE-CNS-003 | User agent NÃO DEVE ser armazenado | Aprovado — pendente | ausência verificada |

### 7.7 Frete

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-SHP-001 | Cotação DEVE exigir checkout validado | Aprovado — pendente | endereço incompleto é rejeitado |
| SRS-BE-SHP-002 | Cotação DEVE ser autoritativa e vinculada à versão | Aprovado — pendente | mudança de carrinho expira opção |
| SRS-BE-SHP-003 | Referência de opção DEVE ser opaca | Aprovado — pendente | provider interno não é exposto |
| SRS-BE-SHP-004 | TTL de cotação NÃO DEVE exceder 30 minutos | Aprovado — pendente | opção expirada é rejeitada |
| SRS-BE-SHP-005 | Seleção DEVE recalcular totais | Aprovado — pendente | novo `ETag` e totais retornados |
| SRS-BE-SHP-006 | Mudança relevante DEVE revogar seleção | Aprovado — pendente | opção anterior não é restaurada |
| SRS-BE-SHP-007 | M1 NÃO DEVE usar fallback logístico | Aprovado — pendente | indisponibilidade retorna erro explícito |

### 7.8 Pagamento por cartão

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-PAY-001 | Tentativa DEVE exigir checkout, frete e consentimentos válidos | Aprovado — pendente | tentativa incompleta é rejeitada |
| SRS-BE-PAY-002 | Backend DEVE derivar amount e currency | Entregue | body não aceita valor autoritativo |
| SRS-BE-PAY-003 | Tentativa compatível PODE ser reutilizada idempotentemente | Aprovado — pendente | mesma chave retorna mesmo resultado seguro |
| SRS-BE-PAY-004 | `client_secret` DEVE ser efêmero e sensível | Entregue; contrato será estendido | não aparece em logs/exemplos |
| SRS-BE-PAY-005 | Backend DEVE expor consulta reduzida de status | Aprovado — pendente | erro incerto é resolvido sem nova confirmação |
| SRS-BE-PAY-006 | Backend DEVE invalidar tentativa incompatível | Aprovado — pendente | tentativa não pode ser reutilizada |
| SRS-BE-PAY-007 | Cancelamento Stripe na invalidação é best effort | Aprovado — pendente | falha não apaga evidência local |
| SRS-BE-PAY-008 | Evento tardio invalidado NÃO DEVE criar Order atual | Aprovado — pendente | reconciliação e alerta crítico são produzidos |
| SRS-BE-PAY-009 | Webhook Stripe DEVE validar assinatura e raw body | Entregue | assinatura inválida não altera estado |
| SRS-BE-PAY-010 | Sucesso canônico DEVE produzir no máximo um Order | Entregue | concorrência e duplicata são seguras |

### 7.9 Confirmação assíncrona

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-CONF-001 | Tentativa DEVE emitir `confirmationToken` BFF-only | Aprovado — pendente | token não chega ao navegador |
| SRS-BE-CONF-002 | Token DEVE possuir 32 bytes, hash e TTL de 30 minutos | Aprovado — pendente | valor puro não é persistido |
| SRS-BE-CONF-003 | Troca DEVE ser atômica e idempotente | Aprovado — pendente | mesma chave retorna mesma sessão válida |
| SRS-BE-CONF-004 | `confirmationSessionRef` DEVE ser opaca e sensível | Aprovado — pendente | referência não aparece em URL |
| SRS-BE-CONF-005 | Consulta DEVE usar POST e verificar Customer | Aprovado — pendente | referência isolada não concede acesso |
| SRS-BE-CONF-006 | Polling DEVE retornar `retryAfterMs` e `Retry-After` | Aprovado — pendente | cliente respeita backoff |
| SRS-BE-CONF-007 | `ORDER_CONFIRMED` exige `Order` persistido | Entregue como invariante; interface pendente | não depende do Stripe client-side |
| SRS-BE-CONF-008 | Reconciliação DEVE encerrar polling automático | Aprovado — pendente | nova cobrança permanece bloqueada |
| SRS-BE-CONF-009 | E-mail, analytics e Gelato NÃO DEVEM bloquear confirmação | Entregue como invariante | falha downstream não muda estado confirmado |

Estados públicos obrigatórios:

- `AWAITING_PROVIDER`;
- `PROCESSING_WEBHOOK`;
- `ORDER_CONFIRMED`;
- `PAYMENT_RETRY_REQUIRED`;
- `PAYMENT_CANCELED`;
- `PAYMENT_INVALIDATED`;
- `PAYMENT_EXPIRED`;
- `RECONCILIATION_REQUIRED`;
- `CONFIRMATION_SESSION_EXPIRED`;
- `CONFIRMATION_UNKNOWN`.

### 7.10 Pedido confirmado

| ID | Requisito | Estado | Critério de aceite |
|---|---|---|---|
| SRS-BE-ORD-001 | Resumo DEVE exigir Customer proprietário | Aprovado — pendente | outro Customer recebe 404/negação segura |
| SRS-BE-ORD-002 | Referência DEVE ser opaca e não sequencial | Aprovado — pendente | enumeração não é útil |
| SRS-BE-ORD-003 | Acesso direto DEVE expirar após 24 horas | Aprovado — pendente | após TTL retorna `CONFIRMATION_NOT_FOUND` |
| SRS-BE-ORD-004 | Resumo DEVE ser reduzido e mascarado | Aprovado — pendente | sem Stripe IDs, CPF ou metadata Gelato |
| SRS-BE-ORD-005 | Mesmo Customer PODE acessar em outro dispositivo | Aprovado — pendente | autorização não depende do cookie original |

### 7.11 Downstream e operação existente

| ID | Requisito | Estado |
|---|---|---|
| SRS-BE-DWN-001 | `purchase_completed` local e único | Entregue |
| SRS-BE-DWN-002 | analytics assíncrono | Entregue |
| SRS-BE-DWN-003 | e-mail assíncrono | Entregue |
| SRS-BE-DWN-004 | Gelato somente após elegibilidade local | Entregue |
| SRS-BE-DWN-005 | dispatch e webhook idempotentes | Entregue |
| SRS-BE-TRK-001 | tracking público por token hash | Entregue; fora do Frontend M1 |
| SRS-BE-ADM-001 | reembolso confirmado por webhook | Entregue |
| SRS-BE-ADM-002 | trocas auditáveis | Entregue |
| SRS-BE-ADM-003 | alertas persistidos e sanitizados | Entregue |
| SRS-BE-ADM-004 | identidade Admin obtida do contexto | Entregue |

---

## 8. Dados e invariantes

### 8.1 Pré-pagamento

Antes da confirmação canônica, o estado DEVE residir em:

- `Cart`;
- `PaymentCollection`;
- `PaymentSession`;
- `PaymentAttempt`;
- cotação/seleção de frete;
- sessão de confirmação.

`Order` NÃO DEVE representar intenção de compra pendente.

### 8.2 Dinheiro

Schemas públicos DEVEM declarar unidade:

```ts
type StoreMajorMoney = {
  amount: number
  currency_code: "brl"
  unit: "major"
}

type StoreMinorMoney = {
  amount: number
  currency_code: "brl"
  unit: "minor"
}
```

Regras:

- moeda do M1 é BRL;
- valores autoritativos são derivados no backend;
- valores negativos são inválidos;
- `captured_amount` não excede `amount`;
- `Refund.amount` é maior que zero;
- frete zero é permitido;
- total final zero é bloqueado;
- conversões são explícitas e testadas;
- cálculo autoritativo não depende de ponto flutuante sem estratégia decimal.

### 8.3 Versão do carrinho

A versão DEVE:

- ser monotônica;
- mudar com itens, endereço, consentimentos, frete ou totais relevantes;
- ser retornada em `ETag`;
- ser exigida em `If-Match`;
- vincular cotação, seleção, tentativa e confirmação;
- impedir pagamento de snapshot desatualizado.

### 8.4 Idempotência

A chave DEVE:

- ser escopada por ator, operação e recurso;
- preservar resultado para retry seguro;
- rejeitar reutilização com payload incompatível;
- possuir retenção definida;
- complementar, não substituir, constraints e locks.

Operações cobertas:

- criação de carrinho;
- mutações e merge;
- reconhecimento de revisão;
- checkout draft/final;
- cotação e seleção;
- criação, status e invalidação de tentativa;
- troca de confirmação;
- webhooks;
- `Order`;
- outboxes;
- Gelato;
- reembolso;
- revalidação de catálogo.

### 8.5 Tokens e capabilities

- valores são CSPRNG;
- somente hash é persistido;
- escopo, vínculo, TTL e uso único são explícitos;
- valores não aparecem em URL;
- erros evitam enumeração;
- consumo é atômico quando necessário.

### 8.6 Snapshot operacional

Itens do pedido DEVEM preservar os dados necessários ao fulfillment. Alterações posteriores no catálogo NÃO DEVEM modificar pedido confirmado.

---

## 9. Estados do sistema

### 9.1 Carrinho

Estados derivados mínimos:

- ativo convidado;
- ativo autenticado;
- requer revisão;
- checkout incompleto;
- checkout válido;
- frete pendente;
- pronto para pagamento;
- pagamento em andamento;
- completado;
- expirado.

### 9.2 PaymentAttempt

O domínio DEVE distinguir estados Stripe reutilizáveis, bloqueantes, invalidados e terminais.

Invariantes:

- sucesso produz no máximo um `Order`;
- falha/cancelamento/expiração não produz `Order`;
- confirmação client-side não substitui webhook;
- tentativa invalidada não pode ser reaproveitada;
- sucesso tardio incompatível exige reconciliação.

### 9.3 Pedido e fulfillment

Estados financeiro, pedido, fulfillment e Gelato NÃO DEVEM ser comprimidos em um campo.

- `shipped` não equivale automaticamente a `completed`;
- reembolso não equivale a cancelamento;
- falha de e-mail ou analytics não invalida pagamento;
- falha Gelato pode gerar atenção operacional;
- estados não regridem sem regra explícita.

### 9.4 Troca e alerta

Trocas e alertas mantêm os grafos já entregues. Transições inválidas ou terminais são rejeitadas e auditadas.

---

## 10. Requisitos não funcionais

| ID | Requisito |
|---|---|
| SRS-NFR-001 | Código de aplicação DEVE usar TypeScript estrito |
| SRS-NFR-002 | `web` e `worker` DEVEM permanecer separados |
| SRS-NFR-003 | Operações externas longas DEVEM ser assíncronas |
| SRS-NFR-004 | Webhooks DEVEM responder sem aguardar relays externos |
| SRS-NFR-005 | PostgreSQL e Redis DEVEM possuir health sanitizado |
| SRS-NFR-006 | Falhas temporárias DEVEM ser reprocessáveis |
| SRS-NFR-007 | Efeitos críticos DEVEM ser idempotentes |
| SRS-NFR-008 | Criação do `Order` DEVE ser segura sob concorrência |
| SRS-NFR-009 | Logs de produção DEVEM ser JSON estruturado |
| SRS-NFR-010 | Requisições aplicáveis DEVEM possuir correlation ID |
| SRS-NFR-011 | CORS DEVE aceitar somente origens autorizadas |
| SRS-NFR-012 | Secrets DEVEM permanecer fora do repositório |
| SRS-NFR-013 | Migrações DEVEM executar no processo `release` |
| SRS-NFR-014 | OpenAPI, Zod e fixtures DEVEM passar por verificação de drift |
| SRS-NFR-015 | Runtime DEVE expor versão verificável |
| SRS-NFR-016 | Carrinho, checkout, pagamento e confirmação DEVEM ser `no-store` nas respostas privadas |
| SRS-NFR-017 | Rate limit DEVE ser específico por superfície sensível |
| SRS-NFR-018 | Payloads e bodies DEVEM possuir limites de tamanho |
| SRS-NFR-019 | Schemas públicos DEVEM ser fechados quando possível |
| SRS-NFR-020 | Operações críticas DEVEM definir timeout e comportamento de retry |

---

## 11. Segurança, privacidade e retenção

### 11.1 Dados proibidos em logs e telemetry

- bodies completos por padrão;
- PAN/CVC;
- `client_secret`;
- JWT e cookies;
- `guestCartToken`;
- `confirmationToken`;
- `confirmationSessionRef`;
- PaymentIntent ID;
- CPF completo;
- endereço completo;
- QR/copia-e-cola Pix;
- secrets e assinaturas;
- payload cru de provider.

### 11.2 CPF

- criptografia AES-256-GCM ou mecanismo equivalente aprovado;
- chave gerenciada fora do banco;
- mascaramento em Store;
- acesso completo somente auditado;
- purge de carrinho abandonado em 7 dias;
- não envio para Stripe, Gelato, PostHog ou Sentry.

### 11.3 Cookies do BFF

Embora gerenciados pelo frontend, o contrato DEVE suportar:

- `HttpOnly`;
- `Secure` em staging/produção;
- `SameSite=Lax`;
- host-only;
- ausência de token em JavaScript.

### 11.4 Rate limit

Aplicar a:

- cadastro e login;
- reset e verificação;
- criação de carrinho;
- cotação;
- tentativa de pagamento;
- troca e polling de confirmação.

`429` DEVE incluir `Retry-After`.

### 11.5 Retenção proposta

| Dado | Regra |
|---|---|
| CPF de carrinho abandonado | 7 dias |
| token de confirmação | TTL 30 minutos |
| capability de carrinho | até consumo, expiração ou conclusão |
| prova de Termos | proposta de 5 anos |
| ciência de Privacidade | proposta de 5 anos |
| registro de acesso legal | proposta mínima de 6 meses |
| user agent | não armazenar |

Revisão jurídica é gate de go-live.

---

## 12. Erros e semântica HTTP

### 12.1 Envelope

```ts
type StoreErrorResponse = {
  code: string
  message: string
  correlationId?: string
  retryable: boolean
  fieldErrors?: Record<string, string>
  cart?: StoreCartResponse
}
```

### 12.2 Status

| Status | Uso |
|---|---|
| 200 | consulta ou retry idempotente |
| 201 | criação |
| 202 | processamento assíncrono aceito |
| 400 | schema inválido |
| 401 | autenticação ausente/expirada |
| 403 | acesso negado |
| 404 | ausente ou ocultado por segurança |
| 409 | conflito de estado/idempotência |
| 412 | versão `If-Match` incompatível |
| 422 | validação de domínio |
| 429 | rate limit |
| 500 | falha interna sanitizada |
| 503 | dependência obrigatória indisponível |

### 12.3 Códigos mínimos

Carrinho:

- `CART_NOT_FOUND`;
- `CART_ACCESS_DENIED`;
- `CART_VERSION_MISMATCH`;
- `CART_REVIEW_REQUIRED`;
- `VARIANT_NOT_SELLABLE`;
- `INVALID_QUANTITY`;
- `QUANTITY_LIMIT_EXCEEDED`.

Checkout:

- `INVALID_CPF`;
- `FEDERAL_TAX_ID_REQUIRED`;
- `ZERO_TOTAL_NOT_SUPPORTED`.

Frete:

- `SHIPPING_ADDRESS_INVALID`;
- `SHIPPING_NOT_AVAILABLE`;
- `SHIPPING_QUOTE_EXPIRED`;
- `SHIPPING_OPTION_NO_LONGER_ELIGIBLE`;
- `SHIPPING_PROVIDER_UNAVAILABLE`;
- `SHIPPING_PROVIDER_TIMEOUT`.

Pagamento e confirmação:

- `PAYMENT_CHECKOUT_INCOMPLETE`;
- `PAYMENT_ATTEMPT_ALREADY_ACTIVE`;
- `PAYMENT_ATTEMPT_INVALIDATED`;
- `PAYMENT_PROVIDER_UNAVAILABLE`;
- `PAYMENT_CARD_DECLINED`;
- `PAYMENT_CONFIRMATION_UNKNOWN`;
- `PAYMENT_IN_PROGRESS`;
- `CONFIRMATION_NOT_FOUND`;
- `CONFIRMATION_RATE_LIMITED`;
- `CONFIRMATION_SERVICE_UNAVAILABLE`.

Mensagens NÃO DEVEM revelar conta existente, provider interno ou estado financeiro além do necessário.

---

## 13. Observabilidade e auditoria

### 13.1 Correlation ID

- formato e tamanho allowlisted;
- gerar quando ausente/inválido;
- propagar para jobs e integrações;
- devolver em header e erros seguros;
- nunca derivar de token sensível.

### 13.2 Eventos mínimos

- carrinho criado, recuperado ou expirado;
- mutação e conflito de versão;
- merge e revisão;
- checkout draft/final;
- cotação, seleção e revogação;
- tentativa criada, reutilizada ou invalidada;
- token de confirmação emitido, consumido ou expirado;
- polling rate-limited;
- webhook ingerido e deduplicado;
- `Order` criado ou reutilizado;
- reconciliação requerida;
- resumo de confirmação acessado;
- revalidação de catálogo;
- retries de e-mail, analytics e Gelato;
- falhas de PostgreSQL e Redis.

Nenhum evento registra token ou CPF.

### 13.3 Analytics

`purchase_completed`:

- nasce exclusivamente no backend;
- ocorre uma vez por pedido;
- ocorre após `Order`;
- não depende da página de confirmação;
- não contém PII ou referências operacionais sensíveis.

### 13.4 Auditoria Admin

DEVE preservar ator autenticado, ação, entidade, timestamp, correlation ID e fatos mínimos sanitizados. Identidade do ator nunca vem do body.

### 13.5 Health

`/health/live` confirma processo HTTP.

`/health/ready`:

- consulta PostgreSQL e Redis em paralelo;
- aplica timeout;
- retorna `200` quando prontos;
- retorna `503` sanitizado quando uma dependência obrigatória falha.

---

## 14. Integrações externas

### 14.1 Stripe

- cartão é método obrigatório do M1;
- dados de cartão permanecem no Stripe;
- `client_secret` é efêmero;
- webhook é autoridade financeira;
- 3DS é suportado;
- return URL não contém token ou referência sensível;
- sucesso tardio de tentativa invalidada gera reconciliação.

### 14.2 Resend

- confirmação de pedido e verificação de e-mail usam outbox;
- tokens de e-mail são hash, uso único e expiráveis;
- falha não bloqueia `Order` nem sessão inicial permitida;
- respostas são anti-enumeração.

### 14.3 Gelato

- recebe apenas dados necessários;
- não recebe CPF;
- dispatch usa snapshot do pedido;
- falha é reprocessável;
- webhook é autenticado e idempotente.

### 14.4 PostHog e Sentry

- payloads sanitizados;
- nenhuma capability ou PII;
- falha externa não altera estado transacional.

### 14.5 Revalidação Next.js

Evento DEVE usar:

- `x-indicio-event-id`;
- `x-indicio-event-type`;
- `x-indicio-signature`;
- `x-indicio-timestamp`.

O payload identifica `catalog` e/ou `product:<id>`, sem metadata interna. Entrega é idempotente, assinada e reprocessável.

### 14.6 CEP

Consulta ViaCEP/BrasilAPI pertence ao BFF. O backend valida os dados finais e não confia no resultado do provider de CEP como prova de endereço.

---

## 15. Testes, contratos e gates

### 15.1 Artefatos obrigatórios

Antes de Mock Development:

- PRD Backend atualizado;
- SRS atualizado;
- matriz de rastreabilidade;
- registry Store atualizado;
- Store OpenAPI `1.1.0`;
- Webhooks OpenAPI atualizado;
- tipos gerados;
- schemas Zod;
- fixtures positivas e negativas;
- mock server;
- contract tests;
- CI de drift.

### 15.2 Contract tests

DEVEM validar:

- métodos, paths e `operationId`;
- security schemes;
- headers sensíveis;
- request/response;
- status HTTP;
- idempotência;
- `ETag`/`If-Match`;
- unidades monetárias;
- masking;
- códigos de erro;
- ausência de campos proibidos;
- tokens fora de URLs;
- consumo único e retry idempotente;
- ownership da confirmação;
- equivalência OpenAPI/Zod/fixture;
- assinatura e deduplicação da revalidação.

### 15.3 Integração obrigatória

- cadastro em duas etapas;
- verificação flexível;
- reset e revogação;
- guest capability;
- mutações e conflito;
- merge completo/parcial;
- revisão;
- draft/final checkout;
- CPF inválido, criptografia e purge;
- frete disponível, indisponível e expirado;
- tentativa compatível/incompatível;
- invalidação;
- troca de confirmação;
- 3DS;
- erro incerto;
- polling;
- reconciliação;
- `Order` confirmado;
- resumo autorizado;
- concorrência e múltiplas abas.

### 15.4 Gates

```bash
npm run openapi:verify:store
npm run openapi:verify:admin
npm run openapi:verify:webhooks
npm run openapi:lint
npm run openapi:check
npm test
npm run lint
npm run build
git diff --check
```

Qualquer falha relevante resulta em `BLOCKED`. Não existe `PASS WITH KNOWN DEBTS`.

---

## 16. Deploy, release e operação

### 16.1 Ambientes

| Ambiente | Estado |
|---|---|
| Local | desenvolvimento com PostgreSQL e Redis |
| Produção | Heroku + Supabase PostgreSQL + Redis |
| Staging | convenção documentada; ainda não provisionado formalmente |

### 16.2 Deploy

O deploy DEVE:

1. selecionar candidate SHA explícito;
2. executar migrações no processo `release`;
3. iniciar `web` e `worker`;
4. validar health, PostgreSQL e Redis;
5. comparar SHA retornado com release atual;
6. executar smokes autorizados;
7. preservar evidências sanitizadas;
8. respeitar gates manuais.

### 16.3 Restrições operacionais

- agentes não alteram variáveis Heroku sem autorização;
- secrets não são exibidos;
- deploy e rollback exigem autorização explícita;
- mudança de domínio, CORS, webhook ou chave exige gate humano.

### 16.4 Rollback

O alvo é a release anterior compatível registrada antes do deploy. O sistema não afirma que rollback real foi exercitado.

---

## 17. Critérios de aceite e estado atual

### 17.1 Backend v1.0

Permanece aceito para os comportamentos entregues:

- pagamento → webhook → um único `Order`;
- outboxes locais;
- Gelato elegível;
- reembolsos, trocas e alertas;
- health, logs, contratos e runtime.

### 17.2 Especificação Frontend M1

A especificação está aceita quando:

- todos os requisitos MUST possuem decisão explícita;
- operações necessárias estão enumeradas;
- segurança, dinheiro, concorrência e idempotência estão definidos;
- fluxos de erro e reconciliação estão definidos;
- PRD Backend, PRD Frontend e SRS são coerentes.

### 17.3 Artefatos

O Gate de Artefatos somente passa quando:

- OpenAPI 1.1.0 está completo;
- schemas, tipos, Zod e fixtures existem;
- contract tests passam;
- DB Model e matriz estão alinhados;
- exemplos não contêm dados proibidos;
- lint, build, testes e drift passam.

### 17.4 Integração

O backend está pronto para o frontend quando o BFF consegue executar contratualmente:

```text
catálogo
→ carrinho convidado
→ cadastro/login
→ merge
→ checkout
→ frete
→ pagamento
→ confirmação
→ Order confirmado
```

### 17.5 Estado consolidado

| Área | Estado |
|---|---|
| Backend v1.0 | Entregue |
| Decisões Frontend M1 | Completas |
| PRD Backend | Atualizado |
| SRS | Atualizado |
| OpenAPI 1.1.0 | Pendente |
| DB Model complementar | Pendente de confirmação/materialização |
| Zod, fixtures e mocks | Pendentes |
| Contract tests | Pendentes |
| Mock Development | Bloqueado |
| Integração | Bloqueada |

---

## 18. Fora do escopo

- checkout convidado;
- Pix na storefront M1;
- histórico completo de pedidos;
- endereços salvos;
- cupons, promoções e gift cards;
- pedidos de total zero;
- tracking público na storefront M1;
- trocas automatizadas pelo cliente;
- CNPJ/conta empresarial;
- múltiplas moedas e países;
- fallback logístico;
- integração automática com Correios;
- editor de arte e personalização;
- reviews, chat, afiliados e app nativo.

---

## 19. Riscos e decisões pendentes

| Risco/pendência | Tratamento |
|---|---|
| Drift entre documentos e OpenAPI | gate determinístico e matriz de rastreabilidade |
| Persistência nova não refletida no DB Model | atualizar modelo antes da implementação |
| Política legal de retenção | revisão jurídica antes do go-live |
| Frete sem provider/fallback comprovado | bloquear lançamento até validação operacional |
| Sucesso Stripe em tentativa invalidada | reconciliação crítica e lock de nova cobrança |
| Exposição de capability | headers sensíveis, redaction e testes negativos |
| Resend/Gelato/PostHog sem prova externa | validação operacional separada |
| Resolução de produto por handle indefinida no runtime | materializar operação/filtro no OpenAPI |
| CORS/domínios/cookies de produção | gate de preview e produção |

---

## 20. Rastreabilidade e referências

### 20.1 Rastreabilidade de alto nível

| Frontend | Backend/SRS |
|---|---|
| FE-CAT-001–005 | SRS-BE-CAT-001–007 |
| FE-CART-001–008 | SRS-BE-CART-001–008 e SRS-BE-MRG-001–008 |
| FE-AUTH-001–007 | SRS-BE-AUTH-001–007 |
| FE-CHK-001–006 | SRS-BE-CHK-001–008, SRS-BE-PII e SRS-BE-CNS |
| FE-SHP-001–004 | SRS-BE-SHP-001–007 |
| FE-PAY-001–006 | SRS-BE-PAY-001–010 |
| FE-CONF-001–006 | SRS-BE-CONF-001–009 e SRS-BE-ORD-001–005 |

A matriz detalhada DEVE mapear requisito, operationId, schema, fixture, teste e estado.

### 20.2 Referências

- `docs/PRD_Backend_v1.1.md`;
- `docs/PRD_frontend_v1.1.md`;
- `docs/DB_MODEL_v1.21.md`;
- `docs/openapi/README.md`;
- `apps/backend/src/api-docs/generated/store.openapi.json`;
- `apps/backend/src/api-docs/generated/admin.openapi.json`;
- `apps/backend/src/api-docs/generated/webhooks.openapi.json`;
- `apps/backend/src/api-docs/operations/store/`;
- `apps/backend/src/api-docs/components/security-schemes.ts`;
- `apps/backend/.env.template`;
- `ops/API_DOCS.md`;
- `.planning/PROJECT.md`;
- `.planning/STATE.md`.

### 20.3 Estado do gate

```text
Gate de Decisões A–J: PASS
Gate de Decisões R: PASS
PRD Backend alinhado: PASS
SRS alinhado: PASS
Gate de Artefatos: PENDING
PASS DOCUMENTAL: não concedido
PASS PARA MOCK DEVELOPMENT: não concedido
PASS PARA INTEGRAÇÃO: não concedido
```

---

*Última revisão: 2026-08-06 — SRS alinhado ao PRD Backend v1.1.1 e ao Frontend Milestone 1. O documento preserva o backend v1.0 entregue, especifica as extensões obrigatórias e mantém o Gate de Artefatos pendente.*
