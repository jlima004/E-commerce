# Indicio Cult E-commerce — Backend

Backend headless de um e-commerce Print-on-Demand (POD) de camisetas para o
mercado brasileiro, construído com Medusa v2 e operado em Brasil/BRL. O backend
MVP está completo e publicado: catálogo, checkout, pagamento, criação confiável
de pedidos, fulfillment, tracking, operações administrativas e observabilidade
fazem parte da versão `v1.0`.

O storefront não faz parte deste repositório e ainda não foi iniciado. As APIs
Store e Admin expõem contratos estáveis para seu consumo futuro.

## Estado atual

| Item | Estado |
|---|---|
| Milestone | `v1.0 Backend MVP` |
| Status | Completo, fechado, arquivado, tagged e released em 2026-07-30 |
| Fases | 13/13 completas e fechadas |
| Planos | 62/62 completos |
| Requisitos | 45/45 completos |
| Blockers ativos | 0 |
| Verificações obrigatórias pendentes | 0 |
| Artefatos diferidos | 0 |
| GitHub Release | [`v1.0 — Backend MVP`](https://github.com/jlima004/E-commerce/releases/tag/v1.0), publicada |
| Próximo milestone | Não definido / não iniciado |

A versão publicada é identificada pela tag anotada `v1.0`, não pela ponta
corrente de `main`. O alvo imutável da tag e a identidade do archive do
repositório são `fbe986160535c1ba9d2a5f41ad9255e91cd13914`.

## Valor central

Um `Order` só existe após a confirmação de pagamento confiável, validada e
idempotente pelo webhook canônico do Stripe. Estados anteriores ao pagamento
permanecem em Cart, Payment Collection, Payment Session e `PaymentAttempt`.

A Gelato só recebe um pedido de produção após a existência do `Order` confirmado
e a passagem pelos gates locais duráveis, incluindo o registro local de
`purchase_completed`. Esse fluxo evita cobrança fantasma, pedido duplicado e
fulfillment indevido.

## Capacidades entregues

### Commerce

- Catálogo de produtos e variantes, com preços em BRL e validação de metadados
  Gelato antes da publicação e venda.
- Mídia pública do catálogo em Supabase Storage por interface S3.
- Carrinho ativo e checkout convidado ou autenticado.
- Associação segura de carrinho convidado a cliente autenticado.
- Coleta e validação dos dados brasileiros necessários ao checkout.

### Pagamento e Order

- Stripe `19.1.0` para cartão e fluxo Pix. A ativação operacional de Pix depende
  da elegibilidade da conta Stripe.
- `PaymentAttempt` para estados, tentativas, invalidação, concorrência e
  separação explícita entre valores em unidades maiores e menores.
- Iniciação Stripe em modo de teste com persistência allowlist-only; secrets,
  `client_secret`, QR e copia-e-cola Pix permanecem fora da persistência.
- Webhook Stripe com raw body intacto, assinatura obrigatória, persistência em
  `WebhookEventLog` e idempotência.
- `CheckoutCompletionLog` para criação concorrente e idempotente do `Order`
  somente após confirmação canônica do pagamento.
- Proteções contra reentrega, duplicidade, disputa concorrente e retomada de
  processamento obsoleto.

### Downstream

- `AnalyticsEventLog` como outbox durável de `purchase_completed`, com relay
  assíncrono para PostHog.
- `EmailDeliveryLog` como outbox de confirmação, com relay assíncrono e
  idempotente para Resend.
- `GelatoFulfillment` para elegibilidade, dispatch idempotente, tratamento de
  falhas e webhook de atualização da Gelato.
- Tracking seguro para convidados por token de acesso armazenado somente como
  hash e consulta pública com resposta reduzida.

### Operações

- Solicitação de reembolso via Admin e confirmação financeira apenas pelo
  webhook Stripe confiável.
- Trocas operacionais via Admin, com logística reversa dos Correios
  manual/semiautomática.
- `OperationalAlert` para falhas e estados que exigem atenção do operador.
- `AdminActionLog` para auditoria de ações administrativas sensíveis.
- Health checks, logs estruturados e Sentry com sanitização.
- Testes críticos dos invariantes de pagamento, `Order`, fulfillment,
  idempotência, constraints e concorrência.

## Limitações conhecidas

As limitações abaixo são não bloqueantes e não reabrem o milestone `v1.0`:

- envio real pelo Resend ainda não foi comprovado;
- dispatch real para a Gelato ainda não foi comprovado;
- evento real no PostHog ainda não foi comprovado;
- exercício externo do Sentry ainda não foi comprovado;
- alguns gates externos do Stripe permanecem não exercitados;
- Pix permanece condicionado à elegibilidade da conta Stripe;
- os Correios não possuem integração automática de API;
- o rollback real não foi executado.

## Stack

| Tecnologia | Versão / contrato | Uso |
|---|---|---|
| Node.js | `>=22 <23` | Runtime |
| npm | `10.9.8` | Gerenciador do monorepo |
| Medusa | `2.16.0` | Commerce headless, Admin e módulos |
| TypeScript | `^5.6.2` | Linguagem |
| PostgreSQL | Supabase | Persistência relacional |
| Redis | Contratos separados | Cache, event bus, workflow engine e locking |
| Supabase Storage | Interface S3 | Mídia pública do catálogo |
| Stripe | `19.1.0` | Cartão, Pix, webhooks e reembolsos |
| Resend | `^4.8.0` | E-mail transacional assíncrono |
| PostHog | `^5.38.2` | Analytics server-side assíncrono |
| Sentry | `10.59.0` | Monitoramento de erros |
| Pino | `10.3.1` | Logs estruturados |
| Turbo | `^2.0.14` | Orquestração do monorepo |

O repositório não fixa uma versão operacional de PostgreSQL ou Redis; os
contratos versionados definem integração e comportamento, não a versão do
serviço gerenciado.

## Arquitetura

O backend segue a arquitetura modular do Medusa v2:

- **Custom modules** isolam domínios como `PaymentAttempt`,
  `WebhookEventLog`, `CheckoutCompletionLog`, outboxes, fulfillment, tracking,
  reembolsos, trocas, alertas e auditoria.
- **Module links** conectam módulos customizados a Cart, Payment Collection e
  Payment Session sem acesso direto ao banco de outro domínio.
- **Workflows** orquestram validação de catálogo, criação pós-webhook do
  `Order`, registro downstream e reembolsos.
- **Jobs e subscribers** têm o processo worker como ambiente de execução. Os
  relays entregues atualmente são jobs agendados para analytics, e-mail,
  dispatch Gelato, reconciliação e scanners operacionais.
- **Store API e Admin API** expõem contratos para consumidores e operadores.
- **Webhooks** Stripe e Gelato autenticam, deduplicam e persistem seus eventos
  antes de aplicar transições de domínio.
- **Outboxes locais** desacoplam a verdade transacional dos provedores
  externos.

### Runtime atual

A produção validada atualmente roda em Heroku com a topologia definida no
[`Procfile`](Procfile):

| Processo | Responsabilidade |
|---|---|
| `release` | Executa `db:migrate:safe` antes da nova formação |
| `web` | Serve HTTP e Admin com `WORKER_MODE=server` |
| `worker` | Executa jobs e trabalho assíncrono com `WORKER_MODE=worker` e Admin desabilitado |

PostgreSQL é fornecido pelo Supabase e Redis opera com TLS nos contratos de
cache, eventos, workflows e locks. A implantação em VPS com PM2 e Nginx
permanece documentada como blueprint portável em
[`ops/DEPLOY.md`](ops/DEPLOY.md); ela não representa o runtime de produção
corrente.

## Estrutura do repositório

```text
.
├── apps/
│   └── backend/
│       ├── src/
│       │   ├── api/             # Store API, Admin API, health e webhooks
│       │   ├── config/          # Ambiente e identidade de runtime
│       │   ├── infrastructure/  # PostgreSQL, Redis, storage e migrações
│       │   ├── jobs/            # Relays e reconciliações do worker
│       │   ├── links/           # Module links do Medusa
│       │   ├── modules/         # Domínios customizados persistentes
│       │   ├── observability/   # Pino, Sentry e sanitização
│       │   └── workflows/       # Orquestrações de catálogo, Order e refund
│       ├── integration-tests/   # Integração HTTP e de módulos
│       ├── medusa-config.ts
│       └── scripts/
├── docs/                        # PRD, SRS e modelo de dados
├── ops/                         # Blueprint VPS/PM2/Nginx e testes operacionais
├── .planning/                   # Estado, archive e evidências do milestone
├── Procfile                     # Topologia Heroku atual
└── turbo.json
```

## Desenvolvimento local

### Pré-requisitos

- Node.js compatível com `>=22 <23`;
- npm `10.9.8`;
- PostgreSQL acessível;
- Redis acessível.

### Configuração e execução

Instale as dependências e crie o arquivo local de ambiente:

```bash
npm ci
cp apps/backend/.env.template apps/backend/.env
```

Antes de continuar, edite `apps/backend/.env` e substitua os placeholders pelos
valores do seu ambiente local. Nunca commite esse arquivo ou qualquer secret.

Com PostgreSQL, Redis e as variáveis obrigatórias configurados, execute:

```bash
cd apps/backend
npm run db:migrate:safe
cd ../..

npm run dev
```

Por padrão, o desenvolvimento usa `WORKER_MODE=shared` e
`ADMIN_DISABLED=false`. O Medusa escuta em `http://127.0.0.1:9000` e o Admin
fica disponível em `/app`.

## Variáveis de ambiente

Os principais contratos são:

| Grupo | Variáveis |
|---|---|
| Banco | `DATABASE_URL`, `DATABASE_MIGRATION_URL` |
| Redis | `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL`, `WE_REDIS_URL` |
| Autenticação | `JWT_SECRET`, `COOKIE_SECRET` |
| URLs/CORS | `API_PUBLIC_URL`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` |
| Storage | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FILE_URL` |
| Stripe | `STRIPE_REAL_INITIATION_ENABLED`, chave apenas de teste e contratos de webhook |
| Observabilidade | `SENTRY_DSN` |
| Processos | `WORKER_MODE`, `ADMIN_DISABLED` |

O contrato completo e os placeholders seguros estão em
[`apps/backend/.env.template`](apps/backend/.env.template). A identidade de
runtime é resolvida pelos metadados da plataforma quando disponíveis, com
`APP_VERSION` como fallback operacional para outras topologias. Em
desenvolvimento, a ausência desses valores resulta na versão `dev`.

## Scripts

### Raiz

| Comando | Descrição |
|---|---|
| `npm run dev` | Desenvolvimento dos workspaces via Turbo |
| `npm run build` | Build dos workspaces |
| `npm run start` | Inicialização dos workspaces buildados |
| `npm run lint` | Lint dos workspaces |
| `npm run test` | Testes dos workspaces |
| `npm run backend:dev` | Desenvolvimento somente do backend |
| `npm run backend:seed` | Seed do backend |

### Backend (`apps/backend`)

| Comando | Descrição |
|---|---|
| `npm run dev` | `medusa develop` |
| `npm run build` | `medusa build` |
| `npm run start` | `medusa start` após o build |
| `npm run db:migrate:safe` | Migrações pela conexão apropriada |
| `npm run lint` | Lint do backend |
| `npm run test:unit` | Testes unitários |
| `npm run test:integration:http` | Testes de integração HTTP |
| `npm run test:integration:modules` | Testes de integração de módulos |

## Health checks

| Endpoint | Propósito | Resposta |
|---|---|---|
| `GET /health/live` | Confirma que o processo HTTP responde | `200` |
| `GET /health/ready` | Verifica PostgreSQL e Redis | `200` ou `503` |

Readiness consulta PostgreSQL e Redis com limites de tempo. Se uma dependência
obrigatória não estiver pronta, a rota retorna `503` com resposta sanitizada.

## Testes

A estratégia de testes cobre:

- testes unitários de módulos, workflows, jobs, validação e segurança;
- integração HTTP das APIs Store, Admin, health e webhooks;
- integração de módulos Medusa;
- invariantes do fluxo pagamento → webhook → `Order` → downstream;
- idempotência e concorrência de webhook e criação de `Order`;
- PostgreSQL real descartável para constraints, locks e disputas concorrentes;
- contratos operacionais de Redis, release, PM2/Nginx e observabilidade.

Os números de casos não são fixados aqui porque evoluem com o código. Consulte
os scripts dos manifests e as evidências arquivadas do milestone para os gates
validados.

## Release e operação

| Item | Valor |
|---|---|
| GitHub Release | [`v1.0 — Backend MVP`](https://github.com/jlima004/E-commerce/releases/tag/v1.0) |
| Tag anotada | `v1.0` |
| Archive / alvo da tag | `fbe986160535c1ba9d2a5f41ad9255e91cd13914` |
| Runtime validado | Heroku `v78` |
| SHA do runtime | `18d809e4169daa301839542191f0d6794b02d695` |
| Alvo de rollback | Heroku `v77` |
| Rollback executado | Não |

O SHA do runtime implantado e o commit de archive do repositório são
identidades distintas. A tag `v1.0` permanece no merge da PR #9; ela não aponta
para o SHA implantado. O [`Procfile`](Procfile) é a autoridade para a topologia
Heroku atual, enquanto [`ops/DEPLOY.md`](ops/DEPLOY.md) documenta a alternativa
portável VPS/PM2/Nginx.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`.planning/PROJECT.md`](.planning/PROJECT.md) | Escopo, requisitos e decisões canônicas |
| [`.planning/ROADMAP.md`](.planning/ROADMAP.md) | Roadmap compacto e archive do milestone |
| [`.planning/MILESTONES.md`](.planning/MILESTONES.md) | Registro do milestone e da release |
| [`.planning/STATE.md`](.planning/STATE.md) | Estado consolidado do projeto |
| [`.planning/milestones/v1.0-MILESTONE-AUDIT.md`](.planning/milestones/v1.0-MILESTONE-AUDIT.md) | Auditoria de fechamento da `v1.0` |
| [`docs/PRD_Backend_v1.1.md`](docs/PRD_Backend_v1.1.md) | Requisitos de produto do backend |
| [`docs/SRS_v1.5.md`](docs/SRS_v1.5.md) | Especificação de software |
| [`docs/DB_MODEL_v1.21.md`](docs/DB_MODEL_v1.21.md) | Modelo de dados |
| [`AGENTS.md`](AGENTS.md) | Contexto para desenvolvimento assistido |
| [GitHub Release `v1.0`](https://github.com/jlima004/E-commerce/releases/tag/v1.0) | Versão publicada |

## Segurança

- Tokens de tracking são persistidos somente como hash; o token puro não é
  armazenado.
- O webhook Stripe exige raw body intacto e assinatura válida antes de aceitar
  o evento.
- O webhook Gelato exige autenticação por header dedicado e falha de forma
  fechada quando o contrato não é satisfeito.
- Logs estruturados e eventos Sentry passam por sanitização antes do envio.
- Secrets, credenciais, dados completos de cartão e tokens puros nunca devem
  ser commitados ou registrados.
- `client_secret`, QR, copia-e-cola e payloads sensíveis de Stripe/Pix
  permanecem somente na resposta quando aplicável.

## Escopo futuro

- **Frontend/storefront:** projeto posterior, ainda não iniciado.
- **Próximo milestone:** não definido e não iniciado.
- **Phase 13:** não iniciada e não autorizada.

Nenhum novo milestone é iniciado implicitamente pelo fechamento da `v1.0`.

## Licença

MIT — conforme [`apps/backend/package.json`](apps/backend/package.json).
