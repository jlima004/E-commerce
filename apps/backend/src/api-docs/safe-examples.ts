const HTTP_METHOD_KEYS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
])

const PARAMETER_IN_VALUES = new Set(["query", "header", "path", "cookie"])

type JsonRecord = Record<string, unknown>

type TraversalLocation =
  | "unknown"
  | "document"
  | "components"
  | "pathMap"
  | "pathItem"
  | "operation"
  | "operationMetadata"
  | "parameterArray"
  | "parameterMap"
  | "parameter"
  | "responseMap"
  | "response"
  | "headerMap"
  | "header"
  | "requestBodyMap"
  | "requestBody"
  | "contentMap"
  | "mediaType"
  | "schemaMap"
  | "schemaComponentMap"
  | "schema"
  | "propertyMap"
  | "patternPropertyMap"

type TraversalState = {
  location: TraversalLocation
  insideExample: boolean
  exampleMapContainer?: boolean
  semanticName?: string
  sensitiveAncestor: boolean
}

export type SafeExampleRoot =
  | "unknown"
  | "document"
  | "operationMetadata"
  | "parameter"
  | "header"
  | "response"
  | "requestBody"
  | "schema"

export type SafeExampleOptions = {
  isUnsafeExampleValue: (value: string) => boolean
  errorMessage: string
  rootLocation: SafeExampleRoot
  rootSemanticName?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isParameterObject(value: unknown): value is JsonRecord & {
  name: string
  in: string
} {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.in === "string" &&
    PARAMETER_IN_VALUES.has(value.in)
  )
}

function parameterName(value: unknown): string | undefined {
  return isParameterObject(value) ? value.name : undefined
}

function isSensitiveExampleKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
  return /(?:^|_)(?:id|ids|identifier|identifiers|provider|address|street|city|postal(?:_code)?|zip|email|phone|telephone|mobile|cpf|cnpj|tax(?:_id|_number)?|document(?:_id|_number)?|authorization|token|secret|signature|api_key|client_secret|pix|qr_code|copy_paste)(?:_|$)/.test(
    normalized
  )
}

function isSensitiveSemanticName(name: string | undefined): boolean {
  return name !== undefined && isSensitiveExampleKey(name)
}

function decodeEscapedRegexLiterals(pattern: string): string {
  return pattern
    .replace(/\\x([0-9a-f]{2})/gi, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\u([0-9a-f]{4})/gi, (_escape, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
}

function decodeEscapedSemanticSeparators(pattern: string): string {
  return decodeEscapedRegexLiterals(pattern).replace(/\\([._-])/g, "$1")
}

function normalizePatternPropertyName(pattern: string): string | undefined {
  let normalized = pattern.replace(/^\^/, "").replace(/\$$/, "")
  if (!normalized) {
    return undefined
  }

  normalized = normalized
    .replace(/\[[._-]+\]/g, "_")
    .replace(/[()]/g, "")

  const regexMetaCharacters = new Set([
    "\\",
    "^",
    "$",
    ".",
    "*",
    "+",
    "?",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "|",
  ])
  if ([...normalized].some((character) => regexMetaCharacters.has(character))) {
    return undefined
  }

  return normalized
}

function isSensitivePatternPropertyName(
  pattern: string,
  normalizedPattern: string | undefined
): boolean {
  if (isSensitiveSemanticName(normalizedPattern)) {
    return true
  }

  const patternWithSemanticSeparators = decodeEscapedSemanticSeparators(pattern).replace(
    /\[(?:\\.|[^\]])*\]/g,
    (characterClass) => {
      const contents = characterClass
        .slice(1, -1)
        .replace(/\\(.)/g, "$1")
      return /^[._-]+$/.test(contents) ? "_" : ""
    }
  )
  const literalTokens = patternWithSemanticSeparators
    .replace(/\(\?(?:P<|<)[^>]*>/g, "(")
    .replace(/\\k<[^>]*>/g, "")
    .match(/[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*/g) ?? []
  return (
    literalTokens.some((token) => isSensitiveSemanticName(token)) ||
    (literalTokens.length > 1 &&
      isSensitiveSemanticName(literalTokens.join("_")))
  )
}

function componentRootLocation(type: string): SafeExampleRoot {
  if (type === "parameters") {
    return "parameter"
  }
  if (type === "headers") {
    return "header"
  }
  if (type === "responses") {
    return "response"
  }
  if (type === "requestBodies") {
    return "requestBody"
  }
  if (type === "schemas") {
    return "schema"
  }
  return "unknown"
}

function nextState(
  state: TraversalState,
  key: string,
  child: unknown,
  semanticName: string | undefined,
  childInsideExample: boolean,
  sensitiveAncestor: boolean
): TraversalState {
  const inheritedSensitiveAncestor =
    state.sensitiveAncestor || sensitiveAncestor

  if (state.insideExample) {
    return {
      location: "unknown",
      insideExample: childInsideExample,
      semanticName,
      sensitiveAncestor: inheritedSensitiveAncestor,
    }
  }

  if (key === "examples" && isRecord(child)) {
    return {
      location: "unknown",
      insideExample: false,
      exampleMapContainer: true,
      semanticName,
      sensitiveAncestor: inheritedSensitiveAncestor,
    }
  }

  switch (state.location) {
    case "document":
      if (key === "components") {
        return {
          location: "components",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "paths") {
        return {
          location: "pathMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "components":
      if (key === "parameters") {
        return {
          location: "parameterMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "headers") {
        return {
          location: "headerMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "responses") {
        return {
          location: "responseMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "requestBodies") {
        return {
          location: "requestBodyMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "schemas") {
        return {
          location: "schemaComponentMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "pathMap":
      return {
        location: "pathItem",
        insideExample: childInsideExample,
        sensitiveAncestor: inheritedSensitiveAncestor,
      }
    case "pathItem":
      if (HTTP_METHOD_KEYS.has(key)) {
        return {
          location: "operation",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "parameters") {
        return {
          location: "parameterArray",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "operation":
    case "operationMetadata":
      if (key === "parameters") {
        return {
          location: "parameterArray",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "responses") {
        return {
          location: "responseMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "requestBody") {
        return {
          location: "requestBody",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "parameterArray":
    case "parameterMap":
      return {
        location: "parameter",
        insideExample: childInsideExample,
        semanticName: parameterName(child),
        sensitiveAncestor:
          inheritedSensitiveAncestor ||
          isSensitiveSemanticName(parameterName(child)),
      }
    case "parameter":
      if (key === "schema") {
        return {
          location: "schema",
          insideExample: childInsideExample,
          semanticName,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "responseMap":
      return {
        location: "response",
        insideExample: childInsideExample,
        semanticName: key,
        sensitiveAncestor:
          inheritedSensitiveAncestor || isSensitiveSemanticName(key),
      }
    case "response":
      if (key === "headers") {
        return {
          location: "headerMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "content") {
        return {
          location: "contentMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "headerMap":
      return {
        location: "header",
        insideExample: childInsideExample,
        semanticName: key,
        sensitiveAncestor:
          inheritedSensitiveAncestor || isSensitiveSemanticName(key),
      }
    case "header":
      if (key === "schema") {
        return {
          location: "schema",
          insideExample: childInsideExample,
          semanticName,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "requestBodyMap":
      return {
        location: "requestBody",
        insideExample: childInsideExample,
        sensitiveAncestor: inheritedSensitiveAncestor,
      }
    case "requestBody":
      if (key === "content") {
        return {
          location: "contentMap",
          insideExample: childInsideExample,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "contentMap":
      return {
        location: "mediaType",
        insideExample: childInsideExample,
        sensitiveAncestor: inheritedSensitiveAncestor,
      }
    case "mediaType":
      if (key === "schema") {
        return {
          location: "schema",
          insideExample: childInsideExample,
          semanticName,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "schemaComponentMap":
      return {
        location: "schema",
        insideExample: childInsideExample,
        semanticName: key,
        sensitiveAncestor:
          inheritedSensitiveAncestor || isSensitiveSemanticName(key),
      }
    case "schemaMap":
      return {
        location: "schema",
        insideExample: childInsideExample,
        semanticName: key,
        sensitiveAncestor: isSensitiveSemanticName(key),
      }
    case "schema":
      if (key === "properties") {
        return {
          location: "propertyMap",
          insideExample: childInsideExample,
          semanticName,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "patternProperties") {
        return {
          location: "patternPropertyMap",
          insideExample: childInsideExample,
          semanticName,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      if (key === "$defs" || key === "dependentSchemas") {
        return {
          location: "schemaMap",
          insideExample: childInsideExample,
          sensitiveAncestor: false,
        }
      }
      if (
        key === "items" ||
        key === "unevaluatedItems" ||
        key === "additionalProperties" ||
        key === "unevaluatedProperties" ||
        key === "allOf" ||
        key === "anyOf" ||
        key === "oneOf" ||
        key === "not" ||
        key === "if" ||
        key === "then" ||
        key === "else" ||
        key === "contains" ||
        key === "propertyNames" ||
        key === "prefixItems" ||
        key === "contentSchema"
      ) {
        return {
          location: "schema",
          insideExample: childInsideExample,
          semanticName,
          sensitiveAncestor: inheritedSensitiveAncestor,
        }
      }
      break
    case "propertyMap":
      return {
        location: "schema",
        insideExample: childInsideExample,
        semanticName: key,
        sensitiveAncestor:
          inheritedSensitiveAncestor || isSensitiveSemanticName(key),
      }
    case "patternPropertyMap": {
      const normalizedPattern = normalizePatternPropertyName(key)
      return {
        location: "schema",
        insideExample: childInsideExample,
        semanticName: normalizedPattern,
        sensitiveAncestor:
          inheritedSensitiveAncestor ||
          isSensitivePatternPropertyName(key, normalizedPattern),
      }
    }
    default:
      break
  }

  return {
    location: "unknown",
    insideExample: childInsideExample,
    semanticName,
    sensitiveAncestor: inheritedSensitiveAncestor,
  }
}

export function assertSafeExamples(
  value: unknown,
  options: SafeExampleOptions
): void {
  const visit = (current: unknown, state: TraversalState): void => {
    if (typeof current === "string" && state.insideExample) {
      if (options.isUnsafeExampleValue(current)) {
        throw new Error(options.errorMessage)
      }
      return
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(
          item,
          state.location === "parameterArray"
            ? {
                location: "parameter",
                insideExample: state.insideExample,
                semanticName: parameterName(item),
                sensitiveAncestor:
                  state.sensitiveAncestor ||
                  isSensitiveSemanticName(parameterName(item)),
              }
            : state
        )
      }
      return
    }

    if (!isRecord(current)) {
      return
    }

    if (state.exampleMapContainer) {
      for (const example of Object.values(current)) {
        visit(example, {
          location: "unknown",
          insideExample: true,
          sensitiveAncestor: state.sensitiveAncestor,
        })
      }
      return
    }

    const currentSemanticName =
      state.location === "parameter"
        ? parameterName(current) ?? state.semanticName
        : state.semanticName
    const currentSensitiveAncestor =
      state.sensitiveAncestor || isSensitiveSemanticName(currentSemanticName)

    for (const [key, child] of Object.entries(current)) {
      const isExampleKey = /^examples?$/i.test(key)
      const childInsideExample = state.insideExample || isExampleKey

      if (
        (!state.insideExample &&
          isExampleKey &&
          child !== null &&
          child !== undefined &&
          currentSensitiveAncestor) ||
        (state.insideExample &&
          isSensitiveExampleKey(key) &&
          child !== null &&
          child !== undefined)
      ) {
        throw new Error(options.errorMessage)
      }

      visit(
        child,
        nextState(
          state,
          key,
          child,
          currentSemanticName,
          childInsideExample,
          currentSensitiveAncestor
        )
      )
    }
  }

  visit(value, {
    location: options.rootLocation,
    insideExample: false,
    semanticName: options.rootSemanticName,
    sensitiveAncestor: isSensitiveSemanticName(options.rootSemanticName),
  })
}

export { componentRootLocation }
