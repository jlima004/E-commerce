# PRD — Frontend Storefront E-commerce POD de Camisetas

| Campo | Valor |
|---|---|
| Documento | Product Requirements Document — Frontend |
| Projeto | E-commerce Headless Print-on-Demand de Camisetas |
| Versão | 1.1 |
| Base | SRS v1.5 · PRD Backend v1.1 · DB_MODEL v1.21 |
| Data | 2026-06-22 |
| Status | Revisado |
| Responsável | Jefferson |
| Stack | Next.js · TypeScript · Tailwind CSS · Vercel · Stripe client · PostHog · Sentry |
| Mercado Inicial | Brasil |
| Moeda Inicial | BRL |

> Nota da versão 1.1: esta revisão alinha a storefront ao fluxo atualizado de `purchase_completed` como evento de domínio registrado duravelmente pelo backend em outbox/AnalyticsEventLog. A storefront não emite, não confirma e não aguarda `purchase_completed`.

---

## Changelog

| Versão | Data | Alterações |
|---|---:|---|
| 1.1 | 2026-06-22 | Alinhado o PRD Frontend ao SRS v1.5, PRD Backend v1.1 e DB_MODEL v1.21. Formalizada a separação entre eventos frontend e `purchase_completed` backend/outbox; detalhado contrato de confirmação assíncrona; definidos valores monetários canônicos vindos do backend; definidos status operacionais/financeiros como read-only; e atualizados testes e critérios de aceite. |
| 1.0 | 2026-06-21 | Versão inicial do PRD Frontend baseada no SRS v1.9. |

---

## 1. Objetivo

Construir a storefront headless do e-commerce POD de camisetas, permitindo que clientes naveguem pelo catálogo, escolham variantes, realizem checkout por cartão ou Pix, acompanhem pedidos e consultem políticas da loja.

O frontend deve consumir o backend Medusa v2 por API, operar em Next.js com TypeScript e Tailwind CSS, ser publicado na Vercel e instrumentado com PostHog e Sentry.

---

## 2. Escopo do Frontend

### 2.1 Incluído

- Página inicial da loja.
- Listagem de produtos.
- Página de produto.
- Galeria de imagens.
- Seleção de variantes.
- Carrinho.
- Checkout como convidado.
- Checkout autenticado.
- Cálculo e seleção de frete via backend.
- Pagamento por cartão via Stripe.
- Pagamento por Pix via Stripe.
- Estado de confirmação assíncrona do pedido.
- Página de confirmação do pedido.
- Página de tracking.
- Área do cliente.
- Login, cadastro, logout e recuperação de senha.
- Histórico de pedidos do cliente.
- Páginas legais: Política de Privacidade, Termos de Compra e Política de Trocas.
- Canal de solicitação de troca por e-mail de suporte.
- Instrumentação PostHog.
- Captura de erros frontend via Sentry.
- Layout responsivo mobile-first.

### 2.2 Fora do Escopo do Frontend MVP

- Editor visual de camiseta.
- Upload de arte pelo cliente.
- Personalização dinâmica de produto.
- Reviews de produto.
- Chat de atendimento integrado.
- App mobile nativo.
- Programa de afiliados.
- A/B testing avançado.
- Fluxo automatizado de troca dentro da área do cliente.
- Multi-país.
- Multi-moeda.
- Métodos de pagamento além de cartão e Pix.

---

## 3. Personas e Usuários

| Perfil | Descrição | Necessidades no Frontend |
|---|---|---|
| Visitante | Usuário sem autenticação. | Navegar, visualizar produto, adicionar ao carrinho. |
| Cliente Convidado | Cliente que compra sem criar conta. | Checkout, pagamento, confirmação e tracking por link/token. |
| Cliente Registrado | Cliente com conta. | Login, checkout associado à conta, histórico de pedidos e tracking. |
| Administrador | Operador da loja. | Não usa a storefront como interface primária; usa Admin Medusa/backend. |
| Sistema | Integrações e serviços internos. | Recebe eventos e dados instrumentados pela storefront. |

---

## 4. Experiência do Usuário

### 4.1 Jornada Principal — Cartão

```text
Cliente acessa storefront
→ Navega pelo catálogo
→ Abre página de produto
→ Seleciona tamanho/cor/quantidade
→ Adiciona ao carrinho
→ Inicia checkout
→ Informa e-mail e endereço no Brasil
→ Seleciona frete
→ Seleciona cartão
→ Confirma pagamento pela interface Stripe
→ Storefront pode registrar payment_client_confirmed
→ Storefront exibe “confirmando pagamento e pedido”
→ Backend confirma Order após webhook Stripe
→ Storefront exibe página de confirmação
→ Cliente recebe e-mail de confirmação
→ Cliente acompanha tracking
```

### 4.2 Jornada Principal — Pix

```text
Cliente acessa storefront
→ Adiciona produto ao carrinho
→ Inicia checkout
→ Informa e-mail e endereço no Brasil
→ Seleciona frete
→ Seleciona Pix
→ Storefront exibe QR Code, copia-e-cola e instruções
→ Storefront registra payment_instructions_displayed
→ Cliente realiza pagamento
→ Storefront exibe “confirmando pagamento e pedido” quando aplicável
→ Backend confirma Order após webhook Stripe
→ Storefront exibe página de confirmação
→ Cliente recebe e-mail de confirmação
→ Cliente acompanha tracking
```

### 4.3 Confirmação Assíncrona

Após retorno do Stripe, a storefront **não deve assumir que o Order já existe**.

A página de retorno deve:

1. Exibir estado de “confirmando pagamento e pedido”.
2. Consultar o backend por referência segura de checkout, como `cart_id`, `payment_intent_id` ou token equivalente.
3. Exibir página de confirmação quando o Order estiver disponível.
4. Em caso de timeout controlado, exibir mensagem neutra:
   - informar que a confirmação está em processamento;
   - orientar o cliente a acompanhar o e-mail;
   - não expor erro técnico;
   - não mostrar dados de pedido inexistente.

---

## 5. Requisitos Funcionais — Frontend

### 5.1 Storefront Pública

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-SF-001 | Exibir página inicial da loja. | Must Have | Página carrega sem erro e apresenta navegação para catálogo/produtos. |
| FE-SF-002 | Exibir listagem de produtos. | Must Have | Cada produto exibe imagem, nome, preço em BRL e indicação de variantes. |
| FE-SF-003 | Exibir apenas produtos publicados. | Must Have | Produto despublicado no backend não aparece na storefront. |
| FE-SF-004 | Exibir página de detalhe do produto. | Must Have | Página contém galeria, descrição, preço em BRL, variantes e CTA de carrinho. |
| FE-SF-005 | Permitir seleção de variantes. | Must Have | Cliente só consegue adicionar combinação válida de tamanho/cor. |
| FE-SF-006 | Exibir variante indisponível. | Must Have | Variante sem metadados Gelato, despublicada ou inválida aparece desabilitada. |
| FE-SF-007 | Ser responsiva. | Must Have | Catálogo, produto, carrinho e checkout funcionam em mobile e desktop. |
| FE-SF-008 | Suportar páginas de coleção/categoria. | Should Have | Produtos podem ser filtrados por coleção/categoria. |
| FE-SF-009 | Suportar busca textual. | Could Have | Busca retorna produtos por nome ou termo relevante. |
| FE-SF-010 | Exibir páginas legais. | Must Have | Política de Privacidade, Termos de Compra e Política de Trocas ficam acessíveis no rodapé e no checkout. |

---

### 5.2 Carrinho

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-CA-001 | Criar carrinho para visitante. | Must Have | Ao adicionar primeiro item, frontend recebe/persiste identificador de cart do backend. |
| FE-CA-002 | Persistir carrinho durante a sessão. | Must Have | Recarregar a página não perde carrinho ativo. |
| FE-CA-003 | Adicionar item ao carrinho. | Must Have | Item selecionado aparece com variante e quantidade corretas. |
| FE-CA-004 | Alterar quantidade. | Must Have | Totais são recalculados após atualização. |
| FE-CA-005 | Remover item. | Must Have | Item removido desaparece do resumo. |
| FE-CA-006 | Exibir subtotal em BRL. | Must Have | Subtotal deve refletir o valor canônico retornado pelo backend e ser formatado em BRL. |
| FE-CA-007 | Exibir carrinho lateral ou página equivalente. | Must Have | Cliente consegue revisar itens antes do checkout. |
| FE-CA-008 | Suportar cupom de desconto. | Should Have | Cupom válido altera total; cupom inválido exibe erro. |

#### Regra de valores monetários

A storefront deve tratar valores monetários recebidos do backend como canônicos.

Quando o backend retornar valores na menor unidade monetária, o frontend deve apenas formatar para BRL. Totais críticos de carrinho, frete, descontos, pagamento e pedido devem vir do backend.

O frontend não deve recalcular total financeiro final usando ponto flutuante. Cálculos visuais locais só podem ser usados como feedback temporário e devem ser substituídos pelo total retornado pelo backend.

---

### 5.3 Checkout

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-CH-001 | Permitir checkout como convidado. | Must Have | Cliente consegue comprar sem criar conta. |
| FE-CH-002 | Permitir checkout autenticado. | Must Have | Cliente logado conclui compra com pedido associado à conta após confirmação do pagamento. |
| FE-CH-003 | Coletar e-mail. | Must Have | E-mail válido é obrigatório para confirmação e tracking. |
| FE-CH-004 | Coletar endereço completo no Brasil. | Must Have | Nome, endereço, cidade, estado, CEP, telefone e país são obrigatórios. |
| FE-CH-005 | Rejeitar endereço fora do Brasil. | Must Have | País diferente de `BR` não permite avançar. |
| FE-CH-006 | Validar campos obrigatórios. | Must Have | Campos inválidos exibem mensagem inline. |
| FE-CH-007 | Solicitar cálculo de frete antes do pagamento. | Must Have | Cliente vê pelo menos uma opção de envio quando disponível. |
| FE-CH-008 | Exibir prazo estimado quando disponível. | Must Have | Cada frete exibe prazo ou intervalo estimado. |
| FE-CH-009 | Exibir resumo completo antes do pagamento. | Must Have | Resumo deve conter itens, frete, descontos e total em BRL com valores canônicos vindos do backend. |
| FE-CH-010 | Impedir checkout com carrinho vazio. | Must Have | Usuário é redirecionado ao catálogo ou carrinho. |
| FE-CH-011 | Tratar falha no cálculo de frete. | Must Have | Exibe mensagem e permite nova tentativa. |
| FE-CH-012 | Solicitar aceite dos Termos e Política de Privacidade. | Must Have | Cliente deve aceitar antes de concluir pagamento. |
| FE-CH-013 | Exibir resumo da Política de Trocas. | Should Have | Cliente acessa política completa antes de pagar. |
| FE-CH-014 | Exibir estado assíncrono de confirmação. | Must Have | Após retorno Stripe, a storefront exibe “confirmando pagamento e pedido”, consome o estado normalizado do backend e só exibe confirmação quando receber `order_confirmed`. |

---

### 5.4 Pagamentos no Frontend

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-PG-001 | Integrar Stripe client-side. | Must Have | Stripe é usado para cartão e Pix sem expor dados sensíveis à loja. |
| FE-PG-002 | Permitir pagamento por cartão. | Must Have | Cliente paga usando interface segura do Stripe. |
| FE-PG-003 | Permitir pagamento por Pix. | Must Have | Cliente gera Pix, visualiza QR Code, copia-e-cola e instruções. |
| FE-PG-004 | Não processar dados de cartão diretamente. | Must Have | Dados de cartão não passam por componentes próprios da loja. |
| FE-PG-005 | Registrar `payment_client_confirmed` quando aplicável. | Could Have | Evento não é usado como receita nem fonte financeira. |
| FE-PG-006 | Registrar `payment_instructions_displayed` para Pix. | Must Have | Evento é disparado quando QR/código/instruções são exibidos. |
| FE-PG-007 | Tratar Pix pendente/expirado/falho no cliente. | Must Have | Cliente vê estado claro e pode tentar novamente sem Order criado. |
| FE-PG-008 | Não exibir pedido inexistente. | Must Have | Frontend só mostra número/resumo de pedido quando backend confirmar Order. |

---

### 5.5 Confirmação e Tracking

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-OR-001 | Exibir página de confirmação. | Must Have | Após Order confirmado pelo backend, cliente vê número do pedido, resumo e status normalizados retornados pela API. |
| FE-OR-002 | Exibir página de tracking para convidado. | Must Have | Acesso por link com token seguro. |
| FE-OR-003 | Exibir tracking para cliente autenticado. | Must Have | Cliente vê pedidos próprios na área do cliente sem token. |
| FE-OR-004 | Tratar token inválido/expirado. | Must Have | Exibe erro genérico sem expor dados do pedido. |
| FE-OR-005 | Não enviar `order_id` interno ao PostHog. | Must Have | Tracking usa `tracking_ref` ou identificador público/anônimo não reversível. |

#### Regra de status read-only

A storefront deve renderizar `order_status`, `payment_status` e `fulfillment_status` como estados read-only retornados pelo backend.

O frontend não deve inferir nem alterar:

- cancelamento;
- reembolso;
- pagamento capturado;
- envio;
- entrega;
- conclusão operacional;
- estado `requires_attention`.

Eventos client-side, retorno do Stripe no navegador ou eventos PostHog não são fonte de verdade para status de pedido, pagamento ou fulfillment.

---

### 5.6 Conta do Cliente

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-AC-001 | Permitir criação de conta. | Must Have | Cliente cria conta com e-mail e senha. |
| FE-AC-002 | Permitir login. | Must Have | Cliente autentica com credenciais válidas. |
| FE-AC-003 | Permitir logout. | Must Have | Sessão é encerrada corretamente. |
| FE-AC-004 | Permitir recuperação de senha. | Must Have | Cliente recebe link de redefinição. |
| FE-AC-005 | Exibir histórico de pedidos. | Must Have | Cliente vê pedidos com `order_status`, `payment_status`, fulfillment e tracking retornados pelo backend. |
| FE-AC-006 | Permitir salvar e reutilizar endereços. | Must Have | Cliente usa endereço salvo no checkout. |
| FE-AC-007 | Manter guest checkout disponível. | Must Have | Cliente pode comprar sem criar conta. |
| FE-AC-008 | Visualizar solicitações de troca na área do cliente. | Should Have | Cliente consulta status de troca quando funcionalidade estiver disponível. |

---

### 5.7 Trocas no Frontend

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-RT-001 | Expor Política de Trocas. | Must Have | Cliente acessa política antes e depois da compra. |
| FE-RT-002 | Disponibilizar canal de solicitação de troca. | Must Have | MVP usa e-mail de suporte como canal canônico. |
| FE-RT-003 | Permitir formulário/página de contato opcional. | Could Have | Formulário pode coletar número do pedido, motivo e contato. |
| FE-RT-004 | Não criar troca automaticamente no MVP. | Must Have | Solicitação do cliente não cria registro formal; admin registra no backend. |

---

### 5.8 Analytics e Monitoramento Frontend

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| FE-AN-001 | Integrar PostHog na storefront. | Must Have | Eventos mínimos são capturados sem dados sensíveis desnecessários. |
| FE-AN-002 | Registrar `product_viewed`. | Should Have | Payload contém produto, variante quando aplicável e origem. |
| FE-AN-003 | Registrar `variant_selected`. | Should Have | Payload contém produto e variante. |
| FE-AN-004 | Registrar `add_to_cart`. | Should Have | Payload contém produto, variante, quantidade e preço. |
| FE-AN-005 | Registrar `checkout_started`. | Should Have | Payload contém cart e quantidade de itens. |
| FE-AN-006 | Registrar `shipping_selected`. | Should Have | Payload contém método e valor do frete. |
| FE-AN-007 | Registrar `payment_method_selected`. | Should Have | Payload contém cart e tipo de pagamento. |
| FE-AN-008 | Registrar `payment_instructions_displayed`. | Must Have | Pix: registrado quando instruções são exibidas. |
| FE-AN-009 | Registrar `payment_client_confirmed` quando necessário. | Could Have | Cartão: evento opcional, não usado como receita. |
| FE-AN-010 | Registrar `checkout_failed`. | Should Have | Payload contém cart, etapa e erro. |
| FE-AN-011 | Registrar `tracking_viewed`. | Should Have | Payload usa `tracking_ref`; não usa `order_id` interno. |
| FE-AN-012 | Integrar Sentry no frontend. | Must Have | Exceções frontend são reportadas por ambiente. |
| FE-AN-013 | Não emitir `purchase_completed` na storefront. | Must Have | O evento deve ser registrado pelo backend em outbox/AnalyticsEventLog. A storefront não deve disparar, simular ou aguardar `purchase_completed`. |

---

## 6. Eventos PostHog sob Responsabilidade do Frontend

| Evento | Origem | Quando | Observação |
|---|---|---|---|
| `product_viewed` | Storefront | Visualização de produto. | Não incluir dados pessoais. |
| `variant_selected` | Storefront | Seleção de variante. | Produto e variante. |
| `add_to_cart` | Storefront | Item adicionado ao carrinho. | Produto, variante, quantidade e preço. |
| `checkout_started` | Storefront | Início de checkout. | Cart e quantidade de itens. |
| `shipping_selected` | Storefront | Seleção de frete. | Método e valor. |
| `payment_method_selected` | Storefront | Seleção de cartão ou Pix. | Tipo do método. |
| `payment_instructions_displayed` | Storefront | Pix exibido. | Não é receita. |
| `payment_client_confirmed` | Storefront | Confirmação client-side de cartão, se aplicável. | Opcional; não é receita. |
| `checkout_failed` | Storefront | Erro relevante no checkout. | Etapa e código/motivo. |
| `tracking_viewed` | Storefront | Página de tracking acessada. | Usar `tracking_ref`; não usar `order_id` interno. |

O evento `purchase_completed` **não é responsabilidade da storefront**.

Ele deve ser registrado duravelmente pelo backend em outbox/AnalyticsEventLog após Order confirmado. A entrega ao PostHog é assíncrona, reprocessável e não deve bloquear:

- confirmação visual do pedido;
- exibição da página de confirmação;
- envio à Gelato;
- tracking;
- qualquer fluxo da storefront.

A storefront não deve emitir `purchase_completed`, não deve simular esse evento e não deve depender do sucesso do PostHog para exibir estados de pedido.

---

## 7. Requisitos Não Funcionais — Frontend

| ID | Requisito | Critério |
|---|---|---|
| FE-NFR-PERF-001 | Storefront deve carregar rapidamente em mobile. | Páginas principais devem buscar LCP abaixo de 2,5s em condições normais. |
| FE-NFR-PERF-002 | APIs críticas devem ser usadas com baixa latência percebida. | UI deve usar loading, skeleton ou feedback em operações assíncronas. |
| FE-NFR-PERF-003 | Imagens devem ser otimizadas. | Usar otimização, lazy loading e tamanhos responsivos. |
| FE-NFR-UX-001 | Storefront deve ser mobile-first. | Fluxos principais funcionam em 375px de largura. |
| FE-NFR-UX-002 | Checkout deve minimizar etapas. | Guest checkout é caminho claro. |
| FE-NFR-UX-003 | Erros devem ser claros. | Cliente entende o que corrigir. |
| FE-NFR-UX-004 | Componentes devem ter acessibilidade básica. | Labels, foco, contraste e navegação por teclado tratados. |
| FE-NFR-UX-005 | Estados de loading devem ser explícitos. | Operações assíncronas exibem feedback. |
| FE-NFR-UX-006 | Pix deve ter instruções claras. | Cliente entende como pagar e que pedido só processa após confirmação. |
| FE-NFR-SEC-001 | Frontend deve usar HTTPS em produção. | Vercel/domínio com TLS válido. |
| FE-NFR-SEC-002 | Variáveis públicas e privadas devem ser separadas. | Apenas `NEXT_PUBLIC_*` seguro no frontend. |
| FE-NFR-LGPD-001 | Analytics deve respeitar privacidade. | Não capturar dados sensíveis desnecessários. |
| FE-NFR-LGPD-002 | Sentry não deve capturar dados sensíveis indevidos. | Scrubbing configurado para tokens, headers e payloads sensíveis. |

---

## 8. Dependências do Backend

O frontend depende do backend para:

- APIs de catálogo.
- APIs de produto e variantes.
- APIs de carrinho.
- APIs de checkout.
- Cálculo de frete.
- Criação de Payment Collection/Payment Session.
- Criação/integração Stripe.
- Consulta de estado de confirmação assíncrona com estados normalizados:
  - `confirming`
  - `order_confirmed`
  - `payment_failed`
  - `payment_expired`
  - `payment_canceled`
  - `timeout_processing`
- Dados do Order confirmado.
- Página de tracking por token.
- Área do cliente e histórico de pedidos.
- URLs de imagens no Supabase Storage.
- Status de pedido/fulfillment.
- Políticas e dados de configuração quando dinâmicos.

### 8.1 Contrato mínimo de confirmação assíncrona

A storefront deve consultar o backend após retorno do Stripe usando referência segura de checkout, como `cart_id`, `payment_intent_id` ou token equivalente.

O backend deve retornar um dos estados normalizados:

| Estado | Comportamento da Storefront |
|---|---|
| `confirming` | Exibir “confirmando pagamento e pedido” e continuar polling controlado. |
| `order_confirmed` | Exibir página de confirmação com dados do pedido retornados pelo backend. |
| `payment_failed` | Exibir erro de pagamento e permitir nova tentativa quando aplicável. |
| `payment_expired` | Exibir expiração do pagamento e permitir nova tentativa. |
| `payment_canceled` | Exibir cancelamento e permitir retorno ao checkout quando aplicável. |
| `timeout_processing` | Exibir mensagem neutra informando que a confirmação está em processamento e orientar acompanhamento por e-mail. |

A storefront não deve buscar nem renderizar dados de pedido enquanto o estado não for `order_confirmed`.

---

## 9. Variáveis de Ambiente — Frontend

```env
NEXT_PUBLIC_MEDUSA_BACKEND_URL=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STORE_URL=
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
```

---

## 10. Testes — Frontend

### 10.1 Testes Unitários

Devem cobrir:

- Componentes de produto.
- Seleção de variante.
- Estados de variante indisponível.
- Carrinho.
- Validação de endereço.
- Rejeição de país diferente de `BR`.
- Estados de Pix.
- Estado “confirmando pagamento e pedido”.
- Token inválido/expirado de tracking.
- Eventos PostHog.
- Formatação de moeda BRL.
- Formatação de valores monetários vindos do backend na menor unidade monetária.
- Renderização de `order_status`, `payment_status` e `fulfillment_status` como estados read-only.
- Garantia de que `purchase_completed` não é disparado por componentes/hooks da storefront.
- Estados de erro/loading.

### 10.2 Testes de Integração

Devem cobrir:

- Catálogo consumindo backend.
- Produto com variantes.
- Carrinho persistente.
- Checkout convidado.
- Checkout autenticado.
- Cálculo de frete.
- Criação de pagamento cartão.
- Criação de Pix e exibição de instruções.
- Retorno Stripe sem Order disponível.
- Confirmação quando Order passa a existir.
- Confirmação assíncrona consumindo estados normalizados do backend.
- Falha ou indisponibilidade do PostHog no browser sem bloquear página de confirmação.
- Página de confirmação baseada apenas em `order_confirmed` retornado pelo backend.
- Resumo de checkout usando totais canônicos retornados pelo backend.
- Página de tracking.
- Login/cadastro/logout/recuperação de senha.
- Sentry e PostHog.

### 10.3 Testes E2E

Fluxo cartão:

```text
Produto publicado
→ Cliente adiciona ao carrinho
→ Checkout convidado
→ Endereço Brasil
→ Frete selecionado
→ Pagamento cartão
→ Estado “confirmando pagamento e pedido” se necessário
→ Backend retorna `order_confirmed`
→ Página de confirmação renderiza dados e status vindos do backend
→ Storefront não emite `purchase_completed`
→ Tracking
```

Fluxo Pix:

```text
Produto publicado
→ Cliente adiciona ao carrinho
→ Checkout convidado
→ Endereço Brasil
→ Frete selecionado
→ Pix gerado
→ payment_instructions_displayed registrado
→ Pagamento confirmado
→ Backend retorna `order_confirmed`
→ Página de confirmação renderiza dados e status vindos do backend
→ Storefront não emite `purchase_completed`
→ Tracking
```

---

## 11. Critérios de Aceite do PRD Frontend

O frontend será considerado pronto quando:

- Storefront estiver publicada em Vercel.
- Catálogo e página de produto funcionarem em mobile e desktop.
- Imagens carregarem a partir de URLs fornecidas pelo backend/Supabase Storage.
- Carrinho funcionar e persistir durante a sessão.
- Checkout convidado funcionar.
- Checkout autenticado funcionar.
- Endereços fora do Brasil forem rejeitados.
- Frete for exibido antes do pagamento.
- Cartão funcionar em produção.
- Pix funcionar em produção.
- Storefront exibir estado “confirmando pagamento e pedido”.
- Endpoint de confirmação assíncrona for consumido por estados normalizados.
- Página de confirmação não buscar Order inexistente.
- Storefront não depender do PostHog para exibir confirmação de pedido.
- Valores financeiros críticos forem exibidos a partir dos totais canônicos retornados pelo backend.
- Status de pedido, pagamento e fulfillment forem renderizados como read-only vindos do backend.
- Página de tracking funcionar por token para convidado.
- Área do cliente exibir histórico e tracking.
- Eventos PostHog frontend forem emitidos corretamente.
- `purchase_completed` não for emitido pelo frontend.
- `order_id` interno não for enviado ao PostHog no frontend.
- Sentry capturar erros frontend.
- Páginas legais estiverem publicadas.
- Canal de troca por e-mail de suporte estiver visível.
- Fluxos principais passarem em smoke test de produção.

---

## 12. Questões Abertas Relacionadas ao Frontend

| ID | Questão | Impacto | Prazo |
|---|---|---|---|
| FE-Q-001 | URL final da storefront será `www.<dominio>.com.br` ou apex `<dominio>.com.br`? | SEO, Vercel, CORS, cookies. | Antes de staging. |
| FE-Q-002 | Conteúdo final da Política de Trocas. | Checkout, rodapé, suporte. | Antes de go-live. |
| FE-Q-003 | Canal LGPD publicado ao cliente. | Política de Privacidade. | Antes de go-live. |
| FE-Q-004 | Haverá formulário de contato/troca no MVP ou apenas e-mail? | UX de troca. | Antes de implementação da página de trocas. |

---