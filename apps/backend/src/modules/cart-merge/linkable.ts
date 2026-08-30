export type CartMergeLinkableSource = {
  linkable: string
  primaryKey: string
  serviceName: string
  field: string
  entity: string
  alias?: string
}

/**
 * Converts an explicit CartMerge foreign-reference linkable into a source
 * whose persisted identity is still the CartMerge record ID. The role-specific
 * linkable key and alias distinguish guest/customer/canonical associations in
 * Medusa's link registry without adding a database foreign key.
 */
export function cartMergeForeignLinkable(
  modelLinkables: Record<string, CartMergeLinkableSource>,
  property: string,
  alias: string
): CartMergeLinkableSource {
  const source = modelLinkables[property]
  if (!source) {
    throw new Error(`CART_MERGE_LINKABLE_UNAVAILABLE:${property}`)
  }

  return {
    ...source,
    primaryKey: "id",
    alias,
  }
}
