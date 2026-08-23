import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { GUEST_CART_CAPABILITY_RANDOM_BYTES } from "./types"

const DUMMY_HASH_BUFFER_A = Buffer.from(
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "utf8"
)

const DUMMY_HASH_BUFFER_B = Buffer.from(
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856",
  "utf8"
)

export function generateGuestCartCapability(
  randomBytesFn: (size: number) => Buffer = randomBytes
): string {
  const bytes = randomBytesFn(GUEST_CART_CAPABILITY_RANDOM_BYTES)
  if (!Buffer.isBuffer(bytes) || bytes.length !== GUEST_CART_CAPABILITY_RANDOM_BYTES) {
    throw new Error(
      `generateGuestCartCapability requires exactly ${GUEST_CART_CAPABILITY_RANDOM_BYTES} bytes`
    )
  }
  return bytes.toString("base64url")
}

export function hashGuestCartCapability(plaintextToken: string): string {
  if (typeof plaintextToken !== "string" || plaintextToken.length === 0) {
    throw new Error("hashGuestCartCapability requires a non-empty string token")
  }
  return createHash("sha256").update(plaintextToken, "utf8").digest("hex")
}

export function compareGuestCartCapabilityHash(
  presentedHash: string,
  candidateHash: string
): boolean {
  if (
    typeof presentedHash !== "string" ||
    typeof candidateHash !== "string" ||
    presentedHash.length === 0 ||
    candidateHash.length === 0
  ) {
    timingSafeEqual(DUMMY_HASH_BUFFER_A, DUMMY_HASH_BUFFER_B)
    return false
  }

  const bufA = Buffer.from(presentedHash, "utf8")
  const bufB = Buffer.from(candidateHash, "utf8")

  if (bufA.length !== bufB.length) {
    timingSafeEqual(DUMMY_HASH_BUFFER_A, DUMMY_HASH_BUFFER_B)
    return false
  }

  return timingSafeEqual(bufA, bufB)
}

export function performDummyGuestCartCapabilityHashComparison(): boolean {
  timingSafeEqual(DUMMY_HASH_BUFFER_A, DUMMY_HASH_BUFFER_B)
  return false
}
