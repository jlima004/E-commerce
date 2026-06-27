# Gelato Snapshot Contract v1

## Objetivo

Congelar o shape imutável de `gelato_snapshot` que a Phase 6 deverá persistir em `LineItem.metadata.gelato_snapshot`, sem reinterpretar campos e sem reler `ProductVariant.metadata` no momento do fulfillment.

## Fonte de verdade

- O builder canônico desta fase é `buildGelatoSnapshot` em [apps/backend/src/modules/catalog/gelato-snapshot.ts](/home/jlima/Projetos/ecommerce/Backend/apps/backend/src/modules/catalog/gelato-snapshot.ts).
- A validação obrigatória de metadata continua centralizada em `assertSellableVariantMetadata` de `gelato-metadata.ts`.
- Este contrato reaproveita exatamente o gate de `02-02`; metadata ausente ou inválida não gera snapshot parcial.

## Payload canônico

```ts
type GelatoSnapshot = {
  gelato_product_uid: string
  gelato_template_id: string
  gelato_variant_options: {
    size: string
    color: string
  }
  template_mode: "fixed"
  source_product_variant_id: string
  source_product_variant_sku: string
  captured_at: string
}
```

## Semântica dos campos

- `gelato_product_uid`: produto Gelato efetivamente vendido.
- `gelato_template_id`: template Gelato fixo usado para produção.
- `gelato_variant_options`: opções produtivas congeladas no momento da captura.
- `template_mode`: sempre `"fixed"` no MVP.
- `source_product_variant_id`: ID da variante Medusa de origem no momento da captura.
- `source_product_variant_sku`: SKU da variante no momento da captura.
- `captured_at`: timestamp ISO-8601 UTC gerado pelo builder.

## Regras de consumo para a Phase 6

- Persistir o objeto sem renomear campos e sem enriquecer o shape.
- Usar o snapshot persistido no `LineItem` para fulfillment e reprocessamentos.
- Não voltar a consultar `ProductVariant.metadata` para pedidos já confirmados.
- Se o builder lançar erro, bloquear criação do snapshot e tratar a falha no fluxo de Order/fulfillment.

## Fora do escopo desta fase

- Persistência em `Order` ou `LineItem`.
- Migrations.
- Deploy.
- Alteração de secrets ou config vars.
