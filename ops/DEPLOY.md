# Runbook de deploy — Backend Medusa (Fase 01)

Este documento descreve como operar o Walking Skeleton em **local** e **production**.  
**Staging** é apenas uma convenção futura — não há provisionamento nesta fase.

> **Status operacional (2026-06-26):** este runbook VPS/PM2/Nginx permanece como blueprint portável da Fase 01, mas a rota de produção validada neste ciclo foi substituída por Heroku. O checkpoint atual está em `.planning/phases/01-foundation-observability/01-07-SUMMARY.md` e usa Heroku app `espacoliminar`, Supabase Postgres via pooler e Heroku Redis com TLS.

Nenhum secret, domínio real, IP público ou URL privada deve ser commitado.  
Todos os exemplos usam placeholders.

---

## Visão geral da topologia

| Componente | Papel |
|------------|-------|
| **Nginx** | Única borda pública (80/443, TLS via Certbot) |
| **medusa-server** (PM2) | HTTP em `127.0.0.1:9000`, Admin habilitado |
| **medusa-worker** (PM2) | Background jobs, Admin desabilitado, sem listener HTTP |
| **Postgres/Supabase** | Privado — runtime via `DATABASE_URL` pooled |
| **Redis** | Privado — quatro contratos de URL separados |
| **Sentry** | DSN configurado apenas no ambiente do operador |

```text
Internet ──► Nginx (api.__DOMAIN__ / admin.__DOMAIN__)
                 │
                 └──► 127.0.0.1:9000 (medusa-server)

PM2 medusa-worker ──► Redis / Postgres (sem HTTP público)
```

---

## Pré-requisitos

### Local (desenvolvimento)

- Node.js **22.x LTS**
- Postgres e Redis acessíveis (Docker, WSL ou serviços remotos)
- Copiar `apps/backend/.env.template` → `apps/backend/.env` e preencher **fora do Git**

### Production (VPS)

- Ubuntu/Debian estável com usuário dedicado `<APP_USER>` (sem root para a app)
- Pacotes: `nginx`, `certbot`, `python3-certbot-nginx`, `pm2` (via npm global ou pacote)
- Firewall: **somente** 22 (SSH), 80 (HTTP), 443 (HTTPS)
- Postgres (Supabase) e Redis **privados** — nunca expor portas 5432/6379
- DNS: `api.__DOMAIN__` e `admin.__DOMAIN__` apontando para o VPS
- Arquivo de ambiente em `<APP_ROOT>/apps/backend/.env` (permissões `600`, dono `<APP_USER>`)

### Variáveis obrigatórias (production)

Exportar **uma única vez** antes do build/start — especialmente `APP_VERSION`:

| Variável | Uso |
|----------|-----|
| `APP_VERSION` | Identificador imutável da release (commit SHA ou tag) — consumido por env.ts, Sentry, health e PM2 |
| `DATABASE_URL` | Runtime pooled (servidor + worker) |
| `DATABASE_MIGRATION_URL` | Migrações direct/session (**nunca** porta 6543) |
| `REDIS_URL`, `CACHE_REDIS_URL`, `EVENTS_REDIS_URL`, `WE_REDIS_URL` | Contratos Redis |
| `API_PUBLIC_URL`, `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` | URLs públicas renderizadas |
| `JWT_SECRET`, `COOKIE_SECRET` | Mínimo 32 caracteres, gerados fora do Git |
| `SENTRY_DSN` | Projeto Sentry production |
| `WORKER_MODE` / `ADMIN_DISABLED` | Definidos pelo PM2 ecosystem — não sobrescrever manualmente nos processos |

`APP_VERSION` **não** deve ser lido de Git em runtime nem ter fallback paralelo no ecosystem PM2.

---

## Ambiente local

### 1. Instalar dependências

```bash
cd <REPO_ROOT>
npm ci
```

### 2. Configurar ambiente

```bash
cp apps/backend/.env.template apps/backend/.env
# Editar apps/backend/.env com valores locais (sem commitar)
```

Modo local usa `WORKER_MODE=shared` e `ADMIN_DISABLED=false` (padrão do template).

### 3. Migrar banco

```bash
cd apps/backend
npm run db:migrate:safe
```

### 4. Desenvolver

```bash
npm run dev
# ou: cd apps/backend && npm run dev
```

Medusa escuta em `http://127.0.0.1:9000` com Admin em `/app`.

### 5. Verificar health (servidor local rodando)

```bash
curl -fsS http://127.0.0.1:9000/health/live
curl -fsS http://127.0.0.1:9000/health/ready
```

---

## Deploy production (primeira instalação)

Substituir placeholders:

- `<REPO_ROOT>` — checkout do repositório no VPS
- `<APP_ROOT>` — diretório de deploy (ex.: `/srv/<APP_USER>/app`)
- `<APP_USER>` — usuário Unix dedicado
- `api.__DOMAIN__` / `admin.__DOMAIN__` — hosts DNS reais (**fora deste doc**)

### 1. Preparar usuário e firewall

```bash
sudo adduser --disabled-password <APP_USER>
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 2. Clonar release e definir APP_VERSION

```bash
sudo -u <APP_USER> -H bash -lc '
  export APP_ROOT=<APP_ROOT>
  export APP_VERSION=<COMMIT_SHA_OR_RELEASE_TAG>
  cd "$APP_ROOT"
  git fetch --tags origin
  git checkout "$APP_VERSION"
'
```

**Bloqueante:** se `APP_VERSION` estiver ausente ou for placeholder (`dev`, `unknown`), o schema de ambiente falha em production.

### 3. Instalar dependências e build

```bash
sudo -u <APP_USER> -H bash -lc '
  export APP_ROOT=<APP_ROOT>
  export APP_VERSION=<COMMIT_SHA_OR_RELEASE_TAG>
  cd "$APP_ROOT"
  npm ci
  cd apps/backend
  npm run build
'
```

Confirmar artefato: `<APP_ROOT>/apps/backend/.medusa/server`

### 4. Configurar `.env` production

Criar `<APP_ROOT>/apps/backend/.env` com todos os contratos de `apps/backend/.env.template`.  
**Nunca** commitar este arquivo.

### 5. Executar migração segura (antes de reiniciar processos)

```bash
sudo -u <APP_USER> -H bash -lc '
  export APP_ROOT=<APP_ROOT>
  export APP_VERSION=<COMMIT_SHA_OR_RELEASE_TAG>
  set -a
  source "$APP_ROOT/apps/backend/.env"
  set +a
  cd "$APP_ROOT/apps/backend"
  npm run db:migrate:safe
'
```

Falha se `DATABASE_MIGRATION_URL` estiver ausente ou usar pooler transacional (porta 6543).

### 6. Iniciar PM2 (server + worker)

```bash
sudo -u <APP_USER> -H bash -lc '
  export APP_ROOT=<APP_ROOT>
  export APP_VERSION=<COMMIT_SHA_OR_RELEASE_TAG>
  set -a
  source "$APP_ROOT/apps/backend/.env"
  set +a
  pm2 start "$APP_ROOT/ops/pm2/ecosystem.config.cjs"
  pm2 save
'
```

Registrar startup systemd (executar comando sugerido por `pm2 startup`, depois `pm2 save`).

### 7. Comprovar bind privado

```bash
sudo ss -ltnp | grep 9000
```

**Esperado:** Medusa escuta **somente** `127.0.0.1:9000`.  
Porta 9000 **não** deve aparecer em interface pública.

### 8. Renderizar e instalar Nginx

```bash
sudo sed \
  -e "s/__API_HOST__/api.__DOMAIN__/g" \
  -e "s/__ADMIN_HOST__/admin.__DOMAIN__/g" \
  -e "s/__UPSTREAM__/127.0.0.1:9000/g" \
  <APP_ROOT>/ops/nginx/medusa.conf.template \
  | sudo tee /etc/nginx/sites-available/medusa.conf

sudo ln -sf /etc/nginx/sites-available/medusa.conf /etc/nginx/sites-enabled/medusa.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 9. TLS com Certbot

```bash
sudo certbot --nginx -d api.__DOMAIN__ -d admin.__DOMAIN__
sudo certbot renew --dry-run
```

**Checkpoint manual:** renovação dry-run deve passar antes de considerar TLS operacional.

### 10. Instalar logrotate

```bash
sudo cp <APP_ROOT>/ops/logrotate/medusa /etc/logrotate.d/medusa
# Editar paths <APP_USER> e <APP_ROOT> no arquivo instalado
sudo logrotate -d /etc/logrotate.d/medusa
```

### 11. Smoke pós-deploy

Contratos automatizados (no repositório):

```bash
node --test <APP_ROOT>/ops/tests/pm2-config.test.mjs
bash <APP_ROOT>/ops/tests/nginx-routing-smoke.sh
```

Verificações manuais (substituir hosts):

```bash
# Health — sem rate limit agressivo
curl -fsS https://api.__DOMAIN__/health/live
curl -fsS https://api.__DOMAIN__/health/ready
curl -fsS https://admin.__DOMAIN__/health/live

# Isolamento por host
curl -o /dev/null -s -w "%{http_code}\n" https://api.__DOMAIN__/app          # esperado: 404
curl -o /dev/null -s -w "%{http_code}\n" https://admin.__DOMAIN__/hooks/ping # esperado: 404
curl -o /dev/null -s -w "%{http_code}\n" https://admin.__DOMAIN__/webhooks/x # esperado: 404
curl -fsSI https://admin.__DOMAIN__/ | grep -i location                       # esperado: /app

# Admin acessível
curl -o /dev/null -s -w "%{http_code}\n" https://admin.__DOMAIN__/app         # esperado: 200 ou 302
```

### 12. Verificar APP_VERSION consistente

- Resposta de `/health/live` e `/health/ready` deve incluir `version` igual a `APP_VERSION` exportado no deploy
- Evento de teste no Sentry (se disparado) deve carregar a mesma release — **sem** registrar DSN ou payload sensível na evidência

### 13. Checkpoint pós-reboot

```bash
sudo reboot
# Após retorno:
sudo ss -ltnp | grep 9000
pm2 list
curl -fsS https://api.__DOMAIN__/health/ready
```

**Checkpoint manual:** server e worker devem voltar online; bind permanece loopback; isolamento API/Admin intacto.

---

## Deploy de release subsequente

Ordem obrigatória:

1. Exportar `APP_VERSION=<NOVA_RELEASE>`
2. Checkout da nova release em `<APP_ROOT>`
3. `npm ci` + `npm run build` em `apps/backend`
4. `npm run db:migrate:safe` (**antes** do reload PM2)
5. `pm2 reload <APP_ROOT>/ops/pm2/ecosystem.config.cjs --update-env`
6. Smoke (automated + manual)
7. `pm2 save`

---

## Rollback

1. Exportar `APP_VERSION=<RELEASE_ANTERIOR>`
2. Checkout da release anterior
3. `npm ci` + `npm run build`
4. **Não** reexecutar migrações destrutivas — se a migration nova já foi aplicada, restaurar backup de banco conforme política do operador
5. `pm2 reload` com ecosystem da release anterior
6. Smoke health + isolamento hosts
7. `pm2 save`

Documentar incidente e evidências **sanitizadas** (sem secrets).

---

## Logs e observabilidade

| Fonte | Localização |
|-------|-------------|
| PM2 stdout/stderr | `~/.pm2/logs/` ou paths configurados |
| Nginx access/error | `/var/log/nginx/` |
| Rotação | `/etc/logrotate.d/medusa` (diária, 7 rotações, maxsize 100M) |

A aplicação escreve apenas em stdout/stderr — não cria arquivos de log próprios.

Comandos úteis:

```bash
pm2 logs medusa-server --lines 100
pm2 logs medusa-worker --lines 100
sudo tail -f /var/log/nginx/error.log
```

---

## Health checks (referência)

| Endpoint | Propósito | Dependências |
|----------|-----------|--------------|
| `GET /health/live` | Liveness (processo responde) | Nenhuma |
| `GET /health/ready` | Readiness (Postgres + Redis) | `SELECT 1`, Redis `PING` |

Nginx encaminha ambos **sem** rate limit de autenticação.  
Timeouts Nginx: connect 5s, read/send 60s.

---

## Segurança e webhook raw body

- Nginx é a **única** borda pública (D-03/D-04)
- Headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, HSTS 180 dias
- Body limits: API **2m**, Admin **10m**
- Rate limit **seletivo** em rotas `auth` — nunca global
- Rotas futuras `/hooks/` e `/webhooks/` no host API:
  - `proxy_pass_request_body on`
  - Headers `Content-Type`, `Content-Length`, `Stripe-Signature` encaminhados
  - **Sem** `proxy_set_body`, gunzip ou filtros que alterem o corpo (D-06)

---

## Staging (convenção futura — não provisionado)

Quando adotado, reutilizar este runbook com:

- Hosts `api.staging.__DOMAIN__` / `admin.staging.__DOMAIN__`
- Projeto Supabase/Redis/Sentry separados
- `APP_VERSION` prefixado (ex.: `staging-<sha>`)

Nenhum passo de staging é obrigatório para concluir a Fase 01.

---

## Checklist de verificação (Fase 01 / Plan 01-07)

- [ ] DNS de API e Admin válidos
- [ ] Certbot emitido; `certbot renew --dry-run` passa
- [ ] Firewall: apenas 22/80/443
- [ ] `ss -ltnp`: Medusa somente em `127.0.0.1:9000`
- [ ] PM2: `medusa-server` + `medusa-worker` online
- [ ] Worker com `ADMIN_DISABLED=true`, sem listener HTTP
- [ ] API bloqueia `/app`; Admin bloqueia `/hooks` e `/webhooks`
- [ ] `/health/live` e `/health/ready` corretos nos dois hosts
- [ ] `APP_VERSION` idêntico em health e Sentry
- [ ] Processos restaurados após reboot
- [ ] `node --test ops/tests/pm2-config.test.mjs` verde
- [ ] `bash ops/tests/nginx-routing-smoke.sh` verde
- [ ] Nenhum secret/domínio real commitado

**Task 3 (checkpoint humano):** este checklist exige VPS real — não substituir por revisão documental apenas.

---

## Referências no repositório

| Artefato | Caminho |
|----------|---------|
| PM2 ecosystem | `ops/pm2/ecosystem.config.cjs` |
| Nginx template | `ops/nginx/medusa.conf.template` |
| Logrotate | `ops/logrotate/medusa` |
| Teste PM2 | `ops/tests/pm2-config.test.mjs` |
| Smoke Nginx | `ops/tests/nginx-routing-smoke.sh` |
| Migração segura | `apps/backend/scripts/run-migrations.mjs` |
| Contrato env | `apps/backend/src/config/env.ts` |
