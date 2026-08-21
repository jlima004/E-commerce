---
quick_id: 260821-r4s
status: passed
verified: 2026-08-21
---

# Verificação — B15-07-HR-01

## Must-haves

- PASS — As seis operações Cart M1 possuem exatamente três alternativas de
  segurança, todas com `bffServiceCredential` e `publishableApiKey`.
- PASS — Há zero alternativas que aceitam `publishableApiKey` sem
  `bffServiceCredential`.
- PASS — Guest não possui `customerBearer` nem `customerSession`; bearer e
  session são alternativas separadas.
- PASS — Runtime, manifest, Admin OpenAPI e Webhooks OpenAPI permaneceram
  inalterados.

## Evidência

- Unit Store contract: `23/23 PASS`.
- Store writer: `PASS`, somente `store.openapi.json` regenerado.
- JSON inspection: Cart M1 `6/6`; BFF `6/6`; publishable `6/6`; publishable-only
  `0`; request header `required: false`; response capability header somente em
  POST active `201`; 412 preservado.
- OpenAPI lint: `PASS`.
- Admin SHA-256 preservado:
  `6ea59bf72f62eff5cea87fdccabe44042fb41cdc25e7a6291448ae7844df6b0a`.
- Webhooks SHA-256 preservado:
  `47e923846ac650b31e78851ed5134297c7c7b653e828803a5fa10f5dadd01be4`.
- `git diff --check`: `PASS`.

## Escopo negativo

- `openapi:check`: não executado.
- Plan 15-08: não iniciado e não autorizado.
- Nenhuma alteração de runtime, manifest, dependência, env, migration, push,
  PR, merge ou deploy.
