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
  | "schema"
  | "propertyMap"

type TraversalState = {
  location: TraversalLocation
  insideExample: boolean
  exampleMapContainer?: boolean
  semanticName?: string
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
  childInsideExample: boolean
): TraversalState {
  if (state.insideExample) {
    return {
      location: "unknown",
      insideExample: childInsideExample,
      semanticName,
    }
  }

  if (key === "examples" && isRecord(child)) {
    return {
      location: "unknown",
      insideExample: false,
      exampleMapContainer: true,
      semanticName,
    }
  }

  switch (state.location) {
    case "document":
      if (key === "components") {
        return { location: "components", insideExample: childInsideExample }
      }
      if (key === "paths") {
        return { location: "pathMap", insideExample: childInsideExample }
      }
      break
    case "components":
      if (key === "parameters") {
        return { location: "parameterMap", insideExample: childInsideExample }
      }
      if (key === "headers") {
        return { location: "headerMap", insideExample: childInsideExample }
      }
      if (key === "responses") {
        return { location: "responseMap", insideExample: childInsideExample }
      }
      if (key === "requestBodies") {
        return { location: "requestBodyMap", insideExample: childInsideExample }
      }
      if (key === "schemas") {
        return { location: "schemaMap", insideExample: childInsideExample }
      }
      break
    case "pathMap":
      return { location: "pathItem", insideExample: childInsideExample }
    case "pathItem":
      if (HTTP_METHOD_KEYS.has(key)) {
        return { location: "operation", insideExample: childInsideExample }
      }
      if (key === "parameters") {
        return { location: "parameterArray", insideExample: childInsideExample }
      }
      break
    case "operation":
    case "operationMetadata":
      if (key === "parameters") {
        return { location: "parameterArray", insideExample: childInsideExample }
      }
      if (key === "responses") {
        return { location: "responseMap", insideExample: childInsideExample }
      }
      if (key === "requestBody") {
        return { location: "requestBody", insideExample: childInsideExample }
      }
      break
    case "parameterArray":
    case "parameterMap":
      return {
        location: "parameter",
        insideExample: childInsideExample,
        semanticName: parameterName(child),
      }
    case "parameter":
      if (key === "schema") {
        return {
          location: "schema",
          insideExample: childInsideExample,
          semanticName,
        }
      }
      break
    case "responseMap":
      return { location: "response", insideExample: childInsideExample }
    case "response":
      if (key === "headers") {
        return { location: "headerMap", insideExample: childInsideExample }
      }
      if (key === "content") {
        return { location: "contentMap", insideExample: childInsideExample }
      }
      break
    case "headerMap":
      return {
        location: "header",
        insideExample: childInsideExample,
        semanticName: key,
      }
    case "header":
      if (key === "schema") {
        return {
          location: "schema",
          insideExample: childInsideExample,
          semanticName,
        }
      }
      break
    case "requestBodyMap":
      return { location: "requestBody", insideExample: childInsideExample }
    case "requestBody":
      if (key === "content") {
        return { location: "contentMap", insideExample: childInsideExample }
      }
      break
    case "contentMap":
      return { location: "mediaType", insideExample: childInsideExample }
    case "mediaType":
      if (key === "schema") {
        return {
          location: "schema",
          insideExample: childInsideExample,
          semanticName,
        }
      }
      break
    case "schemaMap":
      return {
        location: "schema",
        insideExample: childInsideExample,
        semanticName,
      }
    case "schema":
      if (key === "properties") {
        return { location: "propertyMap", insideExample: childInsideExample }
      }
      if (
        key === "$defs" ||
        key === "patternProperties" ||
        key === "dependentSchemas"
      ) {
        return {
          location: "schemaMap",
          insideExample: childInsideExample,
          semanticName,
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
        }
      }
      break
    case "propertyMap":
      return {
        location: "schema",
        insideExample: childInsideExample,
        semanticName: key,
      }
    default:
      break
  }

  return {
    location: "unknown",
    insideExample: childInsideExample,
    semanticName,
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
        })
      }
      return
    }

    const currentSemanticName =
      state.location === "parameter"
        ? parameterName(current) ?? state.semanticName
        : state.semanticName

    for (const [key, child] of Object.entries(current)) {
      const isExampleKey = /^examples?$/i.test(key)
      const childInsideExample = state.insideExample || isExampleKey

      if (
        (!state.insideExample &&
          isExampleKey &&
          currentSemanticName !== undefined &&
          isSensitiveExampleKey(currentSemanticName)) ||
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
          childInsideExample
        )
      )
    }
  }

  visit(value, {
    location: options.rootLocation,
    insideExample: false,
    semanticName: options.rootSemanticName,
  })
}

export { componentRootLocation }
