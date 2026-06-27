---
phase: 2
slug: catalog-media
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| 02-01-01 | 01 | 1 | CAT-02, CAT-04 | Helper central reconhece metadata Gelato completa/incompleta sem acesso espalhado a `variant.metadata.gelato_*` | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts` | ✅ `apps/backend/src/modules/catalog/gelato-metadata.ts` | ✅ green |
| 02-01-02 | 01 | 1 | CAT-01, CAT-02 | Erros tipados distinguem draft incompleto de variante vendavel invalida | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts` | ✅ `apps/backend/src/modules/catalog/types.ts` | ✅ green |
| 02-02-01 | 02 | 2 | CAT-02 | Update/create/publish falham com mensagem clara quando tentam tornar variante vendavel sem contrato Gelato valido | integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts` | ✅ `apps/backend/integration-tests/http/catalog-admin.spec.ts` | ✅ green |
| 02-02-02 | 02 | 2 | CAT-02, CAT-03 | Variantes invalidas continuam permitidas como draft e `is_sellable` e calculado de forma deterministica | unit + integration | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts` | ✅ `apps/backend/src/workflows/catalog/validate-sellable-variant.ts` | ✅ green |
| 02-03-01 | 03 | 2 | MEDIA-01 | Provider oficial e bucket S3-compatible do Supabase sao aprovados antes de instalar/configurar | supply-chain gate | `npm view @medusajs/file-s3@2.16.0 version repository.url` | n/a | ✅ green |
| 02-03-02 | 03 | 2 | MEDIA-01 | Schema de env falha cedo sem vars obrigatorias de storage em production | unit | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts -t "storage|s3|supabase|public url"` | ✅ `apps/backend/src/config/__tests__/env.unit.spec.ts` | ✅ green |
| 02-03-03 | 03 | 2 | MEDIA-01 | Medusa aponta para URLs publicas do bucket, sem binario no banco e sem provider custom | build + config contract | `cd apps/backend && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts && npm run build` | ✅ `apps/backend/src/infrastructure/storage-config.ts` | ✅ green |
| 02-04-01 | 04 | 3 | CAT-03, MEDIA-01 | `/store/products` expone shape estavel shopper-facing com BRL, imagens e sem `gelato_*` | integration | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts` | ✅ `apps/backend/src/api/store/products/serializers.ts` | ✅ green |
| 02-04-02 | 04 | 3 | CAT-02, CAT-03 | Variantes nao vendaveis nao aparecem publicamente | integration | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts` | ✅ `apps/backend/src/api/store/products/query-config.ts` | ✅ green |
| 02-05-01 | 05 | 3 | CAT-04 | Snapshot builder gera objeto imutavel a partir de variante validada com `id` e `sku` | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts` | ✅ `apps/backend/src/modules/catalog/gelato-snapshot.ts` | ✅ green |
| 02-05-02 | 05 | 3 | CAT-04 | Metadata ausente/invalida nunca gera snapshot parcial; erro tipado e deterministico | unit | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts` | ✅ `apps/backend/src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts` | ✅ green |
| 02-05-03 | 05 | 3 | CAT-04 | Contrato documentado para a Phase 6 consome exatamente o mesmo shape validado nesta fase | unit + doc check | `cd apps/backend && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts && XDG_CONFIG_HOME=/tmp/medusa-config TMPDIR=/tmp HMR_PORT=5173 npm run build` | ✅ `docs/contracts/gelato-snapshot-v1.md` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Gates de Wave e Fase

| Gate | Momento | Comando literal | Resultado registrado |
|------|---------|-----------------|---------------------|
| Build da wave 1 | Apos 02-01 | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts && npm run build` | ✅ 17 testes unitarios PASS + build PASS em `02-01-SUMMARY.md` |
| Gate da wave 2 | Apos 02-02 e 02-03 | `cd apps/backend && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts && npm run build` | ✅ 13 testes HTTP PASS, 17 regressivos PASS, 29 testes de env PASS, build PASS e smoke manual de upload PASS em `02-02-SUMMARY.md`, `02-03-SUMMARY.md` e `02-UAT.md` |
| Gate da wave 3 | Apos 02-04 e 02-05 | `cd apps/backend && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts && HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build && XDG_CONFIG_HOME=/tmp/medusa-config TMPDIR=/tmp HMR_PORT=5173 npm run build` | ✅ 4 testes HTTP PASS, 6 testes unitarios PASS e builds PASS com workarounds de sandbox registrados em `02-04-SUMMARY.md` e `02-05-SUMMARY.md` |
| Gate final da fase | Antes de `$gsd-verify-work` | `cd apps/backend && npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-metadata.unit.spec.ts && npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-admin.spec.ts && npm run test:unit -- --runTestsByPath src/config/__tests__/env.unit.spec.ts && TMPDIR=/tmp npm run test:integration:http -- --runTestsByPath integration-tests/http/catalog-store.spec.ts && TMPDIR=/tmp npm run test:unit -- --runTestsByPath src/modules/catalog/__tests__/gelato-snapshot.unit.spec.ts` | ✅ Evidencia consolidada no `02-UAT.md`: 5/5 planos verificados, 0 issues pendentes e gate manual humano ainda obrigatorio |

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

**Aprovacao:** validacao reconciliada com a execucao real dos planos 02-01..02-05; fechamento da Phase 02 continua bloqueado no gate manual humano.
