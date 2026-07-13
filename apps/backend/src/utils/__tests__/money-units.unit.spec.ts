import {
  assertNonNegativeBrlMinorAmount,
  assertPositiveBrlMinorAmount,
  brlMajorToMinor,
  normalizeBrlMajorAmount,
} from "../money-units"

describe("money-units BRL", () => {
  describe("normalizeBrlMajorAmount / brlMajorToMinor", () => {
    it.each([
      [99, 9900],
      [99.0, 9900],
      [99.9, 9990],
      ["99.90", 9990],
      [0.01, 1],
    ])("converte %p major para %p minor sem arredondamento", (major, minor) => {
      expect(brlMajorToMinor(major)).toBe(minor)
    })

    it("normaliza major units sem alterar o valor comercial", () => {
      expect(normalizeBrlMajorAmount("99.90")).toBe(99.9)
      expect(normalizeBrlMajorAmount(0.01)).toBe(0.01)
    })

    it("converte cada componente antes da multiplicacao", () => {
      expect(brlMajorToMinor(49.5) * 2).toBe(9900)
    })

    it("aceita bigint inteiro major e formatos BigNumber-like do Medusa", () => {
      expect(brlMajorToMinor(99n)).toBe(9900)
      expect(brlMajorToMinor({ rawAmount: "99.90" })).toBe(9990)
      expect(brlMajorToMinor({ numeric: 99.9 })).toBe(9990)
      expect(brlMajorToMinor({ valueOf: () => 99 })).toBe(9900)
      expect(
        brlMajorToMinor({
          valueOf() {
            return this
          },
          toString: () => "99.90",
        })
      ).toBe(9990)
    })

    it("aceita zeros finais alem da segunda casa sem perder exatidao", () => {
      expect(brlMajorToMinor("99.9000")).toBe(9990)
    })

    it.each([99.999, "10.129", "0.001"])(
      "rejeita precisao decimal maior que centavos: %p",
      (value) => {
        expect(() => brlMajorToMinor(value)).toThrow(
          "BRL_MAJOR_AMOUNT_TOO_PRECISE"
        )
      }
    )

    it.each([NaN, Infinity, -Infinity, "not-money", null, undefined])(
      "rejeita valor major invalido: %p",
      (value) => {
        expect(() => brlMajorToMinor(value)).toThrow()
      }
    )

    it("rejeita valor major negativo", () => {
      expect(() => brlMajorToMinor(-0.01)).toThrow(
        "BRL_MAJOR_AMOUNT_NEGATIVE"
      )
    })

    it("rejeita resultado minor acima de Number.MAX_SAFE_INTEGER", () => {
      expect(() => brlMajorToMinor("90071992547409.92")).toThrow(
        "BRL_MINOR_AMOUNT_OVERFLOW"
      )
    })
  })

  describe("assertPositiveBrlMinorAmount", () => {
    it("aceita inteiro minor positivo", () => {
      expect(assertPositiveBrlMinorAmount(9900)).toBe(9900)
      expect(assertPositiveBrlMinorAmount("9900")).toBe(9900)
      expect(assertPositiveBrlMinorAmount(9900n)).toBe(9900)
    })

    it.each([0, -1])("rejeita total pagavel nao positivo: %p", (value) => {
      expect(() => assertPositiveBrlMinorAmount(value)).toThrow()
    })

    it.each([99.9, NaN, Infinity])("rejeita minor nao inteiro: %p", (value) => {
      expect(() => assertPositiveBrlMinorAmount(value)).toThrow()
    })
  })

  describe("assertNonNegativeBrlMinorAmount", () => {
    it("aceita zero e inteiro minor positivo", () => {
      expect(assertNonNegativeBrlMinorAmount(0)).toBe(0)
      expect(assertNonNegativeBrlMinorAmount(9900)).toBe(9900)
    })

    it("rejeita minor negativo", () => {
      expect(() => assertNonNegativeBrlMinorAmount(-1)).toThrow(
        "BRL_MINOR_AMOUNT_NEGATIVE"
      )
    })

    it("rejeita minor acima de Number.MAX_SAFE_INTEGER", () => {
      expect(() =>
        assertNonNegativeBrlMinorAmount(BigInt(Number.MAX_SAFE_INTEGER) + 1n)
      ).toThrow("BRL_MINOR_AMOUNT_OVERFLOW")
    })
  })
})
