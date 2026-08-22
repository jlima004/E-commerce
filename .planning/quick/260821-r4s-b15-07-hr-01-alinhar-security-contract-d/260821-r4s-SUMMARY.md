---
quick_id: 260821-r4s
slug: b15-07-hr-01-alinhar-security-contract-d
status: complete
completed: 2026-08-21
scope: B15-07-HR-01-only
---

# Quick Task 260821-r4s — B15-07-HR-01

## Resultado

O contrato OpenAPI das seis operações Cart M1 agora exige a autoridade BFF
server-to-server junto da publishable Store key em todas as alternativas. A
política comum `STORE_OPTIONAL_CUSTOMER` não foi alterada.

## Validação

- `23/23` testes do Store contract PASS.
- Store OpenAPI gerado exclusivamente pelo writer.
- `openapi:lint` PASS.
- Admin/Webhooks inalterados por hash.
- Commit de implementação: `637f19d` — `fix(15-07): require BFF authority in cart OpenAPI`.
- Remediação registrada em `15-07-SUMMARY.md`.

## Não-ações e checkpoint

Runtime, manifest e superfície Store permaneceram inalterados. `openapi:check`
não foi executado; 15-08 não foi iniciado nem autorizado; não houve push, PR,
merge ou deploy. `15-07 HUMAN REVIEW: PENDING`.
