# Phase 14: Customer Auth & Verification - Context

**Gathered:** 2026-08-11
**Status:** CONTEXT COMPLETE — AWAITING HUMAN REVIEW

<domain>
## Phase Boundary

Esta phase entrega os contratos e o comportamento backend de cadastro coordenado
de identidade + `Customer`, login, sessao inicial flexivel, refresh, verificacao
de e-mail, reset e alteracao de senha para `AUTH-01..AUTH-09`.

O unico consumidor storefront autorizado continua sendo o BFF same-origin. O
navegador nao recebe JWT nem chama Medusa diretamente. A sessao inicial de um
`Customer` ainda nao verificado pode comprar dentro da mesma linhagem logica,
limitada pelo teto absoluto herdado de 30 dias. Depois de logout, revogacao,
reset/alteracao de senha ou expiracao absoluta, uma nova autenticacao exige
e-mail verificado.

Esta phase nao altera os invariantes financeiros: expiracao ou revogacao de
sessao nao desfaz estado persistido, processamento server-side nem pagamento
confirmado. O webhook Stripe canonico permanece a unica autoridade para
confirmar pagamento e criar `Order`.

Este documento fixa comportamento e invariantes. Modelo fisico, transacoes,
integracao exata com Medusa Auth, TTLs de tokens, enforcement de revogacao,
outbox auth e rate limits pertencem ao futuro RESEARCH/PLAN, ambos bloqueados
ate nova autorizacao humana.

</domain>

<decisions>
## Implementation Decisions

### Cadastro parcialmente concluido

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

### Limite da sessao inicial

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

### Verificacao e reenvio

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

### Reset e revogacao

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

### Regras transversais

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

### Agent Discretion

O futuro RESEARCH pode comparar mecanismos Medusa/customizados para modelo
fisico, constraints, transacoes, outbox auth, TTLs de verificacao/reset,
rotacao/reuse detection, enforcement de access-token revocation, recuperacao de
resposta perdida e rate limits. Nao ha discricionariedade para relaxar
latest-wins, uso unico, hash-only, anti-enumeracao, limite absoluto, revogacao
global, fail-closed, BFF-only ou autoridade do webhook Stripe. Qualquer escolha
exige RESEARCH e PLAN aprovados separadamente.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Governanca e escopo

- `.planning/PROJECT.md` — core value, milestone v1.1, constraints e ordem de
  autoridade documental.
- `.planning/STATE.md` — gate manual corrente e bloqueios de progressao.
- `.planning/ROADMAP.md` — boundary, goal, deliverables e exit criteria da
  Phase 14.
- `.planning/REQUIREMENTS.md` — `AUTH-01..AUTH-09` e rastreabilidade
  `FE-AUTH-001..FE-AUTH-007`.
- `.planning/MILESTONES.md` — separacao entre backend v1.1 e futuro frontend.
- `.planning/config.json` — modo interativo, sem auto-advance/auto-chain e sem
  paralelizacao.
- `.planning/milestones/v1.1-ROADMAP.md` — sequencia imutavel `13 -> 22`.
- `.planning/milestones/v1.1-REQUIREMENTS.md` — snapshot dos requisitos do
  milestone.

### Decisoes herdadas da Phase 13

- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CONTEXT.md`
  — BFF-only, Store fail-closed, erros minimizados, anti-enumeracao e
  invariantes de `Order`.
- `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-RESEARCH.md`
  — inventario `/auth` do Medusa 2.16.0, superficie Customer e gaps levados
  para a Phase 14.

### Contratos de produto, sistema e dados

- `docs/PRD_Backend_v1.1.md` — operacoes auth alvo, politica flexivel, BFF,
  refresh, reset e verificacao.
- `docs/PRD_frontend_v1.1.md` — comportamento esperado do futuro BFF,
  `AuthSessionEnvelope` e limite absoluto de 30 dias.
- `docs/SRS_v1.5.md` — requisitos normativos de auth, outbox de verificacao,
  rate limit, revogacao e anti-enumeracao.
- `docs/DB_MODEL_v1.21.md` — invariantes de e-mail/idempotencia e requisito de
  atualizar o modelo antes de nova persistencia; ainda nao materializa todo o
  estado auth decidido nesta phase.
- `docs/FRONTEND_CONTRACT_TRACEABILITY.md` — operacoes, schemas, fixtures e
  suites pendentes de `FE-AUTH-001..007`.

### Codigo e contrato as-built

- `apps/backend/src/api/middlewares.ts` — guard Store fail-closed, envelope de
  erro e autenticacao atual.
- `apps/backend/src/api/store-surface/manifest.ts` — `/store/customers` e
  `/store/customers/me` permanecem `EXTENDED -> DENY` ate a Phase 14.
- `apps/backend/src/api-docs/operations/store/customers.ts` — registry Store
  ainda nao publica operacoes Customer executaveis.
- `apps/backend/medusa-config.ts` — Auth/CORS/JWT, Redis e modulos customizados
  registrados no runtime atual.
- `apps/backend/package.json` — Medusa 2.16.0, Node 22 e Resend as-built; nova
  dependencia nao e presumida.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `storeSurfaceGuardMiddleware` + `storeErrorEnvelopeMiddleware`: boundary
  global fail-closed e resposta Store padronizada que a Phase 14 deve preservar.
- `StoreIdempotencyRecord` e primitives de PostgreSQL da Phase 13: padrao de
  idempotencia persistida e concorrencia a avaliar, sem assumir reutilizacao
  direta para auth.
- `EmailDeliveryLog` + `email-resend-relay.ts`: padrao duravel de claim,
  retry/dead-letter, idempotency key e Resend. O modelo atual e especifico para
  `order_confirmation`; RESEARCH deve decidir extensao segura ou outbox auth
  proprio, sem forcar reutilizacao incompatível.
- Sanitizacao/correlation ID e logs allowlist-first existentes: base para
  auditoria de replay/revogacao sem tokens.

### Established Patterns

- O BFF same-origin guarda JWT/cookies e e o unico consumidor storefront.
- PostgreSQL e a verdade para unicidade/idempotencia; Redis pode coordenar, mas
  nao substituir constraints persistentes.
- Superficie desconhecida ou ainda nao habilitada permanece `DENY`.
- Provider externo e eventual e nunca desfaz estado de negocio consolidado.
- Erros publicos usam vocabulario fechado e minimizado; detalhes internos sao
  sanitizados.

### Integration Points

- Medusa 2.16.0 expoe 18 operacoes nativas em `/auth`; Phase 14 precisa
  classificar/restringir provider, register/reset/update, session, token/refresh,
  verification e MFA sem habilitacao cega.
- `POST /store/customers` e `GET /store/customers/me` sao candidatos
  `EXTENDED`, mas continuam bloqueados ate contrato, guard e evidencia da
  Phase 14.
- Operacoes customizadas de request/resend/confirm/status de verificacao ainda
  precisam ser materializadas no registry TypeScript e runtime futuro.
- Nova persistencia auth, se necessaria, exige reconciliacao previa com
  `docs/DB_MODEL_v1.21.md`, model/constraints e migration autorizados.
- Relay/worker Resend existente oferece um padrao, mas falha do provider nao
  pode afetar cadastro, sessao inicial ou respostas publicas.

</code_context>

<specifics>
## Specific Ideas

- A linhagem da sessao inicial e logica: refresh renova credencial tecnica, nao
  reinicia o relogio absoluto.
- Contrato de replay escolhido:

  ```text
  consumed refresh reused
  -> revoke entire lineage
  -> descendant refresh invalid
  -> future refresh denied
  -> active access tokens rejected where enforceable
  ```

- Contrato de expiracao absoluta escolhido:

  ```text
  absolute session expiry
  -> client authorization ends
  -> persisted checkout state preserved
  -> server-side processing continues
  -> canonical payment webhook remains authoritative
  -> new client actions require verified re-authentication
  ```

- Contrato publico de resend: `request accepted` nao confirma existencia de
  e-mail, geracao de token nem aceite do provedor.
- Contrato de reset:

  ```text
  reset success
  = password updated
  + reset token consumed
  + all session lineages revoked
  ```

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

RESEARCH, PLAN, SPEC/SDD, implementation prompt, execution, tests, migrations,
providers, deploy, frontend e fases posteriores permanecem bloqueados ate
autorizacao humana explicita e separada.

</deferred>

---

*Phase: 14-customer-auth-verification*
*Context gathered: 2026-08-11*
