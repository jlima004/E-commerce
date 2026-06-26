# Phase 2: Catalog & Media - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning (manual-review gated — see Manual Gate below)

<domain>
## Phase Boundary

Permitir que operadores modelem produtos/variantes com preço em BRL (centavos inteiros) carregando metadados Gelato obrigatórios, com imagens de produto no Supabase Storage, expostos como um contrato de API de catálogo estável para o futuro storefront — e entregar um **snapshot builder/helper/contract** Gelato pronto para a criação de Order na Phase 6.

**No escopo desta fase:**
- (a) Definição dos metadados Gelato obrigatórios na variante.
- (b) Validação de variantes vendáveis com `gelato_*` obrigatórios.
- (c) Referências de imagem em Supabase Storage (sem binários no banco).
- (d) Contrato de API de catálogo estável (Store API do Medusa).
- (e) Snapshot builder/helper/contract puro para consumo futuro (Phase 6).
- (f) Unit tests do snapshot builder.

**Fora do escopo (verificado/realizado depois):**
- Persistência real de `LineItem.metadata.gelato_snapshot` — só existe e é verificada na **Phase 6**, onde a criação de Order existe. Nesta fase NÃO se grava nada em Order/LineItem.
- Carrinho, checkout, pagamento, criação de Order (Phases 3+).

</domain>

<decisions>
## Implementation Decisions

### Modelagem dos metadados Gelato
- **D-01:** Os campos `gelato_*` são armazenados em `ProductVariant.metadata` (JSON nativo do Medusa). Não criar módulo custom nem `defineLink` nesta fase.
- **D-02:** Todo acesso (leitura e escrita) aos `gelato_*` passa por um helper/service/schema **tipado central**. Proibido acessar `variant.metadata.gelato_*` diretamente fora desse ponto. Isso preserva um caminho de migração futura para módulo/link custom sem tocar nos callers; migrar só se aparecer limitação objetiva.
- **D-03:** O contrato obrigatório segue integralmente `docs/DB_MODEL_v1.21.md §4.11` (sem "minimal core"), para que a validação da Phase 02 e o contrato de consumo da Phase 6 sejam idênticos.
- **D-04:** Campos informados pelo operador e exigidos para variante vendável: `gelato_product_uid`, `gelato_template_id`, `gelato_variant_options`, `template_mode="fixed"`.
- **D-05:** Campos derivados pelo snapshot builder no momento de montar o snapshot (não digitados manualmente): `source_product_variant_id`, `source_product_variant_sku`, `captured_at`.

### Validação de variante vendável
- **D-06:** Drafts incompletos são permitidos — o operador pode salvar variantes sem o contrato completo.
- **D-07:** Uma variante incompleta/inválida é **bloqueada no gate de sellable/publishable**: não pode tornar-se vendável/publicada sem o contrato `gelato_*` completo e válido.
- **D-08:** A garantia dura é um **workflow hook + typed validator** no fluxo de create/update/publish de produto/variante, lançando erro de validação claro exibido no Admin.
- **D-09:** Há também um check read-time `is_sellable` (computado) usado pela API de catálogo para **nunca expor publicamente** uma variante inválida/não-vendável.
- **D-10:** O snapshot builder também falha se a metadata estiver ausente/inválida (reforço do invariante de fulfillability — ver D-19).

### Mídia (imagens de produto)
- **D-11:** Usar o File Module provider oficial `@medusajs/file-s3` apontando para o endpoint S3-compatible do Supabase Storage (bucket/region/endpoint/keys via env). Caminho de menor manutenção.
- **D-12:** Não criar File Module provider custom via `@supabase/supabase-js` nesta fase (revisitar só sob limitação objetiva).
- **D-13:** Imagens de produto do catálogo são **públicas** no MVP: bucket público + **public bucket URLs** expostas na API. Cacheáveis, sem signing.
- **D-14:** Nenhum binário é armazenado no Postgres — apenas referências de URL.
- **D-15:** Signed/expiring URLs ficam fora do escopo desta fase (consideração futura para assets privados / RLS-aware uploads).

### Contrato de API de catálogo
- **D-16:** Estender a **Store API padrão do Medusa**, especialmente `/store/products` e rotas relacionadas, com query config/extension **mínima** para adicionar somente os campos necessários ao catálogo. Não criar rotas custom de catálogo agora (evita reimplementar paginação/filtros/convenções).
- **D-17:** `gelato_*` **não** é exposto no payload público da Store API — é wiring interno de fulfillment, **admin/internal only**, acessível ao backend para snapshot/fulfillment futuro.
- **D-18:** A API pública expõe apenas dados shopper-facing: produto, imagens, preço BRL (centavos inteiros), opções visíveis (ex.: tamanho/cor), SKU/IDs seguros quando necessário e status vendável (`is_sellable`).

### Snapshot builder (contrato para a Phase 6)
- **D-19:** Implementar um **helper/função puro, tipado e unit-tested**, sem persistência e sem acoplamento a lifecycle de service/module. Entrada: uma `ProductVariant` validada (incluindo `id` e `sku`). Saída: objeto `gelato_snapshot` **imutável** compatível com `DB_MODEL §4.11`.
- **D-20:** Em metadata ausente/inválida, o builder **lança erro tipado e claro** — nunca produz snapshot parcial/inválido. No futuro (Phase 6) esse erro mapeia para bloqueio de fulfillment / `requires_attention`.
- **D-21:** Nesta fase o builder **não grava** em Order/LineItem. A **Phase 6** consumirá esse helper, sem alterar o contrato, para persistir `LineItem.metadata.gelato_snapshot` no momento da criação do Order.

### Claude's Discretion
- A escolha de validação (D-06..D-09) foi confirmada como default por minha decisão (a pergunta foi pulada na discussão) e depois ratificada explicitamente pelo usuário. Detalhes finos — nome exato do helper/service de metadados, nomes de rotas/handlers, estrutura concreta do schema de validação, e wiring exato do `@medusajs/file-s3` (nomes de env, bucket, region) — ficam a critério da pesquisa/plano, com defaults conservadores e preservando integralmente os contratos acima.
- Versões de pacotes devem permanecer alinhadas ao conjunto `@medusajs/*` 2.15.x já instalado.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Escopo e requisitos
- `.planning/ROADMAP.md` §"Phase 2: Catalog & Media" — objetivo, scope note, e critérios de sucesso (1..5).
- `.planning/REQUIREMENTS.md` — CAT-01, CAT-02, CAT-03, CAT-04, MEDIA-01 (e CAT-04 cujo snapshot imutável é consumido na Phase 6).
- `.planning/PROJECT.md` — limites do backend MVP, BRL single-currency, segurança e decisões globais.
- `.planning/STATE.md` — política de revisão manual e posição atual (Phase 02 = próximo ciclo manual, não iniciado).

### Contrato canônico do snapshot Gelato (núcleo desta fase)
- `docs/DB_MODEL_v1.21.md` §4.11 "LineItem — Snapshot Gelato" — campos obrigatórios, finalidade e regras (snapshot imutável, derivado da metadata da variante, falha bloqueia fulfillment).
- `docs/DB_MODEL_v1.21.md` §2.12 "Snapshot Gelato no LineItem" — regra de imutabilidade pós-criação de Order.

### Documentos canônicos do produto
- `docs/PRD_Backend_v1.1.md` — modelagem de catálogo, metadados Gelato obrigatórios, contrato de API para storefront futuro.
- `docs/SRS_v1.5.md` — requisitos de catálogo/mídia e segurança.
- `docs/DB_MODEL_v1.21.md` — restrições gerais (não expor secrets/tokens/payloads sensíveis; integridade de dados de catálogo).

### Arquitetura, stack e riscos
- `.planning/research/STACK.md` — `@medusajs/file-s3` → Supabase Storage S3 endpoint; versões `@medusajs/*` 2.15.x; BRL end-to-end.
- `.planning/research/ARCHITECTURE.md` — fase "Catálogo & mídia" como pré-requisito de carrinho e fulfillment; metadados Gelato obrigatórios nas variantes.
- `.planning/research/PITFALLS.md` — BRL/centavos inteiros (minor units), armadilhas de catálogo/preço.

### Decisões prévias relevantes (Phase 01)
- `.planning/phases/01-foundation-observability/01-CONTEXT.md` — redaction/observabilidade ativas; nada de secrets/tokens/payloads em logs; runtime Heroku/Supabase/Redis.
- `.planning/phases/01-foundation-observability/01-CLOSURE.md` — gate manual e checkpoint de produção validado.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/backend/` — app Medusa v2 já scaffolded e em produção (Heroku/Supabase/Redis) na Phase 01. Estrutura existente: `src/modules`, `src/api/store`, `src/api/admin`, `src/api/store/custom`, `src/api/admin/custom`, `src/workflows`, `src/links`, `src/subscribers`, `src/jobs`, `src/config`, `src/infrastructure`, `src/observability`.
- `apps/backend/src/modules/README.md` — placeholder; ainda não há módulos de negócio. Catálogo usa entidades core do Medusa (Product/ProductVariant), então não se espera um módulo custom nesta fase (ver D-01).
- Logger estruturado + redaction da Phase 01 já disponíveis para qualquer log desta fase.

### Established Patterns
- Medusa v2: catálogo via entidades core (Product/ProductVariant); customização via `ProductVariant.metadata` + workflow hooks (D-01, D-08).
- File Module do Medusa para mídia (provider `@medusajs/file-s3`) — sem binários no banco (D-11, D-14).
- Store API padrão estendida por query config mínima, mantendo convenções Medusa (D-16).
- Isolamento de módulos v2 e leitura cross-domain via Query graph permanecem regras do projeto (relevante quando a Phase 6 consumir o builder).

### Integration Points
- `apps/backend/src/modules` — local do helper/service tipado de metadados Gelato e do snapshot builder puro (helper sem persistência).
- `apps/backend/src/workflows` — hook de validação no create/update/publish de produto/variante (D-08).
- `apps/backend/src/api/store` — extensão de query config da Store API para shaping shopper-facing (D-16, D-18).
- `medusa-config.ts` — registro do provider `@medusajs/file-s3` apontando para o endpoint S3 do Supabase (D-11).
- O snapshot builder é o ponto de contrato que a **Phase 6** importará para persistir `LineItem.metadata.gelato_snapshot` (D-21).

</code_context>

<specifics>
## Specific Ideas

- "Hybrid" deliberado: simplicidade de MVP agora (`metadata` nativo) sem fechar a porta para um módulo/link custom depois — desde que todo acesso fique atrás de um ponto tipado central.
- Paridade estrita entre a validação da Phase 02 e o contrato de snapshot da Phase 6 (mesma fonte de verdade, sem divergência).
- "Fail loud": variante não-fulfillable nunca deve ser vendável nem gerar snapshot parcial.
- Fulfillment é wiring interno: o público vê só o que o storefront precisa; `gelato_*` permanece interno.

</specifics>

<deferred>
## Deferred Ideas

- Persistência real de `LineItem.metadata.gelato_snapshot` — Phase 6 (criação de Order).
- File Module provider custom via `@supabase/supabase-js` (signed URLs / RLS-aware uploads) — futura fase, só sob necessidade objetiva.
- Signed/expiring URLs para assets privados — fora do MVP de catálogo público.
- Migração de `gelato_*` de `metadata` para módulo custom + `defineLink` — somente se surgir limitação objetiva (o ponto de acesso tipado mantém isso barato).

</deferred>

---

## Manual Gate

**Phase 02 — Catalog & Media inicia somente em modo manual-review gated.**

- Este documento é apenas a captura de contexto/escopo inicial para revisão humana. Nada além do CONTEXT.md foi produzido.
- Não houve implementação, execução de plano, alteração de código de aplicação, deploy, alteração de secrets/config vars, nem migrations.
- A Phase 02 **não foi iniciada** e **não deve auto-avançar**. A cadeia automática do GSD permanece desligada.
- Próximo passo permitido (somente após revisão humana explícita desta captura): planejar a fase com `/gsd-plan-phase 2`.

---

*Phase: 2-Catalog & Media*
*Context gathered: 2026-06-26*
