---
phase: 2
slug: catalog-media
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-26
---

# Fase 2 - Estrategia de Validacao

> Contrato de validacao por fase para amostragem continua durante a execucao.

---

## Infraestrutura de Testes

| Propriedade | Valor |
|-------------|-------|
| **Framework** | Jest 29.7.x + `@medusajs/test-utils` 2.16.0 |
| **Comando unitario** | `cd apps/backend && npm run test:unit -- --runTestsByPath <arquivo>` |
| **Comando HTTP** | `cd apps/backend && npm run test:integration:http -- --runTestsByPath <arquivo>` |
| **Build** | `cd apps/backend && npm run build` |
| **Meta por check direcionado** | inferior a 30 segundos |
| **Gate completo** | build + suites direcionadas da wave correspondente |

---

## Taxa de Amostragem

- **Apos cada tarefa:** executar apenas o comando literal da linha correspondente.
- **Apos cada wave com codigo/config:** executar `cd apps/backend && npm run build`.
- **Apos waves que fecham contrato HTTP:** executar tambem a suite `integration:http` do arquivo da wave.
- **Antes de `$gsd-verify-work`:** build + suites unitarias/integradas desta fase + smokes manuais externos devem estar verdes.

---

## Mapa de Verificacao por Tarefa

| Task ID | Plano | Wave | Requisito | Comportamento seguro | Tipo | Comando automatizado | Arquivo existe | Status |
|---------|-------|------|-----------|----------------------|------|----------------------|----------------|--------|
| 02-01-01 | 01 | 1 | CAT-02, CAT-04 | Helper central reconhece metadata Gelato completa/incompleta sem acesso espalhado a `variant.metadata.gelato_*` | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts -t "parse\\|sellable\\|BRL"` | ❌ slice 01 | ⬜ pending |
| 02-01-02 | 01 | 1 | CAT-01, CAT-02 | Erros tipados distinguem draft incompleto de variante vendavel invalida | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts -t "typed error\\|draft\\|required"` | ❌ slice 01 | ⬜ pending |
| 02-02-01 | 02 | 2 | CAT-02 | Update/create/publish falham com mensagem clara quando tentam tornar variante vendavel sem contrato Gelato valido | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts -t "create\\|update\\|publish\\|gelato"` | ❌ slice 02 | ⬜ pending |
| 02-02-02 | 02 | 2 | CAT-02, CAT-03 | Variantes invalidas continuam permitidas como draft e `is_sellable` e calculado de forma deterministica | unit + integration | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts -t "is_sellable" && cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts -t "draft"` | ❌ slice 02 | ⬜ pending |
| 02-03-01 | 03 | 2 | MEDIA-01 | Provider oficial e bucket S3-compatible do Supabase sao aprovados antes de instalar/configurar | supply-chain gate | `npm view @medusajs/file-s3@2.16.0 version repository.url` | n/a | ⬜ pending |
| 02-03-02 | 03 | 2 | MEDIA-01 | Schema de env falha cedo sem vars obrigatorias de storage em production | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts -t "storage\\|s3\\|supabase"` | ❌ slice 03 | ⬜ pending |
| 02-03-03 | 03 | 2 | MEDIA-01 | Medusa aponta para URLs publicas do bucket, sem binario no banco e sem provider custom | build + config contract | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts -t "storage\\|public url" && cd apps/backend && npm run build` | apos 02-03-02 | ⬜ pending |
| 02-04-01 | 04 | 3 | CAT-03, MEDIA-01 | `/store/products` expone shape estavel shopper-facing com BRL, imagens e sem `gelato_*` | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts -t "store products\\|shape\\|gelato"` | ❌ slice 04 | ⬜ pending |
| 02-04-02 | 04 | 3 | CAT-02, CAT-03 | Variantes nao vendaveis nao aparecem publicamente | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts -t "is_sellable\\|hidden invalid"` | ❌ slice 04 | ⬜ pending |
| 02-05-01 | 05 | 3 | CAT-04 | Snapshot builder gera objeto imutavel a partir de variante validada com `id` e `sku` | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts -t "snapshot\\|immutable\\|captured_at"` | ❌ slice 05 | ⬜ pending |
| 02-05-02 | 05 | 3 | CAT-04 | Metadata ausente/invalida nunca gera snapshot parcial; erro tipado e deterministico | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts -t "missing\\|invalid\\|typed error"` | ❌ slice 05 | ⬜ pending |
| 02-05-03 | 05 | 3 | CAT-04 | Contrato documentado para a Phase 6 consome exatamente o mesmo shape validado nesta fase | unit + doc check | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts && cd apps/backend && npm run build` | apos 02-05-02 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Gates de Wave e Fase

| Gate | Momento | Comando literal |
|------|---------|-----------------|
| Build da wave 1 | Apos 02-01 | `cd apps/backend && npm run build && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts` |
| Gate da wave 2 | Apos 02-02 e 02-03 | `cd apps/backend && npm run build && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts` |
| Gate da wave 3 | Apos 02-04 e 02-05 | `cd apps/backend && npm run build && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts` |
| Gate final da fase | Antes de `$gsd-verify-work` | `cd apps/backend && npm run build && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts src/config/__tests__/env.unit.spec.ts && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts integration-tests/http/catalog-store.spec.ts` |

---

## Verificacoes Exclusivamente Manuais

| Comportamento | Requisito | Por que e manual | Instrucoes |
|---------------|-----------|------------------|------------|
| Upload real de imagem no Admin para Supabase Storage | MEDIA-01 | Depende de bucket, credenciais e superficie Admin reais | Fazer upload de uma imagem de produto em ambiente autorizado, confirmar persistencia no bucket publico e URL retornada pela API sem binario no Postgres. |
| Mensagem de erro no Admin ao tentar publicar variante invalida | CAT-02 | UX real depende do fluxo do Admin | Tentar publicar produto/variante sem `gelato_*` obrigatorios e confirmar erro claro, sem stack cru nem vazamento de metadata sensivel. |
| Contrato publico do catalogo para storefront futuro | CAT-03 | Requer inspecao humana do payload | Consultar `/store/products` com produto valido e confirmar shape shopper-facing estavel, sem `gelato_*`, com preco BRL e imagens publicas. |

---

## Aprovacao da Validacao

- [x] A fase foi quebrada em 5 slices pequenas e revisaveis.
- [x] Nenhuma tarefa depende de migrations, deploy ou persistencia de Order.
- [x] O gate manual externo continua exigido antes de executar qualquer slice.
- [x] `nyquist_compliant: true` definido no frontmatter.

**Aprovacao:** pendente ate revisao humana do plano.
