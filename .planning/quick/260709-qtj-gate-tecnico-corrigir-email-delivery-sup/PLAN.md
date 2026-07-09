---
id: 260709-qtj
slug: gate-tecnico-corrigir-email-delivery-sup
status: in_progress
---

# Gate técnico: email não configurado no webhook Stripe

## Escopo

1. Fazer o enfileiramento de confirmação de pedido depender da configuração completa e explícita do relay Resend.
2. Quando o relay não estiver configurado, pular o e-mail local sem chamar o provider e sem bloquear o resultado terminal de Order/analytics.
3. Preservar fail-closed para e-mail quando o relay estiver configurado e acrescentar cobertura focada para o smoke sem configuração.

## Fora de escopo

- migrations ou alteração do modelo/status do `EmailDeliveryLog`;
- chamadas reais ao Resend, Stripe, Gelato ou Correios;
- mudanças de dependências, lockfiles, `ROADMAP.md` ou `REQUIREMENTS.md`.

## Verificação

- suites unitárias focadas de e-mail/workflow/rota Stripe;
- build do backend e `git diff --check`;
- prova negativa de que não houve configuração ou chamada real de provider.
