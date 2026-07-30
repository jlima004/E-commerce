import crypto from "crypto"
import fs from "fs"
import path from "path"
import type { HttpMethod } from "../contracts"
import { MEDUSA_VERSION } from "../document"

export function normalizeEvidenceBytes(bytes: Buffer | string): string {
  return bytes.toString().replace(/\r\n/g, "\n")
}

export function fingerprintEvidence(input: {
  method: HttpMethod
  path: string
  medusaVersion: string
  sourceFile: string
  bytes: Buffer | string
}): string {
  const normalized = normalizeEvidenceBytes(input.bytes)
  const payload = [
    input.method,
    input.path,
    input.medusaVersion,
    input.sourceFile,
    normalized,
  ].join("\n---\n")

  return crypto.createHash("sha256").update(payload).digest("hex")
}

export function verifyEvidenceFingerprint(input: {
  repositoryRoot: string
  method: HttpMethod
  path: string
  sourceFile: string
  expected: string
}): void {
  const absolute = path.resolve(input.repositoryRoot, input.sourceFile)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Native evidence file is missing: ${input.sourceFile}`)
  }

  const actual = fingerprintEvidence({
    method: input.method,
    path: input.path,
    medusaVersion: MEDUSA_VERSION,
    sourceFile: input.sourceFile,
    bytes: fs.readFileSync(absolute),
  })

  if (actual !== input.expected) {
    throw new Error(
      `Native evidence fingerprint drift: ${input.method} ${input.path} ${input.sourceFile}`
    )
  }
}
