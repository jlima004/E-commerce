---
phase: 17-authenticated-br-checkout-privacy
gate: research
status: technical-research-complete-human-review-required
prepared_at: 2026-09-09
context_authority:
  file: 17-CONTEXT.md
  status: human-approved-pass
requirements:
  - CHK-01
  - CHK-02
  - CHK-03
  - CHK-04
  - CHK-05
  - CHK-06
  - CHK-07
  - CHK-08
  - CHK-09
  - CHK-10
---

# Phase 17 — Authenticated BR Checkout & Privacy — Research

## 1. Identity

```text
Phase:
17 — Authenticated BR Checkout & Privacy

Gate:
RESEARCH

Status:
TECHNICAL RESEARCH COMPLETE — HUMAN REVIEW REQUIRED

Context authority:
17-CONTEXT.md — HUMAN APPROVED — PASS
```

Este artefato consolida fatos locais, fontes oficiais, restrições recomendadas,
decisões humanas ainda abertas e bloqueios da Fase 17. Ele não é um PLAN, não
autoriza implementação e não altera `D17-01..D17-16`.

## 2. Executive Research Summary

### 2.1 Resultado

As 13 perguntas de pesquisa foram classificadas:

```text
RESOLVED — EVIDENCE SUFFICIENT: 0
PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN: 7
HUMAN PRODUCT DECISION REQUIRED: 4
LEGAL/HUMAN REVIEW REQUIRED: 1
BLOCKED — EXTERNAL CONSTRAINT: 1
DEFERRED — CORRECT FUTURE PHASE: 0
```

O resultado principal é:

- a autoridade protegida de checkout ainda não existe e não deve ser
  implementada dentro de `shipping_address.metadata`;
- `CheckoutCompletionLog` continua sendo a única autoridade project-owned para
  nascimento e recuperação de exatamente um Order;
- um snapshot protegido pode ser preparado de forma recuperável antes da
  transição irreversível de criação do Order, mas nunca se torna autoridade de
  nascimento concorrente;
- AES-256-GCM com nonce de 96 bits, tag de 128 bits, AAD versionado,
  `key_version` e autoridade externa é um piso técnico bem sustentado;
- o fingerprint sensível deve ser uma derivação HMAC chaveada e versionada de
  um DTO semântico canônico; hash cru, CPF mascarado, ciphertext aleatório e
  deterministic encryption são inadequados;
- CPF é dado pessoal sob a LGPD, mas não é automaticamente a categoria jurídica
  de dado pessoal sensível do art. 5º, II; finalidade, base, retenção, acesso e
  direitos precisam ser aprovados por tratamento;
- endereço de cobrança distinto não é tecnicamente exigido pelo fluxo Card/Pix
  aceito ou pelo modelo Medusa, mas a política de produto continua aberta;
- as operações PATCH/validate de `checkout-details` são apenas candidatas
  documentais; resume, taxonomia de erros e precedência exigem decisão humana;
- CHK-08 não está provada: há CPF cru em metadata e no payload Gelato, PII
  reversível em fingerprint e lacunas em logs, Sentry e erros persistidos;
- a documentação oficial Gelato afirma que `federalTaxId` é obrigatório para
  remessas ao Brasil e não prova exceção para vestuário ou produção local.

### 2.2 Bloqueio material

```text
NO-CPF GELATO COMPATIBILITY:
BLOCKED

Raw CPF transmission:
FORBIDDEN — PRESERVED
```

`R17-BLOCK-01` impede uma conclusão compatível entre Gelato-only, destinatário
pessoa física no Brasil e D17-12. O bloqueio não autoriza omitir um campo que o
provider documenta como obrigatório, transmitir CPF, trocar provider ou puxar
implementação de frete da Fase 18.

### 2.3 Consequências arquiteturais

- Dados protegidos, receipts e snapshot devem pertencer a uma autoridade de
  domínio explícita, com constraints PostgreSQL próprias.
- Module Links servem para navegação/Query; não substituem unicidade,
  cardinalidade ou lifecycle dentro do módulo protegido.
- Purge precisa ser físico ou usar cryptographic erasure aprovada; soft delete
  não remove o ciphertext.
- Freeze financeiro, `processing`, `reconciliation_required`, execução
  irreversível ou snapshot não finalizado suspendem purge otimista.
- O Store manifest, exact-set BFF e OpenAPI permanecem fechados; nenhum novo
  método/path é autorizado por esta pesquisa.

## 3. Method

### 3.1 Arqueologia local

Foram lidos os inputs vinculantes, artefatos aceitos das Fases 13–16, runtime
Medusa instalado, authorities de Customer/cart/review/version/idempotency,
PaymentAttempt, CheckoutCompletionLog, fluxo canônico de Order, Gelato,
analytics, e-mail, observabilidade, Store surface e registry OpenAPI.

Versões confirmadas no checkout:

```text
Node engine: >=22 <23
Medusa: 2.16.0
Stripe SDK: 19.1.0
Sentry: 10.59.0
PostHog: ^5.38.2
Zod: 4.2.0
```

### 3.2 Pesquisa externa

Foram usadas fontes primárias/oficiais de Medusa, PostgreSQL, Node.js, NIST,
RFC Editor, OWASP, Supabase, Stripe, Gelato, Planalto e ANPD. A aplicabilidade
foi confrontada com o runtime instalado quando possível.

O conector Context7 foi usado para resolver e consultar documentação Medusa,
PostgreSQL e Node. O conector Supabase foi usado somente para documentação e
changelog; nenhum projeto foi enumerado e nenhum SQL foi executado. O conector
Stripe exigiu reautenticação e não forneceu resultados; `stripe docs` não estava
instalado, então a pesquisa usou páginas públicas oficiais `docs.stripe.com`.
Nenhuma conta Stripe foi listada e nenhum objeto Stripe foi criado.

### 3.3 Subagentes e revisão do orquestrador

Execução serial, concorrência máxima 1:

| Agente | Modelo | Modo | Escopo |
|---|---|---|---|
| A — baseline | GPT-5.6 Sol — Extra High | LOCAL READ | Q01–Q13 |
| B — data/order/purge | GPT-5.6 Sol — Extra High | LOCAL READ / EXTERNAL RESEARCH | Q01, Q03, Q04 |
| C — crypto/idempotency | GPT-5.6 Sol — Extra High | LOCAL READ / EXTERNAL RESEARCH | Q02, Q09 |
| D — privacy/legal BR | GPT-5.6 Sol — Extra High | LOCAL READ / EXTERNAL RESEARCH | Q08 |
| E — Gelato CPF | GPT-5.6 Sol — Extra High | LOCAL READ / EXTERNAL RESEARCH | Q05 |
| F — billing/address/CEP | GPT-5.6 Sol — High | LOCAL READ / EXTERNAL RESEARCH | Q06, Q12 |
| G — errors/resume/surface | GPT-5.6 Sol — High | LOCAL READ | Q07, Q10, Q11 |
| H — PII sinks | GPT-5.6 Sol — High | LOCAL READ | Q13 |
| I — phase boundary | GPT-5.6 Sol — High | SYNTHESIS REVIEW | Q01–Q13 |
| J — adversarial review | GPT-5.6 Sol — Extra High | SYNTHESIS REVIEW | após o draft |

O orquestrador revisou cada handoff e reconciliou gaps de implementação com
conflitos reais. Nenhum subagente escreveu no repositório.

### 3.4 Ações expressamente não realizadas

- zero chamadas operacionais Stripe/Gelato/Supabase/Redis;
- zero chaves, secrets ou KMS reais;
- zero testes, migrations, SQL ou disposable database;
- zero alteração de aplicação, registry ou OpenAPI gerado;
- zero push, PR, merge, deploy ou frontend.

## 4. Binding Constraints Carried Forward

### 4.1 D17-01..D17-16

Todos permanecem vinculantes e sem alteração:

- D17-01..04: Customer pessoa física autenticado, autoridade server-side,
  BFF-only e resume sem restaurar autoridade expirada;
- D17-05..08: authorities existentes, draft parcial válido, validação final
  atômica, endereço BR estruturado e readiness derivada com total positivo;
- D17-09..12: CPF-only, lifecycle protegido, receipts por finalidade e
  fronteira negativa de PII;
- D17-13..16: replay/CAS seguro, zero nova autoridade de Order, module/contract
  authorities fechadas e sequência linear P18–P22.

### 4.2 FIN-01..FIN-04

```text
FIN-01 — PRE-PROVIDER AUTHORITY: PRESERVED
FIN-02 — CANONICAL MONEY SNAPSHOT: PRESERVED
FIN-03 — FINANCIAL FINALITY: PRESERVED
FIN-04 — POST-ORDER RECOVERY: PRESERVED
```

Endereço e consentimento são mutações estruturais. Purge não pode apagar dado
necessário a risco financeiro vivo; erro criptográfico após sucesso canônico
gera reconciliação durável, nunca perda silenciosa ou segunda criação.

### 4.3 Autoridades de plataforma

- Order birth: webhook Stripe canônico + `CheckoutCompletionLog`.
- PostgreSQL: ownership, locks, version, uniqueness, atomicidade e lifecycle.
- Redis: coordenação, nunca autoridade de correção.
- Medusa module isolation: sem serviço/DB cru de módulo irmão.
- Store/BFF: exact method/path, credencial BFF distinta de Customer auth.
- OpenAPI: registry TypeScript; JSON gerado não é editado manualmente.

### 4.4 CHK-01..CHK-10

Os dez requisitos continuam OPEN. Pesquisa não equivale a implementação nem
prova de aceitação.

## 5. Research Question Ledger

| ID | Classificação | Owner |
|---|---|---|
| R17-Q01 | PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN | P17 |
| R17-Q02 | PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN | P17 + decisões técnicas humanas |
| R17-Q03 | HUMAN PRODUCT DECISION REQUIRED | P17 |
| R17-Q04 | PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN | P17 |
| R17-Q05 | BLOCKED — EXTERNAL CONSTRAINT | P17 blocker; P18 não absorve |
| R17-Q06 | HUMAN PRODUCT DECISION REQUIRED | P17 |
| R17-Q07 | HUMAN PRODUCT DECISION REQUIRED | P17 |
| R17-Q08 | LEGAL/HUMAN REVIEW REQUIRED | P17; go-live final P22 |
| R17-Q09 | PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN | P17; dependency P19 |
| R17-Q10 | HUMAN PRODUCT DECISION REQUIRED | P17 |
| R17-Q11 | PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN | P17 |
| R17-Q12 | PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN | P17 |
| R17-Q13 | PARTIALLY RESOLVED — PLAN CONSTRAINTS KNOWN | P17; prova integrada P22 |

### R17-Q01 — Sensitive-checkout data model and constraints

**Fatos.** O runtime não possui autoridade dedicada para CPF protegido,
receipts ou snapshot protegido de Order. CPF cru permanece em
`shipping_address.metadata.federal_tax_id`; `completeCartWorkflow` 2.16 copia
shipping address/metadata ao Order. Medusa permite índices/checks no mesmo
módulo, enquanto Module Links não materializam FKs cross-module.

**Evidência.** Código instalado Medusa 2.16; `checkout-data.ts`, serializers,
modelos `CustomerCartAuthority`, `StoreResourceVersion`; MED-01..MED-05 e
PG-01..PG-02.

**Constraints recomendadas para PLAN.** Uma autoridade protegida de domínio
deve possuir estado corrente por cart, receipts append-only, snapshot interno
único pela identidade CCL/PaymentAttempt e ledger de purge sanitizado. IDs
cross-domain escalares e constraints PostgreSQL permanecem autoridade; links
são projeção. Nomes físicos e DDL ainda não estão aprovados.

**Decisões remanescentes.** Campos mínimos do snapshot, retenção, cardinalidade
adicional por Customer e modelo de acesso/decriptação. Ver R17-HR-02 e HR-05.

**Risco.** Metadata genérica pode duplicar CPF, propagar ao Order e escapar do
lifecycle. Soft delete preserva ciphertext.

### R17-Q02 — Cryptography, key authority and rotation

**Fatos.** NIST sustenta GCM com IV único, preferência por 96 bits e tag não
truncada; Node 22 fornece `randomBytes`, `createCipheriv`, AAD e falha de
autenticação em `decipher.final()`. `pgsodium`/TCE não é recomendado para adoção
nova; Supabase Vault é secret store candidato, mas a documentação consultada
não prova KMS completo, KEK não exportável ou rotação de envelopes.

**Evidência.** CRY-01..CRY-10 e runtime Node 22.

**Constraints recomendadas para PLAN.** Envelope lógico AES-256-GCM, nonce de
12 bytes, tag de 16 bytes, AAD canônico/versionado, `key_version` positivo e
base64url canônico; nunca liberar plaintext antes de `final()`. Autoridade
externa e rotação devem suportar versões antigas decrypt-only. Falha/ausência de
chave/tag inválida é fail-closed sem fallback plaintext.

**Decisões remanescentes.** Provider/threat model, KEK/DEK, criptoperíodo,
cache/SLA, recovery/escrow, rotação e AAD Cart→Order. Ver R17-HR-03.

**Risco.** Reuso nonce+key compromete GCM; destruir versão ainda referenciada
torna dado irrecuperável; AEAD remoto transmite CPF ao processador de chaves.

### R17-Q03 — Seven-day abandonment and purge semantics

**Fatos.** Sete dias é contrato de produto, não prazo universal da LGPD. Não há
relógio/job atual. `Cart.updated_at` também muda por ações internas e não é
atividade humana confiável. FIN-03 congela quando
`financial_freeze_started_at != null`, `provider_canceled_confirmed_at == null`
e `order_id == null`.

**Evidência.** `financial-authority.ts`, PaymentAttempt migration,
`order-birth-marker.ts`, PG-03..PG-04 e LEG-01.

**Constraints recomendadas.** Clock server-side dedicado; GET/replay/job/
webhook não reiniciam automaticamente. Purge concorrente faz claim e revalida
todas as condições na mesma transação; falha/ambiguidade adia e alerta. Soft
delete não cumpre purge. Item vencido sob suspensão continua due e é removido
assim que a autoridade resolver.

**Decisão remanescente.** Evento inicial/reset/grace e política de freeze ou
reconciliation prolongado. Ver R17-HR-01.

**Risco.** Purge precoce rompe late success/Order; retenção indefinida por mera
conveniência viola minimização.

### R17-Q04 — Protected snapshot handoff at canonical Order birth

**Fatos.** `completeCartWorkflow` 2.16 é `store: true`, `idempotent: false` e
cria Order antes do link cart. O CCL possui constraints e recovery scan que
encontram zero/exatamente um/múltiplos Orders pelo marcador e falham fechado.
`transactionId`, `order_cart`, snapshot e Module Link não são exactly-once.

**Evidência.** Runtime `@medusajs/core-flows` 2.16, CCL service/migration,
`webhook-order-entrypoint.ts`, recovery scanner e prova aceita da Fase 13.

**Constraints recomendadas.** Após claim/reuse CCL e antes da transição
irreversível, preparar idempotentemente o snapshot protegido, único por
CCL/PaymentAttempt. Após criar ou recuperar exatamente um Order, bind
condicionalmente o mesmo snapshot ao mesmo `order_id`. Divergência ou ausência
necessária gera `reconciliation_required`; nunca rerun otimista de Order.

**Decisões remanescentes.** Conteúdo mínimo/retention e opção de re-encrypt no
handoff versus identidade/AAD estável. Ver R17-HR-02, HR-03 e HR-05.

**Risco.** Snapshot pós-Order abre janela de crash; snapshot como authority cria
segunda fonte de nascimento.

### R17-Q05 — Existing Gelato CPF conflict

**Fatos.** Gelato documenta `federalTaxId` como obrigatório para Brasil e o Help
Center afirma CPF do destinatário individual ou CNPJ de empresa em todos os
pedidos enviados ao Brasil. Produção local de apparel não prova exceção. O
runtime exige `federal_tax_id`, envia-o e inclui o payload no request hash.

**Evidência.** GEL-01..GEL-05 e `gelato-fulfillment/service.ts`.

**Constraint.** Raw CPF → Gelato continua proibido. Omitir o campo não constitui
compatibilidade. CNPJ do lojista, valor fictício ou máscara são rejeitados.

**Decisão/bloqueio.** Exceção oficial escrita ou adjudicação produto/provider
que preserve D17-12. Ver R17-HR-09 e R17-BLOCK-01.

**Risco.** Implementar Phase 18 sobre contrato incompatível ou reabrir D17-12.

### R17-Q06 — Billing-address product rule

**Fatos.** Medusa 2.16 representa shipping e billing como relações opcionais e
independentes. O request Stripe Card/Pix aceito não contém billing/address/CPF;
`billing_details` é opcional na API/SDK examinada. Stripe pode coletar somente
o mínimo necessário pelo método.

**Evidência.** STR-01..STR-04, pacote Medusa/Stripe instalado e
`provider-request-authority.ts`.

**Recomendação.** Não introduzir billing independente no M1 sem requisito
fiscal, antifraude ou operacional comprovado. Se derivado, exigir equivalência
explícita e copiar por allowlist sem metadata/CPF.

**Decisão remanescente.** Ausente, derivado ou independente; e materialização
da relação Medusa. Ver R17-HR-06.

**Risco.** Duplicação de PII e lifecycle sem necessidade.

### R17-Q07 — Stable error taxonomy and precedence

**Fatos.** O envelope atual permite `code`, `message`, `retryable`,
`correlationId?`, `fieldErrors?`, `cart?`; valores são sanitizados. Ownership é
404 não enumerável, stale é 412 específico, review/freeze viram conflito
genérico. A precedência atual varia entre operações e a allowlist de campos não
cobre todo o endereço/consentimento P17.

**Evidência.** Store `errors.ts`, concurrency/review/freeze guards, serializers
e componentes OpenAPI.

**Constraints recomendadas.** Preservar envelope fechado, nunca ecoar input,
causa crypto/provider ou financial ID; `cart` somente como snapshot seguro.
Surface/BFF/auth/ownership formam o prefixo obrigatório. A ordem restante não
foi aceita.

**Decisão remanescente.** Códigos, chaves, ordem/múltiplos erros e precedência
freeze/stale/review/replay/domain. Ver R17-HR-07.

**Risco.** Oráculos, contratos BFF instáveis e replay contornando authority.

### R17-Q08 — Consent/legal meaning, IP, access and retention

**Fatos oficiais.** CPF é dado pessoal. LGPD exige finalidade, adequação,
necessidade, transparência, segurança e prestação de contas. Consentimento é
uma entre várias bases; se usado, deve ser livre, informado, inequívoco,
demonstrável, específico e revogável. Termos de Compra, Política de Trocas e
ciência da Privacidade não são automaticamente o mesmo ato jurídico. A LGPD não
fixa prazo universal de cinco anos para receipts/CPF no Order.

**Inferências técnicas.** Receipts também são dados pessoais; decriptação exige
identidade individual, finalidade, menor privilégio e audit trail sem CPF. IP,
se exigido pelo Marco Civil, deve ter autoridade/prazo próprios. User-agent não
é necessário para o registro legal consultado e permanece proibido.

**Evidência.** LEG-01..LEG-07.

**Decisões remanescentes.** Matriz finalidade/base, semântica/versionamento dos
três documentos, revogação, retention, papéis de decrypt, direitos/exclusão e
aplicabilidade de IP/porta. Ver R17-HR-04 e HR-05.

**Risco.** Apresentar consentimento universal, prazo inventado ou CPF
criptografado como anônimo. Esta pesquisa não é aconselhamento jurídico.

### R17-Q09 — Sensitive idempotency fingerprint

**Fatos.** A Idempotency-Key já usa HMAC, mas o fingerprint semântico atual usa
SHA-256 de JSON. PaymentAttempt persiste JSON reversível com email/CEP/UF/cidade
e não distingue intentos que só mudam CPF. `pepper_version` existe, porém o
serviço atual resolve somente o pepper corrente, prejudicando rotação/replay.

**Evidência.** `store-idempotency/service.ts`, model/env, PaymentAttempt
fingerprint, CRY-04..CRY-07.

**Constraints recomendadas.** HMAC-SHA-256 de DTO allowlisted/canônico, incluindo
CPF normalizado somente em memória; chave dedicada, domain separation,
`fingerprint_scheme` e versão persistidos; digest completo de 32 bytes comparado
com `timingSafeEqual`. O locator da claim e o fingerprint têm lifecycles de
chave separados. Antes de usar a versão persistida para recomputar o
fingerprint, o serviço procura a claim por todas as versões de lookup retidas
ou por locator opaco estável independente da chave rotativa. Com keyring retido
comprovadamente completo, zero matches permite criar uma claim sob a versão
ativa, linearizada pela constraint/transação existente; um match é replay/reuse
e seleciona as versões persistidas; mais de um match falha fechado. Versão
necessária ausente ou keyring incompleto falha antes de interpretar zero como
claim nova. Digest é pseudonimizado, não anônimo.

**Decisões remanescentes.** Estratégia de lookup não circular,
retention/keyrings independentes, janela de versões antigas e registros
comprometidos. Ver R17-HR-10.

**Risco.** SHA-256 cru permite ataque de domínio pequeno; rotação incorreta pode
transformar replay em nova claim.

### R17-Q10 — Exact resume contract

**Fatos.** `GET /store/carts/active` localiza o cart canônico e retorna ETag,
mas admite guest e não contém draft protegido/receipts. Após reauth, Customer e
`CustomerCartAuthority` devem ser resolvidos novamente; browser snapshot/path
antigo não restauram autoridade.

**Evidência.** Active-cart route, CustomerCartAuthority, D17-04 e Store surface.

**Constraints recomendadas.** Mesmo cart canônico pode expor somente draft
allowlisted e readiness/ETag atuais. Cart antigo permanece 404 não enumerável.
Não transferir CPF/receipts silenciosamente.

**Decisão remanescente.** Operação/shape de leitura e política quando o cart
canônico foi substituído. Ver R17-HR-08.

**Risco.** Transferência silenciosa de PII/aceites ou confusão com polling P20.

### R17-Q11 — Closed Store/BFF surface integration

**Fatos.** Manifest atual: 66 operações, 14 M1, 46 DENY, 6 preserve-legacy. BFF
cart exact-set: 8. Não há `checkout-details`. PATCH draft e POST validate são
candidatos prospectivos marcados `ARTIFACT PENDING`; não existe candidato
documental de GET.

**Evidência.** Store manifest/guard, BFF exact-set, middleware, registry e
traceability.

**Constraints recomendadas.** Se aprovadas no futuro, operações P17 exigem BFF
service credential + publishable key + Customer bearer + canonical ownership +
lock/recheck + review/freeze/CAS/idempotency. Native update/complete/payment,
guest, saved-address CRUD, shipping, CEP Store e aliases permanecem DENY.

**Decisões remanescentes.** Exact-set final depende de HR-07/HR-08.

**Risco.** `ARTIFACT PENDING` virar contrato ou browser-direct Medusa.

### R17-Q12 — Address mapping, normalization and CEP seam

**Fatos.** Medusa não possui campos first-class para number, neighborhood e
complement. A autoridade canônica precisa mantê-los separados; projeção Medusa
não pode ser parseada para reconstruir domínio. CEP lookup é conveniência BFF,
não prova de validade/deliverability.

**Evidência.** D17-07, tipos Medusa 2.16, PRD frontend e current normalizer.

**Constraints conhecidas.** Manter `street`, `number|S/N`, `neighborhood` e
`complement?`; projetar allowlist para `address_1`, `address_2`, `postal_code`,
`province`, `country_code=br`. CEP aceita somente oito dígitos ou `NNNNN-NNN` e
persiste oito dígitos. Lookup falho não invalida preenchimento manual e não
altera cart/payment/shipping.

**Decisões remanescentes.** Fórmula e delimitadores exatos da projeção, limites
e overflow de cada campo, normalização além de CEP/UF, exact-set de erros e o
contrato futuro de timeout/fallback/cache do BFF. O último é boundary de
frontend/BFF, não implementação backend P17.

**Risco.** Um planner pode inventar serialização incompatível ou promover o PRD
prospectivo de CEP a contrato atual. A string Medusa nunca pode ser authority.

### R17-Q13 — Collateral PII and negative-proof matrix

**Fatos.** Há exposição real em metadata/Gelato, email real no Resend e PII
reversível no fingerprint PaymentAttempt. Hash Gelato deriva de payload com
CPF; WEL Stripe deriva do evento; EmailDelivery guarda hash não chaveado e
domínio do destinatário. Stripe create e PostHog normais usam projeções
estreitas.
Logs/Sentry/CCL/WEL podem receber CPF/endereço/email em message/stack/cause.
O `completeCartWorkflow` 2.16 usa `store: true`, consulta shipping metadata e
pode tornar contexto/output do Workflow Engine um sink durável adicional.

**Evidência.** Matriz da seção 12 e código local de cada sink.

**Constraints recomendadas.** Allowlist por sink, sanitização no boundary final
e canários formatado/não formatado/aliases/noisy objects no valor efetivo do
sink. Ausência estrutural local não substitui captura end-to-end.

**Decisões remanescentes.** Retention/classificação de derivados, hash/domínio
de email e política `no-store`.

**Risco.** CHK-08 ser marcada PASS por máscara ou filtro de nome de chave.

## 6. Recommended Architecture Constraints

### 6.1 MUST

- Manter CCL como única autoridade de nascimento/recovery de Order.
- Materializar authorities protegidas com constraints PostgreSQL próprias.
- Persistir somente envelopes autenticados; nunca plaintext ou fallback.
- Preparar snapshot protegido recuperável antes do seam irreversível de Order.
- Revalidar purge na mesma transação que remove o segredo.
- Revalidar Customer/cart/review/freeze/CAS antes de replay produzir resultado.
- Projetar todas as saídas por allowlist, inclusive Order/Gelato/Stripe/events.
- Manter todas as novas operações BFF-only e DENY por default.

### 6.2 MUST NOT

- Usar `shipping_address.metadata`, `cart.metadata`, Redis, browser, session,
  Module Link, `order_cart`, snapshot ou `transactionId` como authority.
- Criar `OrderBirthExecution` ou outra autoridade de nascimento.
- Fazer soft delete como purge de CPF.
- Comparar ciphertext GCM como fingerprint semântico.
- Persistir CPF mascarado, hash cru ou digest separado correlacionável.
- Descriptografar/emitir antes da autenticação GCM finalizar.
- Assumir billing, IP, user-agent, consentimento universal ou retenção de cinco
  anos sem decisão humana.
- Tratar omissão de `federalTaxId` como compatibilidade Gelato.

### 6.3 SHOULD / CANDIDATE

- Um módulo de privacidade de checkout com responsibilities para current data,
  receipts, protected Order snapshot e purge ledger.
- KEK externo + DEK versionada; DEK por registro é opção de maior isolamento.
- Clock dedicado `last_meaningful_activity_at` e `purge_due_at` server-side.
- Tombstone/audit sanitizado sem CPF, ciphertext ou payload.
- Billing ausente no M1 enquanto necessidade independente não for provada.

### 6.4 Rejected alternatives

| Alternativa | Motivo da rejeição |
|---|---|
| CPF cifrado em metadata | Propagação genérica, sem lifecycle/cardinality/least privilege |
| Snapshot somente após Order | Crash pode deixar Order sem dado necessário |
| Snapshot como Order authority | Viola D17-14/FIN-04 |
| Purge por status operacional | Status local não prova finality financeira |
| SHA-256 de CPF | Domínio pequeno e reversível por enumeração |
| Deterministic encryption de CPF | Correlacionável e inadequada como fingerprint |
| Supabase pgsodium/TCE novo | Documentação atual não recomenda adoção nova |
| Gelato sem campo por omissão | Contrato BR documenta campo obrigatório |

## 7. Data Model Findings

Nomes abaixo são candidatos de responsabilidade, não schema aprovado:

| Responsibility | Cardinalidade/authority pesquisada | Lifecycle |
|---|---|---|
| Protected checkout current data | no máximo um ativo por cart canônico; vínculo Customer/cart revalidado | draft → final-valid → transferred/purged/suspended |
| Consent receipt | zero ou mais append-only; final requer receipts válidos por propósito aprovado | accepted → superseded/revoked quando juridicamente aplicável |
| Protected Order snapshot | um por CCL e PaymentAttempt; `order_id` nullable depois único | prepared → bound → retained/purged por política |
| Sensitive purge ledger | evento sanitizado idempotente | due → claimed/deferred/purged/alerted |

Constraints locais devem cobrir pares coerentes, unique parcial de estado ativo,
one-snapshot-per-authority e bind idempotente ao mesmo Order. Links Medusa não
substituem esses constraints.

## 8. Cryptography Findings

### 8.1 Envelope mínimo recomendado

```text
envelope_version = 1
algorithm = aes-256-gcm
key_version = positive integer/string from key authority
aad_version = 1
nonce_b64u = canonical base64url of exactly 12 bytes
ciphertext_b64u = canonical base64url
tag_b64u = canonical base64url of exactly 16 bytes
```

AAD não secreto deve incluir domínio/purpose, versões, tipo/ID estável da
authority, nome do campo e `key_version`. Não incluir CPF nem version mutable do
cart. Handoff precisa decidir re-encrypt com novo AAD/nonce ou preservar uma
identidade estável aprovada.

### 8.2 Nonce, key e rotação

- `randomBytes(12)` por nova criptografia;
- retry reutiliza envelope confirmado ou gera novo nonce; nunca repete nonce
  conhecido sob a mesma chave;
- versão ativa cifra; versões anteriores ficam decrypt-only;
- re-encryption usa CAS e preserva envelope antigo se falhar;
- versão só é destruída quando nenhum envelope/backup/replay depende dela;
- limite operacional deve ser inferior ao teto NIST de `2^32` invocações por
  chave no modelo RBG.

### 8.3 Failure semantics

Algoritmo/versão desconhecidos, base64url inválido, nonce/tag errados, chave
ausente, random failure ou tag/AAD inválida falham fechado. Antes do provider:
503 sanitizado/retryable conforme decisão de contrato. Após sucesso canônico:
reconciliation durável. Corrupção e indisponibilidade não viram oráculo público.

### 8.4 Fingerprint seguro

HMAC-SHA-256 sobre DTO semântico exact-set/canônico, com domínio composto por
scheme, operação, actor/resource scope e um binding estável da claim produzido
pela estratégia de lookup aprovada. CPF entra somente transitoriamente já
normalizado. Persistir digest 32 bytes, scheme e key version. Chave HMAC é
independente de AES, Idempotency-Key lookup pepper, tracking e Customer Auth.

Lookup e fingerprint são duas etapas. A primeira usa todas as versões retidas
ou um locator opaco estável. Com keyring comprovadamente completo: zero matches
cria a primeira claim sob a versão ativa e sob linearização transacional; um
match reutiliza/reproduz e só então sua versão persistida seleciona a chave do
fingerprint; mais de um match falha fechado. Chave retida ausente, keyring
incompleto ou corrupção falham antes de interpretar zero como nova claim.
Nenhuma lookup key pode ser destruída enquanto houver claim reexecutável que
dependa dela.

## 9. Privacy / Legal Research

| Categoria | Resultado |
|---|---|
| OFFICIAL SOURCE SAYS | CPF é dado pessoal; tratamento exige princípios e uma base do art. 7º; consentimento tem requisitos próprios; término/conservação/direitos são por finalidade e exceções legais. |
| TECHNICAL INFERENCE | Criptografia/máscara não anonimiza automaticamente; receipts também são PII; access/decrypt exige least privilege e auditoria; IP deve ser segregado se necessário. |
| PRODUCT RECOMMENDATION | Receipts semanticamente distintos, sem CPF/IP/user-agent; não coletar billing/IP além da necessidade aprovada. |
| LEGAL/HUMAN REVIEW REQUIRED | Bases/finalidades, natureza dos três atos, versões, retention, revogação, papéis, direitos e Marco Civil/IP. |

O prazo de sete dias é decisão de produto. O prazo de cinco anos presente em
prosa anterior não foi validado como regra universal. Esta seção não é parecer
jurídico.

## 10. Gelato Compatibility Finding

```text
NO-CPF GELATO COMPATIBILITY:
BLOCKED

Official public contract:
federalTaxId mandatory for orders shipped to Brazil

Individual recipient:
CPF required by provider documentation

Public exception for apparel/local production:
NOT FOUND

Raw CPF transmission:
FORBIDDEN — PRESERVED
```

Compatibilidade só pode ser reavaliada com prova oficial escrita de fluxo BR
sem CPF ou decisão humana de produto/provider que continue preservando D17-12.

## 11. Store/BFF Contract and Error Findings

### 11.1 Candidate operation inventory

| Operação | Estado |
|---|---|
| `PATCH /store/carts/{id}/checkout-details` | candidato `ARTIFACT PENDING` para draft |
| `POST /store/carts/{id}/checkout-details/validate` | candidato `ARTIFACT PENDING` para final validation |
| GET de draft/resume | hipótese; requer decisão humana |
| `GET /store/carts/active` | locator atual; não é leitor implícito do draft protegido |

Todas as demais variantes method/path permanecem DENY até autorização exata.

### 11.2 Guard requirements

```text
closed Store surface
→ BFF service credential
→ publishable Store key
→ Customer bearer
→ canonical Customer/cart ownership
→ transaction lock + ownership recheck
→ remaining guards in human-approved precedence
```

Guest capability, cookie/session-only, browser snapshot, recipient identity,
path id e Idempotency-Key não criam Customer/cart authority.

### 11.3 Candidate public error matrix

| Classe | Shape/HTTP conhecido | Ponto aberto |
|---|---|---|
| surface/native/unknown | 404 uniforme | nenhum detalhe interno |
| BFF auth ausente/incorreta | 404 uniforme | preservar constant-time |
| BFF config ausente | 503 sanitizado | código final humano |
| Customer auth expirada | 401 | resume após reauth |
| ownership/cart antigo | 404 não enumerável | política cart substituído |
| stale version | 412 `CART_VERSION_MISMATCH` | posição na precedência |
| pending review | 409/conflito sanitizado | código final/precedência |
| financial freeze | 409/conflito sanitizado | não revelar attempt/provider |
| field/domain invalid | envelope + allowlisted `fieldErrors` | keys/ordem/múltiplos |
| crypto unavailable | candidato 503 retryable | código público |
| crypto corruption/version invalid | candidato 500 sanitizado | código público |

Precedência candidata, não aceita:

```text
surface → BFF → auth → ownership → lock/recheck
→ freeze → stale → review → idempotency/replay → domain
```

O prefixo até ownership é vinculante. A ordem entre freeze/stale/review/replay/
domain permanece R17-HR-07.

## 12. PII Sink Matrix

| Sink | Current fields/exposure | Existing protection | Proof gap | Future negative proof |
|---|---|---|---|---|
| Cart/Order address metadata | CPF cru real; address/phone/email funcionais | CPF mascarado apenas no DTO | cópia real Cart→Order e purge | Order real + DB/link/snapshot/response scan |
| Public Cart response | address/email/phone autorizados; CPF masked | serializer explícito | sibling spread, cache e cross-customer | noisy object exact-keyset + `no-store` + cross-actor |
| PaymentAttempt fingerprint | JSON reversível com email/CEP/UF/city; CPF omitido | alguns guards por key/pattern | aliases/CPF digits-only/incompatible replay | canários e nova derivação HMAC versionada |
| Stripe create/session | amount/currency/method/technical IDs; sem CPF/address/email | allowlist canônica | erro provider pode conter PII | capture request + adversarial error |
| Gelato dispatch | nome/address/CEP/email/phone/CPF enviados; hash do payload | summaries locais estreitos | contrato no-CPF ausente | payload capture sem document + DB/log/Sentry scan |
| Analytics/PostHog | technical IDs/value/items; sem CPF/address/email normal | builder/projection | strings SKU/error podem carregar aliases | final call + AEL canaries |
| Logs/access | method/route/status/correlation + messages/errors | context allowlist | CPF/email/address em message/stack/route | final sink message/stack/cause canaries |
| Sentry | exception/message/stack/cause/fingerprint/breadcrumb | `sendDefaultPii:false`, hooks | string values não completamente scrubbed | capture final event across every field |
| Stripe WEL | full-event payload hash + errors/metadata | metadata allowlist | derived hash and PII in messages | noisy event + DB/log/Sentry scan |
| Gelato WEL | parsed projection hash + errors | parser/projection | failure message can leak | noisy payload/error canaries |
| CheckoutCompletionLog | error message/reasons/metadata | partial sanitizers | caller path can persist raw message | workflow failure + PostgreSQL scan |
| Store idempotency | hashes/fingerprint/authority IDs | HMAC for key; key guards | semantic fingerprint/rotation | aliases + all columns + replay matrix |
| OpenAPI examples | synthetic examples; obvious-key guards | registry validators | CPF under benign aliases/strings | formatted/digits-only/nested/noisy cases |
| Unauthorized errors | closed fixed envelope | rebuild by allowlist | future P17 paths not covered | 401/404/409/412/422 exact-keyset canaries |
| Resend/EmailDelivery | email sent; DB raw-domain + unkeyed normalized hash | narrow request/error projection | correlation/dictionary risk; message leak | captured call + DB/log scan; justify derivatives |
| Workflow Engine executions | `store:true` pode persistir inputs, outputs, context e step state; complete-cart consulta shipping metadata | nenhuma prova específica de CPF no backend durável | CPF cru pode sobreviver a purge de Cart/Order | executar workflow com canários e varrer execution storage/Admin após purge |
| Events/subscribers | domain events e subscriber payloads/errors | builders estreitos em alguns fluxos | evento genérico, error/cause ou snapshot pode carregar PII | capturar bus payload, subscriber input/error e storage de retry |
| Queues/jobs/retries | job payload, attempts, backoff/error, dead-letter quando aplicável | IDs/summaries em jobs inspecionados | payload/context serializado pode duplicar CPF/endereço/email | canários no backend de fila, retry/dead-letter e logs finais |
| Request validation/middleware | body, parsed DTO, validation errors, correlation/request metadata | closed public error envelope | caches/body snapshots e mensagens de validator não inventariados | canários antes/depois de middleware, validator error e qualquer cache |

Canários mínimos: CPF formatado, digits-only, espaço/pontuação, aliases
`federal_tax_id`, `federalTaxId`, `cpf`, `document`, `taxpayer_document`,
`recipientTaxId`, `national_registry`, e noisy nesting em metadata/message/stack/
cause/breadcrumb/provider response/note/SKU/shippingAddress. A prova observa o
valor final do sink, não apenas o sanitizador de entrada.

## 13. Cross-Phase Deferrals

| Fase | Deferred — não é deliverable P17 RESEARCH |
|---|---|
| P18 | quote/select Gelato, TTL, options/price, selection persistence/invalidation, dispatch e provider failure behavior |
| P19 | redesign/migration de PaymentAttempt, fingerprint existente, guest/Pix removal, status/retry/invalidation/client secret |
| P20 | confirmation session/token, polling, refresh/multi-tab, rate limit e late-success surface |
| P21 | public Order reference, ConfirmedOrderSummary, owner/TTL/cross-device, Order/catalog UI/contract |
| P22 | final kit, types/Zod, fixtures/mocks, integrated provider/release/go-live proof |
| Frontend | Next.js/BFF runtime, form, real CEP lookup, browser integration e UI |

R17-Q01..Q13 não são marcadas DEFERRED: todas são perguntas P17. Somente suas
ramificações de implementação futura foram classificadas acima.

## 14. Human Decisions Required Before PLAN

### R17-HR-01 — Abandonment clock and prolonged freeze

**Decision.** Evento que inicia/reinicia sete dias, grace e comportamento sob
freeze/reconciliation prolongado.

**Options.** Primeiro draft protegido; última mutação válida; final validation;
combinação explicitamente limitada. Purge due pode permanecer suspenso até
finality ou adotar exceção temporal aprovada.

**Evidence/tradeoff.** `Cart.updated_at` é não confiável; reset excessivo retém
PII, reset curto pode quebrar late success. Recomendação: primeiro draft e
somente mutações P17 válidas/final validation reiniciam; item vencido continua
due sob suspensão. **Blocked until decision:** purge state machine.

### R17-HR-02 — Protected authority and minimum Order snapshot

**Decision.** Responsibilities/cardinalities finais e exact minimum do snapshot.

**Options.** Autoridade única com submodels; authorities separadas coordenadas;
snapshot por CCL ou PaymentAttempt com vínculo único a Order.

**Evidence/tradeoff.** Module isolation e CCL favorecem responsabilidades
coesas; overcollection amplia retenção. Recomendação: um módulo de domínio,
snapshot único por CCL/PaymentAttempt, sem duplicar address/email. **Blocked:**
model contract antes do PLAN.

### R17-HR-03 — External key authority and lifecycle

**Decision.** Provider/threat model, KEK/DEK, remote versus local AEAD, SLA,
cache, cryptoperiod, recovery e rotation.

**Options.** KEK externo + DEK versionada compartilhada; KEK externo + DEK por
registro; AEAD remoto; secret store exportável com controls adicionais.

**Evidence/tradeoff.** DEK por registro isola melhor e facilita rewrap; custa
mais operações. AEAD remoto não expõe key ao app, mas envia CPF ao processor.
Supabase Vault sozinho não prova KMS completo. Recomendação: KEK externo + DEK
por registro ou versionada após threat review. **Blocked:** crypto interface,
AAD/handoff e operational failure policy.

### R17-HR-04 — Legal purpose/base and receipt semantics

**Decision.** Finalidade/base de cada tratamento e natureza jurídica dos três
receipts, versões e eventual revogação.

**Options.** Contract acceptance, notice acknowledgement e consent apenas onde
consent for a base real; classificação da Política de Trocas ainda aberta.

**Evidence/tradeoff.** LGPD não admite consentimento universal. Recomendação:
matriz `dado→finalidade→base→recipients` aprovada por jurídico. **Blocked:**
receipt semantics/final validation.

### R17-HR-05 — Retention, access, rights and IP

**Decision.** Retention de snapshot/receipts, roles de decrypt, DSAR/delete e
aplicabilidade de IP/porta sob Marco Civil.

**Options.** Retention por finalidade e obrigação; named roles + emergency
access; IP em authority segregada somente se aplicável.

**Evidence/tradeoff.** Cinco anos não foi provado como universal; deleção não
apaga autoridade financeira/contratual ainda necessária. Recomendação: matriz
de retenção/evento de deletion, least privilege e audit sem CPF. **Blocked:**
lifecycle final e access controls.

### R17-HR-06 — Billing address

**Decision.** Ausente, derivado de shipping ou independente.

**Options/tradeoff.** Ausente minimiza PII; derivado exige declaração explícita
e allowlist; independente amplia contrato/privacy. Recomendação: ausente no M1
sem necessidade comprovada. **Blocked:** DTO/model projection final.

### R17-HR-07 — Public error taxonomy and precedence

**Decision.** Códigos, field keys, ordering/multiple errors e ordem de freeze,
stale, review, replay e domain validation.

**Options/tradeoff.** Precedências diferentes alteram observabilidade pública e
UX; nenhuma pode criar bypass. Recomendação: manter prefixo surface/BFF/auth/
ownership e deliberar a matriz restante com non-echo proof. **Blocked:** closed
TypeScript/OpenAPI error contract.

### R17-HR-08 — Resume operation and replaced cart

**Decision.** GET dedicado ou extensão allowlisted de active cart; erro/re-entry
quando outro cart é canônico.

**Options/tradeoff.** GET dedicado expõe contrato explícito; active-cart reduz
operações mas mistura guest/current semantics. Transferir draft reduz atrito e
aumenta risco de PII/consent authority. Recomendação: leitura customer-only
explícita e nunca transferir silenciosamente. **Blocked:** exact-set final.

### R17-HR-09 — Gelato/provider adjudication

**Decision.** Como preservar D17-12 diante do requisito oficial do provider.

**Options.** Obter exceção oficial no-CPF; alterar produto/provider em gate
separado; manter shipping BR bloqueado. Transmitir CPF não é opção autorizada.

**Evidence/tradeoff.** GEL-01/GEL-02 afirmam mandatory for Brazil. Recomendação:
fail closed até prova escrita. **Blocked:** R17-Q05 e compatibilidade para P18.

### R17-HR-10 — Sensitive fingerprint key lifecycle

**Decision.** Locator de claim não circular, retention/keyrings separados,
versões ativas/anteriores, compromise e registros históricos.

**Options/tradeoff.** Para lookup, calcular candidatos com todas as versões
retidas ou usar locator opaco estável independente da chave rotativa. Com
keyring completo, zero matches cria claim sob a versão ativa, um match é
replay/reuse e mais de um falha fechado; só no match a versão persistida
seleciona a chave do fingerprint. Keyring incompleto nunca transforma zero em
claim nova. Manter versões antigas suporta replay e aumenta exposure; destruir
cedo pode criar nova claim. Recomendação: keyrings separados, prova de
completude e indisponibilidade fail-closed. **Blocked:** lifecycle do
fingerprint/idempotency.

## 15. Research Conflicts and Blockers

### R17-CONFLICT-01 — Gelato BR tax ID versus D17-12

O contrato oficial Gelato exige CPF do destinatário individual para pedidos
enviados ao Brasil; D17-12 proíbe CPF no Gelato. A decisão D17 não é alterada.

### R17-BLOCK-01 — No-CPF Gelato compatibility

```text
Affected question: R17-Q05
Evidence: GEL-01..GEL-05 + current runtime builder
Status: BLOCKED — EXTERNAL CONSTRAINT
Smallest safe next human action:
obter exceção oficial escrita ou adjudicar produto/provider preservando D17-12
```

Outras pendências são decisões humanas, não blockers externos adicionais.

## 16. Source Register

Páginas vivas sem data editorial são marcadas `n/d`. `Primary/secondary`
classifica a autoridade; `Quality` registra quando fonte secundária é orientação
oficial complementar.

| ID | Publisher | Title | Date | Retrieved | Primary/secondary | Quality | Claims supported |
|---|---|---|---|---|---|---|---|
| MED-01 | Medusa | [Module Links](https://docs.medusajs.com/learn/fundamentals/module-links) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | cross-module IDs, no FK in link table |
| MED-02 | Medusa | [Module Isolation](https://docs.medusajs.com/learn/fundamentals/modules/isolation) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | workflows/links/query instead of sibling access |
| MED-03 | Medusa | [Data Model Relationships](https://docs.medusajs.com/learn/fundamentals/data-models/relationships) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | internal model relationships/FKs |
| MED-04 | Medusa | [Data Model Indexes](https://docs.medusajs.com/learn/fundamentals/data-models/indexes) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | composite/conditional/unique indexes |
| MED-05 | Medusa | [Check Constraints](https://docs.medusajs.com/learn/fundamentals/data-models/check-constraints) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | local row invariants |
| MED-06 | Medusa | [Workflow Retry](https://docs.medusajs.com/learn/fundamentals/workflows/retry-failed-steps) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | retry/resume and transaction ID |
| MED-07 | Medusa | [Store Workflow Executions](https://docs.medusajs.com/learn/fundamentals/workflows/store-executions) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | stored executions/Redis engine |
| MED-08 | Medusa | [softDelete](https://docs.medusajs.com/resources/data-model-repository-reference/methods/softDelete) | n/d | 2026-09-08 | PRIMARY | OFFICIAL | deleted_at does not physically purge |
| PG-01 | PostgreSQL | [Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html) | v17 | 2026-09-08 | PRIMARY | PRIMARY | CHECK versus cross-row UNIQUE |
| PG-02 | PostgreSQL | [Partial Indexes](https://www.postgresql.org/docs/17/indexes-partial.html) | v17 | 2026-09-08 | PRIMARY | PRIMARY | unique partial predicates |
| PG-03 | PostgreSQL | [SELECT locking clause](https://www.postgresql.org/docs/17/sql-select.html) | v17 | 2026-09-08 | PRIMARY | PRIMARY | SKIP LOCKED queue-like claim only |
| PG-04 | PostgreSQL | [Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html) | v17 | 2026-09-08 | PRIMARY | PRIMARY | row locks/order/deadlock retry |
| CRY-01 | Node.js | [Crypto v22](https://nodejs.org/docs/latest-v22.x/api/crypto.html) | v22.23.2 docs | 2026-09-08 | PRIMARY | OFFICIAL | GCM/AAD/tag/randomBytes/HMAC/final |
| CRY-02 | NIST | [SP 800-38D](https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38d.pdf) | 2007-11 | 2026-09-08 | PRIMARY | PRIMARY | GCM IV/tag/limits/authentication |
| CRY-03 | NIST | [Revision announcement for SP 800-38D](https://csrc.nist.gov/News/2024/nist-to-revise-sp-80038d-gcm-and-gmac-modes) | 2025-03-11 update | 2026-09-08 | PRIMARY | PRIMARY | future minimum tag direction |
| CRY-04 | NIST | [SP 800-57 Part 1 Rev. 5](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf) | 2020-05 | 2026-09-08 | PRIMARY | PRIMARY | key purpose/version/cryptoperiod/recovery |
| CRY-05 | NIST | [SP 800-108 Rev.1-upd1](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-108r1-upd1.pdf) | 2024-02-02 | 2026-09-08 | PRIMARY | PRIMARY | HMAC KDF/context/domain separation |
| CRY-06 | NIST | [FIPS 198-1 HMAC](https://csrc.nist.gov/pubs/fips/198-1/final) | 2008-07; withdrawal proposed 2025-06-23 | 2026-09-08 | PRIMARY | PRIMARY | keyed MAC; proposta de migração ainda não é retirada consumada |
| CRY-07 | RFC Editor | [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785.html) | 2020-06 | 2026-09-08 | PRIMARY | PRIMARY | deterministic JSON canonicalization |
| CRY-08 | OWASP | [Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) | n/d | 2026-09-08 | SECONDARY | OFFICIAL GUIDANCE | AEAD/minimization/key separation; complementary only |
| CRY-09 | Supabase | [pgsodium pending deprecation](https://supabase.com/docs/guides/database/extensions/pgsodium) | current | 2026-09-08 | PRIMARY | OFFICIAL | no new pgsodium/TCE use |
| CRY-10 | Supabase | [Vault](https://supabase.com/docs/guides/database/vault) | current | 2026-09-08 | PRIMARY | OFFICIAL | secret storage/root key boundary/limitations |
| CRY-11 | NIST | [SP 800-224 IPD](https://csrc.nist.gov/pubs/sp/800/224/ipd) | initial public draft | 2026-09-10 | PRIMARY | PRIMARY DRAFT | proposed HMAC successor text; not final publication |
| LEG-01 | Presidência da República | [LGPD — Lei 13.709](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm) | 2018-08-14, compiled | 2026-09-09 | PRIMARY | PRIMARY | definitions, principles, bases, consent, retention, rights, security |
| LEG-02 | ANPD | [Perguntas Frequentes](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes) | modified 2026-07-01 | 2026-09-09 | SECONDARY | OFFICIAL GUIDANCE | CPF personal data, bases, mapping |
| LEG-03 | ANPD | [Guia de Segurança para ATPPs](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_seguranca_da_informacao_para_atpps___defeso_eleitoral.pdf) | 2021-10 | 2026-09-09 | SECONDARY | OFFICIAL GUIDANCE | authentication/authorization/audit/least privilege |
| LEG-04 | Presidência da República | [Marco Civil — Lei 12.965](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm) | 2014-04-23 | 2026-09-09 | PRIMARY | PRIMARY | access log/IP/six months subject to applicability |
| LEG-05 | Presidência da República | [Decreto 8.771](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/decreto/d8771.htm) | 2016-05-11, compiled | 2026-09-09 | PRIMARY | PRIMARY | access controls/crypto/minimum retention/port |
| LEG-06 | Presidência da República | [Decreto 7.962](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm) | 2013-03-15 | 2026-09-09 | PRIMARY | PRIMARY | ecommerce disclosure/acceptance/contract record |
| LEG-07 | Presidência da República | [CDC — Lei 8.078](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm) | 1990-09-11, compiled | 2026-09-09 | PRIMARY | PRIMARY | understandable contract/access/correction |
| GEL-01 | Gelato | [Create Order v4](https://dashboard.gelato.com/docs/orders/v4/create/) | n/d | 2026-09-09 | PRIMARY | OFFICIAL | federalTaxId mandatory for Brazil |
| GEL-02 | Gelato | [Brazilian tax requirements](https://support.gelato.com/en/articles/8996192-what-are-the-brazilian-tax-requirements-for-shipping) | 2025-10-28 | 2026-09-09 | PRIMARY | OFFICIAL | CPF/CNPJ required for all BR shipments |
| GEL-03 | Gelato | [Getting Started with Shipping](https://support.gelato.com/en/articles/8996174-getting-started-with-shipping) | 2025-10-30 | 2026-09-09 | PRIMARY | OFFICIAL | Brazil additional tax requirements/routing |
| GEL-04 | Gelato | [Where apparel is printed](https://support.gelato.com/en/articles/8996105-where-is-my-apparel-clothing-order-printed) | 2025-10-30 | 2026-09-09 | PRIMARY | OFFICIAL | local production not guaranteed |
| GEL-05 | Gelato | [Customer information needed](https://support.gelato.com/en/articles/8996062-what-customer-information-does-gelato-need-to-process-the-order) | 2025-10-28 | 2026-09-09 | PRIMARY | OFFICIAL | country-specific recipient requirements |
| STR-01 | Stripe | [Billing details collection](https://docs.stripe.com/payments/payment-element/control-billing-details-collection?locale=en-GB) | n/d | 2026-09-09 | PRIMARY | OFFICIAL | minimum collection/address by business need |
| STR-02 | Stripe | [Address Element](https://docs.stripe.com/elements/address-element?platform=web) | n/d | 2026-09-09 | PRIMARY | OFFICIAL | shipping-as-billing equivalence |
| STR-03 | Stripe | [Create PaymentMethod](https://docs.stripe.com/api/payment_methods/create?api-version=2024-06-20) | API 2024-06-20 | 2026-09-09 | PRIMARY | OFFICIAL | billing_details optional |
| STR-04 | Stripe | [Pix](https://docs.stripe.com/payments/pix?locale=pt-BR) | n/d | 2026-09-09 | PRIMARY | OFFICIAL | Pix/BRL context; not negative billing proof alone |

## 17. Research Exit Criteria

| Criterion | Result |
|---|---|
| 13/13 questions classified | PASS |
| Material claims cited | PASS |
| Primary/official sources preferred | PASS |
| Installed-version conflicts handled | PASS |
| Legal claims bounded | PASS |
| Gelato conflict explicit | PASS — blocker retained |
| PII sink inventory covers durable/async/validation boundaries | PASS for research inventory; every implementation proof remains OPEN |
| P18–P22 implementation leakage | 0 |
| P0/P1/material P2 after adversarial review | PASS — 0 / 0 / 0 after three review cycles |

Research is recommended for human review after J recorded zero open P0/P1/
material P2. A PASS here does not close CHK requirements.

## 18. Governance

```text
Phase 17 CONTEXT:
HUMAN APPROVED — PASS

Phase 17 RESEARCH:
TECHNICAL RESEARCH COMPLETE — HUMAN REVIEW REQUIRED

Phase 17 PLAN:
NOT AUTHORIZED

Phase 17 EXECUTION:
NOT AUTHORIZED

Phase 18+:
NOT AUTHORIZED

Push:
NOT AUTHORIZED

Deploy:
NOT AUTHORIZED

Real provider actions:
NOT AUTHORIZED

Remote infrastructure:
NOT AUTHORIZED

Frontend:
BLOCKED
```
