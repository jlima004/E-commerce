---
quick_task: CACHE-01A
type: execute
wave: 1
depends_on: []
autonomous: true
requirements:
  - CACHE-01A
files_modified:
  - apps/backend/src/infrastructure/redis-config.ts
  - apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts
  - .planning/quick/260716-cache01a-redis-cache-tls-shape/VERIFICATION.md
  - .planning/quick/260716-cache01a-redis-cache-tls-shape/SUMMARY.md
must_haves:
  truths:
    - "O provider @medusajs/caching-redis recebe redisUrl e tls no nível superior somente quando rediss:// é usado com REDIS_TLS_REJECT_UNAUTHORIZED=false."
    - "Event Bus e Locking continuam recebendo redisUrl + redisOptions, enquanto Workflow continua recebendo redis: { redisUrl, redisOptions }."
    - "redis:// e rediss:// sem opt-in explícito não relaxam a verificação TLS, e nenhuma configuração TLS global é introduzida."
    - "REDIS_CACHE_PROVIDER_DISABLED=true continua omitindo somente o cache; Locking, Event Bus e Workflow permanecem registrados."
    - "O patch INFRA-01 permanece intacto no stash, sem alteração de config vars, release command, deploy, dependências, migrations, STATE.md ou Phase 12."
  artifacts:
    - path: "apps/backend/src/infrastructure/redis-config.ts"
      provides: "Builders tipados e separados para o contrato padrão e o contrato plano do caching-redis."
      exports:
        - "buildStandardRedisModuleOptions"
        - "buildCachingRedisProviderOptions"
        - "buildRedisModules"
    - path: "apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts"
      provides: "Regressões de shape, contrato do loader 2.16, workaround transitório e segurança de canários Redis."
    - path: ".planning/quick/260716-cache01a-redis-cache-tls-shape/VERIFICATION.md"
      provides: "Evidência sanitizada dos contratos instalados, testes, lint, build, integridade e preservação do stash."
    - path: ".planning/quick/260716-cache01a-redis-cache-tls-shape/SUMMARY.md"
      provides: "Classificação final PASS ou BLOCKED, causa raiz e não-ações do gate."
  key_links:
    - from: "apps/backend/src/infrastructure/redis-config.ts"
      to: "@medusajs/caching-redis@2.16.0"
      via: "O provider de cache usa buildCachingRedisProviderOptions e entrega tls no restante plano consumido pelo loader."
      pattern: "buildCachingRedisProviderOptions"
    - from: "apps/backend/src/infrastructure/redis-config.ts"
      to: "Event Bus, Locking e Workflow Redis"
      via: "Os três consumidores usam buildStandardRedisModuleOptions e preservam redisOptions aninhado."
      pattern: "buildStandardRedisModuleOptions"
    - from: "apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts"
      to: "apps/backend/src/infrastructure/redis-config.ts"
      via: "Os testes extraem a configuração final dos quatro módulos sem abrir conexão Redis."
      pattern: "buildRedisModules"
---

<objective>
Corrigir exclusivamente a incompatibilidade de shape TLS entre o provider `@medusajs/caching-redis@2.16.0` e os outros três consumidores Redis, mantendo o workaround operacional ativo até um gate posterior de ativação.

Purpose: fazer `tls.rejectUnauthorized=false` chegar ao ioredis do cache sem alterar os contratos válidos de Event Bus, Locking e Workflow nem ampliar o gate para INFRA-01 ou produção.
Output: dois builders explícitos, wiring correto por consumidor, regressões de contrato/segurança e documentação sanitizada do resultado.
</objective>

<execution_context>
@/home/jlima/Projetos/ecommerce/Backend/.codex/gsd-core/workflows/execute-plan.md
@/home/jlima/Projetos/ecommerce/Backend/.codex/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@AGENTS.md
@apps/backend/src/infrastructure/redis-config.ts
@apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts
@node_modules/@medusajs/caching-redis/dist/loaders/connection.js
@node_modules/@medusajs/event-bus-redis/dist/loaders/index.js
@node_modules/@medusajs/locking-redis/dist/loaders/index.js
@node_modules/@medusajs/workflow-engine-redis/dist/loaders/redis.js

O worktree deve iniciar limpo, com `stash@{0}` nomeado `infra01-blocked-cache-runtime-unproven-20260715`. Trate esse stash e os backups textuais do INFRA-01 como somente leitura: não criar outro stash, não aplicar, remover, renomear ou sobrescrever o existente. Se a baseline, o inventário ou qualquer loader instalado divergir do contrato descrito abaixo, parar como BLOCKED antes de editar código.

Este é um quick gate customizado que encerra no manual gate. Não executar as etapas 5.6, 7 e 8 do workflow quick padrão: o PLAN não recebe commit pre-dispatch, `.planning/STATE.md` não será atualizado e a finalização não usará o commit documental agregado do workflow. O `task_commit_protocol` do executor fica desabilitado: o subagente executor edita código/teste e produz VERIFICATION/SUMMARY, mas não cria commit algum. `CACHE01A_BASE_SHA` deve ser capturado antes de qualquer commit e deve corresponder ao HEAD inicial `12dea994f81c4713ceaa68c2352de3e2956e412d`. Somente o orquestrador, após PASS de todos os gates, cria exatamente os dois commits descritos neste plano: primeiro o commit de código com os dois arquivos de implementação/teste, depois o commit documental contendo somente PLAN, VERIFICATION e SUMMARY. Se a classificação for BLOCKED, nenhum commit é permitido.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Separar os builders e preservar os shapes por consumidor</name>
  <files>apps/backend/src/infrastructure/redis-config.ts, apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts</files>
  <behavior>
    - Cache + rediss:// + opt-in TLS explícito -> `{ redisUrl, tls: { rejectUnauthorized: false } }`, sem propriedade intermediária de opções.
    - Locking e Event Bus nas mesmas condições -> `{ redisUrl, redisOptions: { tls: { rejectUnauthorized: false } } }`.
    - Workflow nas mesmas condições -> `{ redis: { redisUrl, redisOptions: { tls: { rejectUnauthorized: false } } } }` no descritor final.
    - Qualquer consumidor com redis://, ou rediss:// sem valor literal `false`, recebe somente `redisUrl`.
    - Workaround ligado -> cache ausente e os outros três módulos inalterados; workaround ausente -> quatro módulos Redis e nenhum fallback local/in-memory.
  </behavior>
  <action>Antes de qualquer edição e antes de qualquer commit, capturar `CACHE01A_BASE_SHA=$(git rev-parse HEAD)`, exigir igualdade com `12dea994f81c4713ceaa68c2352de3e2956e412d` e persistir o valor em `/tmp/cache01a-base-sha.txt`; capturar `CACHE01A_INFRA_STASH_OID=$(git rev-parse stash@{0})` em `/tmp/cache01a-infra-stash-oid.txt`; e salvar os inventários imutáveis com `git stash show --include-untracked --name-only --format= stash@{0} > /tmp/cache01a-infra-stash-names.txt` e `git stash show --include-untracked --stat --format= stash@{0} > /tmp/cache01a-infra-stash-stat.txt`. Confirmar nos quatro loaders instalados que cache desestrutura `redisUrl` e repassa o restante ao ioredis, Event Bus e Locking leem `redisOptions`, e Workflow lê isso dentro de `options.redis`; se baseline, stash, inventário ou loaders divergirem, registrar BLOCKED e parar antes da edição. Escrever primeiro as expectativas de shape no teste. Em `redis-config.ts`, substituir o builder indiscriminado por tipos explícitos equivalentes a `RedisTlsOptions`, `StandardRedisModuleOptions` e `CachingRedisProviderOptions`, e por `buildStandardRedisModuleOptions(redisUrl)` e `buildCachingRedisProviderOptions(redisUrl)`. Ambos devem aparar a URL e reutilizar a decisão existente de TLS; o builder padrão aninha as opções e o builder de cache espalha `tls` no nível superior. Conectar exclusivamente o cache ao builder plano e manter Locking, Event Bus e Workflow no builder padrão, preservando URLs específicas, IDs, `is_default`, namespaces/prefixos existentes, release migration mode, desenvolvimento local e `REDIS_CACHE_PROVIDER_DISABLED`. Não alterar `process.env`, agentes globais TLS/HTTPS ou a semântica de opt-in. O executor não cria commit nesta tarefa nem em qualquer outra; seu `task_commit_protocol` está desabilitado.</action>
  <verify>
    <automated>TMPDIR=/tmp npm run test:unit -w @dtc/backend -- src/infrastructure/__tests__/redis-config.unit.spec.ts</automated>
  </verify>
  <done>Os quatro descritores finais exibem exatamente os shapes exigidos para redis://, rediss:// com opt-in e rediss:// sem opt-in; a flag transitória continua afetando apenas o cache.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fixar o contrato do loader 2.16 e a segurança das evidências</name>
  <files>apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts</files>
  <behavior>
    - A configuração final do cache é desestruturada como o loader 2.16 e produz `ioredisOptions.tls.rejectUnauthorized === false`.
    - O restante repassado ao ioredis do cache não contém um objeto `redisOptions` aninhado.
    - Nenhum teste de contrato abre socket ou conecta a Redis.
    - Mensagens de erro e evidências/snapshots não contêm esquemas Redis, username, password nem hostname canário.
  </behavior>
  <action>Adicionar uma regressão de contrato sobre o provider final retornado por `buildRedisModules`: simular em memória a desestruturação do loader 2.16, verificar o TLS plano e a ausência do wrapper incompatível, sem importar/inicializar o loader e sem conexão externa. Manter provas explícitas dos contratos aninhados dos outros três consumidores. Usar URLs canário com credenciais apenas como entrada local e testar que mensagens capturadas e evidências sanitizadas não repetem scheme, username, password ou hostname; usar matchers como `expect.any(String)` para o campo obrigatório em vez de gravar a URL em snapshots. Não imprimir URLs reais ou canários nos relatórios. Não criar commit nesta tarefa; o código e todos os seus testes formarão juntos o primeiro commit somente após PASS dos gates completos.</action>
  <verify>
    <automated>TMPDIR=/tmp npm run test:unit -w @dtc/backend -- src/infrastructure/__tests__/redis-config.unit.spec.ts src/config/__tests__/env.unit.spec.ts</automated>
  </verify>
  <done>Uma regressão sem rede prova diretamente o contrato do loader do cache, os shapes dos demais módulos permanecem cobertos e nenhuma evidência de teste expõe os canários Redis.</done>
</task>

<task type="auto">
  <name>Task 3: Executar os gates completos e documentar PASS ou BLOCKED</name>
  <files>.planning/quick/260716-cache01a-redis-cache-tls-shape/VERIFICATION.md, .planning/quick/260716-cache01a-redis-cache-tls-shape/SUMMARY.md</files>
  <action>Executar primeiro os testes focados reais de redis-config e env, depois a suíte unitária completa, lint e build com os ambientes prescritos. Confirmar baseline mínimo de 44 suítes/730 testes sem desaparecimento, lint com zero erros e no máximo 208 warnings, e build exit 0. Executar `git diff --check`, inventário de status/stat/name-only e confirmar que a superfície está limitada à allowlist de `apps/backend/src/infrastructure/redis-config.ts`, `apps/backend/src/infrastructure/__tests__/redis-config.unit.spec.ts`, `PLAN.md`, `VERIFICATION.md` e `SUMMARY.md` deste quick gate. Recalcular OID, names e stat de `stash@{0}` com os mesmos comandos `--include-untracked` e exigir igualdade byte a byte com `/tmp/cache01a-infra-stash-oid.txt`, `/tmp/cache01a-infra-stash-names.txt` e `/tmp/cache01a-infra-stash-stat.txt`; qualquer diferença é BLOCKED. Escrever VERIFICATION e SUMMARY sem segredos, registrando contrato real dos quatro loaders, causa raiz, shape anterior/corrigido, redis:// versus rediss://, workaround ainda ativo, resultados e contagens, arquivos, stash preservado e ausência de config var, deploy, provider externo e Phase 12. Classificar somente PASS quando todos os gates passarem; qualquer falha é BLOCKED, nunca `PASS WITH KNOWN DEBTS`. O executor deve então retornar ao orquestrador com o worktree ainda sem commits. Se BLOCKED, o orquestrador não cria commit algum. Somente após PASS, o orquestrador cria exatamente o primeiro commit `fix(redis): pass TLS options correctly to cache provider`, contendo apenas os dois arquivos de código/teste, e exatamente o segundo commit `docs(redis): record cache TLS contract correction`, contendo apenas `.planning/quick/260716-cache01a-redis-cache-tls-shape/PLAN.md`, `VERIFICATION.md` e `SUMMARY.md`; depois lê `CACHE01A_BASE_SHA` de `/tmp/cache01a-base-sha.txt`, audita `git diff --name-only "$CACHE01A_BASE_SHA"..HEAD` contra essa allowlist de cinco arquivos e exige worktree limpo. Não executar as etapas 5.6, 7 ou 8 do quick padrão, não atualizar STATE.md e não aplicar o stash.</action>
  <verify>
    <automated>TMPDIR=/tmp npm run test:unit -w @dtc/backend &amp;&amp; HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run lint -w @dtc/backend &amp;&amp; HOME=/tmp XDG_CONFIG_HOME=/tmp TMPDIR=/tmp ADMIN_DISABLED=true npm run build -w @dtc/backend &amp;&amp; git diff --check &amp;&amp; git stash list | head -5 &amp;&amp; git stash show --stat stash@{0}</automated>
  </verify>
  <done>VERIFICATION.md e SUMMARY.md registram PASS somente com testes, lint, build, integridade e stash preservado; caso contrário registram BLOCKED e nenhuma ativação operacional é tentada.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Variáveis Redis -> configuração Medusa -> ioredis | URLs e opções TLS atravessam contratos diferentes por provider; shape incorreto pode descartar segurança ou disponibilidade. |
| Erros/testes -> logs e documentação | URLs Redis podem conter credenciais e hostnames operacionais e não podem aparecer em evidências. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-CACHE-01A-01 | Tampering | Builders Redis | mitigate | Tipos/builders separados e testes do descritor final impedem mistura silenciosa de contratos. |
| T-CACHE-01A-02 | Information Disclosure | Erros, snapshots e documentação | mitigate | Canários, matchers sanitizados e inspeção explícita impedem URLs/credenciais em evidências. |
| T-CACHE-01A-03 | Denial of Service | TLS do caching-redis | mitigate | Contrato plano do loader é fixado sem relaxamento implícito e sem mudança TLS global. |
| T-CACHE-01A-SC | Tampering | Dependências | accept | Nenhuma instalação ou alteração de package/lockfile está autorizada neste gate. |
</threat_model>

<verification>
1. Antes da edição, capturar o SHA base, OID imutável e inventários names/stat completos do stash com `--include-untracked`; confirmar os loaders instalados e parar se qualquer precondição divergir.
2. Executar testes focados de redis-config e env, depois unitários completos.
3. Executar lint e build no workspace `@dtc/backend` com TMPDIR/HOME/XDG/ADMIN_DISABLED definidos.
4. Exigir OID, names e stat finais idênticos ao snapshot inicial do stash INFRA-01.
5. O executor encerra sem commits; se BLOCKED, nenhum commit é criado. Após PASS, somente o orquestrador cria os dois commits autorizados e audita `git diff --name-only "$CACHE01A_BASE_SHA"..HEAD`, exigindo exatamente a allowlist de cinco arquivos e worktree limpo.
6. Não executar as etapas 5.6, 7 ou 8 do quick padrão e desabilitar o `task_commit_protocol` do executor; não atualizar STATE.md, fazer push, deploy, alterar config vars, conectar a Redis real ou aplicar o stash.
</verification>

<success_criteria>
- Cache recebe TLS plano e os três módulos restantes preservam o contrato aninhado.
- TLS só é relaxado para rediss:// com opt-in explícito; nenhuma configuração global é tocada.
- Workaround continua aceito e omite somente o cache.
- Testes focados e completos, lint e build passam sem regressão de contagem.
- Diff de código contém somente os dois arquivos autorizados; documentação contém somente PLAN, VERIFICATION e SUMMARY neste diretório.
- O primeiro commit contém somente `redis-config.ts` e seu teste; o segundo contém somente PLAN, VERIFICATION e SUMMARY.
- OID e inventários completos do stash INFRA-01 permanecem idênticos; STATE.md, release command, config vars, packages, migrations, deploy e Phase 12 permanecem intocados.
</success_criteria>

<output>
Ao concluir a execução, o executor cria exclusivamente `.planning/quick/260716-cache01a-redis-cache-tls-shape/VERIFICATION.md` e `.planning/quick/260716-cache01a-redis-cache-tls-shape/SUMMARY.md` além das duas alterações de código/teste autorizadas, mas não cria commits. Se todos os gates resultarem em PASS, somente o orquestrador finaliza exatamente com os dois commits permitidos, sem incluir STATE.md: o commit de código contém apenas os dois arquivos de código/teste e o commit documental contém apenas PLAN/VERIFICATION/SUMMARY. Se BLOCKED, nenhum commit. Este quick gate customizado termina no manual gate, pula as etapas 5.6/7/8 do workflow quick padrão e desabilita o `task_commit_protocol` do executor. Não retomar INFRA-01, não ativar o cache e não fazer push/deploy.
</output>
