# Phase 3: Cart & Checkout (pre-Order) - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning (manual-review gated)

<domain>
## Phase Boundary

Entregar o contrato backend de carrinho e checkout pré-Order para guests e customers autenticados: criar/manter cart, coletar email e shipping address válidos para Brasil, e expor uma noção derivada de completude de checkout sem criar `Order`, sem iniciar pagamento e sem tocar em webhook ou fulfillment.

**No escopo desta fase:**
- Carrinho guest com um único cart ativo por ator.
- Carrinho autenticado com um único cart ativo por customer.
- Regra de attach do guest cart ao customer no login.
- Coleta e validação de email de contato.
- Coleta, normalização e validação estrutural de shipping address Brasil/Gelato.
- Cálculo derivado de `checkout_data_complete` a partir do cart atual.

**Fora do escopo (explícito):**
- Criar `Order`.
- Iniciar Stripe/Pix, criar `PaymentAttempt` ou qualquer fluxo de pagamento.
- Webhook Stripe/Gelato.
- Fulfillment Gelato.
- Migrations, deploy, alteração de secrets/config vars.

</domain>

<decisions>
## Implementation Decisions

### Ownership e ciclo de vida do cart
- **D-01:** Há **um único cart ativo por ator** no MVP. Guest tem um cart ativo; customer autenticado tem um cart ativo.
- **D-02:** No login, o **guest cart da sessão atual vence** no MVP quando estiver preenchido e não vazio: ele é anexado ao customer e passa a ser o único cart ativo do customer.
- **D-03:** O cart ativo anterior do customer, quando substituído pelo guest cart da sessão atual, **deixa de ser ativo mas não é deletado**.
- **D-04:** Se **não houver guest cart** na sessão, o cart ativo existente do customer continua como fonte de verdade.
- **D-05:** Se o **guest cart estiver vazio**, o backend **preserva o cart ativo existente do customer** para não sobrescrever um cart útil com um cart vazio.
- **D-06:** Nesta fase **não existe merge complexo de linhas** entre guest cart e customer cart, nem resolução explícita de conflitos.
- **D-07:** O cart permanece **livremente editável** em estado pré-Order: itens, quantidades, email e shipping address podem mudar sem travamento permanente.

### Identidade e email de contato
- **D-08:** Para customer autenticado, `customer.email` é a **fonte de verdade** do checkout no MVP e **não pode ser sobrescrito** no cart.
- **D-09:** Se um guest cart já tiver email e depois for anexado a um customer autenticado, o email de contato do cart é **normalizado para `customer.email`**.
- **D-10:** Para guest, o email informado no checkout continua sendo a fonte de contato enquanto não houver autenticação.
- **D-11:** Guest pode **criar, montar e editar** cart sem email; email válido só se torna obrigatório quando o backend precisar considerar o checkout **com dados completos**.
- **D-12:** Email ausente ou inválido **não bloqueia o uso básico do cart**; bloqueia apenas a condição derivada de checkout completo.

### Contrato mínimo do shipping address Brasil/Gelato
- **D-13:** Para `checkout_data_complete = true`, o endereço precisa conter: `full_name`, `address_1`, `city`, `province`/`state`, `postal_code`, `country_code = BR` e `federal_tax_id` do destinatário (aceitando CPF ou CNPJ).
- **D-14:** `phone`, `address_2`/`complement`, `company` e `state_tax_id` permanecem **opcionais** nesta fase.
- **D-15:** `country_code` deve ser sempre **`BR`** no MVP.
- **D-16:** `postal_code` aceita CEP com ou sem máscara e é **normalizado para 8 dígitos**.
- **D-17:** `federal_tax_id` aceita CPF ou CNPJ, é **normalizado para dígitos** e precisa passar validação estrutural, incluindo tamanho e dígitos verificadores.
- **D-18:** `province`/`state` deve ser normalizado preferencialmente para **UF brasileira**.
- **D-19:** `full_name`, `address_1` e `city` são obrigatórios e não vazios.

### Nível de validação do endereço
- **D-20:** A Phase 03 aplica **apenas validação estrutural e normalização** do endereço; não faz validação externa/postal profunda.
- **D-21:** `phone`, se informado, pode ser normalizado/validado em formato básico, mas **não bloqueia** `checkout_data_complete`.
- **D-22:** Ficam explicitamente fora do escopo desta fase: validação externa de CEP, consulta a Correios/ViaCEP, consistência CEP↔cidade↔UF, geocoding e validação real de entregabilidade.

### Limite do checkout sem Order
- **D-23:** A Phase 03 **não persiste nenhum novo status nominal** no cart para representar prontidão.
- **D-24:** Podemos usar **`checkout_data_complete` apenas como linguagem de negócio/documentação ou campo calculado de resposta**, nunca como status persistido definitivo.
- **D-25:** O nome **`ready_for_payment` não deve existir nesta fase**, para não antecipar semântica da Phase 04.
- **D-26:** `checkout_data_complete = true` somente quando o cart tiver: itens válidos, email válido, shipping address válido conforme este contrato, `country_code = BR`, e região/moeda compatíveis com Brasil/BRL.
- **D-27:** Qualquer alteração em itens, quantidade, email ou shipping address **recalcula** a condição derivada.
- **D-28:** `checkout_data_complete = true` **não** cria `Order`, **não** cria `PaymentAttempt`, **não** inicia Stripe/Pix, **não** dispara webhook e **não** aciona fulfillment.

### Itens válidos para `checkout_data_complete`
- **D-29:** O cart precisa ter **pelo menos um line item**.
- **D-30:** Cada item precisa ter **quantidade positiva**.
- **D-31:** O item precisa referenciar uma variante **vendável/publicável** conforme a fronteira pública de catálogo construída na Phase 02.
- **D-32:** O cart precisa estar associado ao contexto **Brasil/BRL**.
- **D-33:** A Phase 03 **reaproveita** a fronteira de vendabilidade da Phase 02 e **não duplica** a validação catalogal/Gelato profunda dentro do checkout.

### the agent's Discretion
- Nomes concretos de rotas, handlers, DTOs, middlewares e utilitários podem ser definidos na pesquisa/plano, desde que preservem integralmente os contratos acima.
- O formato exato de resposta para expor `checkout_data_complete` pode ser decidido depois, desde que permaneça **derivado**, recalculável e não persistido como status.
- O mecanismo técnico para marcar um cart antigo como “não ativo” pode variar no plano, desde que não introduza múltiplos carts ativos simultâneos para o mesmo ator dentro das regras acima.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Escopo e requisitos
- `.planning/ROADMAP.md` §"Phase 3: Cart & Checkout (pre-Order)" — objetivo, dependência em Phase 2 e critérios de sucesso 1..4.
- `.planning/REQUIREMENTS.md` — `CART-01`, `CART-02`, `CART-03`, `CART-04`.
- `.planning/PROJECT.md` — limites do backend MVP, BRL-only, e decisão global de que o estado pré-pagamento vive em `Cart`, `PaymentCollection`, `PaymentSession` e `PaymentAttempt`.
- `.planning/STATE.md` — política de manual-review gate e posição atual da Phase 03.

### Decisões carregadas das fases anteriores
- `.planning/phases/02-catalog-media/02-CONTEXT.md` — contrato público de catálogo, variante vendável/publicável e superfície shopper-facing que a Phase 03 deve reaproveitar.
- `.planning/phases/01-foundation-observability/01-CONTEXT.md` — padrões de middleware, logging/redaction e contrato operacional já estabelecidos para rotas backend.

### Arquitetura e riscos do produto
- `.planning/research/ARCHITECTURE.md` — posição do cart como estado pré-Order e ordem rígida entre checkout, webhook, Order e fulfillment.
- `.planning/research/PITFALLS.md` — anti-pattern de criar `Order` em `completeCart` e necessidade de manter checkout desacoplado da criação de Order.
- `.planning/research/STACK.md` — contrato Medusa v2, BRL/Brasil e limites da arquitetura em torno de cart/payment/order.

### Documentos canônicos do produto
- `docs/PRD_Backend_v1.1.md` — contrato funcional do backend MVP e alinhamento com o storefront futuro.
- `docs/DB_MODEL_v1.21.md` — modelo canônico em que o estado pré-pagamento vive antes de `Order`.
- `docs/SRS_v1.5.md` — requisitos funcionais e fronteiras do MVP backend.
- `docs/PRD_frontend_v1.1.md` — referência futura de consumo para o contrato do checkout/backend.
- `docs/seed/GSD_BACKEND_MVP_SEED.md` — invariantes arquiteturais centrais do produto.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/backend/src/api/middlewares.ts` — já concentra middlewares HTTP, correlation ID, error handling e hooks de extensão para rotas Store/Admin; é um ponto natural para wiring de validação do checkout.
- `apps/backend/src/api/store/products/query-config.ts` — mostra o padrão atual para moldar a Store API via query config mínima.
- `apps/backend/src/api/store/products/serializers.ts` — já expõe a fronteira shopper-facing baseada em variantes vendáveis/publicáveis da Phase 02; essa é a base para definir “itens válidos” no cart.
- `apps/backend/src/api/admin/products/validators.ts` — exemplo atual de mensagens seguras/operacionais sem vazamento de detalhes internos.
- `apps/backend/medusa-config.ts` — ponto central da configuração Medusa já estabilizada em torno de BRL/infra atual.

### Established Patterns
- A codebase já favorece **extensão mínima da Store API padrão** em vez de superfícies custom desnecessárias.
- A fronteira pública do catálogo já filtra variantes não vendáveis; a Phase 03 deve **reutilizar** essa fronteira em vez de revalidar profundamente Gelato no checkout.
- Middlewares e validações devem seguir os padrões de **mensagens seguras e saneadas** herdados da Phase 01.
- O projeto já trata estados críticos do money path como fases posteriores; a Phase 03 deve permanecer estritamente **pré-Order**.

### Integration Points
- `apps/backend/src/api/store` — superfície natural para rotas de cart/checkout e campos calculados como `checkout_data_complete`.
- `apps/backend/src/api/middlewares.ts` — local provável para aplicar validações/normalizações transversais em endpoints de cart/checkout.
- Core Medusa cart/customer/address flows — devem ser estendidos sem quebrar a decisão global de não criar `Order` nesta fase.
- Fronteira de catálogo da Phase 02 — fonte de verdade para disponibilidade pública e vendabilidade dos line items aceitos no cart.

</code_context>

<specifics>
## Specific Ideas

- O comportamento de attach no login deve privilegiar o **estado pré-Order mais recente e explícito da sessão atual**, sem merge complexo no MVP.
- A identidade do customer autenticado e o destinatário do envio permanecem conceitos separados: email vem do `customer`, enquanto nome/endereço/documento representam o destinatário.
- O contrato Brasil/Gelato do endereço precisa carregar **CPF/CNPJ do destinatário já na Phase 03**, mas sem empurrar validação externa ou semântica postal pesada para dentro desta fase.
- `checkout_data_complete` deve ser pensado como **sinal derivado de prontidão de dados**, nunca como “checkout finalizado”.

</specifics>

<deferred>
## Deferred Ideas

- Merge avançado de carts (mescla de linhas, resolução explícita de conflito, múltiplos carts por customer) — fase futura se houver necessidade real.
- Telefone obrigatório, validação postal externa e checks fortes de entregabilidade — fase futura de hardening/logística, não nesta Phase 03.
- Qualquer semântica persistida de “ready for payment” — avaliar apenas se uma fase futura realmente precisar disso.
- Revalidação profunda de snapshot/fulfillment no checkout — permanece reservada para as fases de `Order` e Gelato.

</deferred>

---

*Phase: 3-Cart & Checkout (pre-Order)*
*Context gathered: 2026-06-27*
