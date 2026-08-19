# Phase 14: Customer Auth & Verification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `14-CONTEXT.md`; this log preserves the alternatives considered.

**Date:** 2026-08-11
**Phase:** 14-customer-auth-verification
**Areas discussed:** Cadastro parcialmente concluido, Limite da sessao inicial, Verificacao e reenvio, Reset e revogacao

---

## Cadastro parcialmente concluido

### 1. Identidade criada e falha ao criar Customer

| Option | Description | Selected |
|---|---|---|
| Retomar automaticamente | Tratar identidade criada como estado intermediario e continuar retry compativel | ✓ |
| Concluir em segundo plano | Aceitar cadastro e deixar worker concluir o Customer | |
| Reiniciar o cadastro | Descartar a intencao e exigir novo fluxo | |
| Outra preferencia | Regra livre | |

**User's choice:** Retomar automaticamente.

**Notes:** A retomada e idempotente, nao duplica identidade/`Customer`, nao
revela a falha parcial e permanece recuperavel se uma nova tentativa falhar.

### 2. Tentativas concorrentes de recuperacao

| Option | Description | Selected |
|---|---|---|
| Convergir para o mesmo resultado | Ambas observam um unico resultado canonico persistido | ✓ |
| Retornar em processamento | A concorrente recebe estado intermediario e consulta depois | |
| Rejeitar a concorrente | Uma tentativa vence e a outra recebe conflito | |
| Outra preferencia | Regra livre | |

**User's choice:** Convergir para o mesmo resultado.

**Notes:** No maximo um `Customer`; persistencia, constraint e idempotencia sao
a garantia primaria. Lock em memoria nao e suficiente. Falha canonica produz
resposta generica para ambas e preserva retomabilidade.

### 3. Retry com dados semanticamente diferentes

| Option | Description | Selected |
|---|---|---|
| Rejeitar sem alterar o pendente | Preserva integralmente a intencao original | ✓ |
| Preservar a primeira intencao | Ignora silenciosamente os novos campos | |
| Atualizar o cadastro pendente | Sobrescreve a intencao com o payload novo | |
| Outra preferencia | Regra livre | |

**User's choice:** Rejeitar sem alterar o pendente.

**Notes:** Nome, senha e demais dados nao sao alterados; nenhuma identidade ou
`Customer` adicional e criado. A resposta e generica/anti-enumeracao para
impedir takeover ou mudanca implicita de credenciais.

### 4. Duracao da intencao parcialmente concluida

| Option | Description | Selected |
|---|---|---|
| Janela finita | TTL persistido, com valor exato definido depois | ✓ |
| Ate conclusao | Intencao permanece recuperavel indefinidamente | |
| Exigir intervencao interna | Somente operador pode encerrar/desbloquear | |
| Outra preferencia | Regra livre | |

**User's choice:** Janela finita.

**Notes:** Depois do TTL, a intencao nao e reutilizavel, dados sensiveis nao sao
reaproveitados e um novo cadastro pode iniciar sem expor o estado anterior. O
valor exato foi reservado ao RESEARCH.

---

## Limite da sessao inicial

### 1. Refresh da sessao inicial nao verificada

| Option | Description | Selected |
|---|---|---|
| Preservar a mesma linhagem | Refresh renova token tecnico sem criar nova sessao logica | ✓ |
| Encerrar no primeiro JWT | Expiracao do JWT inicial exige verificacao | |
| Preservar somente durante o checkout | Excecao sobrevive apenas com checkout em andamento | |
| Outra preferencia | Regra livre | |

**User's choice:** Preservar a mesma linhagem.

**Notes:** Refresh nao reinicia o limite absoluto. Logout, revogacao,
reset/alteracao de senha ou expiracao absoluta encerram a excecao; nova
autenticacao exige e-mail verificado.

### 2. Credenciais anteriores apos refresh

| Option | Description | Selected |
|---|---|---|
| Rotacionar o refresh e manter o access token curto | Refresh token vira uso unico; access token anterior expira naturalmente | ✓ |
| Invalidar tudo imediatamente | Cada refresh encerra tambem access tokens anteriores | |
| Permitir sobreposicao controlada | Refresh anterior continua valido por pequena janela | |
| Outra preferencia | Regra livre | |

**User's choice:** Rotacionar o refresh e manter o access token curto.

**Notes:** O refresh consumido e invalidado imediatamente; o descendente
pertence a mesma linhagem. Logout/revogacao/reset/alteracao de senha encerram a
linhagem inteira.

### 3. Reuse/replay de refresh consumido

| Option | Description | Selected |
|---|---|---|
| Revogar toda a linhagem imediatamente | Descendente e futuras renovacoes sao invalidados | ✓ |
| Bloquear refresh e deixar access tokens expirarem | Cadeia de refresh para, mas access tokens terminam o TTL | |
| Rejeitar apenas o replay | Descendente atual permanece utilizavel | |
| Outra preferencia | Regra livre | |

**User's choice:** Revogar toda a linhagem imediatamente.

**Notes:** Access tokens ativos sao rejeitados quando o mecanismo permitir;
resposta publica permanece generica e evidencia interna nao inclui tokens. O
risco de retry legitimo apos resposta perdida foi aceito em favor da protecao.
RESEARCH pode estudar recuperacao idempotente/atomica que nao aceite reuse
arbitrario.

### 4. Expiracao absoluta durante checkout

| Option | Description | Selected |
|---|---|---|
| Encerrar permissoes do cliente imediatamente | Bloqueia novas chamadas e preserva estado/processamento | ✓ |
| Conceder uma janela curta de checkout | Permite apenas operacoes finais por um grace period | |
| Manter a excecao ate terminar o checkout | Checkout aberto estende a autorizacao | |
| Outra preferencia | Regra livre | |

**User's choice:** Encerrar permissoes do cliente imediatamente.

**Notes:** Carrinho e checkout persistidos permanecem intactos; processamento
server-side continua; webhook Stripe canonico ainda confirma pagamento e cria
`Order`. Nenhuma expiracao de sessao desfaz verdade financeira.

---

## Verificacao e reenvio

### 1. Inicio da verificacao

| Option | Description | Selected |
|---|---|---|
| Disparar automaticamente apos o cadastro | Registra envio depois de identidade + Customer | ✓ |
| Disparar quando a sessao inicial terminar | Adia ate novo login ser bloqueado | |
| Exigir solicitacao explicita | Usuario precisa pedir o primeiro link | |
| Outra preferencia | Regra livre | |

**User's choice:** Disparar automaticamente apos o cadastro.

**Notes:** Registro duravel/idempotente e nao bloqueante. Falha do Resend nao
reverte identidade/`Customer`, nao encerra a sessao inicial e nao aparece na
resposta publica. Reenvio permanece disponivel.

### 2. Reenvio com token anterior ainda ativo

| Option | Description | Selected |
|---|---|---|
| Somente o token mais recente permanece valido | Rotacao latest-wins invalida anteriores | ✓ |
| Primeiro token utilizado vence | Tokens coexistem ate um deles confirmar | |
| Nao rotacionar antes da expiracao | Reenvio reutiliza a intencao ativa | |
| Outra preferencia | Regra livre | |

**User's choice:** Somente o token mais recente permanece valido.

**Notes:** Rotacao e atomica; concorrencia nao deixa duas intencoes validas.
Token substituido recebe resposta generica. Confirmacao invalida qualquer token
remanescente daquela identidade.

### 3. Uso do link sem sessao ativa

| Option | Description | Selected |
|---|---|---|
| Token de e-mail e suficiente, mas nao cria sessao | Link confirma e-mail em qualquer navegador | ✓ |
| Exigir autenticacao do mesmo Customer | Token e sessao precisam coexistir | |
| Vincular a sessao inicial | Somente a linhagem original usa o token | |
| Outra preferencia | Regra livre | |

**User's choice:** Token de e-mail e suficiente, mas nao cria sessao.

**Notes:** Token valido, vigente, hash-only e de uso unico confirma o e-mail,
mas nao autentica nem emite JWT. O usuario precisa fazer login normalmente.

### 4. Resposta publica do reenvio

| Option | Description | Selected |
|---|---|---|
| Resposta publica uniforme de aceite | Todos os estados retornam o mesmo resultado | ✓ |
| Distinguir apenas conta ja verificada | Informa que verificacao nao e necessaria | |
| Retornar erro generico para inelegiveis | Diferencia aceite elegivel de erro generico | |
| Outra preferencia | Regra livre | |

**User's choice:** Resposta publica uniforme de aceite.

**Notes:** Somente identidade pendente/elegivel cria token e envio. Existencia,
estado, rate limit, idempotencia e resultado do provedor permanecem internos.
`request accepted` nao prova que o e-mail existe, que um token foi gerado ou
que o provedor aceitou a entrega.

---

## Reset e revogacao

### 1. Reset para identidade nao verificada

| Option | Description | Selected |
|---|---|---|
| Pode redefinir, mas continua nao verificada | Reset recupera senha sem alterar verificacao | ✓ |
| Reset disponivel somente apos verificacao | Nao cria intencao para nao verificados | |
| Reset tambem verifica o e-mail | Posse do link marca e-mail verificado | |
| Outra preferencia | Regra livre | |

**User's choice:** Pode redefinir, mas continua nao verificada.

**Notes:** Reset nao concede sessao nem autentica. Todas as linhagens existentes
sao revogadas e novo login continua bloqueado ate verificacao. Posse temporaria
do link nao equivale a estado persistente de e-mail verificado.

### 2. Nova solicitacao com reset anterior ativo

| Option | Description | Selected |
|---|---|---|
| Somente o token mais recente permanece valido | Nova intencao invalida atomicamente anteriores | ✓ |
| Primeiro token utilizado vence | Multiplos tokens coexistem ate primeiro uso | |
| Preservar a intencao existente | Nenhum token novo antes da expiracao | |
| Outra preferencia | Regra livre | |

**User's choice:** Somente o token mais recente permanece valido.

**Notes:** Semantica latest-wins, uso unico, hash-only e fail-closed. Requests
concorrentes nao deixam duas intencoes validas; conclusao invalida tokens
remanescentes e rejeicoes usam resposta generica.

### 3. Consistencia entre senha e revogacao

| Option | Description | Selected |
|---|---|---|
| Somente apos ambos estarem duraveis | Senha, consumo e revogacao compoem o sucesso | ✓ |
| Senha primeiro, revogacao eventual | Confirma reset antes de revogar sessoes | |
| Revogacao primeiro, senha eventual | Encerra sessoes antes de confirmar a senha | |
| Outra preferencia | Regra livre | |

**User's choice:** Somente apos ambos estarem duraveis.

**Notes:** `reset success = password updated + reset token consumed + all
session lineages revoked`. Falha parcial e recuperavel/reconciliavel, retries
convergem idempotentemente e nenhum sucesso publico e retornado sob incerteza.
Implementacao transacional exata foi reservada ao RESEARCH.

### 4. Prova para alteracao autenticada de senha

| Option | Description | Selected |
|---|---|---|
| Senha atual mais sessao valida | Exige ambas e revoga inclusive a sessao corrente | ✓ |
| Reautenticacao recente | Sessao marcada como recente substitui a senha atual | |
| Sempre usar token por e-mail | Toda troca vira fluxo equivalente ao reset | |
| Outra preferencia | Regra livre | |

**User's choice:** Senha atual mais sessao valida.

**Notes:** Sessao isolada nao basta. Depois da nova senha persistida, todas as
linhagens sao revogadas e nenhuma sessao substituta e emitida. Novo login usa a
nova senha e continua condicionado a verificacao quando o `Customer` nao for
verificado. Troca autenticada permanece distinta de reset por capability.

---

## Agent Discretion

Nenhuma decisao foi delegada integralmente ao agente. Somente detalhes tecnicos
explicitamente reservados a um futuro RESEARCH permanecem abertos: mecanismo
Medusa/customizado, modelo fisico, constraints, TTLs exatos de intencoes/tokens,
transacao/reconciliacao, enforcement de revogacao, recuperacao de resposta
perdida e thresholds de rate limit.

## Deferred Ideas

Nenhuma. A discussao permaneceu dentro de `AUTH-01..AUTH-09`.

## Gate de encerramento

Este log e `14-CONTEXT.md` devem parar em revisao humana. RESEARCH, PLAN,
SPEC/SDD, implementation prompt, execucao, testes, migrations, providers,
deploy, frontend e phases posteriores permanecem bloqueados ate autorizacao
explicita e separada.
