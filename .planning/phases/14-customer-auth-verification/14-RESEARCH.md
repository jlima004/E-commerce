# Phase 14: Customer Auth & Verification — Research

**Pesquisado em:** 2026-08-11

**Domínio:** autenticação Customer, verificação de e-mail, rotação/revogação de credenciais e recuperação de senha

**Compatibilidade-alvo:** artefatos npm Medusa `2.16.0` efetivamente instalados, Node.js `22.x`, PostgreSQL como autoridade e Redis somente como coordenação

**Confiança geral:** HIGH para o as-built, lockfile, tarballs npm e código instalado; MEDIUM para o tag GitHub `v2.16.0`, release notes e documentação oficial corrente; INFERENCE onde este documento recomenda desenho futuro. O tag diverge do artefato instalado no seam de verification e não corrobora fatos desse seam sem comparação individual. [VERIFIED: `apps/backend/package.json`, `package-lock.json`, tarballs npm e `node_modules/@medusajs/*@2.16.0`]

<user_constraints>
## User Constraints (from CONTEXT.md)

> Conteúdo abaixo copiado de `14-CONTEXT.md`; D14-01..D14-16 e as regras transversais são imutáveis. [VERIFIED: `.planning/phases/14-customer-auth-verification/14-CONTEXT.md`]

### Locked Decisions

#### Cadastro parcialmente concluido

- **D14-01 — Estado intermediario recuperavel:** identidade criada sem
  `Customer` e uma intencao pendente recuperavel. Retry com as mesmas
  credenciais e intencao semanticamente compativel retoma o fluxo
  idempotentemente, sem duplicar identidade ou `Customer` e sem expor a falha
  parcial.
- **D14-02 — Concorrencia converge:** tentativas concorrentes aguardam ou
  observam um unico resultado canonico persistido. No maximo um `Customer` e
  criado; a garantia deve vir de persistencia, constraint e idempotencia, nao
  apenas de lock em memoria.
- **D14-03 — Retry incompativel nao altera a intencao:** novo payload
  semanticamente incompativel para o mesmo e-mail e rejeitado sem sobrescrever
  nome, senha ou qualquer dado pendente. A resposta permanece generica e
  anti-enumeracao; a intencao original continua retomavel.
- **D14-04 — Intencao pendente tem TTL finito:** a janela e persistida e
  limitada. Depois de expirar, a intencao nao e reutilizada, dados sensiveis
  nao sao reaproveitados implicitamente e um novo cadastro pode iniciar sem
  revelar o estado anterior. O valor exato do TTL fica para RESEARCH.

#### Limite da sessao inicial

- **D14-05 — Refresh preserva a linhagem, nao cria sessao logica:** refresh
  valido renova somente a credencial tecnica da mesma sessao inicial. A
  permissao excepcional do `Customer` nao verificado continua apenas dentro
  dessa linhagem e nunca estende o limite absoluto original.
- **D14-06 — Rotacao de refresh e access token curto:** cada refresh token e
  de uso unico. Refresh bem-sucedido consome imediatamente o token apresentado
  e emite um descendente para a mesma linhagem. Access tokens anteriores
  sobrevivem somente ate sua expiracao curta.
- **D14-07 — Reuse/replay revoga toda a linhagem:** reutilizar refresh token
  consumido invalida inclusive o refresh descendente, impede novas renovacoes
  e deve rejeitar access tokens ativos quando o mecanismo arquitetural
  permitir. A resposta publica e generica e a evidencia interna nao registra
  tokens. RESEARCH pode avaliar recuperacao atomica/idempotente de resposta
  perdida, sem aceitar reutilizacao arbitraria.
- **D14-08 — Expiracao absoluta encerra o cliente, nao a verdade server-side:**
  ao atingir o limite absoluto, novas chamadas autenticadas sao bloqueadas sem
  destruir carrinho, checkout ou dados persistidos e sem conceder grace period.
  Processamento server-side continua; o webhook Stripe canonico continua apto
  a confirmar pagamento e criar `Order`. Nova acao do usuario exige verificacao
  e nova autenticacao.

#### Verificacao e reenvio

- **D14-09 — Primeiro envio automatico e nao bloqueante:** depois de identidade
  + `Customer` confirmados, o backend registra automaticamente e de forma
  duravel/idempotente a intencao de verificacao. Falha ou atraso do provedor
  nao reverte cadastro, nao encerra a sessao inicial e nao muda a resposta
  publica.
- **D14-10 — Reenvio e latest-wins atomico:** cada reenvio elegivel cria nova
  intencao/token e invalida todos os tokens anteriores ainda ativos. Reenvios
  concorrentes nao podem deixar duas intencoes validas. Depois da confirmacao,
  nenhum token de verificacao daquela identidade permanece utilizavel.
- **D14-11 — Token verifica, mas nao autentica:** token valido, vigente,
  hash-only e de uso unico pode confirmar o e-mail em outro navegador ou
  dispositivo, sem sessao ativa. A confirmacao nao cria sessao nem emite JWT;
  o usuario precisa autenticar-se normalmente depois.
- **D14-12 — Reenvio tem aceite publico uniforme:** e-mail inexistente, ja
  verificado, pendente inelegivel ou temporariamente limitado recebe o mesmo
  resultado publico. Somente identidade pendente e elegivel gera intencao e
  envio. Existencia, elegibilidade, rate limit, idempotencia e resultado do
  provedor permanecem internos.

#### Reset e revogacao

- **D14-13 — Reset nao equivale a verificacao:** identidade nao verificada pode
  solicitar e concluir reset, mas continua nao verificada. Reset nao autentica,
  nao cria sessao e revoga todas as linhagens existentes; novo login permanece
  bloqueado ate a verificacao do e-mail.
- **D14-14 — Reset e latest-wins atomico:** nova solicitacao elegivel cria nova
  intencao/token e invalida todos os anteriores ativos. Tokens sao hash-only,
  expiraveis e de uso unico; requests concorrentes nao deixam duas intencoes
  validas e a conclusao invalida qualquer token remanescente.
- **D14-15 — Sucesso de reset e composto e fail-closed:** `reset success`
  significa, em conjunto, senha persistida, token definitivamente consumido e
  todas as linhagens revogadas. Nao ha sucesso publico enquanto qualquer
  garantia estiver incerta. Falha parcial e recuperavel/reconciliavel e retries
  convergem idempotentemente; o mecanismo transacional exato fica para RESEARCH.
- **D14-16 — Alteracao autenticada exige senha atual:** troca iniciada por
  usuario autenticado exige sessao valida e confirmacao da senha atual. Depois
  da nova senha persistida, todas as linhagens, inclusive a corrente, sao
  revogadas; nenhuma sessao substituta e emitida. O usuario autentica-se de
  novo, sujeito a verificacao de e-mail quando aplicavel.

#### Regras transversais

- Tokens de refresh, verificacao e reset nunca aparecem em logs, telemetry,
  analytics, exemplos ou evidencia persistida; quando persistencia propria for
  necessaria, o material verificavel e hash-only.
- Tokens de verificacao/reset sao expiraveis, de uso unico e fail-closed.
- Respostas publicas de cadastro, login, verificacao, reenvio e reset sao
  minimizadas e anti-enumeracao. Estados internos, existencia de conta e
  resultado do provedor nao podem formar oracle.
- Logout do dispositivo atual permanece responsabilidade do BFF; revogacao
  backend de linhagens e credenciais segue as decisoes acima.
- Nenhuma sessao ou falha de e-mail altera os invariantes de pagamento,
  `Order`, analytics, e-mail de pedido ou Gelato ja consolidados no backend.

### the agent's Discretion

O futuro RESEARCH pode comparar mecanismos Medusa/customizados para modelo
fisico, constraints, transacoes, outbox auth, TTLs de verificacao/reset,
rotacao/reuse detection, enforcement de access-token revocation, recuperacao de
resposta perdida e rate limits. Nao ha discricionariedade para relaxar
latest-wins, uso unico, hash-only, anti-enumeracao, limite absoluto, revogacao
global, fail-closed, BFF-only ou autoridade do webhook Stripe. Qualquer escolha
exige RESEARCH e PLAN aprovados separadamente.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

RESEARCH, PLAN, SPEC/SDD, implementation prompt, execution, tests, migrations,
providers, deploy, frontend e fases posteriores permanecem bloqueados ate
autorizacao humana explicita e separada.
</user_constraints>

## Research Scope

Este estudo cobre somente `AUTH-01..AUTH-09` e responde `R14-01..R14-16`; não implementa endpoints, modelos, migrations, testes, configuração, provider, frontend ou deploy. [VERIFIED: pedido Phase 14 e `14-CONTEXT.md`]

A ordem de autoridade aplicada foi: decisões D14 imutáveis; artefato npm efetivamente instalado; `package-lock.json` e metadata/tarball npm; upstream individual comprovadamente equivalente; release notes/documentação; somente então inferência explicitamente rotulada. O tag nominal `v2.16.0` não foi presumido equivalente ao pacote de mesma versão. [VERIFIED: pedido Phase 14]

### Phase Requirements

| ID | Descrição normativa | Apoio desta pesquisa |
|---|---|---|
| AUTH-01 | Coordenar criação da identity com `Customer`; registration JWT não equivale a `Customer`. | R14-01, R14-02, persistência `RegistrationIntent`. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| AUTH-02 | Sessão inicial flexível para não verificado; novo login após término exige verificação. | R14-03, R14-04 e guard de linhagem. [VERIFIED: `.planning/REQUIREMENTS.md`, `14-CONTEXT.md`] |
| AUTH-03 | Login e logout BFF-only; não inventar operação Store quando não houver operação legítima. | R14-01, R14-13, R14-14. [VERIFIED: `.planning/REQUIREMENTS.md`, `14-CONTEXT.md`] |
| AUTH-04 | Reset request/complete com token expirável, one-time e anti-enumeração. | R14-07, R14-08. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| AUTH-05 | Reset/change revogam credenciais anteriores e sessão antiga é rejeitada. | R14-03, R14-04, R14-08, R14-16. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| AUTH-06 | Refresh somente para credencial válida, não expirada e não revogada. | R14-03, R14-05. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| AUTH-07 | Request/resend/confirm/status de verificação com estados públicos estáveis. | R14-06, R14-09, R14-14. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| AUTH-08 | Materializar verificação/outbox custom hash-only quando necessário. | R14-06, R14-09, R14-15. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| AUTH-09 | Rate limit e anti-enumeração em signup/login/reset/resend/verification. | R14-10 e Security Findings. [VERIFIED: `.planning/REQUIREMENTS.md`] |

## Reconciliação Medusa 2.16.0 — Artefato npm × Tag

O artefato npm efetivamente instalado neste repositório é a autoridade as-built
da Phase 14. O tag/ref GitHub `v2.16.0` diverge materialmente desse artefato no
seam de verificação de e-mail; por isso, o tag não é evidência HIGH para uma
afirmação de verification sem equivalência individual comprovada. Release notes
e documentação corrente permanecem apenas contexto MEDIUM. [VERIFIED: filesystem
instalado, lockfile, tarballs npm, GitHub oficial]

### Identidade instalada e origem

| Pacote | Versão/path efetivo | Origem e identidade |
|---|---|---|
| `@medusajs/medusa` | `2.16.0`; `node_modules/@medusajs/medusa`; entry `dist/index.js` | npm normal; lock `resolved=https://registry.npmjs.org/@medusajs/medusa/-/medusa-2.16.0.tgz`; integrity `sha512-2wDt+TaAHNCAto3D9aygl87pfgkRBWmYhaFjrvBuGY/bQRIe2jf3GN2Q/DhST+3PLUSxTziMRNHmWRdz7+Iutg==`. |
| `@medusajs/auth` | `2.16.0`; `node_modules/@medusajs/auth`; entry `dist/index.js` | transitivo de `@medusajs/medusa`; npm normal; resolved `https://registry.npmjs.org/@medusajs/auth/-/auth-2.16.0.tgz`; integrity `sha512-LnA5fKDoO3EYGtFcvBrg/vUoU19UC+t6N3i8Dul3zg6DGLYxxi2N4tSzZplKHc14AwsAbrpk5CqGST9aU9vx0Q==`. |
| `@medusajs/core-flows` | `2.16.0`; `node_modules/@medusajs/core-flows`; entry `dist/index.js` | transitivo de `@medusajs/medusa` e peer de test-utils; npm normal; resolved `https://registry.npmjs.org/@medusajs/core-flows/-/core-flows-2.16.0.tgz`; integrity `sha512-bk1cHKfacKBktVZ0cI9LrnueQ1cViDHu2GRA/Qo/AVJ+VYo4X6sCaaNSR4eSqAxc5PGYyUUOejehLvSKfE+zug==`. |
| `@medusajs/framework` | `2.16.0`; `node_modules/@medusajs/framework`; entry `dist/index.js` | dependência direta e deduped; npm normal; resolved `https://registry.npmjs.org/@medusajs/framework/-/framework-2.16.0.tgz`; integrity `sha512-cp+tzwqvu9QnZol5S6z73xUrmX+Ea8FLuUuIY4Bom/kKq7h2XSouyxWOklE4ScckrZjGtNjrHPbooUi5Fn2o2g==`. |
| `@medusajs/auth-emailpass` | `2.16.0`; `node_modules/@medusajs/auth-emailpass`; entry `dist/index.js` | transitivo de `@medusajs/medusa`; npm normal; resolved `https://registry.npmjs.org/@medusajs/auth-emailpass/-/auth-emailpass-2.16.0.tgz`; integrity `sha512-sH51terDV2CYDQb2SEVYnzUMM9TdR8WHLCpyv6iEnE138CD7eNjjzZpMOBlK5+wy9UGX/yq6oQi1QmADC0Ocew==`. |

Cada path da tabela é o root físico real do pacote e contém o `package.json`
inspecionado em `<path>/package.json`. O backend em si é o workspace
`apps/backend`, ligado pelo root lock como `node_modules/@dtc/backend ->
apps/backend`; os pacotes Medusa não são workspace/file/git dependencies.
[VERIFIED: realpath, package metadata e lockfile]

O root `package-lock.json` v3 é a origem de resolução do workspace
`apps/backend`; os cinco pacotes possuem exatamente um `package.json` sob
`node_modules`, sem segunda versão aninhada. `npm ls` os resolveu todos como
`2.16.0` e deduplicou `framework`. O SHA-512 recalculado dos cinco tarballs npm
coincide com o lock/registry, e a comparação recursiva do conteúdo instalado
com os tarballs foi byte-equal; a única sobra observada foi um diretório
`dist/migrations` local extra em `auth-emailpass`, sem arquivo e sem participação
no entrypoint. [VERIFIED: `npm ls`, `npm explain`, `require.resolve`, `find`,
`npm view`, SHA-512 e `diff -qr` read-only]

O registry npm informa `gitHead=3a13d78eed5a2eccc904437e489560e8d89f8894`
para `auth`, `core-flows`, `framework` e `auth-emailpass`; esse é o commit de
release de 2026-06-18 e contém a superfície actor-agnostic equivalente ao
artefato. Para `medusa`, o metadata publicado expõe
`gitHead=cd1f5afa5aa8c0b15ea957008ee19f1d695cbd2e`, mas esse commit contém o
package legado `@medusajs/medusa@1.1.63`; logo, esse campo é inconsistente e não
prova a origem do build `medusa@2.16.0`. O tarball com SRI verificado, não esse
`gitHead`, continua sendo a autoridade para as rotas. [VERIFIED: npm registry e
commits oficiais GitHub]

### Classificação da comparação

**Resultado: DIVERGENT.** O tag `v2.16.0` aponta para o commit
`699a9a85c795e13f9e787056e0fb65cfea0115dc` de 2026-06-12; o commit de release
`3a13d78...` está 36 commits à frente. As diferenças relevantes são:

No filesystem realmente carregável existe **somente a Variante A**:
`node_modules/@medusajs/medusa/dist/api/auth/verification/request/route.js` e
`node_modules/@medusajs/medusa/dist/api/auth/verification/confirm/route.js`.
Não existe diretório `dist/api/auth/[actor_type]/[auth_provider]/verification`
nesse pacote; a Variante B existe somente no source do tag comparado.
[VERIFIED: package exports, `require.resolve` e `find`]

| Aspecto | Artefato npm instalado (autoridade HIGH) | Tag GitHub `v2.16.0` (contexto MEDIUM) |
|---|---|---|
| Rotas | `POST /auth/verification/request` e `POST /auth/verification/confirm` | `POST /auth/{actor_type}/{auth_provider}/verification/request|confirm` |
| Request | auth bearer/session, inclusive actorless; body `entity_id`, `entity_type`, `code_provider="token"`, `metadata` | sem auth; actor/provider vêm do path; body `entity_id`, `metadata` |
| Confirm | auth opcional; body `code`, `code_provider?` | sem auth; body `token`; provider vem do path |
| Persistência | `AuthVerification`: `entity_id`, `entity_type`, `code_provider`, `requested_at`, `verified_at`, `provider_metadata`, `metadata`; hash em `provider_metadata.token_hash`; expiry calculado, não persistido | `AuthVerificationToken`: colunas `token_hash`, `expires_at`, `metadata`, links a Auth/ProviderIdentity; verificado em `ProviderIdentity.provider_metadata.verified_at` |
| Estado de login | `authVerificationsPerActor` consulta `AuthVerification.verified_at`; ausência da config significa que login não exige verification | emailpass option `require_verification` marca `ProviderIdentity.provider_metadata.requires_verification`; confirmação grava `verified_at`/`requires_verification=false` |
| Evento `auth.verification_requested` | `entity_id`, `entity_type`, `code_provider`, `auth_identity_id`, `code`, `expires_at`, `metadata` | `entity_id`, `actor_type`, `provider`, `auth_identity_id`, `provider_identity_id`, `token`, `expires_at`, `metadata` |
| Consumo | mantém a linha/hash e grava `verified_at`; read-then-update sem transaction decorator/lock/CAS | em transaction manager, grava metadata da identity e deleta a linha-token, mas sem row lock/unique/CAS de concorrência |

Não surgiu finding material fora do seam autorizado. A direção arquitetural
permanece: PostgreSQL autoridade, Redis auxiliar, BFF-only, `/auth` raw negado,
estado/outbox custom quando os invariantes D14 excedem a primitive instalada.
[VERIFIED: reconciliação acima + D14-01..D14-16]

## Executive Findings

1. O Medusa `2.16.0` instalado tem primitives úteis para identity, Customer, JWT, reset e verificação, porém seu refresh apenas reemite JWT a partir de autenticação já válida; não há refresh token rotativo, família, lineage, replay detection, revogação global ou credential versioning nativos. [VERIFIED: `node_modules/@medusajs/medusa/dist/api/auth/token/refresh/route.js`, middleware e Auth models instalados]
2. O fluxo nativo é deliberadamente identity-first: `/auth/.../register` cria `AuthIdentity` e devolve JWT sem actor; `POST /store/customers` executa depois o workflow de `Customer` e associa `app_metadata.customer_id`. A janela entre chamadas, queda do cliente e falha posterior deixam identity sem Customer; a compensação do workflow Customer não prova uma transação única entre as duas requisições. [VERIFIED: rotas e `create-customer-account` instalados]
3. O reset nativo melhorou em `2.16.0`: usa JTI aleatório, hash SHA-256, TTL de 15 minutos e consumo atômico da linha. Entretanto, o middleware consome o JTI antes de atualizar a senha e o runtime não revoga linhagens inexistentes no modelo nativo. Logo, o sucesso composto D14-15 não é oferecido pronto. [VERIFIED: `create-password-reset-token`, `validate-token.js` e update route instalados]
4. No artefato instalado, a verificação guarda SHA-256 em `AuthVerification.provider_metadata.token_hash`, usa `requested_at`/`verified_at` na própria linha e calcula expiry por TTL; a confirmação é read-then-update sem transaction decorator, lock ou update condicional. O evento contém `code` plaintext e o Event Bus Redis persiste job data em BullMQ/Redis. Ela não atende, sem wrapper/persistência própria, latest-wins concorrente, confirmação estritamente one-time, outbox segura e resposta pública estável. [VERIFIED: Auth verification provider/workflows e `@medusajs/event-bus-redis@2.16.0` instalados; não derivado do tag divergente]
5. Inference: o PLAN deve manter PostgreSQL como autoridade e adotar estado customizado mínimo para intenção de signup, versão global da credencial, linhagens, refresh credentials, verification/reset intents e auth notification outbox; Redis deve limitar/coordenar, mas não decidir validade. [VERIFIED: gaps do as-built + decisões D14 + documentação PostgreSQL]

**Recomendação principal:** negar por padrão toda a superfície `/auth`, publicar somente operações Customer/emailpass explicitamente classificadas e envolvidas por contratos BFF, e implementar os invariantes ausentes como state machines PostgreSQL fail-closed antes de elevar `/store/customers*` ou qualquer operação auth de `DENY`. [VERIFIED: Phase 13 surface lockdown, D14-01..D14-16, auditoria 2.16.0]

## Architectural Responsibility Map

| Capability | Tier primário | Tier secundário | Racional |
|---|---|---|---|
| Cookies/browser session | BFF same-origin | Browser | O BFF guarda/renova credenciais; o navegador não recebe JWT Medusa. [VERIFIED: PRD Frontend, `14-CONTEXT.md`] |
| Identity, login, refresh, revogação | API/backend | PostgreSQL | A autorização exige estado autoritativo cross-dyno. [VERIFIED: SRS, D14-05..08] |
| Customer e vínculo identity | API/backend | PostgreSQL | O Medusa cria Customer e grava a correlação na identity. [VERIFIED: código instalado] |
| Verification/reset state | API/backend | PostgreSQL | One-time/latest-wins/fail-closed precisam de constraints e transações persistentes. [VERIFIED: D14-10..15; PostgreSQL docs] |
| Limitação de abuso | API/backend | Redis | Redis é adequado ao contador global; PostgreSQL conserva auditoria/estado, não cada hit. Inference: arquitetura recomendada. [VERIFIED: configuração Redis as-built + constraint de PostgreSQL-authority] |
| Entrega de e-mail | Worker/relay | Resend | O request público registra intenção; provider eventual não altera estado de negócio. [VERIFIED: relay as-built, D14-09] |
| Pagamento e criação de Order | Webhook backend | PostgreSQL | Continua fora do auth do cliente e sob webhook Stripe canônico. [VERIFIED: PROJECT, D14-08] |

## Project Constraints (from AGENTS.md)

- Responder e documentar em Português do Brasil. [VERIFIED: `AGENTS.md`]
- Base obrigatória Medusa v2 + Node.js + TypeScript; PostgreSQL/Supabase e Redis; Brasil/BRL. [VERIFIED: `AGENTS.md`]
- Browser storefront acessa somente o BFF; contratos devem permanecer estáveis para o frontend futuro. [VERIFIED: `AGENTS.md`, PROJECT]
- `Order` só nasce depois do webhook Stripe canônico, confiável e idempotente; auth/session não desfaz processamento server-side. [VERIFIED: `AGENTS.md`, `14-CONTEXT.md`]
- Tokens de tracking e auth não podem ser persistidos/logados em claro; secrets, cartão e tokens puros nunca entram em logs, exemplos ou telemetry. [VERIFIED: `AGENTS.md`, regras D14]
- PostgreSQL é a verdade de unicidade/idempotência; Redis coordena, mas não substitui constraints. Superfície Store desconhecida permanece `DENY`. [VERIFIED: `AGENTS.md`, Phase 13 CONTEXT]
- O registry TypeScript em `apps/backend/src/api-docs/` é a autoridade HTTP; JSON OpenAPI gerado nunca é editado manualmente e exemplos são sintéticos. [VERIFIED: `AGENTS.md`]
- Swagger UI continua não interativa; exposição produtiva exige gate humano separado. [VERIFIED: `AGENTS.md`]
- Esta pesquisa não autoriza edição de código, migration, teste, provider, deploy, commit ou avanço de gate. [VERIFIED: pedido Phase 14 e workflow GSD]

## R14-01 — As-Built Auth Inventory

### Medusa 2.16.0 Auth Surface

O pacote instalado materializa 18 operações em 14 arquivos de rota sob `/auth`. A resolução parte de `@medusajs/medusa` `main=dist/index.js`/exports `./api/* -> ./dist/api/*.js`; não há segunda cópia do pacote. Portanto, a árvore `dist/api/auth` abaixo é a efetivamente carregável pelo backend, não build antigo duplicado. A tabela não presume publicação: `deny/not exposed` significa que o guard futuro deve rejeitar a rota, mesmo que Medusa a registre internamente. [VERIFIED: package metadata, `require.resolve`, filesystem e inventário instalado]

| Path | Método | Actor/provider | Auth requerida | Efeito factual | Risco BFF-only | Classificação recomendada |
|---|---|---|---|---|---|---|
| `/auth/{actor_type}/{auth_provider}` | GET | genérico | não | autentica provider; pode devolver redirect ou JWT/result; não cria identity/session. [VERIFIED: route instalada] | actor/provider arbitrário e JWT poderia chegar ao browser. | **native usable with wrapper/guard** somente `customer/emailpass`; raw `DENY`. |
| `/auth/{actor_type}/{auth_provider}` | POST | genérico | não | autentica credenciais e emite JWT/result; não cria Customer/session. [VERIFIED: route instalada] | enumeração/timing, token direto, ausência de lineage. | **native usable with wrapper/guard**; BFF server-to-server. |
| `/auth/{actor_type}/{auth_provider}/callback` | GET | genérico/OAuth | não | conclui callback e pode emitir JWT. [VERIFIED: route instalada] | provider fora do escopo e redirect/token não contratados. | **deny/not exposed**. |
| `/auth/{actor_type}/{auth_provider}/callback` | POST | genérico/OAuth | não | variante POST do callback. [VERIFIED: route instalada] | idem. | **deny/not exposed**. |
| `/auth/{actor_type}/{auth_provider}/register` | POST | genérico | não | cria/reusa `AuthIdentity`/provider identity e devolve registration JWT sem actor; não cria Customer/session. [VERIFIED: route e emailpass provider instalados] | JWT direto; emailpass pode substituir senha de identity ainda sem actor. | **native usable with wrapper/guard** como primitive interna; raw `DENY`. |
| `/auth/{actor_type}/{auth_provider}/reset-password` | POST | genérico | não | cria reset JTI hash-only/15 min, emite evento e responde `201` mesmo quando workflow falha com `throwOnError:false`. [VERIFIED: route/workflow instalados] | evento carrega token; sem rate limit/outbox custom. | **custom required**; primitive de token pode ser avaliada internamente. |
| `/auth/{actor_type}/{auth_provider}/update` | POST | genérico | reset JWT | middleware valida e consome JTI, depois atualiza credencial. [VERIFIED: middleware/route instalados] | consumo antecede update; sem revogação global. | **deny/not exposed** raw; **custom required**. |
| `/auth/session` | POST | todos | bearer, inclusive unregistered | grava `auth_context` em `connect.sid` e devolve user. [VERIFIED: route instalada] | cria sessão Medusa paralela ao BFF. | **deny/not exposed**. |
| `/auth/session` | DELETE | todos | session | destrói sessão Medusa `connect.sid`. [VERIFIED: route instalada] | não é logout da lineage BFF e induz cookie/sessão paralela. | **deny/not exposed**. |
| `/auth/token/refresh` | POST | todos | bearer/session válida | reemite JWT; token anterior continua reutilizável até expirar. [VERIFIED: route instalada] | não existe rotação/replay/family e pode perpetuar exceção sem deadline custom. | **deny/not exposed**; **custom required**. |
| `/auth/verification/request` | POST | body `entity_id`, `entity_type`, `code_provider`, `metadata` | bearer/session, aceita unregistered | cria/atualiza verification e emite evento com `code`; responde `201 { verification }`, removendo somente `code`/`expires_at`, sem whitelist dos demais campos — inclusive `provider_metadata.token_hash` permanece no result nativo. [VERIFIED: route/validator/workflow/provider instalados] | caller fornece identifiers; resposta e evento expõem internals/capability; evento persiste capability no Redis; sem contrato público uniforme. | **custom required**; primitive nativa parcial. |
| `/auth/verification/confirm` | POST | body `code`, `code_provider?` | auth opcional (`allowUnauthenticated`) | busca hash, verifica TTL/`verified_at`, grava `verified_at`; responde `200` com `entity_id`, `entity_type`, `code_provider`, `verified_at`. [VERIFIED: middleware/route/provider instalados] | concorrência one-time não comprovada; resposta expõe metadados além do contrato público desejado. | **custom required**; raw `DENY`. |
| `/auth/mfa/challenges/{id}/verify` | POST | MFA | bearer/unregistered conforme fluxo | verifica challenge e pode emitir JWT. [VERIFIED: route instalada] | MFA fora do milestone e token direto. | **deny/not exposed**. |
| `/auth/mfa/factors` | GET | MFA | bearer/session | lista fatores. [VERIFIED: route instalada] | fora do escopo. | **deny/not exposed**. |
| `/auth/mfa/factors` | POST | MFA | bearer/session | cria fator. [VERIFIED: route instalada] | fora do escopo. | **deny/not exposed**. |
| `/auth/mfa/factors/{id}/verify` | POST | MFA | bearer/session | verifica/ativa fator. [VERIFIED: route instalada] | fora do escopo. | **deny/not exposed**. |
| `/auth/mfa/factors/{id}` | DELETE | MFA | bearer/session | remove fator. [VERIFIED: route instalada] | fora do escopo. | **deny/not exposed**. |
| `/auth/mfa/recovery-codes` | POST | MFA | bearer/session | gera recovery codes. [VERIFIED: route instalada] | secrets fora de contrato. | **deny/not exposed**. |

`medusa-config.ts` não configura `authMethodsPerActor` nem `authVerificationsPerActor`; o código nativo interpreta ausência de allowlist de métodos como permissão ampla de actor/provider e ausência/array vazio de verification config como verificação não obrigatória no login. A interface do `auth-emailpass` instalado oferece somente `hashConfig`: o mecanismo legado `require_verification` do tag não existe nesse provider npm. [VERIFIED: `apps/backend/medusa-config.ts`, config types, `validate-verification.js` e emailpass instalados]

O middleware global atual aplica CORS a `/auth` mas o `storeSurfaceGuardMiddleware` é delimitado a `/store`; portanto, não existe hoje um manifest fail-closed equivalente para a superfície auth. [VERIFIED: `apps/backend/src/api/middlewares.ts`]

Inference: o primeiro plano executável deve criar um inventário/guard auth deny-by-default, validar exatamente `actor_type=customer` e `auth_provider=emailpass`, e impedir acesso browser por CORS/origin e pelo contrato BFF; configuração Medusa é defesa adicional, não a única fronteira. [VERIFIED: as-built + Phase 13 fail-closed]

## R14-02 — Identity + Customer Coordination

### Capacidade nativa comprovada

1. Emailpass `register` usa o e-mail recebido como `entity_id` sem `trim()`/lowercase, cria `AuthIdentity`/provider identity e devolve JWT de registro sem actor. Se a identity existe sem `app_metadata`, o provider atualiza o hash da senha e retorna sucesso; se já há actor, sinaliza duplicidade. [VERIFIED: emailpass provider `2.16.0` instalado]
2. `POST /store/customers` requer o registration bearer sem actor, executa `createCustomerAccountWorkflow`, cria Customer `has_account=true` e grava `customer_id` em `AuthIdentity.app_metadata`. [VERIFIED: Store customer route e core flow instalados]
3. O workflow Customer possui compensações para apagar o Customer criado e restaurar/remover o metadata quando um passo posterior falha. Isso cobre falhas dentro daquela execução, mas não engloba a requisição anterior de register. [VERIFIED: core flow instalado]
4. Constraints as-built relevantes: provider identity possui unique parcial `(entity_id, provider)` para linhas não deletadas; Customer possui unique parcial `(email, has_account)` para linhas não deletadas. Nenhuma delas é case-insensitive. [VERIFIED: migrations/snapshots Medusa `2.16.0` instalados]

### Falhas e correlação

| Cenário | Resultado factual possível | Recuperação nativa suficiente? |
|---|---|---|
| register conclui, resposta perde-se antes de Customer | Identity sem Customer; cliente não tem resultado confiável. [VERIFIED: duas requisições separadas] | Não; retry emailpass pode alterar senha pendente. |
| register conclui, Customer request nunca ocorre | Identity sem `app_metadata.customer_id`. [VERIFIED: fluxo separado] | Não há intent/TTL. |
| criação Customer falha no workflow | Compensação tenta remover Customer/reverter metadata. [VERIFIED: workflow instalado] | Parcial; identity anterior permanece. |
| duas tentativas concorrentes | Constraints impedem duplicatas exatas, mas uma requisição pode falhar e não existe resultado canônico/intenção observável. [VERIFIED: constraints + ausência de coordinator] | Não atende D14-02. |
| mesmo e-mail com case/whitespace distintos | Podem ser identities/Customers distintos. [VERIFIED: comparação exata e constraints atuais] | Não. |
| retry com senha/nome incompatível | Provider pode substituir senha da identity pendente antes de detectar incompatibilidade de Customer. [VERIFIED: provider instalado] | Viola D14-03. |

Identificadores úteis comprovados são `auth_identity.id`, provider identity `(provider, entity_id=email)`, `customer.id` e `AuthIdentity.app_metadata.customer_id`; o Customer não possui foreign key direta para AuthIdentity. [VERIFIED: modelos/workflow instalados]

### Extensão necessária

Inference: criar `RegistrationIntent` autoritativa, chaveada pelo e-mail normalizado ativo, antes de chamar register. A transação/constraint escolhe um intent canônico; retries compatíveis retomam estados `pending_identity -> pending_customer -> completed`, concorrentes observam/aguardam esse resultado, e intent incompatível/expirado nunca chama novamente `register`. [VERIFIED: D14-01..04 + gaps nativos + PostgreSQL docs]

Inference: a intent deve persistir apenas um HMAC/fingerprint do payload sem senha e os valores imutáveis normalizados necessários; compatibilidade da senha deve ser verificada contra o hash scrypt já mantido pelo provider, sem gravar senha, hash determinístico da senha ou novo hash. [VERIFIED: password storage do provider + D14-03]

Não há evidência de transação única que abarque a criação nativa de AuthIdentity, a intent custom e Customer por módulos/serviços distintos. O PLAN deve provar propagação de um mesmo transaction manager antes de declarar atomicidade; sem essa prova, deve tratar o coordinator como state machine reconciliável. [VERIFIED: fronteiras de chamadas instaladas; nenhuma prova cross-module encontrada]

## R14-03 — Session Lineage and Refresh

### O que o Medusa oferece

| Capacidade | As-built 2.16.0 | Suficiente para D14? |
|---|---|---|
| Access JWT | `jsonwebtoken` assinado com claims de actor/auth identity/provider e `exp`; default `jwtExpiresIn` é `1d` quando não configurado. [VERIFIED: config/framework instalado] | Não: falta lineage/version e lookup de revogação. |
| Refresh | endpoint aceita bearer/session válido e emite novo JWT. [VERIFIED: refresh route] | Não: não há refresh credential separada nem rotação. |
| Session | `connect.sid` server-side opcional, TTL default de 10h. [VERIFIED: config types/defaults e routes] | Não usar: conflita com BFF-only. |
| Expiry | JWT expira criptograficamente; refresh recomeça `exp`. [VERIFIED: JWT generator] | Não há deadline absoluto original. |
| Logout | somente destrói `connect.sid`; bearer JWT permanece válido. [VERIFIED: DELETE session] | Não revoga lineage/access. |
| Credential version | ausente nos claims/modelo consultado. [VERIFIED: JWT generator/Auth models] | Não. |
| Token family / reuse | ausente. [VERIFIED: Auth models/routes] | Não. |
| Revogação global | bearer middleware verifica assinatura/exp/type, sem consulta de estado revogado. [VERIFIED: authenticate middleware] | Não. |

Resposta: o modelo nativo **não** é suficiente para logical lineage, teto absoluto da sessão inicial, rotação one-time, replay detection, family revocation ou revogação global por reset/change. [VERIFIED: inventário acima]

### Estado customizado mínimo recomendado

Inference: usar três responsabilidades persistentes: (a) `AuthCredentialState` por identity, com `credential_version`, `email_verified_at`, `revoked_before` e reset/change pendente; (b) `AuthSessionLineage` com `original_authenticated_at`, `absolute_expires_at` imutável, estado/reason e snapshot da versão; (c) `AuthRefreshCredential` com generation, `token_hash`, status e vínculo ao sucessor. [VERIFIED: D14-05..08, gaps nativos]

Inference: access JWT custom deve carregar identificador opaco de lineage (`sid` ou claim privado equivalente), versão da credencial e `jti`; o BFF nunca o expõe ao JavaScript/browser. O limite absoluto de 30 dias é salvo no nascimento da lineage e jamais recalculado no refresh. [VERIFIED: D14-05..08, PRD Frontend]

## R14-04 — Revocation Enforcement

| Mecanismo | Segurança/cross-dyno | Custo/indisponibilidade | Disposição |
|---|---|---|---|
| Só expiração JWT | Não rejeita token roubado após replay/reset/change. [VERIFIED: bearer middleware] | Barato, mas viola AUTH-05/D14-07. | Rejeitado. |
| Denylist por `jti` | Pode revogar tokens individuais, mas global reset exige enumerar JTIs e cleanup. Inference: complexidade desnecessária. | Lookup por request; crescimento proporcional a tokens. | Não usar como autoridade principal. |
| `credential_version` apenas | Revoga globalmente quando versão muda, mas não representa replay de uma lineage isolada. Inference. | Um lookup por request. | Complemento, não solução única. |
| `lineage.status` + versão | Rejeita lineage específica e toda identity; funciona em múltiplos dynos com PostgreSQL. Inference. | Um lookup indexado por request; DB indisponível => negar. | **Recomendado**. |
| Redis como autoridade | Cross-dyno enquanto disponível, mas eviction/perda/outage pode ressuscitar sessão. Inference. | Rápido; segurança depende de Redis. | Rejeitado. |
| PostgreSQL + cache Redis auxiliar | PostgreSQL decide; cache curto pode reduzir custo sem conceder validade além do DB. Inference. | Cache miss consulta DB; DB/estado incerto => `401/503` genérico e nenhuma ação. | **Recomendado**, cache opcional. |

Inference: todo endpoint Customer autenticado deve, depois de validar assinatura/expiry, consultar `AuthCredentialState` e `AuthSessionLineage` por claim opaca; aceitar somente `active`, versão igual, `now < absolute_expires_at` e identity vinculada ao Customer esperado. [VERIFIED: AUTH-02/05/06, D14-05..08]

O guard deve ser fail-closed: indisponibilidade do PostgreSQL ou inconsistência de cache não pode transformar token em válido. Redis pode guardar revogação/versão como aceleração e invalidar cross-dyno, mas cache positivo deve ter TTL no máximo igual ao access token e o desenho mais seguro consulta PostgreSQL em cada request sensível. Inference: a duração exata do cache é decisão do PLAN. [VERIFIED: constraints do projeto]

Após replay, reset, password change ou revogação global, a transação marca lineage(s) revogadas e/ou incrementa versão; tokens já emitidos passam a falhar no guard, não apenas quando o JWT expirar. Logout browser é BFF-only, mas para encerrar imediatamente a exceção de sessão inicial o BFF precisa solicitar internamente a revogação da lineage atual ou concluir um protocolo que produza o mesmo efeito autoritativo. Inference: rota/nome exato no PLAN. [VERIFIED: D14-07, D14-16 e regra de logout]

## R14-05 — Refresh Rotation and Lost Response

### Transição recomendada

Inference: em uma única transação PostgreSQL, fazer `SELECT ... FOR UPDATE` da refresh credential por hash; validar lineage/versão/deadline; transicionar `N: active -> consumed`; criar exatamente um `N+1: active`; gravar `replacement_id` e confirmar. A unique parcial de uma credencial ativa por `(lineage_id, generation)`/lineage impede dois descendentes canônicos. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html] [CITED: https://www.postgresql.org/docs/current/indexes-partial.html]

| Falha | Comportamento |
|---|---|
| crash antes do commit | `N` continua ativo; retry repete com segurança. [VERIFIED: semântica de transação PostgreSQL] |
| concorrentes antes do commit | lock serializa; o perdedor observa `consumed`. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html] |
| crash/resposta perdida depois do commit | `N` está consumido e `N+1` existe; replay indiscriminado não pode emitir `N+2`. [VERIFIED: D14-07] |
| replay tardio/chave diferente | revoga toda a lineage, inclusive descendente. [VERIFIED: D14-07] |

### Recuperação limitada de resposta perdida

Existem três estratégias factíveis:

1. falhar e exigir novo login; é simples e seguro, mas pode tornar irrecuperável a única lineage de um Customer ainda não verificado. Inference. [VERIFIED: D14-02 e D14-07]
2. persistir/encriptar o refresh sucessor para replay de resposta; viola ou enfraquece o requisito hash-only e aumenta blast radius. Inference: rejeitar. [VERIFIED: regras transversais]
3. derivar deterministicamente o capability `N+1` com HMAC/HKDF de segredo server-side + token `N` apresentado + lineage/generation + nonce não secreto persistido, guardar somente hash, e aceitar recuperação apenas com o mesmo `Idempotency-Key` BFF, dentro de uma janela curta e enquanto o descendente não foi usado. Inference: preserva hash-only e retorna o mesmo resultado já comprometido, não uma nova rotação. [VERIFIED: D14-07]

**Recomendação para PLAN:** estratégia 3, condicionada a threat-model e teste formal. O registro de rotação deve guardar `request_key_hash`, `recovery_until`, `replacement_id` e `replacement_used_at`; mesma chave+mesmo token na janela recupera exatamente `N+1`; qualquer chave distinta, janela expirada ou descendente já usado é replay e revoga a lineage. Inference: janela de 30–60 segundos é apenas baseline técnico, a ser fechada no PLAN. [VERIFIED: D14-07]

Limitação inevitável: servidor não consegue distinguir com certeza um BFF legítimo de um atacante que possua simultaneamente token consumido e idempotency key. A janela curta, vínculo à mesma requisição e bloqueio após uso de `N+1` limitam o risco; se o threat model rejeitar isso, a alternativa segura é falhar e exigir recuperação/verificação, nunca reutilização aberta. Inference. [VERIFIED: análise de replay]

## R14-06 — Verification

### Primitive nativa

O model efetivamente instalado é `AuthVerification`, não
`AuthVerificationToken`. Ele persiste `entity_id`, `entity_type`,
`code_provider`, `requested_at`, `verified_at`, `provider_metadata` e
`metadata`, além do link `auth_identity`; a unique parcial
`(auth_identity_id, entity_id, entity_type) WHERE deleted_at IS NULL` permite
uma única linha não deletada para a tupla. `token_hash` não é coluna: vive em
`provider_metadata.token_hash`. `expires_at` também não é coluna: é calculado
como `requested_at + ttl`. `requires_verification` não existe nesse model nem
no provider emailpass instalado. [VERIFIED: model, migration, provider e types
npm instalados]

No request, o provider gera `crypto.randomBytes(32).toString("base64url")`
(256 bits antes do encoding), calcula SHA-256 hexadecimal e usa TTL default de
900 s, configurável por `ttl_seconds` positivo. Para uma linha pendente
existente, faz update do mesmo registro com novo hash/`requested_at`, troca
`code_provider` e limpa `verified_at`; isso invalida sequencialmente o hash
anterior por substituição. Se a linha já está verificada, retorna a linha sem
gerar novo capability. Se não existe, cria a linha. [VERIFIED:
`verification-token.js` e token provider instalados]

A route `POST /auth/verification/request` chama
`requestVerificationWorkflow`; o step resolve `Modules.AUTH` e chama
`requestAuthVerification`. A route `POST /auth/verification/confirm` resolve
`Modules.AUTH` diretamente e chama `confirmAuthVerification`. Não há chamada
ao emailpass provider nesses dois handlers; emailpass fornece a
`ProviderIdentity` usada pelo gating de login. [VERIFIED: routes, workflow,
step e Auth service instalados]

`requestAuthVerification` usa `@InjectManager`, não
`@InjectTransactionManager`; o provider faz `list` seguido de `update` ou
`create`, sem row lock/CAS. A unique parcial evita duas linhas não deletadas,
mas não serializa dois requests: criação concorrente pode produzir conflito e
updates concorrentes são last-writer-wins, sem prova de que a geração mais nova
por tempo é a que permanece. Não há duas colunas de token ativas na linha, mas
isso não satisfaz D14-10 de convergência/latest-wins atômico. [VERIFIED:
decorators, provider e migration instalados]

Na confirmação, o provider busca por
`provider_metadata.token_hash=sha256(code)`, rejeita ausência ou
`verified_at` já preenchido, confere `code_provider`, calcula expiry pelo
`requested_at` e grava apenas `verified_at`. A linha e o hash não são deletados;
o consumo é lógico pela checagem de `verified_at`. O método também usa somente
`@InjectManager`, e não existe row lock, unique/constraint sobre o JSON hash,
`WHERE verified_at IS NULL` no update ou outra condição que escolha um único
vencedor. Assim, dois confirms concorrentes podem ler `verified_at=null` antes
dos updates e ambos retornar sucesso; one-time concorrente não está provado.
[VERIFIED: route, Auth service decorators e token provider instalados]

O request emite `auth.verification_requested` com exatamente `entity_id`,
`entity_type`, `code_provider`, `auth_identity_id`, `code`, `expires_at` e
`metadata`. Não contém `actor_type`, `provider` nem `provider_identity_id`; o
capability plaintext usa o campo `code`. A resposta HTTP remove apenas `code`
e `expires_at` do objeto por spread, sem remover
`provider_metadata.token_hash`. [VERIFIED: workflow e route instalados]

O estado persistente que influencia login é `AuthVerification.verified_at`.
`validateVerification` usa `authVerificationsPerActor[actor_type]`, escolhe o
item por `auth_provider`, obtém o `entity_id` da `ProviderIdentity` e lista a
verification por auth identity/entity/type. Se a configuração não existe ou
está vazia, retorna `requiresVerification=false`; se configurada e a linha não
tem `verified_at`, o gerador devolve actorless token +
`verification_required`. Isso não expressa sozinho a exceção flexível por
lineage. [VERIFIED: `validate-verification.js`, `generate-jwt-token.js`, config
types e D14-05]

### Estado mínimo

Inference: `AuthVerificationIntent` custom deve ter identity/customer, generation, status (`pending|claimed|confirmed|superseded|expired|dead_letter`), `token_hash`, `requested_at`, `expires_at`, `confirmed_at`, `superseded_at`, delivery reference e chave idempotente. Unique parcial permite no máximo um `pending` ativo por identity. [VERIFIED: D14-09..12, PostgreSQL partial unique index]

- auto-send ocorre depois de identity+Customer confirmados ao registrar intent+outbox duravelmente; provider failure altera delivery, não `email_verified_at`, signup ou lineage. Inference. [VERIFIED: D14-09]
- resend bloqueia/serializa a identity, supersede todas as ativas e cria generation nova na mesma transação; concorrentes deixam uma ativa. Inference. [VERIFIED: D14-10]
- confirm usa hash+status+expiry em update condicional/row lock, marca uma intent confirmed, grava `email_verified_at` e supersede todas as restantes no mesmo boundary comprovado. Inference: se módulos não compartilharem transaction manager, manter ambos no mesmo módulo auth custom. [VERIFIED: D14-10..11]
- endpoint público devolve vocabulário fixo (`request_accepted`; confirm `verified|invalid_or_expired` minimizado conforme contrato) e nunca JWT/session. O status autenticado pode devolver apenas `verified|pending`, sem provider internals. Inference. [VERIFIED: D14-11..12]

Conclusão: reutilizar random/hash/TTL conceitual nativo é seguro, mas a operação pública e persistência devem ser custom/wrapped; a primitive nativa sozinha não prova todos os invariantes. [VERIFIED: gaps acima]

## R14-07 — Reset Intent

### Primitive nativa

`generateResetPasswordTokenWorkflow` usa TTL hardcoded de 15 minutos, cria UUID JTI, persiste somente SHA-256 e invalida tokens anteriores sequencialmente; a rota pública usa `throwOnError:false` e `201`, o que é boa base anti-enumeração. [VERIFIED: core flow/Auth service/route `2.16.0`]

Gaps: concorrentes podem passar pela invalidação e inserir tokens diferentes porque não foi encontrada unique parcial/lock que garanta uma ativa; o evento `auth.password_reset` carrega token em claro; o middleware de update consome o JTI antes da senha; não existe revogação de lineages nativa. [VERIFIED: migrations/services/workflow/middleware instalados]

Inference: `AuthResetIntent` custom deve reunir identity, generation, hash, expiry, estado composto, operation id e revocation target; request público sempre aceita uniformemente e só cria para identity elegível, após rate limit uniforme. Identity não verificada pode resetar, mas `email_verified_at` permanece intocado. [VERIFIED: D14-13..15]

Estados recomendados, sem fixar migration: `pending -> claimed -> credential_updated -> revocation_committed -> completed`; `superseded|expired|failed_reconcilable` são terminais/operacionais. Claim torna o capability indisponível a novas operações; retry com mesmo operation id retoma a state machine, não reabilita o token. Inference. [VERIFIED: D14-14..15]

Password change autenticado exige guard de lineage válida e reautenticação da senha atual pelo provider; a rota nativa `/update` não serve, pois só aceita reset JWT com `purpose=reset`. Depois do update, incrementa versão/revoga todas as lineages, inclusive atual, e não emite substituta. [VERIFIED: update middleware instalado, D14-16]

## R14-08 — Reset Atomicity

Os três efeitos não têm atomicidade cross-module comprovada. O token nativo vive no Auth Module; a senha emailpass fica em metadata da provider identity no Auth Module; as lineages propostas seriam módulo custom. Embora tudo possa usar PostgreSQL, igualdade de banco não prova compartilhamento do mesmo transaction manager. [VERIFIED: código/modelos instalados; nenhuma boundary única encontrada]

Além disso, na rota nativa a ordem é explicitamente `verify+delete reset row` no middleware e somente depois `updateProvider` no handler; uma falha entre eles consome o token sem persistir a nova senha. [VERIFIED: `validate-token.js` e update route]

### Padrão fail-closed recomendado

Inference: centralizar `AuthResetIntent` e lineages/credential state no mesmo módulo custom, com transação PostgreSQL para claim/estado/revogação; tratar `updateProvider` como efeito idempotente externo à boundary até o PLAN provar uma transação compartilhada. [VERIFIED: gaps acima]

1. Lock/claim do intent válido e grava `operation_id`; estado `claimed` bloqueia login/refresh daquela identity por fail-closed. Inference.
2. Atualiza provider password; repetição com a mesma nova senha é semanticamente idempotente, embora o hash scrypt possa mudar por novo salt. Inference: o estado persistido evita repetir quando já há `credential_updated_at`. [VERIFIED: provider scrypt]
3. Em transação autoritativa, incrementa `credential_version`, revoga todas as lineages e marca `revocation_committed`. Inference.
4. Só então marca `completed` e devolve sucesso uniforme. Falha após senha e antes de revogação permanece bloqueada pelo estado `claimed|credential_updated`; worker/retry reconcilia. Inference. [VERIFIED: D14-15]

Constraints/chaves necessárias: uma intent ativa por identity, generation monotônica, token hash único, `operation_id` único, transições condicionais por versão/status, e revogação idempotente com `revocation_operation_id`. Inference. [VERIFIED: D14-14..15]

O PLAN precisa de um spike/teste de transaction propagation. Se provar que Auth provider update e módulo custom aceitam o mesmo transaction manager, poderá colapsar passos em transação forte; até lá, este RESEARCH proíbe declarar atomicidade cross-module. [VERIFIED: protocolo de pesquisa]

## R14-09 — Auth Notification Outbox / Resend

### As-built

`EmailDeliveryLog` atual é materialmente específico de pedido: enum/template `order_confirmation`, campos order/cart/payment e payload de pedido; `email-resend-relay.ts` resolve destinatário de Order, faz claim/retry/dead-letter e envia com idempotency key Resend. [VERIFIED: módulo/migration/relay as-built]

O idempotency key do Resend evita duplicação da mesma requisição por até 24 horas e aceita no máximo 256 caracteres; ele não torna o claim PostgreSQL nem a mudança de estado do token atômicos. [CITED: https://resend.com/docs/dashboard/emails/idempotency-keys]

O claim do relay atual é update após leitura, sem CAS/`SKIP LOCKED` comprovado; a idempotency key reduz duplicação no provider, mas não é prova de single claimant cross-dyno. [VERIFIED: `apps/backend/src/subscribers/email-resend-relay.ts`]

### Decisão recomendada: opção 3, outbox auth próprio

Inference: criar `AuthNotificationOutbox` no domínio auth e reutilizar somente padrões/helpers de status, backoff, dead-letter, sanitização e idempotency. Estender o modelo order-only exigiria nullable polymorphism e aumentaria risco de payload/token em uma tabela desenhada para pedido. [VERIFIED: schema as-built + DB_MODEL]

O `DB_MODEL_v1.21.md` conceitualmente prevê delivery log com `entity_type` auth e `password_reset`, mas o modelo implementado diverge e continua order-only. O PLAN deve reconciliar/atualizar o DB_MODEL antes de model/migration, escolhendo explicitamente sibling auth outbox. [VERIFIED: DB_MODEL e migration as-built]

### Transporte seguro do capability

Evento nativo não é aceitável como transporte: no artefato instalado, o workflow inclui o capability plaintext no campo `code` (não `token`) e `event-bus-redis` usa BullMQ/Redis para armazenar job data; portanto o capability fica persistido transitoriamente fora do hash em `provider_metadata.token_hash`. O campo `token` pertence ao workflow divergente do tag e não descreve o runtime deste backend. [VERIFIED: workflow npm instalado e README/service do event-bus-redis `2.16.0`; tag apenas como contraste MEDIUM]

Inference: ao criar intent, persistir `token_hash`, generation e um nonce aleatório não secreto; derivar o token determinístico com HMAC/HKDF de segredo server-side separado + tipo + intent id + generation + nonce. O relay, depois de claim atômico, rederiva o token apenas em memória, renderiza e chama Resend com idempotency key estável; DB/Redis/logs recebem somente nonce/hash/metadados. Retry rederiva o mesmo capability, necessário para combinar com idempotência do provider sem armazenar plaintext. [VERIFIED: hash-only D14 + propriedades Resend]

O segredo de derivação precisa de versionamento/rotação que preserve intents ainda pendentes; logs e Sentry devem redigir URL/query/body/template data. Inference: persistir `key_version`, nunca a key. [VERIFIED: security constraints]

Provider failure muda outbox para retry/dead-letter e gera alerta sanitizado; não muda signup, verification status, reset eligibility ou sessão. Auto-send de signup deve registrar intent+outbox na mesma transação custom comprovada. Inference. [VERIFIED: D14-09]

## R14-10 — Rate Limiting and Anti-Enumeration

Não foi encontrado limiter global de auth. O limiter local/in-process existente em outro domínio não oferece consistência cross-dyno e não deve proteger auth. [VERIFIED: busca no repo e medusa-config]

Inference: usar Redis para contadores atômicos globais e PostgreSQL para estado/auditoria de decisões relevantes. Chaves devem combinar operação + HMAC de e-mail normalizado/identity + faixa IP, nunca e-mail plaintext; aplicar contagem antes de consultar existência para que conta existente/inexistente atravesse o mesmo caminho público. [VERIFIED: AUTH-09, anti-enumeração]

| Operação | Baseline técnico para PLAN | Resposta pública/Redis indisponível |
|---|---|---|
| signup | 5/IP/15 min e 3/e-mail/1 h | sucesso/rejeição genérica; indisponibilidade => `503` minimizado, sem mutar. Inference. |
| login | 10/par IP+email/15 min e 30/IP/15 min | mesmo `invalid_credentials`; indisponibilidade => fail-closed. Inference. |
| reset request | 3/e-mail/1 h e 10/IP/1 h | sempre `request_accepted`, inclusive limitado/inexistente/outage; nenhum envio. Inference. |
| verification resend/request | 3/e-mail/1 h e 10/IP/1 h | sempre `request_accepted`; nenhum oracle. Inference. |
| verification confirm | 10/IP+intent/15 min | `invalid_or_expired` uniforme; outage DB/Redis => fail-closed. Inference. |
| refresh | 10/lineage/min + proteção IP anômalo | resposta auth genérica; não consumir se limiter/DB incerto. Inference. |

Os números são recomendações iniciais, não decisões de produto; o PLAN deve fechá-los e definir `Retry-After` sem variar por existência. BFF adiciona throttling/CSRF/origin como defesa em profundidade, mas não substitui limiter backend porque chamadas server-to-server e múltiplos dynos existem. Inference. [VERIFIED: BFF-only + cross-dyno]

## R14-11 — Email Normalization and Signup Recovery

Emailpass 2.16.0 usa string exata para lookup/register; validators e Customer usam e-mail sem normalização canônica demonstrada, e uniques atuais são case-sensitive. Não foi localizada regra global do projeto que faça trim/lower antes dessas rotas. [VERIFIED: provider/validators/models instalados e repo]

Inference: boundary auth deve aplicar `trim()` + lowercase Unicode estável antes de qualquer key/lookup e persistir `normalized_email`; não aplicar regras provider-specific de pontos ou `+tag`, pois alterariam caixas postais semanticamente válidas. O PLAN deve decidir suporte a IDN/EAI conforme validator real, mas a regra escolhida deve ser única em identity, Customer, rate-limit e intents. [VERIFIED: gap as-built]

Antes de unique normalizada, execução futura deve auditar colisões legadas (`Foo@` vs `foo@`) e bloquear migration se houver ambiguidade; não escolher vencedor automaticamente. Inference. [VERIFIED: uniqueness atual]

### Mismatch sem senha insegura

- persistir HMAC server-side do payload sem senha, com campos imutáveis normalizados e schema version; isso detecta nome/atributos incompatíveis sem expor PII em índices/logs. Inference.
- para senha, não persistir plaintext, hash rápido, fingerprint estável ou HMAC comparável. Se a identity pendente já existe, verificar a senha apresentada contra o hash scrypt existente por primitive interna read-only; nunca chamar `register` novamente antes de confirmar compatibilidade, pois ele substitui a senha. Inference. [VERIFIED: emailpass provider]
- se qualquer comparação falhar, responder genericamente e não alterar intent/identity/Customer; a intent original continua recuperável. [VERIFIED: D14-03]

O provider emailpass usa scrypt-kdf; autenticação inexistente retorna antes do trabalho scrypt enquanto senha incorreta de identity existente executa KDF, criando risco de timing oracle. Wrapper deve equalizar trabalho/latência ou usar dummy scrypt hash, sem logs diferentes. [VERIFIED: provider instalado]

## R14-12 — TTL Recommendations

| Item | Baseline as-built/fixo | Recomendação técnica | Status |
|---|---|---|---|
| Registration intent | nenhum. [VERIFIED: ausência de modelo] | 24 h, cleanup após retenção operacional mínima e PII minimizada. Inference: equilibra retry de cadastro/e-mail com abandono. | Aberto para PLAN. |
| Verification token | native 900 s/15 min. [VERIFIED: token provider] | 30 min para entrega humana; resend supersede imediatamente. Inference. | Aberto para PLAN; native baseline não é obrigatório. |
| Reset token | native 15 min hardcoded no workflow. [VERIFIED: core flow] | manter 15 min. Inference: reduz janela de takeover e evita divergência da primitive. | Recomendação para PLAN. |
| Access token | default Medusa `1d` porque config não define. [VERIFIED: config/default] | 10 min; guard de lineage em toda request sensível. Inference. | Aberto para PLAN. |
| Refresh credential | não existe nativamente. [VERIFIED: inventário] | 7 dias de inatividade por geração, sempre limitado por deadline absoluto. Inference: alinha envelope frontend rolling/inactivity. | Aberto para PLAN. |
| Lost-response recovery | não existe. [VERIFIED: inventário] | 30–60 s, mesma idempotency key e descendente ainda não usado. Inference. | Aberto para PLAN/threat model. |
| Sessão inicial absoluta | **30 dias desde autenticação original**, sem extensão/grace. [VERIFIED: D14-05..08, PRD Frontend] | exatamente 30 dias. | **Fixo; PLAN não pode alterar.** |
| Outbox claim lease | relay atual usa lease/retry próprios. [VERIFIED: relay as-built] | 1–5 min conforme timeout Resend, com CAS e reclaim. Inference. | Aberto para PLAN. |

Nenhum TTL pode permitir que refresh ou cache ultrapasse `absolute_expires_at`; expiry do cliente não apaga carrinho/order truth e não afeta webhook Stripe. [VERIFIED: D14-08]

## R14-13 — Store Surface

| Artefato futuro | Mudança necessária antes de publicar | Estado até prova |
|---|---|---|
| `store-surface/manifest.ts` | elevar somente métodos Customer contratados, com ownership e requisitos; desconhecido continua deny. [VERIFIED: manifest atual] | `/store/customers` e `/store/customers/me` permanecem `EXTENDED -> DENY`. |
| `middlewares.ts` | auth guard deny-by-default; exact customer/emailpass; lineage/version/deadline; CORS/BFF; envelope anti-enum. Inference. | `/auth` raw permanece negado externamente. |
| API Docs registry | registrar schemas/operações BFF-facing/Store e exclusões explícitas; exemplos sem tokens/PII. [VERIFIED: AGENTS API Docs Contract] | customers registry vazio não autoriza runtime. |
| `POST /store/customers` | só via signup coordinator; não expor primitive diretamente ao browser. Inference. | `DENY` até prova Identity+Customer concorrente/idempotente. |
| `GET /store/customers/me` | DTO allowlist e guard de lineage. Inference. | `DENY` até contrato + teste de revogação. |
| auth custom | signup/login/refresh/revoke, verification, reset/change; paths exatos no PLAN. Inference. | todo não listado/MFA/session/callback/update native em `DENY`. |

Elevação exige no mínimo plano/prova de guard fail-closed, anti-enumeração, PostgreSQL concorrente, revogação cross-dyno, registry+artifact determinísticos e nenhum token em exemplos/logs. [VERIFIED: Phase 13/14 gates]

## R14-14 — BFF Contract

| Caso BFF | Endpoint backend necessário | Exclusivo BFF / não browser | Primitive Medusa raw |
|---|---|---|---|
| signup | coordinator identity+Customer, retorna envelope minimizado e cookies apenas ao BFF | sim | register e Store Customer internas; raw denied. |
| login | login wrapper customer/emailpass + criação de lineage | sim | POST auth emailpass interno; JWT raw denied. |
| refresh | rotação custom | sim | native `/auth/token/refresh` denied. |
| logout atual | endpoint BFF browser limpa cookies; BFF solicita revogação interna da lineage se necessária | browser chama apenas BFF | `/auth/session` POST/DELETE denied. |
| verification request/resend | request uniforme por email/identity conforme contrato | sim; browser via BFF | native request não exposto. |
| verification confirm | token público pode chegar em outro navegador, mas frontend chama BFF; backend não emite sessão/JWT | sim | native confirm raw denied. |
| verification status | current identity/customer minimizado | sim | custom; não expor entity/provider metadata. |
| reset request | aceitação uniforme | sim | native reset raw denied/wrapped. |
| reset confirm | state machine composta | sim | native update raw denied. |
| password change | sessão válida + senha atual + revogação global | sim | custom; native reset update não serve. |
| current session/customer | BFF consulta `GET /store/customers/me` guardado e/ou status de lineage | sim | Store só após elevação comprovada. |

Inference: respostas backend ao BFF devem usar códigos/vocabulário fechados e nunca carregar refresh/access token em payload browser; o BFF mantém cookies HttpOnly/Secure/SameSite e CSRF/origin conforme PRD futuro. [VERIFIED: PRD Frontend, D14]

Não criar frontend nesta phase; contratos apenas antecipam o BFF. A operação de logout browser permanece exclusivamente BFF, embora uma operação interna legítima de revogar lineage seja necessária para invalidar access tokens imediatamente; isso não cria endpoint Store artificial. Inference. [VERIFIED: AUTH-03, D14-07]

## R14-15 — Persistence Implications

> Entidades abaixo são prováveis, não migrations finais. Nomes/colunas exatos pertencem ao PLAN. [VERIFIED: limite do pedido]

| Estado provável | Propósito / relação | Unicidade e concorrência | Status/campos/TTL prováveis |
|---|---|---|---|
| `RegistrationIntent` | correlacionar normalized email, auth identity e Customer; recuperar signup parcial | unique parcial por normalized email ativo; row lock/version; customer/auth IDs únicos quando presentes | semantic payload HMAC, state, expires_at, completed_at, retry/version; **sem senha/token**. Inference. |
| `AuthCredentialState` | verificação e revogação global por identity | unique auth_identity_id | credential_version, verified_at, revoked_before, reset_operation/state. Inference. |
| `AuthSessionLineage` | sessão lógica e exceção inicial | id opaco único; index identity/status/deadline | original_authenticated_at, absolute_expires_at, status/reason, version snapshot, revoked_at. Inference. |
| `AuthRefreshCredential` | rotação/replay e recovery idempotente | token_hash unique; generation unique por lineage; uma ativa por lineage/generation | active/consumed/replayed/revoked, replacement_id, request key hash, recovery_until, used_at. Inference. |
| `AuthVerificationIntent` | latest-wins/one-time/delivery | token_hash unique; uma pending ativa por identity | generation, expiry, confirmed/superseded/dead-letter timestamps, key_version/nonce. Inference. |
| `AuthResetIntent` | latest-wins e reset composto | token_hash/operation_id unique; uma ativa por identity | state machine, expiry, credential_updated_at, revocation_committed_at, failure/retry metadata, key_version/nonce. Inference. |
| `AuthNotificationOutbox` | delivery durável sem capability plaintext | event/idempotency key unique; claim CAS/lease; index status/next_attempt | template kind, identity/intent refs, recipient handling minimizado, retry/dead-letter, provider message id; **sem token/body secreto**. Inference. |

As constraints devem ser PostgreSQL partial unique/check/foreign-or-logical link conforme isolamento Medusa; locks em memória ou Redis não satisfazem D14-02/10/14. [CITED: https://www.postgresql.org/docs/current/indexes-partial.html]

O `DB_MODEL_v1.21.md` não materializa lineage, refresh, registration/verification/reset intents e seu EmailDeliveryLog conceitual diverge do as-built order-only. **Requirement obrigatório do PLAN:** atualizar/reconciliar DB_MODEL antes de qualquer model/migration e gerar evidência da migration real, sem desenhá-la neste RESEARCH. [VERIFIED: DB_MODEL + as-built]

Cleanup deve marcar expirado antes de purgar, preservar somente evidência sanitizada necessária e nunca remover revogação antes do último access/refresh possível. Inference: retenções exatas são decisão do PLAN/compliance; nenhum requisito local fixa retenção. [VERIFIED: ausência de decisão de retenção]

## R14-16 — Evidence and Observability

Não executar agora. A arquitetura de validação futura deve produzir esta evidência: [VERIFIED: pedido Phase 14]

| Invariante | Tipo | Prova futura mínima |
|---|---|---|
| Customer não duplica | disposable PostgreSQL integration | duas ou mais requests concorrentes, exatamente uma identity/Customer/intention canonical; retries recebem mesma disposição. Inference. |
| signup parcial/mismatch | HTTP + PostgreSQL | fault injection entre identity/Customer, resume compatível; incompatível não altera hash/senha/dados. Inference. |
| refresh rotation | unit + PostgreSQL HTTP | N aceita uma vez, N+1 único; N concorrente perde; crash pré/pós commit. Inference. |
| lost response/replay | PostgreSQL + HTTP | mesma idempotency key dentro da janela devolve o mesmo N+1; diferente/tardio revoga toda lineage. Inference. |
| revogação cross-dyno | multi-process + PostgreSQL/Redis | token emitido no processo A rejeitado em B após replay/reset/change; Redis flush/outage não concede acesso. Inference. |
| verification latest-wins | PostgreSQL concorrente | apenas generation final valida; confirm concorrente tem um vencedor; todos tokens inválidos após sucesso. Inference. |
| reset latest-wins/composto | PostgreSQL + fault injection | um token ativo; falha após password mantém login/refresh bloqueados; reconciler conclui; sucesso somente após três efeitos. Inference. |
| anti-enumeração | HTTP contract/timing | status/body/header equivalentes para existente/inexistente/verified/limited; distribuição de latência dentro de tolerância definida. Inference. |
| sem token leakage | negative grep + DB/Redis/job/log/Sentry audit | canários reais gerados no teste não aparecem em tabelas exceto hash, Redis jobs, logs, snapshots, OpenAPI ou telemetry. Inference. |
| provider failure independente | provider mock | timeout/5xx/ambiguous response gera retry/dead-letter sem reverter Customer/session/verification/reset state indevidamente. Inference. |

Framework existente é Jest `29.7`/Medusa test-utils `2.16.0`; há infraestrutura de integração e disposable PostgreSQL usada em phases anteriores. [VERIFIED: `apps/backend/package.json`, testes existentes]

### Validation Architecture (Wave 0 futura)

| Propriedade | Valor |
|---|---|
| Framework | Jest 29.7 + `@medusajs/test-utils` 2.16.0. [VERIFIED: package.json] |
| Config | `apps/backend/jest.config.js` e scripts workspace. [VERIFIED: repo] |
| Quick run | testes unitários auth dedicados, alvo <30 s; comando exato no PLAN. Inference. |
| Full phase gate | suites unit/HTTP/disposable-PG/Redis/multi-process + OpenAPI/read-only gates; comando exato no PLAN. Inference. |

Wave 0 deve criar fixtures de clock/entropy/HMAC, provider email mock, Resend mock, barrier concorrente PostgreSQL, Redis isolado, dois app processes e collector de logs. Provider real não é necessário para provar os invariantes; chamada Resend real, se algum dia autorizada, seria smoke operacional separado e não autoridade do contrato. Inference. [VERIFIED: natureza dos invariantes e proibição atual]

Observabilidade deve registrar IDs opacos de operation/intent/lineage, generation, transição, reason code allowlisted e correlation ID; nunca e-mail puro, Authorization/cookie, token/hash, password, URL com capability ou payload provider. Inference. [VERIFIED: regras de segurança]

## Security Findings

### BLOCKER para PLAN

1. **Superfície auth não fail-closed:** não há manifest/guard `/auth` e a configuração não restringe actor/provider; publicar cegamente habilitaria JWT/session/callback/MFA fora do contrato. [VERIFIED: middlewares/config/routes]
2. **Refresh nativo incompatível:** sem refresh credential, rotation, family/replay detection, absolute deadline ou revogação. [VERIFIED: refresh route/Auth models]
3. **Reset composto ausente:** JTI é consumido antes do password update e não há revogação global; atomicidade cross-module não foi comprovada. [VERIFIED: validate-token/update route]
4. **Signup pendente mutável e e-mail não normalizado:** retry native pode substituir a senha antes de detectar mismatch; constraints são case-sensitive. [VERIFIED: emailpass provider/models]

### MUST address during Phase 14

1. Evento nativo de verification contém `code` em claro (reset usa seu próprio token/JTI) e Event Bus Redis persiste job data; não usar esse caminho para capability sensível. [VERIFIED: workflows npm instalados e event-bus-redis]
2. Confirmation verification é read-then-update com `@InjectManager`, sem transaction decorator, row lock ou update condicional comprovado; one-time concorrente não está demonstrado. Request concorrente também é list-then-update/create e a unique de uma linha não prova latest-wins temporal. [VERIFIED: token provider/Auth service/migration npm instalados]
3. Access bearer é validado sem consulta de lineage/version; sessões ficam stale após replay/reset/change. [VERIFIED: authenticate middleware]
4. Emailpass possui diferença de custo entre usuário inexistente e senha errada, potencial timing oracle; respostas e latência precisam equalização. [VERIFIED: emailpass provider]
5. Relay atual é order-specific e claim cross-dyno não demonstrou CAS; auth precisa outbox/claim próprios. [VERIFIED: model/relay]
6. Rate limit auth global inexiste; limiter local/BFF não é autoridade cross-dyno. [VERIFIED: repo/config]
7. A resposta de verification request remove `code`/`expires_at`, mas não remove `provider_metadata.token_hash`; confirm devolve entity/type/provider/`verified_at`, e erros são específicos. Wrappers precisam whitelist/envelope minimizado uniforme. [VERIFIED: routes/workflow npm instalados]
8. Correlation/logging/telemetry devem ser allowlist-first; capability em URL/body/event não pode chegar a logs, Sentry, OpenAPI ou evidência. [VERIFIED: constraints D14/AGENTS]

### Non-blocking

- JWT default de um dia é longo para o modelo recomendado, mas permanece negado até o PLAN configurar emissão custom curta. [VERIFIED: default/config]
- Medusa session/MFA/callback existem, mas podem permanecer `DENY`; não bloqueiam o núcleo se o guard for total. [VERIFIED: route inventory]
- A documentação oficial corrente descreve fluxo geral, porém não é prova de detalhes 2.16.0; este RESEARCH priorizou source instalado. [CITED: https://docs.medusajs.com/resources/commerce-modules/auth/authentication-route]

### Deferred/out-of-scope

- MFA/social login/passwordless, frontend/storefront, profile/address, deploy/provider real e política regulatória de retenção. [VERIFIED: roadmap/CONTEXT]
- Mudanças nos invariantes Stripe/Order/Gelato; webhook canônico continua autoridade. [VERIFIED: PROJECT/D14-08]

### ASVS aplicável

| Categoria | Aplica | Controle padrão para PLAN |
|---|---|---|
| V2 Authentication | sim | emailpass/scrypt, anti-enum, current-password proof, token one-time. Inference. |
| V3 Session Management | sim | lineage, rotação, replay/family revoke, absolute expiry. Inference. |
| V4 Access Control | sim | guard BFF/customer fail-closed e ownership identity↔Customer. Inference. |
| V5 Validation | sim | validators/normalização única, schemas fechados e rate limit. Inference. |
| V6 Cryptography | sim | Node `crypto`, HMAC/HKDF/SHA-256/CSPRNG; não hand-roll primitive. Inference. |
| V7 Error/Logging | sim | envelopes uniformes, allowlist logs, token leakage tests. Inference. |

## Don't Hand-Roll

| Problema | Não construir | Usar |
|---|---|---|
| Hash de senha | KDF próprio | emailpass `scrypt-kdf` Medusa instalado. [VERIFIED: provider] |
| JWT crypto | assinatura/parser próprio | `jsonwebtoken`/utils Medusa, com claims custom e guard de estado. [VERIFIED: framework] |
| Token entropy/hash | RNG não criptográfico/encoding caseiro | Node `crypto.randomBytes`, HMAC/HKDF e SHA-256. Inference. |
| Concorrência | mutex em memória | transação/row lock/partial unique PostgreSQL. [CITED: https://www.postgresql.org/docs/current/explicit-locking.html] |
| Idempotência Resend | dedupe só local | idempotency key Resend + outbox PostgreSQL. [CITED: https://resend.com/docs/dashboard/emails/idempotency-keys] |
| Rate limit cross-dyno | `Map`/timer local | Redis atomic global com fail-closed e chaves HMAC. Inference. |

Nenhum pacote externo novo é necessário para a abordagem recomendada; Medusa, Node crypto, PostgreSQL, Redis e Resend já estão no runtime. Portanto não há Package Legitimacy Gate nesta pesquisa. [VERIFIED: package.json e recomendação]

## AUTH-01..AUTH-09 Coverage Matrix

| Requirement | Existing capability | Gap | Recommended approach | Evidence/source | PLAN implication |
|---|---|---|---|---|---|
| AUTH-01 | identity register + Customer workflow + app_metadata link | duas requests; parcial/mismatch/concurrency/TTL ausentes | `RegistrationIntent` state machine e exact actor/provider wrapper | código instalado; R14-02 | Wave para coordinator + PG concorrente antes de elevar Customer. |
| AUTH-02 | JWT e verification primitive | native gating é global, sem exceção por lineage/deadline | lineage com `absolute_expires_at=30d`, verified state e guard DB | D14-05..08; R14-03/04 | prova fim da exceção em logout/revoke/reset/change/expiry sem afetar Order. |
| AUTH-03 | native login e session routes | JWT/browser/session Medusa violam BFF-only; logout não revoga bearer | wrapper login; cookies BFF; revogação interna da lineage; native session denied | routes + PRD | documentar browser→BFF→backend e exclusões `/auth/session`. |
| AUTH-04 | native reset hash-only/15m/201 | latest-wins concorrente, outbox e sucesso composto ausentes | custom reset intent + uniform request + state machine | core flow/middleware; R14-07/08 | fault injection e one-winner tests obrigatórios. |
| AUTH-05 | JWT expiry somente | tokens antigos continuam válidos após reset/change | credential version + lineage status lookup fail-closed | bearer middleware; R14-04 | cross-dyno proof antiga sessão rejeitada. |
| AUTH-06 | native refresh exige JWT válido | não é refresh one-time; sem revoked/deadline/family | opaque refresh hashed, row-lock rotation, replay family revoke | refresh route; PostgreSQL docs | protocolo lost response e thresholds fechados no PLAN. |
| AUTH-07 | artifact npm: rotas actor-agnostic, `AuthVerification`, hash/TTL | `code` plaintext no evento, hash no response, concorrência/status/provider isolation incompletos | custom verification intent + auth outbox + public states | artifact/lock npm; R14-06/09 | registry e HTTP contract para request/resend/confirm/status. |
| AUTH-08 | EmailDeliveryLog/relay pattern e `AuthVerification` instalado | schema order-only; capability `code` no Event Bus Redis | sibling `AuthNotificationOutbox`, deterministic derivation, CAS claim | repo/artifact npm/event bus/Resend docs | atualizar DB_MODEL antes de model/migration. |
| AUTH-09 | nenhum limiter auth global | oracle/timing/cross-dyno/outage | Redis global IP+HMAC(identity), uniform response, dummy KDF, DB fail-closed | repo/provider; R14-10/11 | PLAN fixa thresholds/janelas e matriz de resposta/latência. |

**Cobertura:** 9/9 requisitos com disposição explícita. [VERIFIED: matriz acima]

## Closed by Research

1. Medusa 2.16.0 não fornece o modelo de refresh/lineage/replay/revogação exigido; `/auth/token/refresh` não será exposto. [VERIFIED: R14-03]
2. Identity e Customer são duas etapas; há correlação por auth identity/app metadata, mas não coordinator persistente de signup. [VERIFIED: R14-02]
3. O artifact npm de verification oferece entropy/hash/TTL úteis e estado em `AuthVerification.verified_at`, porém não satisfaz concorrência/outbox sem customização; o tag `v2.16.0` descreve outro model/API e não é autoridade as-built. Reset permanece conforme R14-07/08. [VERIFIED: reconciliação + R14-06..08]
4. Atomicidade forte de password+token+lineages não foi comprovada; state machine reconciliável/fail-closed é o baseline. [VERIFIED: R14-08]
5. Auth deve usar outbox próprio, não gravar capability plaintext em EmailDeliveryLog/Event Bus Redis. [VERIFIED: R14-09]
6. PostgreSQL decide validade/concorrência; Redis limita e acelera, nunca concede validade. [VERIFIED: project constraints]
7. A regra mínima recomendada de e-mail é trim+lowercase sem canonicalização provider-specific e requer auditoria de colisões. Inference. [VERIFIED: R14-11]
8. `/store/customers*` e toda `/auth` não explicitamente aprovada permanecem `DENY` até implementação+prova. [VERIFIED: R14-13]

## Must Be Decided in PLAN

1. Nomes/paths/schemas públicos exatos e códigos HTTP/envelopes fechados das operações BFF. Inference.
2. Modelo físico e boundary de módulos; o spike de transaction manager decide se algum passo do reset pode compartilhar transação. Inference.
3. TTLs ainda técnicos: registration 24h, verification 30m, access 10m, refresh inactivity 7d e lost-response 30–60s; 30 dias absoluto não está aberto. Inference.
4. Threat model e protocolo final de recuperação de refresh perdido; se não aprovado, usar falha segura/reautenticação, nunca replay aberto. Inference.
5. Thresholds/janelas/rate-limit response e política diante de Redis indisponível, preservando uniformidade. Inference.
6. Claim/CAS/lease/backoff/dead-letter e rotação da key de derivação do auth outbox. Inference.
7. Regras exatas de email/IDN e plano de colisões existentes antes da unique normalizada. Inference.
8. Cache Redis opcional para revocation lookup e TTL; PostgreSQL/fail-closed são fixos. Inference.
9. Atualização prévia de `DB_MODEL_v1.21.md`, entities/constraints e mapa de migrations, sem migration antecipada. [VERIFIED: R14-15]
10. Arquivos/suites Wave 0 e comandos focados; nenhum teste foi executado neste RESEARCH. [VERIFIED: pedido]

## Human Decision Required Before PLAN

Nenhuma nova decisão de produto é necessária: D14-01..D14-16 resolvem as ambiguidades materiais e as escolhas restantes são técnicas dentro do `Agent Discretion`. O PLAN continua bloqueado até autorização humana explícita e separada, conforme o gate de governança; isso não equivale a aprovação automática deste RESEARCH. [VERIFIED: `14-CONTEXT.md`, `.planning/STATE.md`, pedido Phase 14]

## Assumptions Log

| # | Claim assumida/inferida | Risco se errada |
|---|---|---|
| A1 | Nomes físicos sugeridos para sete estados customizados | PLAN pode consolidar/separar entidades, mantendo invariantes. |
| A2 | TTLs recomendados exceto teto de 30 dias | UX/risco operacional muda; PLAN precisa fechar. |
| A3 | HMAC/HKDF determinístico é aceitável para retry seguro de delivery/refresh | Threat model pode exigir falha segura em vez de recovery. |
| A4 | Redis limiter com thresholds propostos | Capacidade/tráfego real pode exigir calibração. |
| A5 | Trim+lowercase é a normalização de produto desejada | IDN/EAI/casos legados podem exigir regra adicional. |

## Sources

### Repo/as-built — HIGH

- `.planning/phases/14-customer-auth-verification/14-CONTEXT.md` — D14-01..D14-16, BFF-only, limite absoluto e gates. [VERIFIED: repo]
- `.planning/STATE.md`, `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/MILESTONES.md`, `.planning/config.json`, milestone v1.1 ROADMAP/REQUIREMENTS — escopo/governança/requisitos. [VERIFIED: repo]
- Phase 13 CONTEXT/RESEARCH — inventory herdado e Store fail-closed. [VERIFIED: repo]
- `docs/PRD_Backend_v1.1.md`, `docs/PRD_frontend_v1.1.md`, `docs/SRS_v1.5.md`, `docs/DB_MODEL_v1.21.md`, `docs/FRONTEND_CONTRACT_TRACEABILITY.md` — produto/sistema/dados/BFF. [VERIFIED: repo]
- `apps/backend/src/api/middlewares.ts`, Store manifest, customers registry, `medusa-config.ts`, `package.json` — runtime/surface as-built. [VERIFIED: repo]
- Módulo `EmailDeliveryLog`, migration e `email-resend-relay.ts` — delivery order-only. [VERIFIED: repo]

### Artefato npm instalado `2.16.0` — HIGH

- Root `package-lock.json` v3: `resolved` e `integrity` dos cinco pacotes relevantes; workspace `apps/backend` e origem npm normal. [VERIFIED: lockfile]
- `node_modules/@medusajs/medusa/dist/api/auth/**`, `@medusajs/core-flows/dist/auth/**`, `@medusajs/auth/dist/**`, emailpass provider, Customer workflow/models/migrations — comportamento exato auditado na única árvore resolvida. [VERIFIED: `require.resolve`, package metadata e código instalado]
- Tarballs npm oficiais `@medusajs/{medusa,auth,core-flows,framework,auth-emailpass}@2.16.0`: SHA-512 igual ao lock/registry e conteúdo byte-equal ao instalado. [VERIFIED: `npm view`, download read-only, SHA-512 e `diff -qr`]
- `node_modules/@medusajs/event-bus-redis/README.md` e `dist/services/event-bus-redis.js` — BullMQ/Redis armazena job/event data. [VERIFIED: código instalado]
- https://github.com/medusajs/medusa/commit/3a13d78eed5a2eccc904437e489560e8d89f8894 — release commit indicado por npm para `auth`, `core-flows`, `framework` e `auth-emailpass`; arquivos individuais de verification são semanticamente equivalentes ao artifact. [CITED: GitHub oficial Medusa]

### Tag GitHub `v2.16.0` — MEDIUM no seam de verification

- https://github.com/medusajs/medusa/tree/v2.16.0/packages/medusa/src/api/auth — tag oficial reproduzível, mas com rotas actor/provider-specific divergentes. [CITED: GitHub oficial Medusa]
- https://github.com/medusajs/medusa/tree/v2.16.0/packages/core/core-flows/src/auth — evento com `token` e payload divergente. [CITED: GitHub oficial Medusa]
- https://github.com/medusajs/medusa/tree/v2.16.0/packages/modules/auth — `AuthVerificationToken` e estado em ProviderIdentity, divergentes do artifact. [CITED: GitHub oficial Medusa]
- https://github.com/medusajs/medusa/compare/699a9a85c795e13f9e787056e0fb65cfea0115dc...3a13d78eed5a2eccc904437e489560e8d89f8894 — o release commit está 36 commits à frente do commit do tag. [CITED: GitHub oficial Medusa]

### Documentação oficial — MEDIUM

- https://docs.medusajs.com/resources/commerce-modules/auth/authentication-route — autenticação e JWT. [CITED: Medusa docs]
- https://docs.medusajs.com/resources/commerce-modules/auth/reset-password — reset/event flow. [CITED: Medusa docs]
- https://docs.medusajs.com/resources/commerce-modules/auth — overview; usado só como corroboração, nunca contra o source 2.16.0. [CITED: Medusa docs]
- https://www.postgresql.org/docs/current/tutorial-transactions.html — atomicidade transacional. [CITED: PostgreSQL docs]
- https://www.postgresql.org/docs/current/explicit-locking.html — row locks. [CITED: PostgreSQL docs]
- https://www.postgresql.org/docs/current/indexes-partial.html — partial unique indexes. [CITED: PostgreSQL docs]
- https://resend.com/docs/dashboard/emails/idempotency-keys — idempotency key, 24h e limite de 256 caracteres. [CITED: Resend docs]

### Consulta e validade

Fontes externas consultadas read-only em 2026-08-11. O registry/tarball npm só é HIGH quando combinado ao lock/SRI e ao conteúdo instalado; o tag/release notes/documentação é MEDIUM no seam divergente. O artifact instalado `2.16.0` tem precedência para as-built. [VERIFIED: reconciliação desta execução]

**Validade recomendada:** até mudança de versão Medusa/config/schema ou 30 dias, o que ocorrer primeiro. Inference.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — versões, paths, lock, SRI e tarballs locais verificados; nenhum pacote novo. [VERIFIED: package.json/package-lock/node_modules/npm]
- Verification as-built/gaps: HIGH — derivados do artifact npm efetivamente instalado e decisões D14; tag `v2.16.0` rebaixado para MEDIUM nesse seam. Mecanismos físicos recomendados permanecem INFERENCE para PLAN. [VERIFIED: reconciliação]
- Segurança/pitfalls: HIGH para achados as-built; MEDIUM para calibração de TTL/rate limit/recovery. [VERIFIED: fontes acima]
- Graph context: indisponível; `.planning/graphs/graph.json` não existe e `graphify` está desabilitado na configuração GSD, então relações foram verificadas diretamente nos documentos/código. [VERIFIED: repo/config e comandos read-only]

**Research date:** 2026-08-11

**Corrective R1:** 2026-08-11 — `B14-RESEARCH-R1-01` reconciliado como
`DIVERGENT`; artefato npm instalado elevado a autoridade as-built e tag
`v2.16.0` rebaixado para MEDIUM no seam de verification. PLAN não iniciado.

**Valid until:** 2026-09-10 ou upgrade do Medusa, o que ocorrer primeiro. Inference.
