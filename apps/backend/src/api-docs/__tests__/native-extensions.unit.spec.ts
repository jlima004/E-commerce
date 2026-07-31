import fs from "fs"
import os from "os"
import path from "path"
import {
  CANONICAL_NATIVE_EXTENSION_MATRIX,
  NATIVE_EXTENSIONS,
  verifyNativeExtensions,
  type NativeExtensionEntry,
} from "../coverage/native-routes"

function cloneEntries(): NativeExtensionEntry[] {
  return JSON.parse(JSON.stringify(NATIVE_EXTENSIONS)) as NativeExtensionEntry[]
}

describe("native Medusa extension manifest", () => {
  it("contains exactly the approved six versioned operations and official URLs", () => {
    expect(CANONICAL_NATIVE_EXTENSION_MATRIX).toHaveLength(6)
    expect(
      NATIVE_EXTENSIONS.map((entry) => `${entry.method} ${entry.path}`)
    ).toEqual([
      "GET /store/products",
      "GET /store/products/{id}",
      "POST /admin/products",
      "POST /admin/products/{id}",
      "POST /admin/products/{id}/variants",
      "POST /admin/products/{id}/variants/{variant_id}",
    ])
    expect(new Set(NATIVE_EXTENSIONS.map((entry) => entry.officialReference)).size)
      .toBe(6)
    expect(
      NATIVE_EXTENSIONS.every(
        (entry) =>
          entry.medusaVersion === "2.16.0" &&
          entry.officialReference.startsWith(
            "https://github.com/medusajs/medusa/blob/v2.16.0/"
          ) &&
          entry.inclusionReason.length > 0
      )
    ).toBe(true)
  })

  it("verifies every local evidence file and all 24 bound fingerprints", () => {
    expect(
      NATIVE_EXTENSIONS.reduce(
        (count, entry) => count + Object.keys(entry.fingerprints).length,
        0
      )
    ).toBe(24)
    expect(() => verifyNativeExtensions()).not.toThrow()
  })

  it("fails when local evidence changes", () => {
    const repositoryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "api-docs-native-")
    )
    const uniqueEvidence = new Set(
      NATIVE_EXTENSIONS.flatMap((entry) => entry.evidenceFiles)
    )
    for (const sourceFile of uniqueEvidence) {
      const target = path.join(repositoryRoot, sourceFile)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.resolve(__dirname, "../../../../..", sourceFile), target)
    }

    expect(() =>
      verifyNativeExtensions(cloneEntries(), repositoryRoot)
    ).not.toThrow()

    const changed = path.join(
      repositoryRoot,
      NATIVE_EXTENSIONS[0].evidenceFiles[0]
    )
    fs.appendFileSync(changed, "\n// drift\n", "utf8")
    expect(() =>
      verifyNativeExtensions(cloneEntries(), repositoryRoot)
    ).toThrow("fingerprint drift")

    fs.rmSync(repositoryRoot, { recursive: true, force: true })
  })

  it("does not allow fingerprints to be exchanged between operations", () => {
    const entries = cloneEntries()
    const sourceFile = entries[1].evidenceFiles[0]
    entries[1].fingerprints[sourceFile] =
      entries[0].fingerprints[entries[0].evidenceFiles[0]]

    expect(() => verifyNativeExtensions(entries)).toThrow("fingerprint drift")
  })

  it.each([
    ["surface", "admin"],
    ["owningContract", "admin.openapi.json"],
    ["officialReference", "https://example.test/wrong-reference"],
    ["method", "POST"],
    ["path", "/store/wrong-path"],
    ["medusaVersion", "2.15.0"],
  ] as const)("rejects canonical %s drift", (field, value) => {
    const entries = cloneEntries()
    Object.assign(entries[0], { [field]: value })

    expect(() => verifyNativeExtensions(entries)).toThrow(
      "canonical matrix mismatch"
    )
  })
})
