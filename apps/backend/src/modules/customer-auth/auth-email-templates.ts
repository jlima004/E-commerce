import type { AuthNotificationTemplate } from "./notification-outbox"

export type EmailVerificationTemplateData = {
  capability: string
  intentId: string
  recipientEmail: string
  storefrontUrl?: string
}

export type PasswordResetTemplateData = {
  capability: string
  intentId: string
  recipientEmail: string
  storefrontUrl?: string
}

export type RenderedAuthEmail = {
  to: string
  subject: string
  html: string
  text: string
}

const DEFAULT_STOREFRONT_URL = "http://localhost:3000"

export function buildVerificationUrl(
  storefrontUrl: string,
  capability: string,
  intentId: string
): string {
  const base = (storefrontUrl || DEFAULT_STOREFRONT_URL).replace(/\/+$/, "")
  return `${base}/auth/verify?token=${encodeURIComponent(capability)}&intent=${encodeURIComponent(intentId)}`
}

export function buildPasswordResetUrl(
  storefrontUrl: string,
  capability: string,
  intentId: string
): string {
  const base = (storefrontUrl || DEFAULT_STOREFRONT_URL).replace(/\/+$/, "")
  return `${base}/auth/reset-password?token=${encodeURIComponent(capability)}&intent=${encodeURIComponent(intentId)}`
}

export function renderEmailVerificationTemplate(
  data: EmailVerificationTemplateData
): RenderedAuthEmail {
  const url = buildVerificationUrl(
    data.storefrontUrl ?? DEFAULT_STOREFRONT_URL,
    data.capability,
    data.intentId
  )

  const subject = "Confirme seu e-mail"
  const text = [
    "Olá!",
    "",
    "Por favor, confirme seu endereço de e-mail clicando no link abaixo:",
    url,
    "",
    "Este link é válido por 30 minutos.",
    "Se você não solicitou este cadastro, ignore este e-mail.",
  ].join("\n")

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="utf-8"><title>${subject}</title></head>
    <body style="font-family: sans-serif; line-height: 1.5; color: #333;">
      <h2>Confirme seu e-mail</h2>
      <p>Obrigado por se cadastrar. Por favor, clique no botão abaixo para verificar seu endereço de e-mail:</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Verificar E-mail</a>
      </p>
      <p style="font-size: 14px; color: #666;">Ou acesse o link: <br><a href="${url}">${url}</a></p>
      <p style="font-size: 12px; color: #999;">Este link é válido por 30 minutos. Se você não solicitou este cadastro, ignore este e-mail.</p>
    </body>
    </html>
  `.trim()

  return {
    to: data.recipientEmail,
    subject,
    html,
    text,
  }
}

export function renderPasswordResetTemplate(
  data: PasswordResetTemplateData
): RenderedAuthEmail {
  const url = buildPasswordResetUrl(
    data.storefrontUrl ?? DEFAULT_STOREFRONT_URL,
    data.capability,
    data.intentId
  )

  const subject = "Redefinição de senha"
  const text = [
    "Olá!",
    "",
    "Recebemos uma solicitação para redefinir sua senha. Clique no link abaixo para escolher uma nova senha:",
    url,
    "",
    "Este link é válido por 15 minutos.",
    "Se você não solicitou a redefinição de senha, ignore este e-mail com segurança.",
  ].join("\n")

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="utf-8"><title>${subject}</title></head>
    <body style="font-family: sans-serif; line-height: 1.5; color: #333;">
      <h2>Redefinição de senha</h2>
      <p>Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para prosseguir:</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Redefinir Senha</a>
      </p>
      <p style="font-size: 14px; color: #666;">Ou acesse o link: <br><a href="${url}">${url}</a></p>
      <p style="font-size: 12px; color: #999;">Este link é válido por 15 minutos. Se você não solicitou esta alteração, ignore este e-mail com segurança.</p>
    </body>
    </html>
  `.trim()

  return {
    to: data.recipientEmail,
    subject,
    html,
    text,
  }
}

export function renderAuthEmailTemplate(
  template: AuthNotificationTemplate,
  data: {
    capability: string
    intentId: string
    recipientEmail: string
    storefrontUrl?: string
  }
): RenderedAuthEmail {
  if (template === "email_verification_v1") {
    return renderEmailVerificationTemplate(data)
  }
  if (template === "password_reset_v1") {
    return renderPasswordResetTemplate(data)
  }
  throw new Error(`Unsupported auth email template: ${template}`)
}
