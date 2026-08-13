import { z } from "zod"

const EMAIL_MAX_LENGTH = 320
const NAME_MAX_LENGTH = 128
const PASSWORD_MIN_LENGTH = 12
const PASSWORD_MAX_LENGTH = 128
const CAPABILITY_MIN_LENGTH = 43
const CAPABILITY_MAX_LENGTH = 512

/**
 * Boundary validation intentionally preserves email bytes. Canonicalization is
 * owned by the future Phase 14 normalizer and must happen exactly once.
 */
export const EmailSchema = z.string().email().min(3).max(EMAIL_MAX_LENGTH)
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
export const CapabilitySchema = z
  .string()
  .min(CAPABILITY_MIN_LENGTH)
  .max(CAPABILITY_MAX_LENGTH)

export const EmptyRequestSchema = z.object({}).strict()

export const SignupRequestSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    firstName: z.string().min(1).max(NAME_MAX_LENGTH),
    lastName: z.string().min(1).max(NAME_MAX_LENGTH),
  })
  .strict()

export const LoginRequestSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
  })
  .strict()

export const EmailRequestSchema = z.object({ email: EmailSchema }).strict()

export const VerificationTokenRequestSchema = z
  .object({ token: CapabilitySchema })
  .strict()

export const ResetConfirmRequestSchema = z
  .object({
    token: CapabilitySchema,
    newPassword: PasswordSchema,
  })
  .strict()

export const PasswordChangeRequestSchema = z
  .object({
    currentPassword: PasswordSchema,
    newPassword: PasswordSchema,
  })
  .strict()

export type SignupRequest = z.infer<typeof SignupRequestSchema>
export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type EmailRequest = z.infer<typeof EmailRequestSchema>
export type VerificationTokenRequest = z.infer<
  typeof VerificationTokenRequestSchema
>
export type ResetConfirmRequest = z.infer<typeof ResetConfirmRequestSchema>
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>
