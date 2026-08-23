# Phase 16: Cart Merge & Review - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22T21:49:13-03:00
**Phase:** 16-Cart Merge & Review
**Areas discussed:** Destino e outcomes, Merge parcial, Estado de revisão, Idempotência e depreciação

---

## Destino e outcomes

| Option | Description | Selected |
|--------|-------------|----------|
| Carrinho Customer como destino | Customer cart permanece canônico e recebe os itens guest. | ✓ |
| Carrinho guest como destino | Guest cart seria promovido e o Customer cart superseded. | |
| Preservar carrinho Customer | Nenhum conteúdo guest seria incorporado. | |

**User's choice:** Carrinho Customer como destino.
**Notes:** Com dois carts válidos e com itens, o Customer é destino e o guest é origem. A Phase 16 deve substituir a promoção simples do attach por merge verdadeiro.

### Customer cart canônico utilizável

| Option | Description | Selected |
|--------|-------------|----------|
| Promover guest sem Customer utilizável | Guest elegível vira/associa-se ao Customer e retorna `GUEST_CART_ATTACHED`. | ✓ |
| Tratar Customer vazio como não utilizável | Guest seria promovido mesmo havendo Customer vazio. | |
| Falhar fechado em qualquer ausência | Não promover o guest. | |

**User's choice:** Promover/associar guest somente quando não existe Customer cart canônico utilizável; Customer vazio continua utilizável.
**Notes:** Customer ativo vazio recebe merge e produz `MERGED`/`MERGED_PARTIAL`. Zero itens incorporáveis produz `NO_ITEMS` sem consumir capability.

### Múltiplos Customer carts

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-closed em ambiguidade | Sem autoridade inequívoca, nenhum merge executa. | ✓ |
| Mais recentemente atualizado | `updated_at DESC` decide o destino. | |
| Marcador/registro canônico obrigatório agora | Exigir novo mecanismo antes de qualquer merge. | |

**User's choice:** Fail-closed em ambiguidade.
**Notes:** `updated_at` não é autoridade. Um novo marcador pode ser uma implementação pesquisada, mas não foi fixado neste CONTEXT.

### `CUSTOMER_CART_PRESERVED`

| Option | Description | Selected |
|--------|-------------|----------|
| Regra de domínio explícita | Customer permanece intacto apenas por regra determinística previamente aprovada. | ✓ |
| Compatibilidade do attach legado | Usar como no-op legado. | |
| Nunca emitir na Phase 16 | Manter somente como valor contratual futuro. | |

**User's choice:** Somente por regra de domínio explícita.
**Notes:** Não há gatilho concreto aprovado; não inventar um. Não usar para ausência, `NO_ITEMS`, anomalia, erro técnico ou conflito.

---

## Merge parcial

| Option | Description | Selected |
|--------|-------------|----------|
| Clamp em 99 e rejeitar excedente | Incorporar o que couber e rejeitar somente a parte excedente. | ✓ |
| Rejeitar linha guest inteira | Manter a quantidade Customer e rejeitar toda a linha. | |
| Rejeitar merge inteiro | Qualquer overflow aborta todas as incorporações. | |

**User's choice:** Incorporar até 99 e rejeitar somente o excedente.
**Notes:** A quantidade Customer nunca é reduzida. Overflow localizado produz `MERGED_PARTIAL`; `rejectedItems` registra as quantidades aceita/rejeitada.

### Todos os itens rejeitados

| Option | Description | Selected |
|--------|-------------|----------|
| `NO_ITEMS` com `rejectedItems` | Nenhum efeito estrutural e capability preservada. | ✓ |
| `MERGED_PARTIAL` com zero aceitos | Tratar tentativa sem aceitação como partial. | |
| Erro de domínio | Não retornar outcome normal. | |

**User's choice:** `NO_ITEMS` com `rejectedItems`.
**Notes:** `MERGED_PARTIAL` significa alguma aceitação e alguma rejeição; zero incorporado não é merge estrutural.

### Conteúdo de `rejectedItems`

| Option | Description | Selected |
|--------|-------------|----------|
| Identificador seguro + quantidades + código fechado | Variante pública segura, quantidades e reason code sem snapshot de catálogo. | ✓ |
| Posição da linha + motivo | Não expõe identificador de variante. | |
| Snapshot exibível | Inclui título/dados para renderização direta. | |

**User's choice:** Identificador público seguro + `requestedQuantity`, `acceptedQuantity`, `rejectedQuantity` e reason code fechado.
**Notes:** Reasons: `VARIANT_INVALID`, `VARIANT_UNAVAILABLE`, `QUANTITY_LIMIT_EXCEEDED`. No provider IDs, preços, metadata, estoque ou mensagens técnicas.

### Linhas guest duplicadas

| Option | Description | Selected |
|--------|-------------|----------|
| Agrupar por variante | Somar intenção guest antes de aplicar o limite e produzir no máximo uma rejeição por variante. | ✓ |
| Processar linha por linha | Preservar a granularidade física. | |
| Falhar fechado | Tratar duplicidade como estado inválido. | |

**User's choice:** Agrupar por variante antes do merge.
**Notes:** O resultado deve ser determinístico e independente da ordem das linhas.

---

## Estado de revisão

| Option | Description | Selected |
|--------|-------------|----------|
| Somente em `MERGED_PARTIAL` | Review corresponde à alteração efetiva incompleta do Customer cart. | ✓ |
| Qualquer resultado com rejeições | Persistir review também em `NO_ITEMS`. | |
| Somente disponibilidade/validade | Overflow não exigiria acknowledge. | |

**User's choice:** `requiresReview=true` se e somente se `outcome=MERGED_PARTIAL`.
**Notes:** Overflow também exige review. `NO_ITEMS` retorna informação de rejeição, mas não altera nem bloqueia o Customer cart por review.

### Vínculo do acknowledge

| Option | Description | Selected |
|--------|-------------|----------|
| Versão/fingerprint atual | Acknowledge reconhece somente o resultado específico do merge parcial. | ✓ |
| Até o próximo merge | Mutações comuns preservariam o acknowledge. | |
| Independente da versão | Acknowledge sobreviveria a qualquer mutação. | |

**User's choice:** Acknowledge vinculado à revisão/versionamento específico.
**Notes:** Stale `If-Match` retorna 412 e mantém review. Mutação posterior invalida a aplicabilidade anterior, mas não reativa review automaticamente.

### Contrato público

| Option | Description | Selected |
|--------|-------------|----------|
| Estado explícito e fechado | Cart, `requiresReview`, `reviewRef`, `rejectedItems` e ETag no header. | ✓ |
| Somente review boolean/rejeições | Versão ficaria implícita no ETag. | |
| Auditoria detalhada | Expor histórico e metadados adicionais. | |

**User's choice:** Estado explícito e fechado.
**Notes:** `reviewRef` é opaco e identifica a revisão, não o cart. Não expor histórico, hashes, actor IDs, timestamps ou detalhes internos.

### Acknowledge repetido/sem pendência

| Option | Description | Selected |
|--------|-------------|----------|
| No-op idempotente | Repetição retorna estado atual sem bump; ausência de review também é no-op. | ✓ |
| Conflito sem review | Toda ausência seria erro. | |
| Falha sempre que referência não estiver pendente | Repetição seria precondition failure. | |

**User's choice:** No-op idempotente com validação estrita de versão e identidade da revisão.
**Notes:** ReviewRef divergente/desconhecido falha fechado; capability consumida não pode ser usada como replay arbitrário.

---

## Idempotência e depreciação

| Option | Description | Selected |
|--------|-------------|----------|
| Operação + Customer + guest + destino | Fingerprint inclui carts, versões e intenção normalizada. | ✓ |
| Operação + Customer | Não distingue suficientemente guest/destino. | |
| Operação + guest capability | Não vincula destino e Customer adequadamente. | |

**User's choice:** Operação + Customer + guest cart + Customer cart destino.
**Notes:** `customerCartId=null` entra no fingerprint quando guest é promovido. Capability plaintext não entra.

### Replay após consumo

| Option | Description | Selected |
|--------|-------------|----------|
| Replay pelo registro idempotente | Resultado COMMITTED é reproduzido sem reexecutar merge. | ✓ |
| Exigir capability ativa | Retry pós-commit falharia por capability consumida. | |
| Reconstruir pelo estado atual | Não dependeria do registro original. | |

**User's choice:** Replay pelo registro de idempotência.
**Notes:** Customer JWT/BFF continuam obrigatórios; capability consumida só vale como prova de replay compatível, nunca para nova execução.

### Depreciação do attach

| Option | Description | Selected |
|--------|-------------|----------|
| Adaptador controlado para merge | Só delega quando satisfaz o contrato novo; sessão legada não muta. | ✓ |
| Preservar attach legado | Manter transferência sem merge durante a janela. | |
| Desativar imediatamente | Retornar erro deprecado para tudo. | |

**User's choice:** Adaptador controlado sem semântica própria.
**Notes:** Fora do contrato M1; sessão legada recebe erro estável sem mutação. Remoção final fica para PLAN posterior.

### Concorrência com chaves diferentes

| Option | Description | Selected |
|--------|-------------|----------|
| Serializar e reavaliar | Uma tentativa vence; a seguinte relê sob autoridade e falha sem reaplicar. | ✓ |
| Rejeitar por versão | Perdedor recebe 412 sem reavaliação. | |
| Merges por variante | Permitir efeitos concorrentes mais granulares. | |

**User's choice:** Serializar e reavaliar sob autoridade transacional.
**Notes:** Chaves diferentes nunca herdam replay. 412 é precondição stale; 409 é conflito de estado como capability consumida, sujeito à confirmação de contrato no RESEARCH/PLAN.

---

## the agent's Discretion

- Nenhuma discricionariedade foi delegada para mudar outcomes, authority,
  capability, review, idempotência, concorrência, rollback ou Order boundary.
- A técnica física, os schemas exatos e o mapeamento final de status HTTP podem
  ser comparados em RESEARCH/PLAN autorizado.

## Deferred Ideas

- Regra concreta para `CUSTOMER_CART_PRESERVED` — deliberadamente não inventada; RESEARCH/PLAN.
- Data/gate de remoção final do attach após a fase de adaptação — PLAN posterior.
