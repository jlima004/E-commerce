---
status: blocked
classification: BLOCKED
verified_at: 2026-07-10
rc1_a_verified_at: 2026-07-10
scope_revision: heroku-excluded
---

# Verificação — Backend RC1

## Escopo efetivo

O usuário confirmou a rotação das variáveis e retomou o gate sem Heroku. Produção Heroku, logs do release e runbook de rollback foram cancelados por decisão humana e não são critérios desta classificação. Nenhuma consulta Heroku foi realizada na retomada.

O RC1-A restringiu-se à recuperação do ambiente local: remover/reconstruir `node_modules` com o lockfile e executar as validações em ordem. Não autorizou ajustes de dependência, código, configuração, banco remoto ou produção. O lint bloqueou antes de build e antes da criação do Postgres Docker descartável.

## Baseline Git

| Campo | Resultado |
|---|---|
| Branch | `main` |
| LOCAL_SHA antes dos documentos da retomada | `5fe53e1c3cf9a86ade505836915a768226e96c7f` |
| ORIGIN_MAIN_SHA | `5fe53e1c3cf9a86ade505836915a768226e96c7f` |
| Divergência local/origin | `0/0` |
| Diff local/origin | vazio |
| Package/lockfiles alterados | não |
| Tag `v1.0-backend-rc*` existente | não encontrada |

`git diff --check` não apresentou erro antes da atualização documental. O worktree passou a conter somente as alterações documentais desta retomada.

## Suítes locais

| Verificação | Exit | Resultado | Duração | Evidência |
|---|---:|---|---:|---|
| `TMPDIR=/tmp npm run test:unit -w @dtc/backend` | 0 | PASS | Jest 84,194 s; wall 89,01 s | 43/43 suites e 673/673 testes passaram; 0 snapshots. |
| `test:integration:http` | — | BLOCKED / NOT RUN | — | Não há `.env.test`; o Postgres local não está comprovado como banco isolado e descartável. |
| `test:integration:modules` | — | BLOCKED / NOT RUN | — | Mesmo bloqueio de isolamento. |
| `HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run lint -w @dtc/backend` | 1 | **BLOCKER** | wall 4,33 s | `medusa lint` pulou a análise porque `eslint` não está instalado; lifecycle encerrou com código 1. Aviso AJV `missingRefs` também observado. |
| `build` | — | NOT RUN | — | Gate interrompido após o blocker do lint, sem correção. |

### RC1-A — reconstrução e repetição controlada

| Verificação | Exit | Resultado | Evidência |
|---|---:|---|---|
| `rm -rf node_modules` + `npm ci --include=dev` | 0 | PASS | Instalação concluída a partir do lockfile. |
| `npm ls eslint @medusajs/eslint-plugin --depth=0` | 0 | PASS | `eslint@9.39.4`; `@medusajs/eslint-plugin@2.16.0`. |
| `node_modules/.bin/eslint --version` | 2 | **BLOCKER** | Binário existe, mas falha no carregamento com AJV `missingRefs` e `TypeError ... defaultMeta`. |
| lint do workspace | 1 | **BLOCKER** | `medusa lint` ainda informa ESLint indisponível; nenhuma regra foi executada. |
| build | — | NOT RUN | Regra de parada após lint. |
| HTTP/modules | — | NOT RUN | Docker/Postgres, guard localhost e migrations descartáveis não foram iniciados após lint. |

O `package.json` raiz mantém o override `ajv: ^8.0.0`; o grafo efetivo instalou `ajv@8.20.0` para `@eslint/eslintrc@3.3.5`, enquanto o lockfile registra `eslint@9.39.4` com dependência `ajv@^6.14.0`. A incompatibilidade foi apenas registrada; não foi corrigida.

Nenhuma dependência foi adicionada ou alterada em manifests/lockfiles; `npm ci --include=dev` somente reconstruiu `node_modules` a partir do lockfile.

## Verificação estática e classificação de valores

- Nenhum segredo rastreado real foi confirmado.
- Ocorrências de `sk_live_*`, `sk_test_*`, `whsec_*`, `pi_*_secret_*` e `Bearer` foram revisadas sem imprimir valores e classificadas como canários deliberados/test fixtures curtos ou lógica de sanitização.
- DSN-like e PostHog ingestion-key-like apareceram somente em template/testes e não foram classificados automaticamente como segredo crítico.
- Nenhum `connect.sid` com valor, `pk_test_*` ou `sb_publishable_*` foi detectado.
- Chaves públicas, publishable keys, DSNs e identificadores/objetos Stripe test-mode foram classificados por finalidade antes da severidade. Nenhuma chave pessoal/administrativa foi identificada nesta trilha.

## Supabase read-only — smoke canônico

Projeto único confirmado como `ecommerce`, estado `ACTIVE_HEALTHY`. Somente `SELECT`/ferramentas de leitura foram usados; email, metadata e payload brutos não foram exibidos.

| Invariante | Resultado |
|---|---|
| PaymentAttempt | `payment_confirmed_by_webhook`, Stripe, BRL 9900, Order e PaymentIntent corretos |
| CheckoutCompletionLog | `completed`, correlações corretas, sem erro terminal |
| Order | pagamento `partially_refunded`, order status `confirmed`, não cancelada |
| `purchase_completed_count` | `1` |
| Analytics | exatamente um evento `recorded`, correlações corretas |
| RefundRequest | `confirmed`, BRL 100, correlações corretas, sem falha |
| `email_delivery_count` | `0` |
| `gelato_fulfillment_count` | `0` |
| `refund_request_count` | `1` |

Todas as invariantes de banco mantidas no escopo passaram.

## Stripe test mode read-only

- PaymentIntent canônico: `status=succeeded`, `amount=9900`, `currency=brl`.
- O conector seguro não expôs `livemode` nem `amount_received`; esses dois campos não foram comprovados.
- Refund ID foi obtido do banco, mas o objeto Refund não foi consultado porque o gate já havia parado no blocker do lint.
- Nenhuma criação, refund, replay ou outra chamada mutável foi executada.

## Auditoria de migrations

- Nove arquivos locais inventariados.
- A fonte efetiva da aplicação é `public.mikro_orm_migrations`, com 181 entradas aplicadas.
- Todos os nove arquivos locais têm entrada correspondente aplicada.
- Não foi encontrada migration local pendente.
- Os quatro arquivos com nome `TBD-*` não são drafts pendentes: estão aplicados desde 2026-07-03. A nomenclatura é uma observação documental, não uma migration esquecida.
- Nenhum DDL ou comando de migration foi executado.

## Etapas canceladas

- Etapa 4 — Produção somente leitura Heroku: cancelada/fora do escopo.
- Etapa 8 — Logs do release atual: cancelada/fora do escopo.
- Etapa 9 — Runbook de rollback: cancelada/fora do escopo.

## Classificação final

**BLOCKED.** Motivos técnicos:

1. `npm ci` concluiu, mas ESLint permaneceu não carregável devido à incompatibilidade AJV e o lint encerrou em 1;
2. integrações HTTP/modules não foram iniciadas porque o lint bloqueou antes da etapa do banco isolado e descartável;
3. build não foi executado pela regra de parada.

Não corrigir estes blockers neste gate. A tag `v1.0-backend-rc1` não está autorizada.
