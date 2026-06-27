export type CheckoutEmailSource = {
  actorType: "guest" | "customer"
  guestEmail?: string | null
  customerEmail?: string | null
}

export type FederalTaxIdKind = "cpf" | "cnpj"

export type BrazilShippingAddressInput = {
  full_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  state?: string | null
  postal_code?: string | null
  country_code?: string | null
  phone?: string | null
  company?: string | null
  state_tax_id?: string | null
  federal_tax_id?: string | null
}

export type NormalizedBrazilShippingAddress = {
  full_name: string
  address_1: string
  address_2?: string
  city: string
  province: string
  postal_code: string
  country_code: "BR"
  phone?: string
  company?: string
  state_tax_id?: string
  metadata: {
    federal_tax_id: string
    federal_tax_id_kind: FederalTaxIdKind
  }
}

export type CheckoutDataValidationError = {
  code:
    | "CHECKOUT_FULL_NAME_REQUIRED"
    | "CHECKOUT_ADDRESS_1_REQUIRED"
    | "CHECKOUT_CITY_REQUIRED"
    | "CHECKOUT_PROVINCE_INVALID"
    | "CHECKOUT_POSTAL_CODE_INVALID"
    | "CHECKOUT_COUNTRY_CODE_INVALID"
    | "CHECKOUT_FEDERAL_TAX_ID_INVALID"
  field:
    | "full_name"
    | "address_1"
    | "city"
    | "province"
    | "postal_code"
    | "country_code"
    | "federal_tax_id"
  message: string
  masked_federal_tax_id?: string
}

const FEDERAL_TAX_ID_REDACTED = "[REDACTED]"
const BRAZIL_UF_CODES = new Set([
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
])

const BRAZIL_UF_NAME_TO_CODE: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  distrito_federal: "DF",
  espirito_santo: "ES",
  goias: "GO",
  maranhao: "MA",
  mato_grosso: "MT",
  mato_grosso_do_sul: "MS",
  minas_gerais: "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  rio_de_janeiro: "RJ",
  rio_grande_do_norte: "RN",
  rio_grande_do_sul: "RS",
  rondonia: "RO",
  roraima: "RR",
  santa_catarina: "SC",
  sao_paulo: "SP",
  sergipe: "SE",
  tocantins: "TO",
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function normalizeTextKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
}

function normalizePhone(value: string | null | undefined): string | undefined {
  const trimmed = asTrimmedString(value)
  if (!trimmed) {
    return undefined
  }

  const digits = trimmed.replace(/\D/g, "")
  return digits.length >= 10 && digits.length <= 13 ? digits : undefined
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isSameDigitSequence(value: string): boolean {
  return /^(\d)\1+$/.test(value)
}

function computeCpfCheckDigit(base: string): number {
  let sum = 0
  for (let index = 0; index < base.length; index += 1) {
    sum += Number(base[index]) * (base.length + 1 - index)
  }
  const remainder = (sum * 10) % 11
  return remainder === 10 ? 0 : remainder
}

function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || isSameDigitSequence(value)) {
    return false
  }

  const firstDigit = computeCpfCheckDigit(value.slice(0, 9))
  const secondDigit = computeCpfCheckDigit(value.slice(0, 10))
  return firstDigit === Number(value[9]) && secondDigit === Number(value[10])
}

function computeCnpjCheckDigit(base: string): number {
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const secondWeights = [6, ...firstWeights]
  const weights = base.length === 12 ? firstWeights : secondWeights

  const sum = base.split("").reduce((acc, current, index) => {
    return acc + Number(current) * weights[index]
  }, 0)

  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || isSameDigitSequence(value)) {
    return false
  }

  const firstDigit = computeCnpjCheckDigit(value.slice(0, 12))
  const secondDigit = computeCnpjCheckDigit(value.slice(0, 13))
  return firstDigit === Number(value[12]) && secondDigit === Number(value[13])
}

export function normalizeCheckoutEmail(input: CheckoutEmailSource): {
  email: string | null
  source: "customer" | "guest" | "none"
  isValid: boolean
} {
  const sourceEmail =
    input.actorType === "customer"
      ? asTrimmedString(input.customerEmail)
      : asTrimmedString(input.guestEmail)

  if (!sourceEmail) {
    return {
      email: null,
      source: "none",
      isValid: false,
    }
  }

  const normalized = sourceEmail.toLowerCase()
  return {
    email: normalized,
    source: input.actorType,
    isValid: isValidEmail(normalized),
  }
}

export function normalizeBrazilPostalCode(
  value: string | null | undefined
): string | null {
  const normalized = value?.replace(/\D/g, "") ?? ""
  return /^\d{8}$/.test(normalized) ? normalized : null
}

export function normalizeBrazilProvince(
  value: string | null | undefined
): string | null {
  const trimmed = asTrimmedString(value)
  if (!trimmed) {
    return null
  }

  const byCode = trimmed.toUpperCase()
  if (BRAZIL_UF_CODES.has(byCode)) {
    return byCode
  }

  const byName = BRAZIL_UF_NAME_TO_CODE[normalizeTextKey(trimmed)]
  return byName ?? null
}

export function maskFederalTaxId(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? ""

  if (digits.length === 11) {
    return `***.***.***-${digits.slice(-2)}`
  }

  if (digits.length === 14) {
    return `**.***.***/****-${digits.slice(-2)}`
  }

  return FEDERAL_TAX_ID_REDACTED
}

export function normalizeFederalTaxId(
  value: string | null | undefined
): {
  kind: FederalTaxIdKind
  value: string
} | null {
  const digits = value?.replace(/\D/g, "") ?? ""

  if (digits.length === 11 && isValidCpf(digits)) {
    return {
      kind: "cpf",
      value: digits,
    }
  }

  if (digits.length === 14 && isValidCnpj(digits)) {
    return {
      kind: "cnpj",
      value: digits,
    }
  }

  return null
}

function buildRequiredFieldError(
  code:
    | "CHECKOUT_FULL_NAME_REQUIRED"
    | "CHECKOUT_ADDRESS_1_REQUIRED"
    | "CHECKOUT_CITY_REQUIRED",
  field: "full_name" | "address_1" | "city"
): CheckoutDataValidationError {
  return {
    code,
    field,
    message: "Campo obrigatorio ausente para checkout pre-order.",
  }
}

export function validateBrazilShippingAddress(input: BrazilShippingAddressInput): {
  ok: true
  normalized: NormalizedBrazilShippingAddress
  maskedFederalTaxId: string
} | {
  ok: false
  errors: CheckoutDataValidationError[]
} {
  const errors: CheckoutDataValidationError[] = []

  const fullName = asTrimmedString(input.full_name)
  const address1 = asTrimmedString(input.address_1)
  const city = asTrimmedString(input.city)
  const province = normalizeBrazilProvince(input.province ?? input.state)
  const postalCode = normalizeBrazilPostalCode(input.postal_code)
  const countryCode = asTrimmedString(input.country_code)?.toUpperCase()
  const taxId = normalizeFederalTaxId(input.federal_tax_id)

  if (!fullName) {
    errors.push(
      buildRequiredFieldError("CHECKOUT_FULL_NAME_REQUIRED", "full_name")
    )
  }

  if (!address1) {
    errors.push(
      buildRequiredFieldError("CHECKOUT_ADDRESS_1_REQUIRED", "address_1")
    )
  }

  if (!city) {
    errors.push(buildRequiredFieldError("CHECKOUT_CITY_REQUIRED", "city"))
  }

  if (!province) {
    errors.push({
      code: "CHECKOUT_PROVINCE_INVALID",
      field: "province",
      message: "UF/province invalida para checkout Brasil.",
    })
  }

  if (!postalCode) {
    errors.push({
      code: "CHECKOUT_POSTAL_CODE_INVALID",
      field: "postal_code",
      message: "CEP invalido: informe 8 digitos numericos.",
    })
  }

  if (countryCode !== "BR") {
    errors.push({
      code: "CHECKOUT_COUNTRY_CODE_INVALID",
      field: "country_code",
      message: "country_code deve ser BR no MVP.",
    })
  }

  if (!taxId) {
    errors.push({
      code: "CHECKOUT_FEDERAL_TAX_ID_INVALID",
      field: "federal_tax_id",
      message: "Documento fiscal invalido para checkout Brasil.",
      masked_federal_tax_id: maskFederalTaxId(input.federal_tax_id),
    })
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    }
  }

  return {
    ok: true,
    normalized: {
      full_name: fullName!,
      address_1: address1!,
      address_2: asTrimmedString(input.address_2),
      city: city!,
      province: province!,
      postal_code: postalCode!,
      country_code: "BR",
      phone: normalizePhone(input.phone),
      company: asTrimmedString(input.company),
      state_tax_id: asTrimmedString(input.state_tax_id),
      metadata: {
        // PII gate confirmed: persist only under shipping_address.metadata.
        federal_tax_id: taxId!.value,
        federal_tax_id_kind: taxId!.kind,
      },
    },
    maskedFederalTaxId: maskFederalTaxId(taxId!.value),
  }
}

export function calculateCheckoutDataComplete(input: {
  actorType: "guest" | "customer"
  guestEmail?: string | null
  customerEmail?: string | null
  shippingAddress?: BrazilShippingAddressInput | null
  hasShippableItems: boolean
  currencyCode?: string | null
}): boolean {
  if (!input.hasShippableItems) {
    return false
  }

  if ((input.currencyCode ?? "").toLowerCase() !== "brl") {
    return false
  }

  const email = normalizeCheckoutEmail({
    actorType: input.actorType,
    guestEmail: input.guestEmail,
    customerEmail: input.customerEmail,
  })

  if (!email.isValid) {
    return false
  }

  if (!input.shippingAddress) {
    return false
  }

  return validateBrazilShippingAddress(input.shippingAddress).ok
}
