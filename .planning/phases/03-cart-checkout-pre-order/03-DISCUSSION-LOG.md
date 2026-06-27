# Phase 3: Cart & Checkout (pre-Order) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-27
**Phase:** 3-Cart & Checkout (pre-Order)
**Areas discussed:** Ownership e ciclo de vida do cart, Identidade no checkout, Contrato mínimo de shipping address, Limite exato do checkout sem Order

---

## Ownership e ciclo de vida do cart

| Option | Description | Selected |
|--------|-------------|----------|
| Um único cart ativo por ator | Guest tem 1 cart ativo; customer autenticado tem 1 cart ativo; no login, o cart guest é anexado ao customer e passa a ser o cart ativo. | ✓ |
| Um único cart ativo por customer com merge | No login, tenta mesclar linhas do cart guest com o cart já ativo do customer. | |
| Cart do customer sempre vence | Se já existir cart ativo do customer, o guest cart é descartado. | |
| Outro | Resposta livre. | |

**User's choice:** Um único cart ativo por ator; no login, o cart guest da sessão atual vence, é anexado ao customer e passa a ser o único cart ativo do customer.
**Notes:** Sem merge complexo e sem descarte silencioso. Se houver cart anterior do customer, ele deixa de ser ativo, mas não é deletado. Se não houver guest cart, o cart do customer segue como fonte de verdade. Se o guest cart estiver vazio, preserva-se o cart útil já existente do customer. O cart permanece livremente editável em estado pré-Order.

---

## Identidade no checkout

| Option | Description | Selected |
|--------|-------------|----------|
| Email da conta é a fonte de verdade | `customer.email` é usado no checkout autenticado e não pode ser sobrescrito. | ✓ |
| Email do cart pode sobrescrever | O checkout autenticado começa com o email da conta, mas aceita email divergente no cart. | |
| Backend exige igualdade rígida com bloqueio explícito | Divergência entre email do customer e do cart bloqueia avanço. | |
| Outro | Resposta livre. | |

**User's choice:** Para customer autenticado, o email da conta é a fonte de verdade e não pode ser sobrescrito.
**Notes:** Guest pode usar cart sem email e só precisa de email válido para o checkout ficar completo. Se um guest cart com email for anexado a um customer autenticado, o email do cart é normalizado para `customer.email`. Nome, telefone e endereço podem representar o destinatário, mas não substituem a identidade/email do customer autenticado.

---

## Contrato mínimo de shipping address

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo operacional enxuto | `full_name`, `address_1`, `city`, `province/state`, `postal_code`, `country_code=BR`. | |
| Mínimo + telefone obrigatório | Endereço mínimo com `phone` obrigatório. | |
| Mínimo + telefone e complemento obrigatórios | Endereço mínimo com `phone` e `address_2/complement`. | |
| Outro | Mínimo Brasil/Gelato enxuto com documento fiscal do destinatário, mas sem telefone nem complemento obrigatórios. | ✓ |

**User's choice:** Adotar mínimo Brasil/Gelato enxuto com `federal_tax_id` obrigatório (CPF ou CNPJ do destinatário).
**Notes:** Obrigatórios para checkout completo: `full_name`, `address_1`, `city`, `province/state`, `postal_code`, `country_code=BR`, `federal_tax_id`. Opcionais: `phone`, `address_2/complement`, `company`, `state_tax_id`. Validação nesta fase é estrutural e com normalização: CEP para 8 dígitos, CPF/CNPJ com dígitos verificadores, `province/state` preferencialmente em UF brasileira, sem validação externa de endereço ou entregabilidade.

---

## Limite exato do checkout sem Order

| Option | Description | Selected |
|--------|-------------|----------|
| `checkout_data_complete` como estado positivo | Cart com itens, email e shipping válidos; pronto para a próxima fase, sem pagamento. | |
| `ready_for_payment` explícito | Estado nominal novo no cart, ainda sem pagamento. | |
| Sem novo estado persistido | Prontidão do checkout é apenas condição derivada do cart atual. | ✓ |
| Outro | Resposta livre. | |

**User's choice:** Não persistir novo estado nominal no cart; `checkout_data_complete` pode existir só como condição derivada/campo calculado.
**Notes:** `checkout_data_complete = true` somente quando houver itens válidos, email válido, shipping válido conforme contrato Brasil/Gelato, `country_code=BR` e região/moeda BRL. A condição é recalculada a cada mudança. Não cria `Order`, `PaymentAttempt`, Stripe/Pix, webhook ou fulfillment. “Itens válidos” significam pelo menos um line item com quantidade positiva e variante vendável/publicável conforme a fronteira de catálogo da Phase 02, no contexto BR/BRL.

---

## the agent's Discretion

- Nenhuma decisão principal foi delegada ao agente; a discrição restante é apenas de naming técnico, shape de resposta e wiring interno no plano/pesquisa.

## Deferred Ideas

- Merge avançado entre guest cart e customer cart.
- Resolução explícita de conflitos entre carts.
- Telefone obrigatório e validação postal externa.
- Estado persistido futuro equivalente a “ready for payment”.
