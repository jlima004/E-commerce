## Resultado

Gate Supabase concluído com sucesso.

-  Supabase migrations: PASS
- `db:migrate:safe`: PASS, exit code 0
- Custom tables: 9/9 confirmadas
- Custom indexes: confirmados
- Migrations custom confirmadas: 9/9
- Build pré-migration: PASS
- Backup pré-migration: registrado
- Remote health smoke: PASS
- Deploy: não executado
- Phase 12: não iniciada
- Stripe/Gelato/Correios real: não executados


## Observações

- A URL Node usou `sslmode=require&uselibpqcompat=true` para evitar `SELF_SIGNED_CERT_IN_CHAIN`.
- A URL `psql` removeu `uselibpqcompat=true`, pois `psql/libpq` não aceita esse parâmetro.
- Durante o migration runner surgiram warnings de scheduled jobs inexistentes (`job-analytics-posthog-relay`, `job-email-resend-relay`, `job-gelato-dispatch-relay`). Não bloquearam a migration; revalidar no futuro gate de deploy/worker.
- Node usado no gate: v22.23.0.


## Health smoke remoto

Target:

- `https://espacoliminar-5c3343d789bf.herokuapp.com`

Resultados:

- `GET /health` → `OK`
- `GET /health/live` → PASS — `status=live`, `service=medusa-backend`, `version=d02fd70`
- `GET /health/ready` → PASS — `status=ready`, `postgres=up`, `redis=up`, `version=d02fd70`

Observação:

- `GET /` retorna 404, esperado/não bloqueante para este backend.
- O release remoto reporta `version=d02fd70`; este gate não realizou deploy da branch ops.
