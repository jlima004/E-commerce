import type { OpenApiDocument } from "../contracts"
import { canonicalize } from "./canonicalize"

export function serializeDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(canonicalize(document), null, 2)}\n`
}
