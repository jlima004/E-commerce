---
quick_task: 260713-mny01-major-minor-units
status: passed
classification: PASS
verified_at: 2026-07-13
---

# Verificação — Hotfix MNY-01

## Resultado

**PASS.** A fronteira monetária ficou explícita e exata: Medusa core e PaymentSession usam BRL major units; Stripe, PaymentAttempt e os contratos customizados já definidos usam minor units. Nenhum provider externo ou dado de produção foi acessado ou alterado.

## Baseline

- Branch inicial: `main`.
- HEAD inicial: `eceedd375374b45462384f091b0920bdd5f08005`.
- Worktree inicial e `git diff --check`: limpos.
- `git fetch origin` executado; divergência inicial `origin/main...HEAD`: `0 0`.

## Matriz verificada

| Superfície | Unidade final |
|---|---|
| Product/PriceSet/Cart/Order/line item/PaymentSession Medusa | major units |
| Stripe PaymentIntent e Stripe Refund | minor units |
| PaymentAttempt, RefundRequest, captured/refunded customizados | minor units |
| Analytics `purchase_completed` e e-mail financeiro canônico | minor units |
| Payload financeiro Gelato já derivado do domínio customizado | minor units |

## Provas focadas

- Utilitário monetário: 1 suíte, 29/29 testes.
- Fronteira payment eligibility/Card/Pix/Stripe/Order/catálogo: 9 suítes, 145/145 testes.
- Fixtures unitárias diretamente afetadas: 7 suítes, 69/69 testes.
- Outbox/entrypoint após o ajuste final de tipagem e nomenclatura: 3 suítes, 31/31 testes.
- HTTP de PaymentAttempt: 33/33 testes.
- HTTP focado de PaymentAttempt, Order webhook, catálogo Store/Admin e checkout: 91/91 testes.

Os testes provam `99 -> 9900`, `99.9 -> 9990`, `"99.90" -> 9990`, `0.01 -> 1` e `49.5 x 2 -> 9900`; rejeitam zero pagável, negativos, precisão maior que duas casas, `NaN`, `Infinity` e overflow. Card cria PaymentSession com `99`, chama Stripe fake com `9900`, persiste/responde PaymentAttempt `9900` e rejeita retorno Stripe `99`. Pix preserva a mesma fronteira até o ponto suportado. O guard da Order aceita Cart `99` ou `49.5 x 2` contra PaymentAttempt `9900`, rejeita PaymentAttempt `99` e mantém `ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH`.

## Suítes completas

| Gate | Resultado |
|---|---|
| Unit | 44/44 suítes; 717/717 testes; exit 0 |
| Integration modules | 28/28 suítes; 462/462 testes; exit 0 |
| Integration HTTP | 14/14 suítes; 170/170 testes; exit 0 |
| Lint | exit 0; 0 erros; 208 warnings, igual ao baseline RC1-H |
| Build | exit 0; compilação concluída com sucesso |
| `git diff --check` | sem saída |

Modules e HTTP usaram PostgreSQL 16 local em `127.0.0.1`, nos bancos descartáveis `mny01_modules` e `mny01_http`. Ambos foram removidos; a consulta final de existência retornou vazia. A primeira execução HTTP completa expôs uma referência de mock fora do escopo em teste (`stripePixInitiationLayer`), 169/170; a fixture de teste foi corrigida, o foco passou 33/33 e a suíte completa repetida passou 170/170. O primeiro build detectou três acessos de payload tipados como `unknown` somente em novas asserções; as asserções foram tipadas, seus testes repetidos passaram e dois builds finais passaram.

## Auditorias negativas

- Nenhum diff em `models/**` ou `migrations/**`.
- Nenhum diff em `package.json`, `package-lock.json` ou `apps/backend/package.json`.
- Nenhuma dependência adicionada; conversão implementada com string decimal e `BigInt`.
- Nenhum arredondamento silencioso por `Math.round(value * 100)`.
- Nenhum nome monetário interno genérico cruza Medusa e Stripe; campos explícitos `medusa_amount_major`, `provider_amount_minor` e `amount_minor` foram verificados.
- `PaymentAttempt.amount = 9900` continua `9900` no webhook, refund customizado, analytics e e-mail; regressões impedem `990000`.
- Nenhuma alteração em APP_VERSION, Redis, Event Bus, locking, Heroku, providers de produção ou Phase 12.
- Nenhum acesso a Supabase/produção, chamada Stripe/Gelato/Resend/PostHog/Correios real, PaymentIntent, refund, replay de webhook, deploy, rollback, tag ou push.

## Commits de código

- `47e76d5` — `fix(payments): separate Medusa major units from Stripe minor units`
- `db89573` — `test(payments): prove major-to-minor monetary boundaries`
- `b7cd48f` — `docs(payments): record monetary unit hotfix`

O fechamento documental foi criado no terceiro commit autorizado `b7cd48f`. A divergência final é 0--0.
