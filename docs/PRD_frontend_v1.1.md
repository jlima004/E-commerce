# PRD — Frontend Storefront da Indicio Cult

| Campo | Valor |
|---|---|
| Documento | Product Requirements Document — Frontend |
| Projeto | E-commerce headless Print-on-Demand da Indicio Cult |
| Versão | 1.1.1 — alinhamento contratual pré-implementação |
| Data da revisão | 2026-08-03 |
| Status | Canônico — frontend planejado e não iniciado |
| Responsável | Jefferson |
| Base | PRD Backend v1.1 as-built · SRS v1.5.1 · OpenAPI Store 3.1.2 |
| Stack planejada | Next.js · TypeScript · Tailwind CSS · Vercel · Stripe.js · PostHog · Sentry |
| Mercado inicial | Brasil |
| Moeda | BRL |
| Backend atual | Medusa v2 no Heroku |

> **Estado do produto:** o backend v1.0 está entregue, fechado, versionado e publicado. A storefront ainda não foi iniciada. Este documento define o produto frontend e suas dependências; não autoriza implementação automática nem inicia um novo milestone.

> **Autoridade contratual:** o frontend deve consumir o comportamento versionado do backend. Quando houver conflito, prevalecem os contratos OpenAPI, o código versionado, `docs/PRD_Backend_v1.1.md`, `docs/SRS_v1.5.md` e as decisões em `.planning/`.

> **Regra central:** a storefront nunca cria, confirma ou infere um `Order`. Estados pré-pagamento permanecem em `Cart`, `PaymentCollection`, `PaymentSession` e `PaymentAttempt`. Um `Order` só existe após confirmação confiável e idempotente do webhook canônico da Stripe no backend.

---

## Sumário

1. [Resumo executivo](#1-resumo-executivo)
2. [Objetivos e métricas](#2-objetivos-e-métricas)
3. [Escopo](#3-escopo)
4. [Usuários e jornadas](#4-usuários-e-jornadas)
5. [Arquitetura do frontend](#5-arquitetura-do-frontend)
6. [Contrato atual do backend](#6-contrato-atual-do-backend)
7. [Lacunas contratuais para o MVP](#7-lacunas-contratuais-para-o-mvp)
8. [Arquitetura de informação e páginas](#8-arquitetura-de-informação-e-páginas)
9. [Fluxos detalhados](#9-fluxos-detalhados)
10. [Requisitos funcionais](#10-requisitos-funcionais)
11. [Estados de interface](#11-estados-de-interface)
12. [Dinheiro e formatação](#12-dinheiro-e-formatação)
13. [Autenticação e sessão](#13-autenticação-e-sessão)
14. [Analytics e Sentry](#14-analytics-e-sentry)
15. [Segurança e privacidade](#15-segurança-e-privacidade)
16. [Acessibilidade, desempenho e SEO](#16-acessibilidade-desempenho-e-seo)
17. [Estratégia de integração](#17-estratégia-de-integração)
18. [Testes](#18-testes)
19. [Ordem recomendada de implementação](#19-ordem-recomendada-de-implementação)
20. [Critérios de aceite](#20-critérios-de-aceite)
21. [Questões abertas](#21-questões-abertas)
22. [Referências](#22-referências)

---

## 1. Resumo executivo

A storefront da Indicio Cult será a interface pública de compra do e-commerce POD. Ela permitirá navegar pelo catálogo, selecionar variantes vendáveis, manter um carrinho, preparar o checkout brasileiro, iniciar pagamentos por cartão ou Pix, aguardar a confirmação real do backend e acompanhar o pedido por tracking seguro.

O frontend deve ser uma camada de experiência e orquestração de interface. Ele não deve duplicar regras transacionais do backend nem tratar eventos do navegador como fonte de verdade financeira.

A implementação deve respeitar cinco princípios:

1. **Contrato primeiro:** consumir apenas rotas e schemas aprovados.
2. **Backend autoritativo:** preços, totais, elegibilidade, estados e existência do pedido vêm do backend.
3. **Pagamento desacoplado do pedido:** confirmação client-side não cria `Order`.
4. **Dados sensíveis efêmeros:** tokens, `client_secret` e material Pix não são persistidos ou enviados a analytics.
5. **Falha explícita e recuperável:** loading, retry, expiração e indisponibilidade devem ter estados de interface definidos.

---

## 2. Objetivos e métricas

### 2.1 Objetivos

- oferecer uma experiência editorial e responsiva coerente com a marca Indicio Cult;
- permitir checkout convidado como caminho principal;
- suportar cliente autenticado sem comprometer o carrinho convidado;
- consumir corretamente as unidades monetárias dos contratos;
- confirmar cartão com Stripe.js sem expor dados de cartão ao backend da loja;
- apresentar Pix com tratamento seguro de QR e copia-e-cola;
- aguardar o backend antes de exibir qualquer pedido confirmado;
- oferecer tracking público reduzido por capability token;
- instrumentar comportamento de produto sem duplicar `purchase_completed`;
- manter compatibilidade com evolução versionada da Store API.

### 2.2 Métricas de sucesso

- zero página de confirmação exibida antes da existência do `Order`;
- zero cálculo financeiro autoritativo feito apenas no navegador;
- zero `client_secret`, token de tracking ou material Pix em logs/analytics;
- zero emissão frontend de `purchase_completed`;
- 100% das chamadas Store com publishable API key quando exigida;
- fluxos de catálogo, carrinho, cartão, Pix e tracking cobertos por testes;
- Core Web Vitals dentro das metas definidas para as páginas principais;
- erros de integração observáveis sem exposição de dados sensíveis.

---

## 3. Escopo

### 3.1 Incluído no frontend MVP planejado

- home institucional e comercial;
- catálogo de produtos;
- página de produto;
- galeria e variantes;
- carrinho convidado e autenticado;
- associação segura do carrinho convidado após login;
- checkout para Brasil;
- seleção de frete;
- pagamento por cartão;
- pagamento Pix quando operacionalmente habilitado;
- estado de confirmação assíncrona;
- confirmação de pedido;
- tracking público por token;
- conta de cliente, histórico e detalhe de pedidos;
- login, cadastro, logout e recuperação de senha;
- páginas legais;
- canal de suporte e solicitação de troca;
- PostHog frontend;
- Sentry frontend;
- acessibilidade básica, SEO e layout mobile-first.

### 3.2 Fora do escopo atual

- Admin ou backoffice customizado;
- editor visual de camiseta;
- upload de arte pelo cliente;
- personalização dinâmica de produto;
- app mobile nativo;
- reviews e avaliações;
- chat integrado;
- programa de afiliados;
- multi-país e multi-moeda;
- métodos de pagamento além de cartão e Pix;
- criação automática de troca pela storefront;
- execução de requisições pela Swagger UI;
- reimplementação de regras financeiras ou de fulfillment no frontend.

### 3.3 Limitações herdadas do backend

- Pix está implementado, mas depende da elegibilidade da conta Stripe;
- Resend, Gelato, PostHog e Sentry ainda possuem provas externas pendentes registradas como limitações não bloqueantes do backend v1.0;
- a integração com Correios permanece manual/semiautomática;
- a Store OpenAPI atual não cobre toda a jornada necessária ao frontend MVP.

---

## 4. Usuários e jornadas

| Perfil | Necessidade principal | Autenticação |
|---|---|---|
| Visitante | Navegar, escolher produto e iniciar carrinho | Publishable API key + sessão convidada |
| Comprador convidado | Preparar checkout, pagar e acompanhar pedido | Publishable API key + sessão convidada + token de tracking |
| Cliente autenticado | Preservar carrinho e acessar pedidos próprios | Publishable API key + JWT ou sessão de cliente |
| Operador de suporte | Atender dúvidas e registrar trocas no Admin | Fora da storefront |

### 4.1 Jornada primária

```text
Descoberta
→ catálogo
→ produto
→ variante
→ carrinho
→ dados de checkout
→ frete
→ pagamento
→ confirmação em processamento
→ pedido confirmado
→ tracking
```

### 4.2 Jornada autenticada

```text
Carrinho convidado existente
→ login
→ associação segura do carrinho
→ preservação do carrinho do cliente quando aplicável
→ checkout
→ pedido associado à conta
→ histórico e detalhe
```

---

## 5. Arquitetura do frontend

```text
Navegador
   │
   ▼
Next.js na Vercel
   │
   ├── páginas públicas e server rendering
   ├── componentes client-side para carrinho e Stripe.js
   ├── adapter Store API tipado
   ├── gerenciamento de sessão/cookies
   ├── PostHog
   └── Sentry
   │
   ▼
Backend Medusa no Heroku
   ├── Store API
   ├── autenticação Medusa
   ├── Stripe PaymentAttempt
   ├── tracking
   └── contratos OpenAPI
```

### 5.1 Responsabilidades do frontend

- renderizar conteúdo e estados de interface;
- manter somente estado de UI e referências permitidas;
- enviar a publishable API key;
- encaminhar JWT ou sessão conforme o fluxo;
- confirmar cartão via Stripe.js;
- solicitar e exibir dados retornados pelo backend;
- fazer retry controlado apenas quando seguro;
- formatar dinheiro conforme a unidade declarada pelo schema;
- enviar eventos frontend sanitizados.

### 5.2 Responsabilidades que permanecem no backend

- preço e total autoritativos;
- validação de elegibilidade do carrinho;
- criação de `PaymentAttempt`;
- confirmação financeira;
- criação do `Order`;
- registro de `purchase_completed`;
- e-mail, Gelato, tracking, reembolso e troca;
- estados de pagamento, pedido e fulfillment;
- idempotência e concorrência.

---

## 6. Contrato atual do backend

A Store OpenAPI 3.1.2 atual possui dez operações documentadas. O Swagger é somente leitura; a fonte de integração deve ser o JSON OpenAPI e os adapters do frontend.

### 6.1 Matriz de rotas documentadas

| Método | Rota | Uso no frontend | Segurança |
|---|---|---|---|
| `GET` | `/health/live` | diagnóstico técnico; não faz parte da jornada de compra | pública |
| `GET` | `/health/ready` | diagnóstico técnico; não deve ser polling do usuário | pública |
| `GET` | `/store/products` | catálogo vendável | publishable key; cliente opcional |
| `GET` | `/store/products/{id}` | detalhe vendável | publishable key; cliente opcional |
| `GET` | `/store/carts/active` | recuperar carrinho ativo | publishable key; cliente opcional |
| `POST` | `/store/carts/active` | criar ou reutilizar carrinho ativo | publishable key; cliente opcional |
| `POST` | `/store/customers/me/cart/attach` | associar carrinho convidado após autenticação | publishable key + cliente obrigatório |
| `POST` | `/store/carts/{id}/payment-attempts/card` | iniciar tentativa de cartão | publishable key; cliente opcional |
| `POST` | `/store/carts/{id}/payment-attempts/pix` | iniciar tentativa Pix | publishable key; cliente opcional |
| `POST` | `/store/tracking/lookup` | consultar tracking público por token | publishable key |

### 6.2 Cabeçalhos e autenticação

- rotas Store exigem `x-publishable-api-key`, exceto health;
- cliente autenticado pode usar `Authorization: Bearer <JWT>` ou cookie `connect.sid`;
- a rota de attach exige cliente autenticado;
- o frontend deve aceitar e propagar `x-correlation-id` para diagnóstico quando aplicável;
- publishable key é pública por definição, mas deve ser restrita ao ambiente correto e nunca confundida com secret key.

### 6.3 Catálogo

`GET /store/products` e `GET /store/products/{id}` retornam somente produtos e variantes vendáveis por um serializer público fechado.

Campos principais:

- produto: `id`, `title`, `subtitle`, `description`, `handle`, `thumbnail`, `images`, `options`, `variants`;
- variante: `id`, `title`, `sku`, `is_sellable=true`, `price`, `options`;
- preço: `currency_code="brl"` e `amount` em unidade maior BRL conforme `x-money-unit: brl-major`.

O frontend não deve tentar recuperar metadados internos Gelato ou tornar vendável uma variante ausente da resposta.

### 6.4 Carrinho ativo

O carrinho público contém:

- `id`, e-mail, moeda, região e locale;
- itens e quantidades;
- totais em unidade maior BRL;
- endereço reduzido;
- CPF/CNPJ apenas mascarado;
- cliente quando autorizado;
- `checkout_data_complete` derivado pelo backend.

`POST /store/carts/active` retorna `200` ao reutilizar um carrinho ou `201` ao criar um novo carrinho BRL.

### 6.5 Associação do carrinho convidado

`POST /store/customers/me/cart/attach` pode retornar:

- `attached_guest_cart`: carrinho convidado autorizado associado ao cliente;
- `preserve_customer_cart`: carrinho existente do cliente preservado, com razão normalizada.

O frontend não deve substituir silenciosamente um carrinho autenticado válido.

### 6.6 PaymentAttempt de cartão

`POST /store/carts/{id}/payment-attempts/card`:

- aceita body omitido ou `{}`;
- não aceita valores monetários enviados pelo cliente;
- retorna `payment_attempt_id`, status, valor em centavos, `provider_payment_intent_id` e `client_secret`;
- não cria `Order`.

O `client_secret` é efêmero e não deve ir para logs, analytics, URL ou armazenamento persistente.

### 6.7 PaymentAttempt Pix

`POST /store/carts/{id}/payment-attempts/pix` retorna:

- `payment_attempt_id`;
- status `awaiting_pix_payment`;
- valor em centavos;
- `expires_at`;
- `qr_code`;
- `copy_paste`;
- `hosted_instructions_url` quando disponível.

QR e copia-e-cola são material de pagamento sensível. Devem permanecer em memória pelo tempo necessário à tela e não devem ser enviados a PostHog, Sentry ou logs.

### 6.8 Tracking público

`POST /store/tracking/lookup` recebe exclusivamente:

```json
{
  "token": "<capability-token-opaco>"
}
```

O token deve estar no body, nunca em path ou query. A resposta pública reduzida contém referência do pedido, estados, quantidade, rótulos sanitizados, timestamp e mensagem.

---

## 7. Lacunas contratuais para o MVP

A Store OpenAPI atual não é uma documentação completa de todas as APIs nativas Medusa. O frontend não deve inventar rotas nem depender de comportamento não versionado sem decisão explícita.

### 7.1 Lacunas bloqueantes

| Jornada | Necessidade | Estado atual |
|---|---|---|
| Autenticação | cadastro, login, logout, sessão e recuperação de senha | não documentado na Store OpenAPI do projeto |
| Mutação do carrinho | adicionar, atualizar e remover line items | não documentado |
| Dados de checkout | atualizar e-mail, endereço e CPF/CNPJ | não documentado |
| Frete | listar opções e selecionar método de envio | não documentado |
| Promoções | aplicar/remover cupom, caso permaneça no MVP | não documentado |
| Confirmação assíncrona | consultar pagamento/checkout até o `Order` existir | não existe operação Store documentada |
| Pedido confirmado | obter resumo seguro da confirmação | não documentado |
| Área do cliente | listar e consultar pedidos próprios | não documentado |
| Endereços do cliente | listar, criar e reutilizar endereços | não documentado |

### 7.2 Regra de resolução

Antes de implementar cada jornada bloqueada, o milestone do frontend deve escolher uma destas opções:

1. incluir e versionar as rotas nativas Medusa necessárias no contrato Store do projeto; ou
2. criar rotas customizadas reduzidas e específicas para a storefront; ou
3. retirar a funcionalidade do MVP com decisão de produto registrada.

A decisão deve atualizar registry, testes, artefato OpenAPI, PRD Backend quando necessário, SRS e este PRD.

### 7.3 Confirmação assíncrona

O PRD anterior pressupunha estados como `confirming` e `order_confirmed`, mas a Store OpenAPI atual não expõe essa operação. Portanto:

- o comportamento continua necessário para a experiência;
- a rota e o schema ainda devem ser definidos;
- nenhuma URL, parâmetro ou payload deve ser assumido no frontend;
- a página de confirmação permanece bloqueada até existir contrato aprovado.

---

## 8. Arquitetura de informação e páginas

| Página | Rota frontend sugerida | Estado contratual |
|---|---|---|
| Home | `/` | conteúdo + catálogo disponível |
| Catálogo | `/produtos` | suportado por Store OpenAPI |
| Produto | `/produtos/[id-ou-handle]` | detalhe por `id` suportado; estratégia de handle deve ser definida |
| Carrinho | `/carrinho` | leitura/criação suportadas; mutações pendentes |
| Checkout | `/checkout` | parcialmente bloqueado |
| Pagamento em processamento | `/checkout/processando` | bloqueado por contrato de confirmação |
| Pedido confirmado | `/pedido/confirmado` | bloqueado por contrato de confirmação/resumo |
| Tracking | `/rastreio` | suportado por token no body |
| Login | `/entrar` | contrato pendente |
| Cadastro | `/cadastro` | contrato pendente |
| Recuperação | `/recuperar-senha` | contrato pendente |
| Conta | `/conta` | contrato pendente |
| Pedidos | `/conta/pedidos` | contrato pendente |
| Políticas | `/privacidade`, `/termos`, `/trocas` | conteúdo editorial |
| Contato | `/contato` | conteúdo/formulário a definir |

Tokens e secrets não devem ser colocados em URLs de frontend. O token de tracking pode chegar por fragmento, estado transitório ou outro mecanismo que permita removê-lo da barra antes da chamada; a Store API o recebe somente no body.

---

## 9. Fluxos detalhados

### 9.1 Inicialização da aplicação

```text
Aplicação carrega configuração pública
→ valida presença da URL do backend e publishable key
→ inicializa adapter Store API
→ inicializa Sentry/PostHog conforme consentimento
→ não consulta /health/ready a cada navegação
```

Health é ferramenta operacional. Falhas normais de uma requisição devem ser tratadas pela própria operação, sem transformar readiness em dependência de cada página.

### 9.2 Catálogo

```text
Usuário abre /produtos
→ frontend chama GET /store/products
→ envia x-publishable-api-key
→ aplica filtros/paginação suportados
→ renderiza somente products retornados
→ formata preço conforme brl-major
→ ausência de produtos gera empty state, não erro técnico genérico
```

Erros:

- `400`: parâmetros inválidos; corrigir requisição;
- `401`: configuração de publishable key inválida;
- `500`: exibir indisponibilidade e permitir retry.

### 9.3 Produto

```text
Usuário abre produto
→ frontend resolve o identificador aprovado
→ chama GET /store/products/{id}
→ renderiza galeria, opções e variantes vendáveis
→ seleciona combinação válida
→ CTA só habilita quando há variante retornada
```

`404` representa produto inexistente ou sem variante vendável. A página deve usar estado de “produto indisponível”, sem expor motivo interno Gelato.

### 9.4 Carrinho ativo

```text
Usuário inicia sessão de navegação
→ frontend chama GET /store/carts/active
→ 200: hidrata o carrinho
→ 404: considera que não há carrinho ativo
→ ao primeiro uso, chama POST /store/carts/active
→ 200 reutiliza; 201 cria
```

O identificador do carrinho não deve ser tratado como autorização suficiente para acessar carrinho de outra sessão.

### 9.5 Adicionar, alterar e remover itens

Este fluxo depende de contratos ainda não incluídos no Swagger do projeto.

Fluxo esperado após definição:

```text
Usuário seleciona variante e quantidade
→ frontend envia mutação contratada
→ backend valida variante e recalcula totais
→ frontend substitui estado local pela resposta canônica
→ erro de concorrência ou indisponibilidade restaura UI e informa o usuário
```

O frontend não deve atualizar o total final apenas por cálculo otimista.

### 9.6 Login com carrinho convidado

```text
Usuário possui carrinho convidado
→ autentica por contrato Medusa aprovado
→ frontend mantém a sessão convidada durante a transição
→ chama POST /store/customers/me/cart/attach
→ attached_guest_cart: usa o carrinho transferido
→ preserve_customer_cart: usa o carrinho do cliente e informa quando necessário
→ atualiza o estado global do carrinho
```

Respostas `403` não devem provocar tentativa automática com outro `cart_id`.

### 9.7 Preparação do checkout brasileiro

O contrato de atualização de checkout e frete ainda está pendente.

Comportamento de produto esperado:

```text
Usuário informa e-mail, nome, telefone e endereço BR
→ frontend valida formato para feedback imediato
→ backend valida e persiste os dados
→ backend retorna endereço reduzido e CPF/CNPJ mascarado
→ frontend solicita opções de frete
→ usuário seleciona uma opção
→ backend recalcula totais
→ frontend habilita pagamento somente com checkout_data_complete=true
```

A validação client-side melhora UX, mas não substitui a validação do backend.

### 9.8 Pagamento por cartão

Pré-condições:

- carrinho ativo;
- itens válidos;
- checkout completo;
- total retornado pelo backend;
- contrato de Stripe.js configurado.

```text
Usuário seleciona cartão
→ frontend chama POST /store/carts/{id}/payment-attempts/card com body omitido ou {}
→ recebe payment_attempt e client_secret
→ mantém client_secret somente em memória
→ Stripe.js coleta/confirma os dados do cartão
→ confirmação client-side concluída
→ frontend registra payment_client_confirmed opcional e sanitizado
→ navega para estado “processando confirmação”
→ aguarda contrato backend de confirmação do Order
```

A resposta do Stripe.js não autoriza exibir número de pedido.

### 9.9 Pagamento Pix

```text
Usuário seleciona Pix
→ frontend chama POST /store/carts/{id}/payment-attempts/pix
→ recebe QR, copia-e-cola, URL opcional e expiração
→ renderiza instruções e contador baseado em expires_at
→ registra payment_instructions_displayed sem payload Pix
→ oferece botão de copiar com feedback acessível
→ ao expirar, desabilita pagamento e oferece nova tentativa segura
→ enquanto não houver confirmação backend, não existe Order na UI
```

O material Pix deve ser removido do estado persistente quando o usuário sair da tela ou iniciar nova tentativa.

### 9.10 Confirmação assíncrona

Fluxo necessário, ainda sem rota Store contratada:

```text
Pagamento foi confirmado ou permanece pendente
→ frontend entra em estado processing
→ consulta endpoint futuro com referência opaca autorizada
→ pending: mantém polling com backoff e limite
→ confirmed: renderiza resumo retornado pelo backend
→ failed/canceled/expired: oferece ação compatível
→ timeout local: mostra mensagem neutra e orienta acompanhar e-mail
```

Regras:

- polling deve ter limite e cancelamento ao desmontar a página;
- não usar `payment_intent_id` em URL pública sem avaliação de segurança;
- não consultar `Order` por enumeração;
- refresh da página deve recuperar o fluxo por referência segura;
- indisponibilidade do PostHog não interfere na confirmação.

### 9.11 Tracking convidado

```text
Cliente abre a experiência de tracking
→ frontend obtém token por mecanismo seguro
→ remove o token da URL/estado exposto quando aplicável
→ chama POST /store/tracking/lookup com { token }
→ 200: renderiza referência, estados e itens sanitizados
→ 401: exibe mensagem genérica de link inválido/expirado
→ 429: informa limite e orienta aguardar
→ não persiste nem registra o token
```

### 9.12 Área do cliente

A área do cliente depende de contratos ainda não documentados para pedidos e endereços.

Comportamento esperado:

- listar apenas pedidos do ator autenticado;
- renderizar estados read-only;
- não usar tracking token para pedidos próprios quando houver rota autenticada;
- permitir logout seguro;
- não expor alertas internos ou estados operacionais exclusivos do Admin.

### 9.13 Solicitação de troca

No MVP, a storefront apresenta:

- política de trocas;
- canal de suporte;
- instruções sobre número/referência do pedido;
- informação de que a análise é operacional.

O frontend não cria `ExchangeRequest` diretamente enquanto não houver rota Store específica aprovada.

### 9.14 Falha do backend

```text
Requisição falha
→ adapter classifica status e código seguro
→ UI decide entre correção, retry, reautenticação ou indisponibilidade
→ correlation id é preservado para suporte
→ Sentry recebe contexto sanitizado
→ usuário nunca vê stack trace, provider payload ou secret
```

---

## 10. Requisitos funcionais

### 10.1 Fundação e integração

| ID | Requisito | Prioridade | Dependência |
|---|---|---|---|
| FE-FND-001 | Implementar Next.js com TypeScript estrito | Must | — |
| FE-FND-002 | Criar adapter tipado para Store API | Must | OpenAPI Store |
| FE-FND-003 | Enviar publishable key nas operações exigidas | Must | configuração |
| FE-FND-004 | Preservar correlation ID em erros observáveis | Must | backend |
| FE-FND-005 | Não acoplar componentes diretamente a `fetch` espalhado | Must | arquitetura frontend |
| FE-FND-006 | Separar configuração pública de secrets server-side | Must | Vercel |

### 10.2 Catálogo

| ID | Requisito | Prioridade | Estado do contrato |
|---|---|---|---|
| FE-CAT-001 | Listar produtos vendáveis | Must | disponível |
| FE-CAT-002 | Exibir detalhe de produto | Must | disponível por ID |
| FE-CAT-003 | Renderizar galeria, opções e variantes | Must | disponível |
| FE-CAT-004 | Não exibir variante ausente da resposta pública | Must | disponível |
| FE-CAT-005 | Tratar produto sem variante vendável como indisponível | Must | disponível |
| FE-CAT-006 | Suportar paginação e filtros documentados | Should | disponível conforme OpenAPI |
| FE-CAT-007 | Suportar resolução por handle | Should | requer decisão/contrato |

### 10.3 Carrinho

| ID | Requisito | Prioridade | Estado do contrato |
|---|---|---|---|
| FE-CART-001 | Recuperar carrinho ativo | Must | disponível |
| FE-CART-002 | Criar ou reutilizar carrinho BRL | Must | disponível |
| FE-CART-003 | Adicionar item | Must | pendente |
| FE-CART-004 | Atualizar quantidade | Must | pendente |
| FE-CART-005 | Remover item | Must | pendente |
| FE-CART-006 | Substituir totais locais pela resposta do backend | Must | parcial |
| FE-CART-007 | Associar carrinho convidado após login | Must | disponível; auth pendente |
| FE-CART-008 | Preservar carrinho do cliente quando indicado | Must | disponível |

### 10.4 Checkout e frete

| ID | Requisito | Prioridade | Estado do contrato |
|---|---|---|---|
| FE-CHK-001 | Permitir checkout convidado | Must | parcial |
| FE-CHK-002 | Permitir checkout autenticado | Must | parcial |
| FE-CHK-003 | Coletar e validar endereço brasileiro | Must | atualização pendente |
| FE-CHK-004 | Coletar CPF/CNPJ quando exigido | Must | contrato pendente |
| FE-CHK-005 | Nunca exibir CPF/CNPJ completo retornado | Must | backend retorna mascarado |
| FE-CHK-006 | Listar e selecionar frete antes do pagamento | Must | pendente |
| FE-CHK-007 | Usar `checkout_data_complete` do backend | Must | leitura disponível |
| FE-CHK-008 | Exibir resumo canônico do carrinho | Must | leitura disponível |
| FE-CHK-009 | Impedir pagamento com checkout incompleto | Must | backend valida |

### 10.5 Pagamento

| ID | Requisito | Prioridade | Estado do contrato |
|---|---|---|---|
| FE-PAY-001 | Iniciar PaymentAttempt de cartão | Must | disponível |
| FE-PAY-002 | Confirmar cartão com Stripe.js | Must | disponível após iniciação |
| FE-PAY-003 | Iniciar PaymentAttempt Pix | Must | disponível; ativação diferida |
| FE-PAY-004 | Exibir QR, copia-e-cola e expiração | Must para Pix | disponível |
| FE-PAY-005 | Não enviar campos monetários nas rotas de tentativa | Must | disponível |
| FE-PAY-006 | Não persistir `client_secret` ou material Pix | Must | — |
| FE-PAY-007 | Não criar nem inferir `Order` | Must | regra backend |
| FE-PAY-008 | Consultar confirmação assíncrona | Must | contrato pendente |
| FE-PAY-009 | Permitir nova tentativa após estado elegível | Must | contrato de estado pendente |

### 10.6 Tracking e conta

| ID | Requisito | Prioridade | Estado do contrato |
|---|---|---|---|
| FE-TRK-001 | Consultar tracking com token no body | Must | disponível |
| FE-TRK-002 | Tratar token inválido sem enumeração | Must | disponível |
| FE-TRK-003 | Tratar rate limit | Must | disponível |
| FE-ACC-001 | Cadastro e login | Must | pendente no OpenAPI do projeto |
| FE-ACC-002 | Logout e recuperação de senha | Must | pendente |
| FE-ACC-003 | Histórico e detalhe de pedidos próprios | Must | pendente |
| FE-ACC-004 | Endereços salvos | Should | pendente |

### 10.7 Conteúdo e suporte

| ID | Requisito | Prioridade |
|---|---|---|
| FE-CNT-001 | Publicar Política de Privacidade | Must |
| FE-CNT-002 | Publicar Termos de Compra | Must |
| FE-CNT-003 | Publicar Política de Trocas | Must |
| FE-CNT-004 | Exibir canal de suporte | Must |
| FE-CNT-005 | Não prometer automação de troca inexistente | Must |

---

## 11. Estados de interface

Cada operação deve definir pelo menos:

- `idle`;
- `loading`;
- `success`;
- `empty`, quando aplicável;
- `validation_error`;
- `unauthorized`;
- `forbidden`;
- `not_found`;
- `rate_limited`;
- `server_error`;
- `offline`;
- `retrying`, quando seguro.

### 11.1 Estados do pagamento

Estados de UI não são estados financeiros autoritativos.

| Estado UI | Significado |
|---|---|
| `preparing_payment` | criando `PaymentAttempt` |
| `awaiting_card_confirmation` | Stripe.js aguardando interação |
| `awaiting_pix_payment` | instruções Pix válidas e não expiradas |
| `processing_confirmation` | backend ainda não confirmou o `Order` |
| `payment_failed` | falha confirmada pelo contrato futuro |
| `payment_canceled` | cancelamento confirmado |
| `payment_expired` | tentativa expirada |
| `order_confirmed` | backend retornou resumo de pedido existente |
| `confirmation_timeout` | polling local encerrou sem conclusão; estado final desconhecido |

`confirmation_timeout` não significa pagamento falho.

---

## 12. Dinheiro e formatação

A Store API usa mais de uma unidade monetária.

| Contexto | Unidade contratada |
|---|---|
| Catálogo | `brl-major` |
| Carrinho público | `brl-major` |
| `PaymentAttempt.amount` | `brl-minor` em centavos |

Regras:

- o adapter deve carregar a unidade junto ao valor;
- não criar uma função global que presuma centavos para todos os campos;
- não converter catálogo/carrinho dividindo por 100;
- formatar com `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`;
- não recalcular totais finais com ponto flutuante;
- testes devem cobrir as duas unidades.

---

## 13. Autenticação e sessão

A estratégia final deve ser escolhida antes da implementação:

- JWT no cliente; ou
- sessão por cookie `connect.sid`; ou
- combinação explícita por contexto.

### 13.1 Requisitos

- autenticação deve usar contrato Medusa aprovado e documentado;
- cookies cross-origin exigem HTTPS, CORS e `SameSite` coerentes;
- JWT não deve ser armazenado em localStorage sem avaliação de risco;
- a sessão convidada deve sobreviver ao login até a conclusão do attach;
- logout deve limpar estado autenticado sem apagar indevidamente o carrinho permitido;
- rotas privadas devem tratar expiração sem loop de redirects.

### 13.2 BFF/proxy

O uso de Route Handlers do Next.js como BFF pode ser adotado para:

- manter cookies HTTP-only;
- centralizar headers e correlation IDs;
- reduzir exposição de detalhes do backend;
- aplicar política consistente de cache.

A decisão deve ser registrada antes do desenho final de autenticação.

---

## 14. Analytics e Sentry

### 14.1 Eventos frontend

| Evento | Momento | Dados permitidos |
|---|---|---|
| `product_viewed` | produto renderizado | referência pública, origem |
| `variant_selected` | variante selecionada | referências públicas |
| `add_to_cart` | resposta de adição confirmada | variante, quantidade, preço permitido |
| `checkout_started` | entrada no checkout | referência segura do carrinho e contagem |
| `shipping_selected` | frete confirmado pelo backend | método público e valor permitido |
| `payment_method_selected` | cartão/Pix selecionado | tipo |
| `payment_instructions_displayed` | Pix renderizado | sem QR/copia-e-cola/client secret |
| `payment_client_confirmed` | Stripe.js retornou sucesso client-side | sem tratar como receita |
| `checkout_failed` | erro de jornada | etapa e código sanitizado |
| `tracking_viewed` | tracking retornado | referência pública não reversível |

### 14.2 Evento proibido no frontend

A storefront **não deve emitir `purchase_completed`**.

O evento é registrado pelo backend em `AnalyticsEventLog` após `Order` confirmado. O frontend também não deve aguardar a entrega ao PostHog para renderizar confirmação.

### 14.3 Sentry

- remover tokens, cookies, headers de autorização e dados de pagamento;
- não anexar body completo de checkout;
- não capturar `client_secret`, QR, copia-e-cola ou token de tracking;
- registrar rota frontend, etapa, status HTTP e correlation ID sanitizado;
- separar ambientes local, preview e produção.

---

## 15. Segurança e privacidade

- HTTPS obrigatório fora do ambiente local;
- secrets Stripe, Medusa Admin e providers nunca entram no bundle;
- apenas Stripe publishable key e Medusa publishable key podem ser públicas;
- CSP deve autorizar somente origens necessárias;
- material Pix não deve entrar em histórico, cache persistente ou clipboard telemetry;
- token de tracking nunca deve aparecer em query enviada ao backend;
- dados pessoais devem ser minimizados;
- CPF/CNPJ completo não deve ser reexibido após envio;
- mensagens de tracking inválido devem ser indistinguíveis;
- erros não devem expor payloads de provider;
- consentimento de analytics deve seguir a política legal definida para o lançamento.

---

## 16. Acessibilidade, desempenho e SEO

### 16.1 Acessibilidade

- WCAG 2.2 AA como meta;
- navegação completa por teclado;
- foco visível e gerenciado em modais/erros;
- labels e mensagens associadas a inputs;
- contraste adequado;
- anúncios acessíveis para loading, erro e item adicionado;
- botão de copiar Pix com feedback textual;
- imagens com texto alternativo editorialmente adequado.

### 16.2 Desempenho

Metas de referência:

- LCP ≤ 2,5 s no percentil 75;
- INP ≤ 200 ms;
- CLS ≤ 0,1;
- imagens responsivas e lazy loading abaixo da dobra;
- catálogo e produto com cache/revalidação coerentes;
- carrinho, conta e checkout sem cache compartilhado;
- Stripe e analytics carregados apenas quando necessários.

### 16.3 SEO

- metadata por produto;
- canonical URL;
- sitemap e robots;
- Open Graph;
- JSON-LD de produto apenas com dados públicos e preço coerente;
- páginas de checkout, conta e tracking com `noindex`;
- estratégia de handle deve ser resolvida antes do roteamento final.

---

## 17. Estratégia de integração

### 17.1 Adapter Store API

O frontend deve centralizar:

- base URL;
- publishable key;
- autenticação;
- correlation ID;
- parsing de erros;
- timeout e cancelamento;
- schemas de resposta;
- política de cache;
- unidade monetária.

### 17.2 Geração de tipos

Preferência:

1. gerar tipos/client a partir de `store.openapi.json`; ou
2. manter tipos manuais validados contra o contrato em CI.

Não usar tipos genéricos do Medusa para respostas que o projeto reduz por serializers próprios.

### 17.3 Política de cache

| Recurso | Política inicial |
|---|---|
| catálogo/produto | cache público com revalidação |
| carrinho | `no-store`, escopo de sessão |
| autenticação/conta | `no-store` |
| pagamento | `no-store` |
| tracking | `no-store` |
| páginas legais | cache estático |

### 17.4 Compatibilidade

Mudança em rota ou schema consumido deve:

- atualizar OpenAPI;
- atualizar client/tipos;
- executar contract tests;
- avaliar breaking change;
- atualizar PRD/SRS quando alterar comportamento de produto.

---

## 18. Testes

### 18.1 Unitários

- formatação `brl-major` e `brl-minor`;
- seleção de variante;
- estados do catálogo;
- reducer/store do carrinho;
- attach outcomes;
- classificação de erros HTTP;
- contador de expiração Pix;
- limpeza de dados sensíveis;
- polling com backoff e timeout;
- garantia de ausência de `purchase_completed`.

### 18.2 Integração

- catálogo e detalhe contra fixtures OpenAPI;
- criação/reuso de carrinho;
- attach autenticado;
- cartão com Stripe mockado;
- Pix com resposta sintética segura;
- tracking `200`, `401` e `429`;
- publishable key obrigatória;
- correlation ID;
- falha PostHog/Sentry sem bloquear UI;
- ausência de secrets em storage e logs.

### 18.3 Contract tests

- validar respostas do adapter contra schemas OpenAPI;
- detectar drift de operationId, path, security e unidade monetária;
- impedir uso de rota inexistente no contrato aprovado;
- falhar CI quando o frontend esperar campo não documentado.

### 18.4 E2E

#### Catálogo e carrinho

```text
Catálogo
→ produto vendável
→ variante
→ carrinho ativo
→ mutação de item após contrato disponível
→ totais canônicos
```

#### Cartão

```text
Checkout completo
→ PaymentAttempt card
→ Stripe.js
→ processing_confirmation
→ contrato futuro confirma Order
→ página de confirmação
→ tracking
```

#### Pix

```text
Checkout completo
→ PaymentAttempt pix
→ QR/copia-e-cola
→ expiração ou pagamento
→ processing_confirmation
→ contrato futuro confirma Order
```

#### Login e attach

```text
Carrinho convidado
→ login
→ attach
→ attached_guest_cart ou preserve_customer_cart
→ checkout autenticado
```

---

## 19. Ordem recomendada de implementação

### Etapa 0 — Gate de contratos

- decidir arquitetura de autenticação;
- documentar rotas nativas necessárias;
- resolver mutações de carrinho;
- resolver checkout/frete;
- criar contrato de confirmação assíncrona;
- criar contratos de pedidos do cliente;
- definir handle/ID de produto;
- atualizar OpenAPI e gates.

### Etapa 1 — Fundação e catálogo

- Next.js, TypeScript, Tailwind;
- design system inicial;
- adapter Store API;
- configuração e observabilidade;
- home, catálogo e produto.

### Etapa 2 — Carrinho

- carrinho ativo;
- mutações contratadas;
- persistência de sessão;
- feedback e estados vazios.

### Etapa 3 — Autenticação

- cadastro/login/logout/reset;
- attach do carrinho;
- proteção de rotas.

### Etapa 4 — Checkout e pagamento

- endereço BR;
- frete;
- cartão;
- Pix condicionado à elegibilidade;
- estados de falha e expiração.

### Etapa 5 — Confirmação e pós-compra

- confirmação assíncrona;
- página de pedido;
- tracking;
- área do cliente.

### Etapa 6 — Conteúdo e qualidade

- legais e suporte;
- acessibilidade;
- SEO;
- performance;
- E2E e release.

Cada etapa permanece sujeita a gate humano e não inicia automaticamente.

---

## 20. Critérios de aceite

O frontend MVP será aceito quando:

- o milestone de frontend tiver sido explicitamente autorizado;
- todas as jornadas Must Have tiverem contratos backend aprovados;
- nenhuma rota for inventada fora do OpenAPI/decisão registrada;
- catálogo e produto renderizarem apenas dados públicos vendáveis;
- carrinho convidado e autenticado funcionarem;
- attach preservar corretamente o carrinho do cliente;
- checkout brasileiro e frete estiverem contratados e funcionais;
- cartão usar Stripe.js e não expuser dados sensíveis;
- Pix respeitar elegibilidade, expiração e proteção do payload;
- `Order` só for exibido após confirmação do backend;
- confirmação assíncrona sobreviver a refresh e timeout controlado;
- tracking enviar token somente no body;
- conta listar somente pedidos autorizados;
- dinheiro respeitar as unidades declaradas;
- `purchase_completed` não for emitido pelo frontend;
- PostHog e Sentry estiverem sanitizados;
- páginas legais estiverem publicadas;
- acessibilidade, performance e SEO passarem nos gates definidos;
- testes unitários, integração, contrato e E2E passarem;
- preview e produção tiverem configuração, CORS, cookies e domínios validados.

---

## 21. Questões abertas

| ID | Questão | Impacto |
|---|---|---|
| FE-Q-001 | Qual será o próximo milestone e quando o frontend será autorizado? | governança |
| FE-Q-002 | O frontend usará JWT, cookie de sessão ou BFF? | segurança, CORS, SSR |
| FE-Q-003 | Quais rotas nativas Medusa entrarão no Store OpenAPI? | integração |
| FE-Q-004 | Qual será o contrato de confirmação assíncrona? | pagamento e confirmação |
| FE-Q-005 | Como o frontend obterá resumo seguro do pedido confirmado? | pós-pagamento |
| FE-Q-006 | Produto será roteado por ID ou handle? | SEO e URLs |
| FE-Q-007 | Quais contratos serão usados para line items, checkout e frete? | carrinho/checkout |
| FE-Q-008 | Quais contratos atenderão histórico de pedidos e endereços? | conta |
| FE-Q-009 | Pix estará elegível no início do frontend? | escopo do pagamento |
| FE-Q-010 | Qual domínio final e estratégia de cookies/CORS? | deploy |
| FE-Q-011 | Haverá banner/gestão de consentimento de analytics? | LGPD |
| FE-Q-012 | Canal inicial de troca será apenas e-mail ou formulário? | suporte |
| FE-Q-013 | Qual conteúdo final das políticas legais? | go-live |

---

## 22. Referências

- `docs/PRD_Backend_v1.1.md` — comportamento backend as-built;
- `docs/SRS_v1.5.md` — requisitos consolidados do sistema;
- `docs/DB_MODEL_v1.21.md` — modelo de dados;
- `docs/openapi/README.md` — política dos contratos;
- `apps/backend/src/api-docs/generated/store.openapi.json`;
- `apps/backend/src/api-docs/operations/store/`;
- `apps/backend/src/api-docs/components/security-schemes.ts`;
- `.planning/PROJECT.md`;
- `.planning/STATE.md`;
- `ops/API_DOCS.md`.

---

*Última revisão: 2026-08-03 — PRD Frontend reconciliado com o backend v1.0, o SRS v1.5.1 e as dez operações atuais da Store OpenAPI. O documento registra explicitamente as lacunas contratuais que devem ser resolvidas antes da implementação integral da storefront.*