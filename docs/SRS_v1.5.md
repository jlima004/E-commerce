# SRS — E-commerce Headless Print-on-Demand de Camisetas

| Campo | Valor |
|-------|-------|
| Versão | 1.5 |
| Data | 2026-06-21 |
| Status | Revisado |

> **Nota da versão 1.5:** esta revisão corrige o acoplamento entre analytics e fulfillment. `purchase_completed` passa a ser tratado como evento de domínio registrado de forma durável no backend/outbox local antes do fulfillment Gelato. A entrega ao PostHog é assíncrona e falhas temporárias do PostHog não bloqueiam produção de pedido pago.

## Sumário

1. [Introdução](#1-introdução)
2. [Visão Geral do Produto](#2-visão-geral-do-produto)
3. [Arquitetura do Sistema](#3-arquitetura-do-sistema)
4. [Fluxos de Negócio](#4-fluxos-de-negócio)
5. [Requisitos Funcionais](#5-requisitos-funcionais)
6. [Requisitos Não Funcionais](#6-requisitos-não-funcionais)
7. [Interfaces Externas](#7-interfaces-externas)
8. [Estados do Sistema](#8-estados-do-sistema)
9. [Regras de Negócio](#9-regras-de-negócio)
10. [Webhooks e Idempotência](#10-webhooks-e-idempotência)
11. [Observabilidade](#11-observabilidade)
12. [Testes](#12-testes)
13. [Deploy e Operação](#13-deploy-e-operação)
14. [Critérios de Aceite do MVP](#14-critérios-de-aceite-do-mvp)
15. [Fora do Escopo do MVP](#15-fora-do-escopo-do-mvp)
16. [Riscos Técnicos](#16-riscos-técnicos)
17. [Questões em Aberto](#17-questões-em-aberto)
18. [Apêndices](#18-apêndices)

----------

## 1. Introdução

### 1.1 Propósito

Este documento especifica os requisitos de software para o desenvolvimento de um e-commerce headless de camisetas customizadas operando no modelo Print-on-Demand.

O objetivo do SRS é servir como fonte canônica para:

-   Arquitetura técnica.
    
-   Requisitos funcionais.
    
-   Requisitos não funcionais.
    
-   Integrações externas.
    
-   Critérios de aceite.
    
-   Riscos, restrições e pontos em aberto.
    

Este documento deve orientar a implementação do sistema e reduzir ambiguidade entre produto, engenharia e operação.

----------

### 1.2 Escopo do Sistema

O sistema será composto por:

-   **Storefront headless** para clientes finais.
    
-   **Backend de e-commerce** baseado em Medusa v2.
    
-   **Banco PostgreSQL gerenciado** via Supabase.
    
-   **Supabase Storage** para imagens e assets de produto.
    
-   **Redis** para filas, cache, event bus e workflows.
    
-   **Stripe** para pagamentos por cartão e Pix.
    
-   **Resend** para envio de e-mails transacionais e alertas operacionais.
    
-   **Gelato API** para produção e entrega automática dos pedidos.
    
-   **Correios** para processo operacional de logística reversa em trocas.
    
-   **Sentry** para monitoramento de erros.
    
-   **PostHog** para analytics de produto.
    
-   **Admin Dashboard** para operação da loja.
    

O sistema não manterá estoque físico, não realizará produção própria e não será responsável pela logística direta inicial de entrega, que será executada pela Gelato.

----------

### 1.3 Objetivo do Produto

Criar uma operação de vendas 100% automatizada para camisetas customizadas no Brasil, permitindo que o operador venda produtos físicos sem:

-   Capital imobilizado em estoque.
    
-   Espaço físico para armazenagem.
    
-   Gestão manual de produção.
    
-   Dependência de plataformas fechadas.
    
-   Pagamento de taxas de marketplace ou SaaS fechado sobre cada venda.
    

Após a confirmação do pagamento, criação/confirmação do pedido e registro durável local de `purchase_completed`, o pedido deverá ser encaminhado automaticamente para a Gelato. A entrega do evento ao PostHog deve ocorrer de forma assíncrona e não deve bloquear a produção de pedido pago.

----------

## 2. Visão Geral do Produto

### 2.1 Perspectiva do Produto

O produto é uma loja online independente de camisetas customizadas para o mercado brasileiro. O cliente acessa a storefront, escolhe uma camiseta, seleciona variantes como tamanho e cor, realiza o checkout e paga por cartão ou Pix.

Depois que o pagamento é confirmado, o backend confirma/cria o pedido, registra duravelmente `purchase_completed` como evento de domínio em outbox local, enfileira a entrega desse evento ao PostHog e cria automaticamente um pedido de produção na Gelato usando templates fixos previamente configurados. A Gelato fabrica a camiseta e envia diretamente para o cliente final. O sistema acompanha o status do pedido por webhooks e envia notificações por e-mail. Falhas temporárias de entrega ao PostHog não devem bloquear o fulfillment Gelato.

Quando houver troca, o processo será operacionalizado via logística reversa dos Correios conforme a política definida.

----------

### 2.2 Principais Funções do Sistema

O sistema deverá permitir:

-   Exibição de catálogo de camisetas.
    
-   Visualização de detalhes de produto.
    
-   Seleção de variantes.
    
-   Carrinho de compras.
    
-   Checkout como convidado.
    
-   Checkout para clientes autenticados.
    
-   Cálculo de frete.
    
-   Pagamento por cartão via Stripe.
    
-   Pagamento por Pix via Stripe.
    
-   Criação automática de pedido no Medusa.
    
-   Registro durável local de `purchase_completed` como evento de domínio/outbox.
    
-   Criação automática de pedido de produção na Gelato após pedido confirmado e registro durável de `purchase_completed`.
    
-   Sincronização de status de produção e envio.
    
-   Registro de código de rastreio.
    
-   Envio de e-mails transacionais.
    
-   Administração de produtos, pedidos e clientes.
    
-   Cancelamento de pedidos quando tecnicamente possível.
    
-   Gestão operacional de trocas com logística reversa dos Correios (RT-009, RT-001).
    
-   Monitoramento de erros via Sentry.
    
-   Analytics de comportamento e conversão via PostHog.
    
-   Alertas operacionais críticos por e-mail.
    
----------

### 2.3 Perfis de Usuário

<table>
  <thead>
    <tr>
      <th>Perfil</th>
      <th>Descrição</th>
      <th>Ações Principais</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Visitante</strong></td>
      <td>Usuário que acessa a loja sem estar autenticado.</td>
      <td>Navegar, visualizar produtos, adicionar ao carrinho.</td>
    </tr>
    <tr>
      <td><strong>Cliente Convidado</strong></td>
      <td>Usuário que compra sem criar conta.</td>
      <td>Checkout, pagamento, acompanhamento por link/token.</td>
    </tr>
    <tr>
      <td><strong>Cliente Registrado</strong></td>
      <td>Usuário com conta na loja.</td>
      <td>Login, compra, histórico de pedidos com tracking, endereços.</td>
    </tr>
    <tr>
      <td><strong>Administrador</strong></td>
      <td>Operador da loja.</td>
      <td>Gerenciar produtos, variantes, pedidos, clientes, regiões, trocas e configurações.</td>
    </tr>
    <tr>
      <td><strong>Sistema</strong></td>
      <td>Serviços internos e integrações automatizadas.</td>
      <td>Processar webhooks, criar fulfillment, enviar e-mails, registrar logs, emitir alertas.</td>
    </tr>
  </tbody>
</table>

----------

### 2.4 Premissas

-   A loja venderá inicialmente camisetas.
    
-   O mercado inicial será exclusivamente o Brasil.
    
-   A moeda inicial será exclusivamente BRL.
    
-   O modelo operacional será exclusivamente Print-on-Demand.
    
-   A Gelato será o fornecedor inicial de POD.
    
-   Os produtos serão baseados em templates fixos configurados na Gelato.
    
-   O operador não terá estoque próprio.
    
-   A storefront será desenvolvida em Next.js, TypeScript e Tailwind CSS.
    
-   O backend será desenvolvido em Medusa v2.
    
-   O backend será hospedado em VPS Linux.
    
-   O banco PostgreSQL será gerenciado pelo Supabase.
    
-   As imagens serão armazenadas em bucket no Supabase Storage.
    
-   Redis será obrigatório no backend.
    
-   Stripe será o provedor inicial para cartão e Pix.
    
-   Resend será o provedor inicial de e-mail transacional e alerta operacional.
    
-   A integração com a Gelato exigirá desenvolvimento customizado.
    
-   Sentry será usado para monitoramento de erros.
    
-   PostHog será usado para analytics.
    
-   Regras de frete de troca conforme §9 (**BR-019**, **BR-020**).
    
----------

### 2.5 Restrições

-   O sistema não deve depender de Shopify, WooCommerce, Hotmart ou plataformas fechadas equivalentes.
    
-   O backend deve expor APIs consumidas pela storefront.
    
-   O frontend e o backend devem ser deployados separadamente.
    
-   O Admin deve ficar em subdomínio próprio.
    
-   O domínio final será definido futuramente.
    
-   Os subdomínios devem seguir o padrão `<prefixo>.<dominio>.com.br`.
    
-   Secrets não devem ser versionados no repositório.
    
-   O fluxo de pagamento deve delegar dados sensíveis de pagamento ao Stripe.
    
-   A criação de pedido na Gelato só deve ocorrer após confirmação confiável do pagamento.
    
-   O sistema deve impedir fulfillment quando os metadados Gelato da variante estiverem ausentes ou inválidos.
    
-   O admin deve ser protegido por autenticação forte.
    
-   A implementação deve priorizar TypeScript em todo o codebase.
    
-   O sistema deve ser projetado inicialmente para Brasil e BRL, sem obrigatoriedade de multi-país no MVP.
    
----------

## 3. Arquitetura do Sistema

### 3.1 Visão Arquitetural

```text
Cliente
  │
  ├──────────────────────────────┐
  ▼                              ▼
Storefront Next.js (Vercel)   Admin Dashboard (subdomínio próprio)
  │                              │
  │ Medusa Store API             │ Medusa Admin API
  ▼                              ▼
Backend Medusa v2 na VPS (api.<dominio>.com.br)
  │
  ├── Worker (filas e workflows assíncronos)
  ├── PostgreSQL via Supabase
  ├── Supabase Storage
  ├── Redis
  ├── Stripe
  ├── Resend
  ├── Gelato API
  ├── Sentry
  ├── PostHog
  └── Correios Logística Reversa

```

----------

### 3.2 Convenção de Domínios

O domínio final ainda será definido.

Quando definido, os subdomínios deverão seguir a convenção:

```text
<prefixo>.<dominio>.com.br

```

Prefixos sugeridos (definição final em **Q-001** — domínio e URL da storefront —, **Q-002** — admin — e **Q-003** — api):

| Componente | Prefixo sugerido | Exemplo |
|------------|------------------|---------|
| Storefront | `www` ou apex (`dominio.com.br`) | `www.loja.com.br` |
| API / Backend | `api` | `api.loja.com.br` |
| Admin | `admin` | `admin.loja.com.br` |

----------

### 3.3 Componentes Principais

#### 3.3.1 Storefront

Responsável por:

-   Renderizar catálogo.
    
-   Renderizar página de produto.
    
-   Gerenciar carrinho.
    
-   Executar fluxo de checkout.
    
-   Integrar Stripe para cartão e Pix.
    
-   Exibir confirmação de pedido.
    
-   Exibir tracking do pedido.
    
-   Permitir login e área do cliente.
    
-   Capturar eventos de produto e funil para o PostHog.
    
-   Reportar erros de frontend para o Sentry.
    

----------

#### 3.3.2 Backend Medusa

Responsável por:

-   Gerenciar produtos e variantes.
    
-   Gerenciar imagens por integração com Supabase Storage.
    
-   Gerenciar carrinhos.
    
-   Gerenciar clientes.
    
-   Gerenciar pedidos.
    
-   Gerenciar regiões, moedas e métodos de pagamento.
    
-   Integrar com Stripe.
    
-   Integrar com Resend.
    
-   Executar workflows.
    
-   Executar fulfillment via Gelato.
    
-   Expor Admin Dashboard em subdomínio próprio.
    
-   Processar webhooks externos.
    
-   Registrar erros no Sentry.
    
-   Registrar eventos relevantes para analytics e auditoria em camada durável local.
    
-   Enfileirar entrega assíncrona de eventos ao PostHog, sem bloquear fulfillment por falha temporária do provedor.
    
-   Gerenciar registros operacionais de troca.
    

Estados de pedido, pagamento e fulfillment customizados (§8) exigem extensão via workflows/módulos no Medusa v2 — não são nativos do core.

----------

#### 3.3.3 Gelato Fulfillment Module

Módulo customizado responsável por:

-   Mapear produtos e variantes Medusa para templates fixos Gelato.
    
-   Validar metadados obrigatórios antes da venda e antes do fulfillment.
    
-   Montar payload de criação de pedido.
    
-   Criar pedido na Gelato.
    
-   Consultar cotação de frete.
    
-   Cancelar pedido na Gelato quando possível.
    
-   Receber e processar webhooks de status.
    
-   Atualizar fulfillment no Medusa.
    
-   Registrar tracking.
    
-   Registrar logs e erros de integração.
    
-   Emitir alerta por e-mail quando houver falha crítica.
    

----------

#### 3.3.4 Returns/Exchange Module

Módulo ou extensão operacional responsável por:

-   Registrar solicitações de troca.
    
-   Controlar se a compra já utilizou a primeira troca com frete pago pela empresa.
    
-   Registrar autorização de logística reversa dos Correios.
    
-   Registrar código de postagem, prazo e status quando disponível.
    
-   Registrar se o custo do frete de troca será da empresa ou do cliente.
    
-   Notificar cliente por e-mail sobre instruções da troca.
    
-   Alertar admin em caso de falha ou pendência operacional.
    

----------

#### 3.3.5 Worker

Processo separado do server HTTP, responsável por:

-   Processar filas.
    
-   Executar workflows.
    
-   Tratar eventos assíncronos.
    
-   Disparar integrações externas.
    
-   Processar outbox/retry de eventos analíticos externos, incluindo entrega de `purchase_completed` ao PostHog.
    
-   Enviar e-mails.
    
-   Enviar alertas operacionais.
    
-   Reprocessar tarefas em caso de falha recuperável.
    
----------

## 4. Fluxos de Negócio

### 4.1 Fluxo de Compra — Cartão

```text
1. Cliente acessa a storefront.
2. Cliente navega pelo catálogo.
3. Cliente abre a página de produto.
4. Cliente seleciona tamanho, cor e quantidade.
5. Cliente adiciona item ao carrinho.
6. Cliente inicia checkout.
7. Cliente informa e-mail.
8. Cliente informa endereço de entrega no Brasil.
9. Sistema consulta opções de frete.
10. Cliente seleciona frete.
11. Medusa cria pedido em `awaiting_payment`.
12. Sistema cria sessão/intenção de pagamento Stripe.
13. Cliente escolhe cartão.
14. Cliente paga via Stripe.
15. Stripe confirma pagamento por webhook.
16. Backend confirma/cria o pedido.
17. Backend registra duravelmente `purchase_completed` em outbox local/`AnalyticsEventLog`.
18. Backend enfileira a entrega assíncrona de `purchase_completed` ao PostHog.
19. Resend envia e-mail de confirmação.
20. Workflow de fulfillment é iniciado após o registro durável local de `purchase_completed`; não depende do sucesso de entrega ao PostHog.
21. Gelato Fulfillment Module cria pedido na Gelato.
22. Sistema registra o `gelato_order_id`.
23. Gelato produz e envia o pedido.
24. Gelato envia webhook de status.
25. Sistema atualiza fulfillment e tracking.
26. Resend envia e-mail de envio com rastreio.
27. PostHog recebe `purchase_completed` quando a entrega assíncrona for bem-sucedida; falhas devem ser reprocessáveis.

```

----------

### 4.2 Fluxo de Compra — Pix

```text
1. Cliente acessa a storefront.
2. Cliente adiciona produto ao carrinho.
3. Cliente informa e-mail e endereço.
4. Sistema calcula frete.
5. Medusa cria pedido em `awaiting_payment`.
6. Cliente seleciona Pix como método de pagamento.
7. Sistema cria pagamento Pix via Stripe.
8. Storefront exibe instruções de pagamento Pix.
9. Cliente realiza o pagamento.
10. Stripe confirma pagamento por webhook.
11. Backend confirma/cria o pedido.
12. Backend registra duravelmente `purchase_completed` em outbox local/`AnalyticsEventLog`.
13. Backend enfileira a entrega assíncrona de `purchase_completed` ao PostHog.
14. Resend envia e-mail de confirmação.
15. Workflow de fulfillment é iniciado após o registro durável local de `purchase_completed`; não depende do sucesso de entrega ao PostHog.
16. Gelato Fulfillment Module cria pedido na Gelato.
17. Gelato processa produção e envio.
18. Sistema recebe tracking e envia e-mail de rastreio.
19. PostHog recebe `purchase_completed` quando a entrega assíncrona for bem-sucedida; falhas devem ser reprocessáveis.

```

Regra crítica: pedido Pix não deve ser enviado à Gelato antes da confirmação efetiva do pagamento pelo webhook do Stripe (BR-017).

----------

### 4.3 Fluxo de Falha no Pagamento

```text
1. Cliente tenta pagar.
2. Stripe recusa, expira ou falha o pagamento.
3. Storefront exibe erro claro.
4. Pedido permanece em `awaiting_payment` ou é marcado como falho/expirado; não avança para `confirmed`.
5. Fulfillment não é disparado.
6. Cliente pode tentar outro cartão, gerar novo Pix ou escolher método disponível.
7. Evento de falha é registrado no PostHog.
8. Erros técnicos são enviados ao Sentry.

```

----------

### 4.4 Fluxo de Falha na Criação do Pedido Gelato

```text
1. Pagamento é confirmado.
2. Pedido é confirmado no Medusa.
3. Backend registra duravelmente `purchase_completed` em outbox local/`AnalyticsEventLog`.
4. Workflow tenta criar pedido na Gelato.
5. Gelato retorna erro ou timeout.
6. Sistema executa retry com backoff.
7. Se a falha persistir, fulfillment é marcado como falho.
8. Sistema registra erro no Sentry.
9. Sistema registra log estruturado.
10. Sistema envia alerta operacional por e-mail.
11. Pedido não deve ser perdido.
12. Falha temporária na entrega de `purchase_completed` ao PostHog não deve bloquear reprocessamento Gelato.
13. Administrador pode reprocessar manualmente (GL-015, AD-016) ou cancelar/reembolsar.

```

----------

### 4.5 Fluxo de Cancelamento

```text
1. Administrador acessa pedido no Admin.
2. Administrador solicita cancelamento.
3. Sistema verifica status do fulfillment.
4. Sistema consulta status atual do pedido na Gelato.
5. Se produção não iniciou, sistema cancela na Gelato.
6. Sistema atualiza pedido/fulfillment no Medusa.
7. Sistema inicia reembolso via Stripe, se aplicável, e só atualiza status local após confirmação via webhook do Stripe.
8. Resend envia e-mail de cancelamento.
9. Se produção já iniciou, sistema bloqueia cancelamento e exibe erro descritivo.

```

----------

### 4.6 Fluxo de Tracking

```text
1. Gelato envia webhook informando envio.
2. Backend valida autenticidade do webhook.
3. Backend localiza fulfillment pelo `gelato_order_id`.
4. Backend salva `tracking_number` e `tracking_url`.
5. Backend atualiza status do fulfillment.
6. Backend dispara evento de envio.
7. Resend envia e-mail com rastreio.
8. Cliente acessa página de tracking.
9. PostHog registra visualização da página de tracking.

```

----------

### 4.7 Fluxo de Troca com Logística Reversa

```text
1. Cliente solicita troca pelo canal oficial do MVP: e-mail para suporte ou formulário/página de contato na storefront (RT-009).
2. Admin localiza pedido e cria registro de troca no Admin (RT-001), com status `requested`.
3. Sistema verifica se o pedido já teve troca anterior (RT-002, RT-003; regras BR-019 e BR-020).
4. Admin aprova ou recusa a solicitação; se aprovada, status passa para `approved`.
5. Se for a primeira troca da compra, frete da logística reversa é pago pela empresa.
6. Se já houve troca na mesma compra, frete da nova troca é pago pelo cliente.
7. Admin gera ou registra autorização de postagem dos Correios (RT-004).
8. Sistema envia e-mail ao cliente com instruções de postagem (EM-010).
9. Admin acompanha recebimento do produto e atualiza status conforme §8.4.
10. Admin define ação manualmente: troca, reenvio, reembolso ou recusa conforme política; reenvio/reembolso automatizados ficam fora do MVP (§15).
11. Sistema registra histórico da troca no pedido (RT-006).

```

----------

## 5. Requisitos Funcionais

### 5.1 Convenção de Prioridade

<table>
  <thead>
    <tr>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Significado</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Must Have</strong></td>
      <td>Obrigatório para o MVP.</td>
    </tr>
    <tr>
      <td><strong>Should Have</strong></td>
      <td>Importante, mas não bloqueia o primeiro lançamento.</td>
    </tr>
    <tr>
      <td><strong>Could Have</strong></td>
      <td>Desejável para evolução futura.</td>
    </tr>
  </tbody>
</table>

### 5.2 Storefront — SF

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>SF-001</td>
      <td>O sistema deve exibir página inicial da loja.</td>
      <td>Must Have</td>
      <td>A página inicial deve carregar sem erro e apresentar navegação para catálogo/produtos.</td>
    </tr>
    <tr>
      <td>SF-002</td>
      <td>O sistema deve exibir listagem de produtos.</td>
      <td>Must Have</td>
      <td>Cada produto deve exibir imagem, nome, preço em BRL (BR-003) e indicação de variantes. Apenas produtos publicados (BR-005, AD-004).</td>
    </tr>
    <tr>
      <td>SF-003</td>
      <td>O sistema deve exibir página de detalhe do produto.</td>
      <td>Must Have</td>
      <td>A página deve conter galeria, descrição, preço em BRL (BR-003), variantes e CTA de adicionar ao carrinho.</td>
    </tr>
    <tr>
      <td>SF-004</td>
      <td>O sistema deve permitir seleção de variantes.</td>
      <td>Must Have</td>
      <td>O cliente só pode adicionar ao carrinho uma combinação válida de tamanho/cor.</td>
    </tr>
    <tr>
      <td>SF-005</td>
      <td>O sistema deve exibir estado de variante indisponível.</td>
      <td>Must Have</td>
      <td>No modelo POD sem estoque físico, variante indisponível significa ausência de metadados Gelato obrigatórios (BR-006), variante despublicada ou combinação inválida — não controle de estoque. Variante indisponível deve estar visualmente desabilitada e não permitir adicionar ao carrinho.</td>
    </tr>
    <tr>
      <td>SF-006</td>
      <td>O sistema deve ser responsivo.</td>
      <td>Must Have</td>
      <td>Catálogo, produto, carrinho e checkout devem funcionar em mobile e desktop.</td>
    </tr>
    <tr>
      <td>SF-007</td>
      <td>O sistema deve suportar páginas de coleção/categoria.</td>
      <td>Should Have</td>
      <td>Produtos devem ser filtráveis por coleção/categoria.</td>
    </tr>
    <tr>
      <td>SF-008</td>
      <td>O sistema deve suportar busca textual de produtos.</td>
      <td>Could Have</td>
      <td>Busca deve retornar produtos por nome ou termo relevante.</td>
    </tr>
    <tr>
      <td>SF-009</td>
      <td>O sistema deve exibir página de confirmação de pedido.</td>
      <td>Must Have</td>
      <td>Após pagamento aprovado, cliente deve ver número do pedido e resumo.</td>
    </tr>
    <tr>
      <td>SF-010</td>
      <td>O sistema deve exibir página de tracking.</td>
      <td>Must Have</td>
      <td>Convidado: consulta por link com token seguro (OR-012, BR-022). Cliente autenticado: consulta na área do cliente (AC-005) sem token, desde que o pedido pertença à conta. Token inválido ou expirado deve retornar erro genérico sem expor dados do pedido.</td>
    </tr>
    <tr>
      <td>SF-011</td>
      <td>O sistema deve conter páginas de Política de Privacidade, Termos de Compra e Política de Trocas.</td>
      <td>Must Have</td>
      <td>Links devem estar visíveis no rodapé e no fluxo de checkout. Conteúdo atende NFRLGPD-002 e NFRLGPD-003; canal LGPD conforme Q-009.</td>
    </tr>
  </tbody>
</table>

### 5.3 Carrinho — CA

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>CA-001</td>
      <td>O sistema deve criar carrinho para visitante.</td>
      <td>Must Have</td>
      <td>Ao adicionar primeiro item, um cart deve ser criado no backend.</td>
    </tr>
    <tr>
      <td>CA-002</td>
      <td>O sistema deve persistir o carrinho durante a sessão.</td>
      <td>Must Have</td>
      <td>Recarregar a página não deve perder o carrinho ativo.</td>
    </tr>
    <tr>
      <td>CA-003</td>
      <td>O sistema deve permitir adicionar item ao carrinho.</td>
      <td>Must Have</td>
      <td>Item selecionado deve aparecer no carrinho com variante e quantidade corretas.</td>
    </tr>
    <tr>
      <td>CA-004</td>
      <td>O sistema deve permitir alterar quantidade.</td>
      <td>Must Have</td>
      <td>Totais devem ser recalculados após atualização.</td>
    </tr>
    <tr>
      <td>CA-005</td>
      <td>O sistema deve permitir remover item.</td>
      <td>Must Have</td>
      <td>Item removido não deve aparecer no resumo do carrinho.</td>
    </tr>
    <tr>
      <td>CA-006</td>
      <td>O sistema deve exibir subtotal em BRL.</td>
      <td>Must Have</td>
      <td>Subtotal deve refletir preço x quantidade dos itens em BRL (BR-003).</td>
    </tr>
    <tr>
      <td>CA-007</td>
      <td>O sistema deve exibir carrinho lateral ou página equivalente.</td>
      <td>Must Have</td>
      <td>Cliente deve conseguir revisar itens antes do checkout.</td>
    </tr>
    <tr>
      <td>CA-008</td>
      <td>O sistema deve suportar cupom de desconto.</td>
      <td>Should Have</td>
      <td>Cupom válido deve alterar total; cupom inválido deve exibir erro.</td>
    </tr>
  </tbody>
</table>

### 5.4 Checkout — CH

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>CH-001</td>
      <td>O sistema deve permitir checkout como convidado.</td>
      <td>Must Have</td>
      <td>Cliente deve conseguir comprar sem criar conta (BR-002, AC-007).</td>
    </tr>
    <tr>
      <td>CH-002</td>
      <td>O sistema deve coletar e-mail do cliente.</td>
      <td>Must Have</td>
      <td>E-mail válido é obrigatório para confirmação e tracking.</td>
    </tr>
    <tr>
      <td>CH-003</td>
      <td>O sistema deve coletar endereço completo de entrega no Brasil.</td>
      <td>Must Have</td>
      <td>Nome, endereço, cidade, estado, CEP, telefone e país devem ser obrigatórios. País deve ser `BR`; endereços fora do Brasil devem ser rejeitados (BR-015).</td>
    </tr>
    <tr>
      <td>CH-004</td>
      <td>O sistema deve validar campos obrigatórios.</td>
      <td>Must Have</td>
      <td>Campos inválidos devem exibir mensagem inline.</td>
    </tr>
    <tr>
      <td>CH-005</td>
      <td>O sistema deve calcular frete antes do pagamento.</td>
      <td>Must Have</td>
      <td>Cliente deve ver pelo menos uma opção de envio quando disponível, antes da confirmação do pagamento (BR-004).</td>
    </tr>
    <tr>
      <td>CH-006</td>
      <td>O sistema deve consultar frete via Gelato ou módulo de shipping integrado.</td>
      <td>Must Have</td>
      <td>Frete deve considerar endereço brasileiro e itens do carrinho (BR-004, GL-006).</td>
    </tr>
    <tr>
      <td>CH-007</td>
      <td>O sistema deve exibir prazo estimado de entrega quando disponível.</td>
      <td>Must Have</td>
      <td>Cada opção de frete deve exibir prazo ou intervalo estimado.</td>
    </tr>
    <tr>
      <td>CH-008</td>
      <td>O sistema deve exibir resumo completo antes do pagamento.</td>
      <td>Must Have</td>
      <td>Resumo deve conter itens, frete, descontos e total em BRL (BR-003).</td>
    </tr>
    <tr>
      <td>CH-009</td>
      <td>O sistema deve impedir checkout com carrinho vazio.</td>
      <td>Must Have</td>
      <td>Usuário deve ser redirecionado ao catálogo ou carrinho.</td>
    </tr>
    <tr>
      <td>CH-010</td>
      <td>O sistema deve tratar falha no cálculo de frete.</td>
      <td>Must Have</td>
      <td>Deve exibir mensagem e permitir nova tentativa.</td>
    </tr>
    <tr>
      <td>CH-011</td>
      <td>O sistema deve solicitar aceite dos Termos de Compra e Política de Privacidade.</td>
      <td>Must Have</td>
      <td>Cliente deve aceitar antes de concluir o pagamento.</td>
    </tr>
    <tr>
      <td>CH-012</td>
      <td>O sistema deve exibir resumo da Política de Trocas no checkout.</td>
      <td>Should Have</td>
      <td>Cliente deve conseguir acessar a política completa antes de pagar.</td>
    </tr>
    <tr>
      <td>CH-013</td>
      <td>O sistema deve permitir checkout para cliente autenticado.</td>
      <td>Must Have</td>
      <td>Cliente logado deve concluir compra com pedido associado à conta, reutilizar endereços salvos (AC-006) e consultar o pedido no histórico (AC-005).</td>
    </tr>
  </tbody>
</table>

### 5.5 Pagamento — PG

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>PG-001</td>
      <td>O sistema deve integrar Stripe como provedor de pagamento.</td>
      <td>Must Have</td>
      <td>Checkout deve criar sessão/intenção de pagamento válida.</td>
    </tr>
    <tr>
      <td>PG-002</td>
      <td>O sistema deve permitir pagamento por cartão.</td>
      <td>Must Have</td>
      <td>Cliente deve conseguir pagar com cartão usando interface segura do Stripe.</td>
    </tr>
    <tr>
      <td>PG-003</td>
      <td>O sistema deve permitir pagamento por Pix.</td>
      <td>Must Have</td>
      <td>Cliente deve conseguir gerar pagamento Pix e receber feedback de status.</td>
    </tr>
    <tr>
      <td>PG-004</td>
      <td>O sistema não deve processar dados sensíveis de cartão diretamente.</td>
      <td>Must Have</td>
      <td>Dados de cartão devem ser tratados pelo Stripe.</td>
    </tr>
    <tr>
      <td>PG-005</td>
      <td>O sistema deve processar webhook de pagamento aprovado.</td>
      <td>Must Have</td>
      <td>Conforme BR-001. Pedido só deve ser confirmado após evento confiável do Stripe. Após confirmação do pedido, o backend deve registrar duravelmente `purchase_completed` antes de iniciar fulfillment; entrega ao PostHog é assíncrona.</td>
    </tr>
    <tr>
      <td>PG-006</td>
      <td>O sistema deve processar webhook de pagamento falho, expirado ou cancelado.</td>
      <td>Must Have</td>
      <td>Pagamento deve permanecer diferente de `captured`; pedido não avança para `confirmed` e fulfillment não é disparado. Conforme BR-017 para Pix pendente ou expirado.</td>
    </tr>
    <tr>
      <td>PG-007</td>
      <td>O sistema deve validar assinatura do webhook Stripe.</td>
      <td>Must Have</td>
      <td>Webhook inválido deve ser rejeitado.</td>
    </tr>
    <tr>
      <td>PG-008</td>
      <td>O sistema deve registrar eventos de pagamento.</td>
      <td>Must Have</td>
      <td>Eventos relevantes devem estar disponíveis para auditoria.</td>
    </tr>
    <tr>
      <td>PG-009</td>
      <td>O sistema deve permitir reembolso via Admin.</td>
      <td>Must Have</td>
      <td>Administrador deve conseguir iniciar reembolso total ou parcial; status local só atualiza após confirmação via webhook Stripe (BR-010, EM-004).</td>
    </tr>
    <tr>
      <td>PG-010</td>
      <td>O sistema deve suportar métodos adicionais de pagamento no futuro.</td>
      <td>Could Have</td>
      <td>Arquitetura não deve bloquear wallets ou outros métodos futuros.</td>
    </tr>
    <tr>
      <td>PG-011</td>
      <td>O sistema deve impedir fulfillment de pedido Pix pendente.</td>
      <td>Must Have</td>
      <td>Requisito testável explícito para Pix; ver também PG-005 e BR-017. Fulfillment só inicia após pagamento em `captured`.</td>
    </tr>
  </tbody>
</table>

### 5.6 Pedidos — OR

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>OR-001</td>
      <td>O sistema deve criar pedido no checkout em `awaiting_payment`.</td>
      <td>Must Have</td>
      <td>Pedido deve ser criado antes do pagamento com status `awaiting_payment`, contendo cliente/e-mail, endereço, itens, frete e total. Pedido só avança para `confirmed` após pagamento confirmado.</td>
    </tr>
    <tr>
      <td>OR-002</td>
      <td>O sistema deve atribuir número identificável ao pedido.</td>
      <td>Must Have</td>
      <td>Cliente e admin devem conseguir referenciar o pedido.</td>
    </tr>
    <tr>
      <td>OR-003</td>
      <td>O sistema deve exibir pedidos no Admin.</td>
      <td>Must Have</td>
      <td>Admin deve visualizar lista e detalhe de pedidos.</td>
    </tr>
    <tr>
      <td>OR-004</td>
      <td>O sistema deve manter status de pagamento.</td>
      <td>Must Have</td>
      <td>Status deve usar os códigos de §8.1. A exibição no Admin pode usar rótulos em português conforme mapeamento de §8.1.1.</td>
    </tr>
    <tr>
      <td>OR-005</td>
      <td>O sistema deve manter status de fulfillment.</td>
      <td>Must Have</td>
      <td>Status deve refletir os estados definidos em §8.3. Transições a partir de webhooks Gelato devem seguir §8.3.1.</td>
    </tr>
    <tr>
      <td>OR-006</td>
      <td>O sistema deve manter status de pedido conforme §8.2.</td>
      <td>Must Have</td>
      <td>Transições de status de pedido devem seguir §8.2.1.</td>
    </tr>
    <tr>
      <td>OR-007</td>
      <td>O sistema deve registrar tracking no pedido.</td>
      <td>Must Have</td>
      <td>Código/link de rastreio deve ser persistido quando disponível (BR-011).</td>
    </tr>
    <tr>
      <td>OR-008</td>
      <td>O sistema deve permitir cancelamento pelo Admin.</td>
      <td>Must Have</td>
      <td>Cancelamento deve respeitar status da Gelato.</td>
    </tr>
    <tr>
      <td>OR-009</td>
      <td>O sistema deve exibir histórico de eventos do pedido.</td>
      <td>Should Have</td>
      <td>Admin deve conseguir auditar mudanças relevantes.</td>
    </tr>
    <tr>
      <td>OR-010</td>
      <td>O sistema deve permitir exportação de pedidos.</td>
      <td>Could Have</td>
      <td>Exportação CSV pode ser adicionada pós-MVP.</td>
    </tr>
    <tr>
      <td>OR-011</td>
      <td>O sistema deve associar solicitações de troca ao pedido original.</td>
      <td>Must Have</td>
      <td>Admin deve ver histórico de troca no detalhe do pedido.</td>
    </tr>
    <tr>
      <td>OR-012</td>
      <td>O sistema deve gerar token seguro para acesso ao tracking do pedido.</td>
      <td>Must Have</td>
      <td>Token destina-se ao acesso de convidados e links em e-mails. Deve ser único, imprevisível e vinculado ao pedido; validado server-side em toda consulta anônima; incluído nos e-mails de confirmação e/ou envio. Pedidos de convidados não devem ser consultáveis somente por ID público. Cliente autenticado acessa tracking pela área do cliente (AC-005) sem token. Token expira 365 dias após confirmação do pedido; após expiração, consulta anônima deve retornar erro genérico (BR-022).</td>
    </tr>
  </tbody>
</table>

### 5.7 Integração Gelato — GL

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>GL-001</td>
      <td>O sistema deve implementar módulo customizado de fulfillment Gelato.</td>
      <td>Must Have</td>
      <td>Módulo deve ser integrado ao fluxo de fulfillment do Medusa.</td>
    </tr>
    <tr>
      <td>GL-002</td>
      <td>O sistema deve mapear variantes Medusa para templates fixos Gelato.</td>
      <td>Must Have</td>
      <td>Cada variante vendável deve ter metadados Gelato obrigatórios.</td>
    </tr>
    <tr>
      <td>GL-003</td>
      <td>O sistema deve validar metadados Gelato antes de criar pedido.</td>
      <td>Must Have</td>
      <td>Falta de metadados deve gerar erro descritivo, bloquear fulfillment e mover pedido para `requires_attention` quando aplicável (§8.2.1).</td>
    </tr>
    <tr>
      <td>GL-004</td>
      <td>O sistema deve criar pedido de produção na Gelato após pagamento confirmado, pedido confirmado e `purchase_completed` registrado duravelmente no backend.</td>
      <td>Must Have</td>
      <td>Conforme BR-001. Chamada deve conter itens, quantidade, endereço brasileiro e método de envio. A integração Gelato não deve depender do sucesso de entrega ao PostHog.</td>
    </tr>
    <tr>
      <td>GL-005</td>
      <td>O sistema deve persistir o identificador do pedido Gelato.</td>
      <td>Must Have</td>
      <td>gelato_order_id deve ser salvo para rastreamento.</td>
    </tr>
    <tr>
      <td>GL-006</td>
      <td>O sistema deve consultar cotação de frete.</td>
      <td>Must Have</td>
      <td>Checkout deve obter opções de envio compatíveis com o endereço.</td>
    </tr>
    <tr>
      <td>GL-007</td>
      <td>O sistema deve processar webhooks Gelato.</td>
      <td>Must Have</td>
      <td>Eventos devem atualizar o fulfillment correspondente conforme mapeamento de §8.3.1.</td>
    </tr>
    <tr>
      <td>GL-008</td>
      <td>O sistema deve registrar tracking recebido da Gelato.</td>
      <td>Must Have</td>
      <td>Tracking deve ser salvo e exposto ao cliente (BR-011, EM-002, OR-007).</td>
    </tr>
    <tr>
      <td>GL-009</td>
      <td>O sistema deve cancelar pedido Gelato quando possível.</td>
      <td>Must Have</td>
      <td>Cancelamento só deve ocorrer se a produção ainda permitir.</td>
    </tr>
    <tr>
      <td>GL-010</td>
      <td>O sistema deve implementar retries para falhas recuperáveis.</td>
      <td>Must Have</td>
      <td>Erros temporários devem ser reprocessados com backoff.</td>
    </tr>
    <tr>
      <td>GL-011</td>
      <td>O sistema deve registrar logs de chamadas Gelato.</td>
      <td>Must Have</td>
      <td>Request, response, status e correlation ID devem ser registrados sem expor secrets.</td>
    </tr>
    <tr>
      <td>GL-012</td>
      <td>O sistema deve permitir validação pré-go-live dos mapeamentos Gelato.</td>
      <td>Must Have</td>
      <td>Script ou rotina deve listar variantes sem metadados obrigatórios.</td>
    </tr>
    <tr>
      <td>GL-013</td>
      <td>O sistema deve suportar sincronização de catálogo Gelato.</td>
      <td>Should Have</td>
      <td>Rotina auxiliar pode importar ou verificar produtos disponíveis.</td>
    </tr>
    <tr>
      <td>GL-014</td>
      <td>O sistema deve impedir publicação de produto sem template Gelato válido.</td>
      <td>Must Have</td>
      <td>Produto incompleto não deve ser vendável sem override administrativo consciente.</td>
    </tr>
    <tr>
      <td>GL-015</td>
      <td>O sistema deve permitir reprocessamento manual de fulfillment Gelato falho.</td>
      <td>Must Have</td>
      <td>Admin deve conseguir reprocessar pedido pago com fulfillment `failed` ou pedido em `requires_attention`, respeitando BR-007 e idempotência (AD-016).</td>
    </tr>
  </tbody>
</table>

### 5.8 E-mails Transacionais e Alertas — EM

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>EM-001</td>
      <td>O sistema deve enviar e-mail de confirmação de pedido.</td>
      <td>Must Have</td>
      <td>Cliente deve receber e-mail após pagamento confirmado.</td>
    </tr>
    <tr>
      <td>EM-002</td>
      <td>O sistema deve enviar e-mail de envio/rastreio.</td>
      <td>Must Have</td>
      <td>Cliente deve receber tracking após status enviado (BR-011, GL-008).</td>
    </tr>
    <tr>
      <td>EM-003</td>
      <td>O sistema deve enviar e-mail de cancelamento.</td>
      <td>Must Have</td>
      <td>Cliente deve ser notificado quando pedido for cancelado (conforme fluxo §4.5).</td>
    </tr>
    <tr>
      <td>EM-004</td>
      <td>O sistema deve enviar e-mail de reembolso.</td>
      <td>Must Have</td>
      <td>Cliente deve ser notificado sobre reembolso quando admin iniciar reembolso via PG-009.</td>
    </tr>
    <tr>
      <td>EM-005</td>
      <td>O sistema deve enviar e-mail de boas-vindas.</td>
      <td>Should Have</td>
      <td>Cliente registrado deve receber confirmação de conta.</td>
    </tr>
    <tr>
      <td>EM-006</td>
      <td>O sistema deve enviar e-mail de redefinição de senha.</td>
      <td>Must Have</td>
      <td>Link de redefinição deve ter validade limitada. Obrigatório para atender AC-004.</td>
    </tr>
    <tr>
      <td>EM-007</td>
      <td>Templates devem seguir identidade visual da loja.</td>
      <td>Should Have</td>
      <td>Templates devem conter logo, cores e linguagem da marca.</td>
    </tr>
    <tr>
      <td>EM-008</td>
      <td>O sistema deve registrar falha de envio de e-mail.</td>
      <td>Must Have</td>
      <td>Falha deve ser logada e passível de reprocessamento. Falha no e-mail não deve cancelar pedido pago (BR-012).</td>
    </tr>
    <tr>
      <td>EM-009</td>
      <td>O sistema deve enviar alerta operacional crítico por e-mail ao admin.</td>
      <td>Must Have</td>
      <td>Falhas críticas conforme §11.3 devem gerar alerta por e-mail.</td>
    </tr>
    <tr>
      <td>EM-010</td>
      <td>O sistema deve enviar e-mail com instruções de troca/logística reversa.</td>
      <td>Must Have</td>
      <td>Cliente deve receber código/instruções quando troca for aprovada (conforme fluxo §4.7).</td>
    </tr>
  </tbody>
</table>

### 5.9 Conta do Cliente — AC

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>AC-001</td>
      <td>O sistema deve permitir criação de conta.</td>
      <td>Must Have</td>
      <td>Cliente deve criar conta com e-mail e senha.</td>
    </tr>
    <tr>
      <td>AC-002</td>
      <td>O sistema deve permitir login.</td>
      <td>Must Have</td>
      <td>Cliente deve autenticar com credenciais válidas.</td>
    </tr>
    <tr>
      <td>AC-003</td>
      <td>O sistema deve permitir logout.</td>
      <td>Must Have</td>
      <td>Sessão deve ser encerrada corretamente.</td>
    </tr>
    <tr>
      <td>AC-004</td>
      <td>O sistema deve permitir recuperação de senha.</td>
      <td>Must Have</td>
      <td>Cliente deve receber link de redefinição.</td>
    </tr>
    <tr>
      <td>AC-005</td>
      <td>O sistema deve exibir histórico de pedidos.</td>
      <td>Must Have</td>
      <td>Cliente autenticado deve ver pedidos anteriores com status, fulfillment e tracking, sem exigir token de link (BR-022).</td>
    </tr>
    <tr>
      <td>AC-006</td>
      <td>O sistema deve permitir salvar endereços.</td>
      <td>Must Have</td>
      <td>Cliente deve reutilizar endereço no checkout.</td>
    </tr>
    <tr>
      <td>AC-007</td>
      <td>O checkout não deve exigir conta.</td>
      <td>Must Have</td>
      <td>Guest checkout deve permanecer disponível sem exigir criação de conta (BR-002, CH-001).</td>
    </tr>
    <tr>
      <td>AC-008</td>
      <td>O sistema deve permitir visualização de solicitações de troca na área do cliente.</td>
      <td>Should Have</td>
      <td>Cliente deve consultar status de troca na área do cliente.</td>
    </tr>
  </tbody>
</table>

### 5.10 Admin — AD

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>AD-001</td>
      <td>O sistema deve disponibilizar Admin Dashboard em subdomínio próprio.</td>
      <td>Must Have</td>
      <td>Admin deve acessar painel protegido por autenticação.</td>
    </tr>
    <tr>
      <td>AD-002</td>
      <td>O sistema deve permitir criar produtos.</td>
      <td>Must Have</td>
      <td>Admin deve cadastrar título, descrição, imagens, preço e variantes.</td>
    </tr>
    <tr>
      <td>AD-003</td>
      <td>O sistema deve permitir editar produtos.</td>
      <td>Must Have</td>
      <td>Alterações devem refletir na storefront após atualização/cache.</td>
    </tr>
    <tr>
      <td>AD-004</td>
      <td>O sistema deve permitir publicar/despublicar produtos.</td>
      <td>Must Have</td>
      <td>Produto despublicado não deve aparecer na storefront (BR-005, SF-002).</td>
    </tr>
    <tr>
      <td>AD-005</td>
      <td>O sistema deve permitir configurar variantes.</td>
      <td>Must Have</td>
      <td>Cada variante deve conter tamanho, cor, SKU, preço em BRL (BR-016) e metadados Gelato.</td>
    </tr>
    <tr>
      <td>AD-006</td>
      <td>O sistema deve permitir visualizar pedidos.</td>
      <td>Must Have</td>
      <td>Lista deve exibir cliente, total, status de pagamento e fulfillment.</td>
    </tr>
    <tr>
      <td>AD-007</td>
      <td>O sistema deve permitir visualizar detalhes do pedido.</td>
      <td>Must Have</td>
      <td>Detalhe deve conter itens, endereço, pagamento, fulfillment, tracking e trocas.</td>
    </tr>
    <tr>
      <td>AD-008</td>
      <td>O sistema deve permitir cancelar pedido.</td>
      <td>Must Have</td>
      <td>Conforme OR-008. Cancelamento deve acionar lógica de Gelato, reembolso (BR-010, PG-009) e e-mail (EM-003).</td>
    </tr>
    <tr>
      <td>AD-009</td>
      <td>O sistema deve permitir gerenciar clientes.</td>
      <td>Should Have</td>
      <td>Admin deve visualizar cliente e histórico de compras.</td>
    </tr>
    <tr>
      <td>AD-010</td>
      <td>O sistema deve configurar região Brasil e moeda BRL.</td>
      <td>Must Have</td>
      <td>Região principal deve suportar Brasil/BRL (BR-016).</td>
    </tr>
    <tr>
      <td>AD-011</td>
      <td>O sistema deve permitir configurar métodos de envio.</td>
      <td>Must Have</td>
      <td>Métodos devem ser compatíveis com cotação Gelato.</td>
    </tr>
    <tr>
      <td>AD-012</td>
      <td>O sistema deve permitir configurar promoções/cupons.</td>
      <td>Should Have</td>
      <td>Admin deve criar cupom com valor, validade e limite.</td>
    </tr>
    <tr>
      <td>AD-013</td>
      <td>O sistema deve permitir registrar e acompanhar solicitações de troca.</td>
      <td>Must Have</td>
      <td>Admin deve ver status, custo de frete e instruções da troca.</td>
    </tr>
    <tr>
      <td>AD-014</td>
      <td>O sistema deve permitir visualizar alertas operacionais críticos.</td>
      <td>Could Have</td>
      <td>Alertas podem inicialmente ser apenas por e-mail (conforme EM-009).</td>
    </tr>
    <tr>
      <td>AD-015</td>
      <td>O sistema deve permitir filtrar e identificar pedidos que exigem atenção.</td>
      <td>Must Have</td>
      <td>Admin deve listar pedidos em `requires_attention` conforme BR-014.</td>
    </tr>
    <tr>
      <td>AD-016</td>
      <td>O sistema deve permitir reprocessar fulfillment Gelato manualmente.</td>
      <td>Must Have</td>
      <td>Conforme GL-015. Ação deve registrar log de auditoria.</td>
    </tr>
  </tbody>
</table>

### 5.11 Storage de Imagens — ST

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>ST-001</td>
      <td>O sistema deve usar bucket no Supabase para imagens de produto.</td>
      <td>Must Have</td>
      <td>Imagens cadastradas no Admin devem ser armazenadas no Supabase Storage.</td>
    </tr>
    <tr>
      <td>ST-002</td>
      <td>O sistema deve gerar URLs públicas ou assinadas conforme estratégia definida.</td>
      <td>Must Have</td>
      <td>MVP: URLs públicas do bucket para imagens de produto, com políticas de acesso restritas a leitura. URLs assinadas podem ser adotadas posteriormente se a política de bucket exigir.</td>
    </tr>
    <tr>
      <td>ST-003</td>
      <td>O sistema deve suportar thumbnail e galeria por produto.</td>
      <td>Must Have</td>
      <td>Página de produto deve exibir imagem principal e imagens adicionais.</td>
    </tr>
    <tr>
      <td>ST-004</td>
      <td>O sistema deve validar tipo e tamanho de arquivo.</td>
      <td>Should Have</td>
      <td>Upload inválido deve ser recusado com mensagem clara.</td>
    </tr>
    <tr>
      <td>ST-005</td>
      <td>O sistema deve organizar arquivos por ambiente.</td>
      <td>Should Have</td>
      <td>Produção, staging e dev não devem compartilhar paths críticos sem controle.</td>
    </tr>
  </tbody>
</table>

### 5.12 Trocas e Logística Reversa — RT

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>RT-001</td>
      <td>O sistema deve registrar solicitação de troca associada a pedido.</td>
      <td>Must Have</td>
      <td>Admin deve conseguir criar registro de troca vinculado ao pedido original, iniciando em `requested`, e avançar entre os status definidos em §8.4.</td>
    </tr>
    <tr>
      <td>RT-002</td>
      <td>O sistema deve identificar se a troca é a primeira da compra.</td>
      <td>Must Have</td>
      <td>Conforme BR-019. Primeira troca deve ser marcada como frete pago pela empresa.</td>
    </tr>
    <tr>
      <td>RT-003</td>
      <td>O sistema deve identificar trocas adicionais da mesma compra.</td>
      <td>Must Have</td>
      <td>Conforme BR-020. Troca adicional deve ser marcada como frete pago pelo cliente.</td>
    </tr>
    <tr>
      <td>RT-004</td>
      <td>O sistema deve registrar autorização de postagem dos Correios.</td>
      <td>Must Have</td>
      <td>Registro deve conter código, prazo e instruções, quando disponíveis.</td>
    </tr>
    <tr>
      <td>RT-005</td>
      <td>O fluxo de troca aprovada deve disparar e-mail ao cliente.</td>
      <td>Must Have</td>
      <td>Conforme EM-010. Envio ocorre após aprovação e registro de instruções disponíveis.</td>
    </tr>
    <tr>
      <td>RT-006</td>
      <td>O sistema deve manter histórico da troca no pedido.</td>
      <td>Must Have</td>
      <td>Admin deve auditar status e decisões tomadas.</td>
    </tr>
    <tr>
      <td>RT-008</td>
      <td>O sistema deve expor política de trocas na storefront.</td>
      <td>Must Have</td>
      <td>Cliente deve conseguir consultar a política antes e depois da compra.</td>
    </tr>
    <tr>
      <td>RT-009</td>
      <td>O sistema deve disponibilizar canal para o cliente solicitar troca.</td>
      <td>Must Have</td>
      <td>MVP: e-mail para suporte e/ou formulário/página de contato na storefront com número do pedido, motivo e dados de contato. Solicitação não cria troca automaticamente; admin registra via RT-001.</td>
    </tr>
  </tbody>
</table>

### 5.13 Analytics e Monitoramento — AN

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Prioridade</th>
      <th style="text-align: left;">Critério de Aceite</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>AN-001</td>
      <td>O sistema deve integrar PostHog na storefront e backend.</td>
      <td>Must Have</td>
      <td>Todos os eventos mínimos de §7.7 devem ser capturados com payloads definidos na mesma seção. Eventos de funil são capturados na storefront; `purchase_completed` deve ser registrado duravelmente no backend após pedido confirmado e entregue ao PostHog de forma assíncrona. Falhas temporárias do PostHog não devem bloquear fulfillment Gelato.</td>
    </tr>
    <tr>
      <td>AN-002</td>
      <td>O sistema deve integrar Sentry no frontend.</td>
      <td>Must Have</td>
      <td>Exceções frontend devem ser reportadas.</td>
    </tr>
    <tr>
      <td>AN-003</td>
      <td>O sistema deve integrar Sentry no backend.</td>
      <td>Must Have</td>
      <td>Exceções backend e falhas críticas devem ser reportadas.</td>
    </tr>
    <tr>
      <td>AN-004</td>
      <td>O sistema deve garantir operação dos alertas críticos por e-mail.</td>
      <td>Must Have</td>
      <td>Implementação e cobertura conforme EM-009 e §11.3.</td>
    </tr>
  </tbody>
</table>

----------

## 6. Requisitos Não Funcionais

**Convenção de IDs:** `NFR` + categoria (`PERF`, `SEC`, `AVL`, `SCL`, `MNT`, `UX`, `LGPD`) + número sequencial (ex.: `NFRPERF-001`).

### 6.1 Performance

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Critério</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>NFRPERF-001</td>
      <td>A storefront deve carregar rapidamente em mobile.</td>
      <td>Páginas principais devem buscar LCP abaixo de 2,5s em condições normais.</td>
    </tr>
    <tr>
      <td>NFRPERF-002</td>
      <td>APIs críticas de storefront devem responder com baixa latência.</td>
      <td>P95 inferior a 500ms para operações simples em condições normais.</td>
    </tr>
    <tr>
      <td>NFRPERF-003</td>
      <td>Webhooks devem ser processados rapidamente.</td>
      <td>Stripe e Gelato devem receber resposta HTTP em até 5 segundos sempre que possível.</td>
    </tr>
    <tr>
      <td>NFRPERF-004</td>
      <td>Operações longas devem ser assíncronas.</td>
      <td>Criação de fulfillment, retries, e-mails e alertas devem usar workflow/fila quando aplicável.</td>
    </tr>
    <tr>
      <td>NFRPERF-005</td>
      <td>Imagens devem ser otimizadas.</td>
      <td>Storefront deve usar otimização, lazy loading e tamanhos responsivos.</td>
    </tr>
  </tbody>
</table>

### 6.2 Segurança

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Critério</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>NFRSEC-001</td>
      <td>Toda comunicação pública deve usar HTTPS.</td>
      <td>Frontend, API e Admin devem ter TLS válido em produção.</td>
    </tr>
    <tr>
      <td>NFRSEC-002</td>
      <td>Secrets devem ficar em variáveis de ambiente.</td>
      <td>Chaves Stripe, Gelato, Resend, Supabase, Sentry, PostHog server-side, database e JWT não podem ser hardcoded.</td>
    </tr>
    <tr>
      <td>NFRSEC-003</td>
      <td>Webhook Stripe deve validar assinatura.</td>
      <td>Payload inválido deve retornar erro e não alterar estado.</td>
    </tr>
    <tr>
      <td>NFRSEC-004</td>
      <td>Webhook Gelato deve validar autenticidade.</td>
      <td>Requisições não verificadas não devem alterar fulfillment.</td>
    </tr>
    <tr>
      <td>NFRSEC-005</td>
      <td>Admin deve exigir autenticação.</td>
      <td>Admin não pode ser público sem login.</td>
    </tr>
    <tr>
      <td>NFRSEC-006</td>
      <td>Admin deve ter proteção reforçada em produção.</td>
      <td>Autenticação forte é obrigatória; recomenda-se IP allowlist, VPN, proteção no reverse proxy ou autenticação adicional.</td>
    </tr>
    <tr>
      <td>NFRSEC-007</td>
      <td>Logs não devem expor dados sensíveis.</td>
      <td>Secrets, tokens e dados completos de pagamento não devem aparecer em logs.</td>
    </tr>
    <tr>
      <td>NFRSEC-008</td>
      <td>O sistema deve proteger endpoints contra CORS indevido.</td>
      <td>Apenas domínios autorizados devem acessar APIs de storefront/admin.</td>
    </tr>
    <tr>
      <td>NFRSEC-009</td>
      <td>O sistema deve aplicar rate limiting em endpoints sensíveis.</td>
      <td>Login, checkout, webhook e formulários devem ter proteção contra abuso.</td>
    </tr>
    <tr>
      <td>NFRSEC-010</td>
      <td>Buckets do Supabase devem ter políticas adequadas.</td>
      <td>Arquivos públicos e privados devem ter regras distintas.</td>
    </tr>
  </tbody>
</table>

### 6.3 Disponibilidade e Resiliência

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Critério</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>NFRAVL-001</td>
      <td>Backend deve reiniciar automaticamente após falha.</td>
      <td>PM2 ou equivalente deve manter processos vivos.</td>
    </tr>
    <tr>
      <td>NFRAVL-002</td>
      <td>Redis deve ser monitorado.</td>
      <td>Falha no Redis deve gerar alerta por e-mail e registro no Sentry.</td>
    </tr>
    <tr>
      <td>NFRAVL-003</td>
      <td>Workflows devem suportar retry.</td>
      <td>Falhas temporárias em Gelato/Resend devem ser reprocessáveis.</td>
    </tr>
    <tr>
      <td>NFRAVL-004</td>
      <td>Webhooks devem ser idempotentes.</td>
      <td>Conforme BR-008 e §10.</td>
    </tr>
    <tr>
      <td>NFRAVL-005</td>
      <td>Sistema deve ter health check.</td>
      <td>Endpoint de saúde deve ser monitorável.</td>
    </tr>
    <tr>
      <td>NFRAVL-006</td>
      <td>Resiliência operacional deve acionar alertas críticos.</td>
      <td>Conforme EM-009.</td>
    </tr>
  </tbody>
</table>

### 6.4 Escalabilidade

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Critério</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>NFRSCL-001</td>
      <td>Server e worker devem poder rodar separadamente.</td>
      <td>Produção deve permitir escalar worker sem escalar API.</td>
    </tr>
    <tr>
      <td>NFRSCL-002</td>
      <td>Banco deve usar pooling em produção.</td>
      <td>Conexões ao Supabase devem evitar esgotamento do pool.</td>
    </tr>
    <tr>
      <td>NFRSCL-003</td>
      <td>Storefront deve usar cache quando apropriado.</td>
      <td>Catálogo e páginas públicas podem usar SSG/ISR conforme estratégia definida.</td>
    </tr>
    <tr>
      <td>NFRSCL-004</td>
      <td>Integrações externas devem ter limites tratados.</td>
      <td>Erros 429 devem acionar backoff.</td>
    </tr>
    <tr>
      <td>NFRSCL-005</td>
      <td>Storage deve suportar crescimento de catálogo.</td>
      <td>Estrutura de bucket deve evitar organização plana e difícil de manter.</td>
    </tr>
  </tbody>
</table>

### 6.5 Manutenibilidade

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Critério</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>NFRMNT-001</td>
      <td>Código deve usar TypeScript.</td>
      <td>Backend e frontend devem evitar JavaScript não tipado em código de aplicação.</td>
    </tr>
    <tr>
      <td>NFRMNT-002</td>
      <td>Código customizado crítico deve ter testes.</td>
      <td>Gelato module, webhooks, Pix, storage e cálculo de payload devem ter cobertura mínima.</td>
    </tr>
    <tr>
      <td>NFRMNT-003</td>
      <td>O projeto deve ter .env.example</td>
      <td>Todas as variáveis obrigatórias devem estar documentadas.</td>
    </tr>
    <tr>
      <td>NFRMNT-004</td>
      <td>O projeto deve ter documentação de setup.</td>
      <td>Desenvolvedor deve conseguir rodar localmente seguindo README.</td>
    </tr>
    <tr>
      <td>NFRMNT-005</td>
      <td>Integrações devem ser isoladas em módulos.</td>
      <td>Código Gelato, Stripe, Resend, Supabase Storage, Sentry e PostHog não deve ficar espalhado pela aplicação.</td>
    </tr>
    <tr>
      <td>NFRMNT-006</td>
      <td>Logs devem ser estruturados.</td>
      <td>Logs devem conter contexto, evento, pedido, fulfillment e correlation ID quando aplicável.</td>
    </tr>
  </tbody>
</table>

### 6.6 Usabilidade e Acessibilidade

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Critério</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>NFRUX-001</td>
      <td>Storefront deve ser mobile-first.</td>
      <td>Fluxos principais devem ser utilizáveis em 375px de largura.</td>
    </tr>
    <tr>
      <td>NFRUX-002</td>
      <td>Checkout deve minimizar etapas.</td>
      <td>Guest checkout deve ser o caminho padrão ou claramente disponível (BR-002, CH-001).</td>
    </tr>
    <tr>
      <td>NFRUX-003</td>
      <td>Erros devem ser claros e acionáveis.</td>
      <td>Cliente deve entender o que corrigir.</td>
    </tr>
    <tr>
      <td>NFRUX-004</td>
      <td>Componentes devem ter acessibilidade básica.</td>
      <td>Labels, foco, contraste e navegação por teclado devem ser tratados.</td>
    </tr>
    <tr>
      <td>NFRUX-005</td>
      <td>Estados de loading devem ser explícitos.</td>
      <td>Ações assíncronas devem exibir carregamento ou skeleton.</td>
    </tr>
    <tr>
      <td>NFRUX-006</td>
      <td>Pix deve ter instruções claras.</td>
      <td>Cliente deve entender como pagar e que o pedido só será processado após confirmação.</td>
    </tr>
  </tbody>
</table>

### 6.7 LGPD e Privacidade

<table>
  <thead>
    <tr>
      <th style="text-align: left;">ID</th>
      <th style="text-align: left;">Requisito</th>
      <th style="text-align: left;">Critério</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>NFRLGPD-001</td>
      <td>O sistema deve coletar apenas dados necessários.</td>
      <td>Checkout deve pedir somente dados requeridos para venda e entrega.</td>
    </tr>
    <tr>
      <td>NFRLGPD-002</td>
      <td>Storefront deve publicar Política de Privacidade.</td>
      <td>Política deve estar acessível no rodapé (SF-011).</td>
    </tr>
    <tr>
      <td>NFRLGPD-003</td>
      <td>Storefront deve publicar Termos de Compra.</td>
      <td>Termos devem estar acessíveis antes ou durante checkout (SF-011, CH-011).</td>
    </tr>
    <tr>
      <td>NFRLGPD-004</td>
      <td>Cliente deve conseguir solicitar exclusão/consulta de dados.</td>
      <td>Canal e fluxo operacional definidos em Q-009; instruções acessíveis na Política de Privacidade (SF-011, NFRLGPD-002).</td>
    </tr>
    <tr>
      <td>NFRLGPD-005</td>
      <td>Dados de pagamento não devem ser armazenados localmente.</td>
      <td>Dados sensíveis de cartão não devem transitar nem ser persistidos pelo backend da loja; o Stripe atua como operador/subprocessador de pagamento.</td>
    </tr>
    <tr>
      <td>NFRLGPD-006</td>
      <td>Analytics deve respeitar privacidade.</td>
      <td>PostHog deve ser configurado sem capturar dados sensíveis desnecessários.</td>
    </tr>
    <tr>
      <td>NFRLGPD-007</td>
      <td>Sentry não deve capturar dados sensíveis indevidos.</td>
      <td>Scrubbing de dados deve ser configurado para headers, tokens, e-mails quando necessário e payloads sensíveis.</td>
    </tr>
  </tbody>
</table>

----------

## 7. Interfaces Externas

### 7.1 Stripe

#### Uso

-   Pagamento por cartão.
    
-   Pagamento por Pix.
    
-   Confirmação de pagamentos.
    
-   Webhooks.
    
-   Reembolsos.
    

#### Eventos Críticos

<table>
  <thead>
    <tr>
      <th style="text-align: left;">Evento</th>
      <th style="text-align: left;">Ação Esperada</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>payment_intent.succeeded</code></td>
      <td>Confirmar pagamento (cartão ou Pix), avançar pedido de `awaiting_payment` para `confirmed` e iniciar fulfillment.</td>
    </tr>
    <tr>
      <td><code>payment_intent.requires_action</code></td>
      <td>Pix: QR/código gerado. Pagamento em `awaiting_pix_payment`; pedido permanece em `awaiting_payment` (§8.1.1, BR-017).</td>
    </tr>
    <tr>
      <td><code>payment_intent.processing</code></td>
      <td>Pix: pagamento em processamento. Manter `awaiting_pix_payment`; não iniciar fulfillment (BR-017).</td>
    </tr>
    <tr>
      <td><code>payment_intent.payment_failed</code></td>
      <td>Registrar falha; pagamento em `failed`; pedido permanece em `awaiting_payment`; fulfillment não é disparado.</td>
    </tr>
    <tr>
      <td><code>payment_intent.canceled</code> ou evento de expiração Pix equivalente</td>
      <td>Registrar expiração/cancelamento; pagamento em `expired` ou `failed`; pedido permanece em `awaiting_payment`; permitir nova tentativa.</td>
    </tr>
    <tr>
      <td>Evento de reembolso</td>
      <td>Atualizar estado de reembolso.</td>
    </tr>
  </tbody>
</table>

#### Requisitos

-   Validar assinatura do webhook.
    
-   Garantir idempotência por ID do evento (BR-008, §10).
    
-   Registrar status e payload mínimo para auditoria.
    
-   Não armazenar dados completos de cartão.
    
-   Não iniciar fulfillment enquanto Pix estiver pendente (BR-017, §8.1.1).
    
-   Exibir ao cliente instruções adequadas de pagamento Pix.
    
-   Validar nomes exatos dos eventos Pix na documentação Stripe para contas BR antes da implementação; tratar eventos equivalentes se a nomenclatura divergir.
    

----------

### 7.2 Gelato API

#### Uso

-   Consultar catálogo de produtos.
    
-   Consultar cotação de frete.
    
-   Criar pedido de produção.
    
-   Consultar status de pedido.
    
-   Cancelar pedido quando possível.
    
-   Receber webhooks de status.
    

#### Operações Necessárias

Os endpoints abaixo são **ilustrativos** e representam operações lógicas. Paths e contratos reais devem ser validados na documentação oficial da Gelato API antes da implementação.

<table>
  <thead>
    <tr>
      <th style="text-align: left;">Operação</th>
      <th style="text-align: left;">Método Lógico</th>
      <th style="text-align: left;">Uso</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Criar pedido</td>
      <td><code>POST /orders</code></td>
      <td>Após pagamento confirmado.</td>
    </tr>
    <tr>
      <td>Cotar frete</td>
      <td><code>POST /orders/quote</code></td>
      <td>Durante checkout.</td>
    </tr>
    <tr>
      <td>Consultar pedido</td>
      <td><code>GET /orders/:id</code></td>
      <td>Debug, cancelamento e reconciliação.</td>
    </tr>
    <tr>
      <td>Cancelar pedido</td>
      <td><code>POST /orders/:id/cancel</code></td>
      <td>Antes do início da produção.</td>
    </tr>
    <tr>
      <td>Receber webhook</td>
      <td><code>POST /webhooks/gelato</code></td>
      <td>Atualização de status e tracking.</td>
    </tr>
    <tr>
      <td>Consultar produtos/templates</td>
      <td><code>GET /products...</code></td>
      <td>Mapeamento de catálogo e templates fixos.</td>
    </tr>
  </tbody>
</table>

#### Requisitos

-   Autenticação por chave de API.
    
-   Chave armazenada em variável de ambiente.
    
-   Retry com backoff para falhas temporárias.
    
-   Tratamento específico para rate limit.
    
-   Idempotência na criação de pedidos.
    
-   Persistência de `gelato_order_id`.
    
-   Logs estruturados sem expor secrets.
    
-   Alerta por e-mail em falhas persistentes (EM-009).
    

----------

### 7.3 Resend

#### Uso

-   Confirmação de pedido.
    
-   Notificação de envio.
    
-   Cancelamento.
    
-   Reembolso.
    
-   Boas-vindas.
    
-   Redefinição de senha.
    
-   Instruções de troca/logística reversa.
    
-   Alertas operacionais críticos para o admin.
    

#### Requisitos

-   Domínio remetente verificado em produção.
    
-   Templates versionados no repositório.
    
-   Falhas de envio devem ser logadas.
    
-   Eventos de e-mail devem ser reprocessáveis quando possível.
    
-   Alertas críticos devem ter assunto padronizado e contexto suficiente para ação.
    

----------

### 7.4 Supabase/PostgreSQL

#### Uso

-   Persistência de dados transacionais do Medusa.
    
-   Produtos, variantes, clientes, pedidos, pagamentos, fulfillment, trocas e metadados.
    

#### Requisitos

-   Usar connection string segura.
    
-   Usar pooling em produção.
    
-   Backups devem estar ativos.
    
-   Migrações devem ser controladas por versionamento.
    
-   Acesso direto ao banco deve ser restrito.
    

----------

### 7.5 Supabase Storage

#### Uso

-   Imagens de produto.
    
-   Thumbnails.
    
-   Galeria de produto.
    
-   Assets públicos da loja.
    
-   Eventuais arquivos de template/referência operacional.
    

#### Requisitos

-   Bucket dedicado por ambiente ou prefixo por ambiente.
    
-   Políticas de acesso definidas.
    
-   URLs consumíveis pela storefront.
    
-   Validação de tipo e tamanho de arquivo.
    
-   Não armazenar secrets ou documentos sensíveis em bucket público.
    

----------

### 7.6 Sentry

#### Uso

-   Captura de erros frontend.
    
-   Captura de erros backend.
    
-   Erros em workflows.
    
-   Erros em webhooks.
    
-   Erros em integrações externas.
    

#### Requisitos

-   Configuração por ambiente.
    
-   Release tracking.
    
-   Source maps quando aplicável.
    
-   Scrubbing de dados sensíveis.
    
-   Alertas configurados para erros críticos.
    

----------

### 7.7 PostHog

#### Uso

-   Analytics de catálogo.
    
-   Eventos de carrinho.
    
-   Eventos de checkout.
    
-   Conversão.
    
-   Abandono de funil.
    
-   Métricas de produto.
    

#### Eventos Mínimos

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 200px;">Evento</th>
      <th style="text-align: left; width: 180px;">Origem</th>
      <th style="text-align: left; width: 220px;">Quando</th>
      <th style="text-align: left;">Payload mínimo</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>product_viewed</code></td>
      <td>Storefront</td>
      <td>Cliente visualiza produto.</td>
      <td><code>product_id</code>, variante quando aplicável, origem.</td>
    </tr>
    <tr>
      <td><code>variant_selected</code></td>
      <td>Storefront</td>
      <td>Cliente seleciona variante.</td>
      <td><code>product_id</code>, <code>variant_id</code>.</td>
    </tr>
    <tr>
      <td><code>add_to_cart</code></td>
      <td>Storefront</td>
      <td>Cliente adiciona item ao carrinho.</td>
      <td><code>product_id</code>, <code>variant_id</code>, quantidade, preço.</td>
    </tr>
    <tr>
      <td><code>checkout_started</code></td>
      <td>Storefront</td>
      <td>Cliente inicia checkout.</td>
      <td><code>cart_id</code>, quantidade de itens.</td>
    </tr>
    <tr>
      <td><code>shipping_selected</code></td>
      <td>Storefront</td>
      <td>Cliente seleciona frete.</td>
      <td><code>cart_id</code>, método de envio, valor do frete.</td>
    </tr>
    <tr>
      <td><code>payment_method_selected</code></td>
      <td>Storefront</td>
      <td>Cliente seleciona cartão ou Pix.</td>
      <td><code>cart_id</code>, tipo (<code>card</code> ou <code>pix</code>).</td>
    </tr>
    <tr>
      <td><code>payment_succeeded</code></td>
      <td>Storefront</td>
      <td>Stripe confirma pagamento no cliente.</td>
      <td><code>order_id</code>, total, método de pagamento. Mede conversão de pagamento no funil.</td>
    </tr>
    <tr>
      <td><code>purchase_completed</code></td>
      <td>Backend</td>
      <td>Pedido confirmado após webhook Stripe e evento registrado duravelmente no backend/outbox local. A entrega ao PostHog é assíncrona.</td>
      <td>Identificador analítico seguro do pedido, total, método de pagamento e quantidade de itens. Evento canônico de receita.</td>
    </tr>
    <tr>
      <td><code>checkout_failed</code></td>
      <td>Storefront</td>
      <td>Erro relevante ocorre no checkout.</td>
      <td><code>cart_id</code>, etapa, código/motivo do erro.</td>
    </tr>
    <tr>
      <td><code>tracking_viewed</code></td>
      <td>Storefront</td>
      <td>Cliente acessa página de tracking.</td>
      <td><code>order_id</code> (interno/anônimo), origem do acesso.</td>
    </tr>
  </tbody>
</table>

> **Nota:** `purchase_completed` é o evento canônico de receita/conversão. Ele deve ser registrado de forma durável no backend antes do fulfillment Gelato. A chamada ao PostHog deve ser processada por fila/outbox com retry; indisponibilidade do PostHog não deve impedir produção de pedido pago.

----------

### 7.8 Correios — Logística Reversa

#### Uso

-   Geração ou registro de autorização de postagem.
    
-   Troca/devolução operacional.
    
-   Controle de custo de frete por regra de negócio.
    

#### Requisitos

-   Primeira troca da compra: frete pago pela empresa (BR-019).
    
-   Troca adicional da mesma compra: frete pago pelo cliente (BR-020).
    
-   Cliente deve receber instruções por e-mail (EM-010).
    
-   Admin deve conseguir registrar código, prazo e status.
    
-   Integração pode iniciar manual/semiautomática no MVP, desde que o histórico fique registrado (Q-005).
    

----------

### 7.9 Vercel

#### Uso

-   Hospedagem da storefront.
    
-   Deploy automático por branch.
    
-   Variáveis de ambiente do frontend.
    

#### Requisitos

-   Domínio configurado quando definido.
    
-   Variáveis públicas e privadas separadas.
    
-   Build deve falhar em erro de TypeScript.
    
-   Preview deployments devem ser usados para validação.
    

----------

### 7.10 VPS Linux

#### Uso

-   Hospedagem do backend Medusa.
    
-   Redis.
    
-   Worker.
    
-   Reverse proxy.
    
-   Certificado SSL.
    

#### Requisitos

-   Node.js em versão compatível.
    
-   Redis ativo e monitorado.
    
-   PM2 ou equivalente configurado.
    
-   Nginx ou equivalente com HTTPS.
    
-   Certificado TLS válido.
    
-   Logs persistidos.
    
-   Deploy reproduzível.
    
-   Health check disponível.
    

----------

## 8. Estados do Sistema

### 8.1 Estados de Pagamento

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 200px;">Estado</th>
      <th style="text-align: left;">Descrição</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>pending</code></td>
      <td>Pagamento iniciado, ainda não confirmado.</td>
    </tr>
    <tr>
      <td><code>awaiting_pix_payment</code></td>
      <td>Pix gerado e aguardando pagamento.</td>
    </tr>
    <tr>
      <td><code>authorized</code></td>
      <td>Pagamento autorizado, se aplicável. Reservado para fluxo de captura em duas etapas; não utilizado no MVP se o Stripe capturar imediatamente.</td>
    </tr>
    <tr>
      <td><code>captured</code></td>
      <td>Pagamento confirmado/capturado.</td>
    </tr>
    <tr>
      <td><code>failed</code></td>
      <td>Pagamento falhou.</td>
    </tr>
    <tr>
      <td><code>expired</code></td>
      <td>Pagamento expirou, aplicável especialmente a Pix.</td>
    </tr>
    <tr>
      <td><code>refunded</code></td>
      <td>Pagamento totalmente reembolsado.</td>
    </tr>
    <tr>
      <td><code>partially_refunded</code></td>
      <td>Pagamento parcialmente reembolsado.</td>
    </tr>
  </tbody>
</table>

#### 8.1.1 Mapeamento de Status de Pagamento

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 200px;">Código (§8.1)</th>
      <th style="text-align: left; width: 180px;">Rótulo Admin</th>
      <th style="text-align: left; width: 200px;">Estado do Pedido (§8.2)</th>
      <th style="text-align: left;">Observação</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>pending</code></td>
      <td>Pendente</td>
      <td><code>awaiting_payment</code></td>
      <td>Cartão: pagamento iniciado, aguardando confirmação.</td>
    </tr>
    <tr>
      <td><code>awaiting_pix_payment</code></td>
      <td>Aguardando Pix</td>
      <td><code>awaiting_payment</code></td>
      <td>Pix gerado; pedido permanece aguardando pagamento (BR-017).</td>
    </tr>
    <tr>
      <td><code>authorized</code></td>
      <td>Autorizado</td>
      <td><code>awaiting_payment</code></td>
      <td>Aplicável se o fluxo de cartão usar autorização separada; não esperado no MVP com captura imediata.</td>
    </tr>
    <tr>
      <td><code>captured</code></td>
      <td>Pago</td>
      <td><code>confirmed</code></td>
      <td>Pagamento confirmado; pedido avança para fulfillment.</td>
    </tr>
    <tr>
      <td><code>failed</code></td>
      <td>Falhou</td>
      <td><code>awaiting_payment</code></td>
      <td>Cliente pode tentar novamente.</td>
    </tr>
    <tr>
      <td><code>expired</code></td>
      <td>Expirado</td>
      <td><code>awaiting_payment</code></td>
      <td>Aplicável a Pix expirado; cliente pode gerar novo pagamento.</td>
    </tr>
    <tr>
      <td><code>refunded</code></td>
      <td>Reembolsado</td>
      <td><code>canceled</code></td>
      <td>Reembolso total confirmado via Stripe.</td>
    </tr>
    <tr>
      <td><code>partially_refunded</code></td>
      <td>Parcialmente reembolsado</td>
      <td><code>confirmed</code> ou <code>completed</code></td>
      <td>Depende do estado do pedido no momento do reembolso parcial.</td>
    </tr>
  </tbody>
</table>

### 8.2 Estados de Pedido

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 200px;">Estado</th>
      <th style="text-align: left;">Descrição</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>awaiting_payment</code></td>
      <td>Pedido criado no checkout, aguardando confirmação de pagamento. Estado inicial padrão do MVP.</td>
    </tr>
    <tr>
      <td><code>confirmed</code></td>
      <td>Pedido confirmado após pagamento capturado.</td>
    </tr>
    <tr>
      <td><code>in_fulfillment</code></td>
      <td>Pedido em processo de produção/envio.</td>
    </tr>
    <tr>
      <td><code>completed</code></td>
      <td>Ciclo operacional encerrado: produto despachado (`shipped`) ou entregue (`delivered`), conforme §8.2.1. No MVP, pode significar despacho confirmado mesmo sem evento de entrega da Gelato.</td>
    </tr>
    <tr>
      <td><code>canceled</code></td>
      <td>Pedido cancelado.</td>
    </tr>
    <tr>
      <td><code>requires_attention</code></td>
      <td>Pedido exige intervenção do admin.</td>
    </tr>
  </tbody>
</table>

#### 8.2.1 Transições de Status de Pedido

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 220px;">Gatilho</th>
      <th style="text-align: left; width: 180px;">De</th>
      <th style="text-align: left; width: 180px;">Para</th>
      <th style="text-align: left;">Observação</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Checkout concluído, pedido criado</td>
      <td>—</td>
      <td><code>awaiting_payment</code></td>
      <td>Estado inicial conforme OR-001.</td>
    </tr>
    <tr>
      <td>Webhook Stripe confirma pagamento</td>
      <td><code>awaiting_payment</code></td>
      <td><code>confirmed</code></td>
      <td>Conforme BR-001.</td>
    </tr>
    <tr>
      <td>Workflow de fulfillment enfileirado</td>
      <td><code>confirmed</code></td>
      <td><code>in_fulfillment</code></td>
      <td>Ao iniciar criação do pedido Gelato.</td>
    </tr>
    <tr>
      <td>Fulfillment concluído (<code>delivered</code> ou <code>shipped</code> se entrega indisponível)</td>
      <td><code>in_fulfillment</code></td>
      <td><code>completed</code></td>
      <td>Preferir <code>delivered</code> quando evento Gelato estiver disponível. Se apenas <code>shipped</code> estiver disponível, o pedido pode ir para <code>completed</code> mesmo com produto em trânsito — o fulfillment permanece <code>shipped</code> até evento de entrega, se houver.</td>
    </tr>
    <tr>
      <td>Cancelamento confirmado</td>
      <td><code>awaiting_payment</code>, <code>confirmed</code> ou <code>in_fulfillment</code></td>
      <td><code>canceled</code></td>
      <td>Respeita regras de cancelamento Gelato (BR-009).</td>
    </tr>
    <tr>
      <td>Falha de validação ou bloqueio irrecuperável antes/durante início de fulfillment</td>
      <td><code>confirmed</code></td>
      <td><code>requires_attention</code></td>
      <td>Ex.: metadados Gelato inválidos (GL-003).</td>
    </tr>
    <tr>
      <td>Fulfillment falhou de forma irrecuperável</td>
      <td><code>in_fulfillment</code></td>
      <td><code>requires_attention</code></td>
      <td>Admin deve intervir ou reprocessar (GL-015).</td>
    </tr>
  </tbody>
</table>

### 8.3 Estados de Fulfillment

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 200px;">Estado</th>
      <th style="text-align: left;">Descrição</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>not_started</code></td>
      <td>Fulfillment ainda não iniciado.</td>
    </tr>
    <tr>
      <td><code>pending</code></td>
      <td>Fulfillment pendente.</td>
    </tr>
    <tr>
      <td><code>submitted_to_gelato</code></td>
      <td>Pedido enviado à Gelato.</td>
    </tr>
    <tr>
      <td><code>created</code></td>
      <td>Gelato criou o pedido.</td>
    </tr>
    <tr>
      <td><code>in_production</code></td>
      <td>Produto em produção.</td>
    </tr>
    <tr>
      <td><code>packed</code></td>
      <td>Produto embalado.</td>
    </tr>
    <tr>
      <td><code>shipped</code></td>
      <td>Produto enviado.</td>
    </tr>
    <tr>
      <td><code>delivered</code></td>
      <td>Produto entregue, se evento disponível.</td>
    </tr>
    <tr>
      <td><code>failed</code></td>
      <td>Falha no fulfillment.</td>
    </tr>
    <tr>
      <td><code>canceled</code></td>
      <td>Fulfillment cancelado.</td>
    </tr>
  </tbody>
</table>

#### 8.3.1 Mapeamento Gelato → Estados Internos

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 220px;">Gatilho / Status Gelato</th>
      <th style="text-align: left; width: 200px;">Estado Interno</th>
      <th style="text-align: left;">Observação</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Pagamento confirmado; fulfillment ainda não enfileirado</td>
      <td><code>not_started</code></td>
      <td>Estado inicial após confirmação do pedido.</td>
    </tr>
    <tr>
      <td>Workflow de fulfillment enfileirado</td>
      <td><code>pending</code></td>
      <td>Aguardando criação do pedido na Gelato.</td>
    </tr>
    <tr>
      <td>Requisição enviada à Gelato API</td>
      <td><code>submitted_to_gelato</code></td>
      <td>Antes da confirmação assíncrona da Gelato.</td>
    </tr>
    <tr>
      <td>Gelato confirma criação do pedido</td>
      <td><code>created</code></td>
      <td><code>gelato_order_id</code> persistido.</td>
    </tr>
    <tr>
      <td>Gelato reporta produção iniciada</td>
      <td><code>in_production</code></td>
      <td>Produção em andamento.</td>
    </tr>
    <tr>
      <td>Gelato reporta produto embalado</td>
      <td><code>packed</code></td>
      <td>Pronto para despacho.</td>
    </tr>
    <tr>
      <td>Gelato reporta envio / tracking disponível</td>
      <td><code>shipped</code></td>
      <td>Registrar <code>tracking_number</code> e <code>tracking_url</code>.</td>
    </tr>
    <tr>
      <td>Gelato reporta entrega</td>
      <td><code>delivered</code></td>
      <td>Aplicável somente se evento estiver disponível.</td>
    </tr>
    <tr>
      <td>Erro irrecuperável ou esgotamento de retries</td>
      <td><code>failed</code></td>
      <td>Pedido pode ir para <code>requires_attention</code>.</td>
    </tr>
    <tr>
      <td>Cancelamento confirmado na Gelato</td>
      <td><code>canceled</code></td>
      <td>Antes ou durante produção, conforme regra da Gelato.</td>
    </tr>
  </tbody>
</table>

----------

### 8.4 Estados de Troca

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 200px;">Estado</th>
      <th style="text-align: left;">Descrição</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>requested</code></td>
      <td>Cliente solicitou troca; aguardando análise do admin.</td>
    </tr>
    <tr>
      <td><code>approved</code></td>
      <td>Troca aprovada pelo admin.</td>
    </tr>
    <tr>
      <td><code>awaiting_posting</code></td>
      <td>Cliente recebeu instruções e deve postar o produto.</td>
    </tr>
    <tr>
      <td><code>posted</code></td>
      <td>Produto postado nos Correios.</td>
    </tr>
    <tr>
      <td><code>received</code></td>
      <td>Produto recebido pela empresa ou ponto definido.</td>
    </tr>
    <tr>
      <td><code>completed</code></td>
      <td>Troca concluída.</td>
    </tr>
    <tr>
      <td><code>rejected</code></td>
      <td>Troca recusada.</td>
    </tr>
    <tr>
      <td><code>canceled</code></td>
      <td>Solicitação de troca cancelada.</td>
    </tr>
  </tbody>
</table>

----------

## 9. Regras de Negócio

Regras canônicas de negócio. Requisitos funcionais e não funcionais devem referenciá-las quando aplicável; as referências cruzadas nesta tabela apontam para os RFs/NFRs correspondentes.

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 120px;">ID</th>
      <th style="text-align: left;">Regra</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>BR-001</strong></td>
      <td>O pedido só pode ser enviado à Gelato após pagamento confirmado, pedido confirmado e `purchase_completed` registrado de forma durável no backend/outbox local. A entrega desse evento ao PostHog é assíncrona e falha temporária do PostHog não bloqueia Gelato.</td>
    </tr>
    <tr>
      <td><strong>BR-002</strong></td>
      <td>O cliente deve poder comprar sem criar conta (CH-001, AC-007).</td>
    </tr>
    <tr>
      <td><strong>BR-003</strong></td>
      <td>O preço final deve ser exibido em BRL antes do pagamento (CA-006, CH-008, SF-002).</td>
    </tr>
    <tr>
      <td><strong>BR-004</strong></td>
      <td>Frete deve ser calculado antes da confirmação do pagamento (CH-005, CH-006).</td>
    </tr>
    <tr>
      <td><strong>BR-005</strong></td>
      <td>Produtos despublicados não devem aparecer na storefront (AD-004, SF-002).</td>
    </tr>
    <tr>
      <td><strong>BR-006</strong></td>
      <td>Variantes sem mapeamento Gelato não devem ser vendáveis.</td>
    </tr>
    <tr>
      <td><strong>BR-007</strong></td>
      <td>Um pedido Medusa não pode gerar mais de um pedido Gelato ativo, salvo reprocessamento manual controlado.</td>
    </tr>
    <tr>
      <td><strong>BR-008</strong></td>
      <td>Webhook duplicado não pode duplicar e-mail, fulfillment ou tracking.</td>
    </tr>
    <tr>
      <td><strong>BR-009</strong></td>
      <td>Cancelamento deve ser bloqueado se a Gelato já tiver iniciado produção.</td>
    </tr>
    <tr>
      <td><strong>BR-010</strong></td>
      <td>Reembolso não deve ser assumido automaticamente sem confirmação do provedor de pagamento (§4.5, PG-009).</td>
    </tr>
    <tr>
      <td><strong>BR-011</strong></td>
      <td>Tracking deve ser enviado ao cliente assim que estiver disponível (EM-002, GL-008).</td>
    </tr>
    <tr>
      <td><strong>BR-012</strong></td>
      <td>Falha no e-mail não deve cancelar pedido pago (EM-008).</td>
    </tr>
    <tr>
      <td><strong>BR-013</strong></td>
      <td>Falha no fulfillment deve exigir intervenção ou reprocessamento (GL-015), não exclusão do pedido.</td>
    </tr>
    <tr>
      <td><strong>BR-014</strong></td>
      <td>O admin deve conseguir identificar pedidos que precisam de atenção (AD-015).</td>
    </tr>
    <tr>
      <td><strong>BR-015</strong></td>
      <td>O MVP deve vender apenas para endereços no Brasil.</td>
    </tr>
    <tr>
      <td><strong>BR-016</strong></td>
      <td>O MVP deve operar apenas em BRL (AD-010, §2.4).</td>
    </tr>
    <tr>
      <td><strong>BR-017</strong></td>
      <td>Pix pendente não deve iniciar produção.</td>
    </tr>
    <tr>
      <td><strong>BR-018</strong></td>
      <td>Templates Gelato devem estar configurados antes da publicação de variantes.</td>
    </tr>
    <tr>
      <td><strong>BR-019</strong></td>
      <td>A primeira troca de uma compra terá frete pago pela empresa.</td>
    </tr>
    <tr>
      <td><strong>BR-020</strong></td>
      <td>Trocas adicionais da mesma compra terão frete pago pelo cliente.</td>
    </tr>
    <tr>
      <td><strong>BR-021</strong></td>
      <td>Alertas críticos devem ser enviados por e-mail ao admin conforme EM-009.</td>
    </tr>
    <tr>
      <td><strong>BR-022</strong></td>
      <td>Tracking anônimo e autenticado conforme OR-012 e AC-005.</td>
    </tr>
    <tr>
      <td><strong>BR-023</strong></td>
      <td>Solicitação de troca pelo cliente no MVP ocorre via canal definido em RT-009; registro formal da troca é criado pelo admin (RT-001).</td>
    </tr>
  </tbody>
</table>

----------

## 10. Webhooks e Idempotência

### 10.1 Webhook Stripe

Requisitos de contrato e eventos conforme **§7.1**; comportamento interno abaixo.

#### Requisitos

-   Validar assinatura.
    
-   Persistir ID do evento processado.
    
-   Rejeitar evento duplicado ou ignorar sem efeitos colaterais (BR-008).
    
-   Processar apenas eventos relevantes.
    
-   Retornar HTTP 2xx apenas quando processamento mínimo seguro for concluído.
    
-   Diferenciar estados de cartão e Pix.
    
-   Não iniciar fulfillment em pagamento Pix pendente (BR-017).
    

#### Efeitos Permitidos

-   Atualizar status do pagamento.
    
-   Confirmar pedido.
    
-   Iniciar workflow de fulfillment.
    
-   Atualizar reembolso.
    
-   Registrar expiração ou falha de Pix.
    
-   Registrar eventos analíticos server-side em outbox local quando aplicável.
    
-   Enfileirar entrega assíncrona ao PostHog com retry, sem bloquear fulfillment por falha temporária do provedor.
    

----------

### 10.2 Webhook Gelato

Requisitos de contrato e operações conforme **§7.2**; comportamento interno abaixo.

#### Requisitos

-   Validar autenticidade.
    
-   Persistir ID ou assinatura do evento quando disponível.
    
-   Localizar fulfillment pelo identificador Gelato.
    
-   Ignorar evento duplicado.
    
-   Não retroceder status sem regra explícita.
    
-   Registrar payload mínimo para auditoria.
    
-   Reportar falhas ao Sentry.
    
-   Enviar alerta por e-mail em falhas persistentes (EM-009).
    

#### Efeitos Permitidos

-   Atualizar status do fulfillment conforme §8.3.1.
    
-   Registrar tracking.
    
-   Emitir evento de e-mail de envio.
    
-   Marcar pedido como exigindo atenção em caso de erro.
    

----------

### 10.3 Idempotency Keys

O sistema deve usar chaves de idempotência para operações críticas:

<table>
  <thead>
    <tr>
      <th style="text-align: left;">Operação</th>
      <th style="text-align: left;">Chave Recomendada</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Criar pedido Gelato</td>
      <td><code>medusa_order_id</code></td>
    </tr>
    <tr>
      <td>Enviar e-mail de confirmação</td>
      <td><code>order_id + email_type</code></td>
    </tr>
    <tr>
      <td>Enviar alerta operacional</td>
      <td><code>alert_type + entity_id + date_bucket</code></td>
    </tr>
    <tr>
      <td>Processar webhook Stripe</td>
      <td><code>stripe_event_id</code></td>
    </tr>
    <tr>
      <td>Processar webhook Gelato</td>
      <td><code>gelato_event_id</code> ou hash do payload</td>
    </tr>
    <tr>
      <td>Reembolso</td>
      <td><code>order_id + refund_id</code></td>
    </tr>
    <tr>
      <td>Criar/atualizar registro de troca (RT-001)</td>
      <td><code>order_id + exchange_id</code> ou <code>order_id + exchange_number</code></td>
    </tr>
  </tbody>
</table>

----------

## 11. Observabilidade

### 11.1 Logs Obrigatórios

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 220px;">Evento</th>
      <th style="text-align: left;">Dados Mínimos</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Criação de carrinho</td>
      <td><code>cart_id, session_id</code></td>
    </tr>
    <tr>
      <td>Início de checkout</td>
      <td><code>cart_id, email, region</code></td>
    </tr>
    <tr>
      <td>Seleção de método de pagamento</td>
      <td><code>cart_id, payment_method_type</code></td>
    </tr>
    <tr>
      <td>Criação de pagamento</td>
      <td><code>cart_id, payment_intent_id, payment_method_type</code></td>
    </tr>
    <tr>
      <td>Webhook Stripe</td>
      <td><code>event_id, type, status</code></td>
    </tr>
    <tr>
      <td>Pedido criado no checkout</td>
      <td><code>order_id, display_id, status, total</code></td>
    </tr>
    <tr>
      <td>Pedido confirmado</td>
      <td><code>order_id, display_id, payment_status</code></td>
    </tr>
    <tr>
      <td>Fulfillment iniciado</td>
      <td><code>order_id, fulfillment_id</code></td>
    </tr>
    <tr>
      <td>Chamada Gelato</td>
      <td><code>order_id, operation, status_code, latency_ms</code></td>
    </tr>
    <tr>
      <td>Webhook Gelato</td>
      <td><code>event_id, gelato_order_id, status</code></td>
    </tr>
    <tr>
      <td>E-mail enviado</td>
      <td><code>order_id, template, recipient, status</code></td>
    </tr>
    <tr>
      <td>Alerta operacional enviado</td>
      <td><code>alert_type, severity, recipient, entity_id</code></td>
    </tr>
    <tr>
      <td>Upload de imagem</td>
      <td><code>product_id, bucket, path, size</code></td>
    </tr>
    <tr>
      <td>Solicitação de troca</td>
      <td><code>order_id, exchange_id, shipping_cost_owner</code></td>
    </tr>
    <tr>
      <td>Erro crítico</td>
      <td><code>error_code, message, correlation_id, sentry_event_id</code></td>
    </tr>
  </tbody>
</table>

### 11.2 Métricas Recomendadas

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 250px;">Métrica</th>
      <th style="text-align: left; width: 150px;">Ferramenta</th>
      <th style="text-align: left;">Objetivo</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Taxa de conversão</td>
      <td>PostHog</td>
      <td>Medir eficiência comercial.</td>
    </tr>
    <tr>
      <td>Abandono de carrinho</td>
      <td>PostHog</td>
      <td>Detectar fricção.</td>
    </tr>
    <tr>
      <td>Abandono de checkout</td>
      <td>PostHog</td>
      <td>Detectar problema no fluxo.</td>
    </tr>
    <tr>
      <td>Conversão por método de pagamento</td>
      <td>PostHog</td>
      <td>Comparar cartão vs Pix.</td>
    </tr>
    <tr>
      <td>Tempo médio de pagamento Pix</td>
      <td>PostHog / Backend</td>
      <td>Medir latência de confirmação.</td>
    </tr>
    <tr>
      <td>Tempo de checkout</td>
      <td>PostHog</td>
      <td>Medir usabilidade.</td>
    </tr>
    <tr>
      <td>Pedidos com fulfillment falho</td>
      <td>Backend / Sentry</td>
      <td>Medir estabilidade Gelato.</td>
    </tr>
    <tr>
      <td>Tempo pedido → produção</td>
      <td>Backend</td>
      <td>Medir latência operacional.</td>
    </tr>
    <tr>
      <td>Tempo pedido → envio</td>
      <td>Backend</td>
      <td>Medir performance logística.</td>
    </tr>
    <tr>
      <td>Falhas de webhook</td>
      <td>Sentry / Logs</td>
      <td>Medir confiabilidade de integrações.</td>
    </tr>
    <tr>
      <td>Falhas de e-mail</td>
      <td>Logs / Sentry</td>
      <td>Medir comunicação transacional.</td>
    </tr>
    <tr>
      <td>Erros 5xx backend</td>
      <td>Sentry</td>
      <td>Medir saúde da API.</td>
    </tr>
    <tr>
      <td>Solicitações de troca por pedido</td>
      <td>Backend / PostHog</td>
      <td>Medir qualidade/ajuste dos produtos.</td>
    </tr>
  </tbody>
</table>

### 11.3 Alertas Mínimos

<table>
  <thead>
    <tr>
      <th style="text-align: left;">Alerta</th>
      <th style="text-align: left; width: 100px;">Canal</th>
      <th style="text-align: left; width: 120px;">Severidade</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Backend indisponível</td>
      <td>E-mail</td>
      <td>Crítica</td>
    </tr>
    <tr>
      <td>Redis indisponível</td>
      <td>E-mail</td>
      <td>Crítica</td>
    </tr>
    <tr>
      <td>Pedido pago sem fulfillment criado</td>
      <td>E-mail</td>
      <td>Crítica</td>
    </tr>
    <tr>
      <td>Falha recorrente na Gelato API</td>
      <td>E-mail</td>
      <td>Alta</td>
    </tr>
    <tr>
      <td>Falha recorrente no Stripe webhook</td>
      <td>E-mail</td>
      <td>Alta</td>
    </tr>
    <tr>
      <td>Falha recorrente no envio de e-mails transacionais</td>
      <td>E-mail</td>
      <td>Média</td>
    </tr>
    <tr>
      <td>Pool de conexões próximo do limite</td>
      <td>E-mail</td>
      <td>Média</td>
    </tr>
    <tr>
      <td>Uso elevado de CPU/memória na VPS</td>
      <td>E-mail</td>
      <td>Média</td>
    </tr>
    <tr>
      <td>Erro crítico capturado no Sentry</td>
      <td>E-mail / Sentry</td>
      <td>Alta</td>
    </tr>
    <tr>
      <td>Falha de upload no Supabase Storage</td>
      <td>E-mail / Sentry</td>
      <td>Média</td>
    </tr>
  </tbody>
</table>

----------

## 12. Testes

### 12.1 Testes Unitários

Complementa **§12.2** (integração) e **§12.3** (E2E). Devem cobrir:

-   Montagem de payload Gelato.
    
-   Validação de metadados obrigatórios.
    
-   Mapeamento de status Gelato para status interno (conforme §8.3.1).
    
-   Tratamento de erros Gelato.
    
-   Idempotência de webhooks.
    
-   Checkout autenticado com endereço salvo (CH-013, AC-006).
    
-   Reprocessamento manual de fulfillment Gelato (GL-015, AD-016).
    
-   Geração e validação de token de tracking (OR-012).
    
-   Fluxo de Pix pendente, confirmado, expirado e falho.
    
-   Atualização de status de reembolso somente após webhook Stripe (BR-010, PG-009).
    
-   Cálculo de totais quando houver descontos/frete.
    
-   Regras de frete de troca.
    
-   Helpers de formatação e validação.
    
-   Upload/path de imagens no Supabase Storage.
    

----------

### 12.2 Testes de Integração

Complementa **§12.1** (unitário) e antecede **§12.3** (E2E). Devem cobrir:

-   Criação de carrinho.
    
-   Adição de item ao carrinho.
    
-   Checkout com endereço brasileiro.
    
-   Checkout autenticado com endereço salvo (CH-013, AC-006).
    
-   Cotação de frete.
    
-   Criação de pagamento cartão em modo teste.
    
-   Criação de pagamento Pix em modo teste.
    
-   Webhook Stripe para cartão aprovado.
    
-   Webhook Stripe para Pix confirmado.
    
-   Webhook Stripe para Pix expirado.
    
-   Criação de pedido Medusa no checkout em `awaiting_payment`.
    
-   Confirmação de pedido Medusa após webhook Stripe.
    
-   Criação de pedido Gelato em ambiente teste/sandbox.
    
-   Webhook Gelato.
    
-   Recuperação de senha com e-mail (AC-004, EM-006).
    
-   Upload de imagem no Supabase Storage.
    
-   Envio de e-mail via Resend.
    
-   Envio de e-mail de reembolso após confirmação Stripe (EM-004, PG-009, BR-010).
    
-   Envio de alerta operacional por e-mail.
    
-   Reprocessamento manual de fulfillment Gelato falho.
    
-   Captura de erro no Sentry.
    
-   Registro de evento no PostHog.
    

----------

### 12.3 Testes End-to-End

Fluxo mínimo obrigatório — Cartão:

```text
Produto publicado
→ Cliente adiciona ao carrinho
→ Cliente faz checkout como convidado
→ Cliente informa endereço no Brasil
→ Cliente seleciona frete
→ Pedido é criado no Medusa em `awaiting_payment`
→ Cliente paga com cartão
→ Pedido é confirmado após webhook Stripe
→ Fulfillment Gelato é criado
→ E-mail de confirmação é enviado
→ Webhook de envio é processado
→ E-mail de tracking é enviado
→ Página de tracking exibe status

```

Fluxo mínimo obrigatório — Pix:

```text
Produto publicado
→ Cliente adiciona ao carrinho
→ Cliente faz checkout como convidado
→ Cliente informa endereço no Brasil
→ Cliente seleciona frete
→ Pedido é criado no Medusa em `awaiting_payment`
→ Cliente escolhe Pix
→ Pix é gerado
→ Pedido permanece em `awaiting_payment`
→ Pagamento Pix é confirmado por webhook
→ Pedido é confirmado no Medusa
→ Fulfillment Gelato é criado
→ E-mail de confirmação é enviado
→ Webhook de envio é processado
→ E-mail de tracking é enviado
→ Página de tracking exibe status

```

Fluxo mínimo de troca:

```text
Pedido entregue
→ Cliente solicita troca via canal RT-009 (e-mail ou formulário)
→ Admin cria registro de troca (RT-001) com status `requested`
→ Admin aprova primeira troca (`approved`)
→ Sistema marca frete como pago pela empresa (BR-019)
→ Admin registra autorização dos Correios (RT-004)
→ Cliente recebe e-mail com instruções (EM-010)
→ Histórico da troca fica visível no pedido

```

----------

### 12.4 Smoke Tests de Produção

Antes do go-live:

-   Storefront carrega no domínio final ou domínio temporário aprovado.
    
-   Backend responde health check.
    
-   Admin abre no subdomínio próprio com autenticação.
    
-   Produto publicado aparece na loja.
    
-   Imagens carregam a partir do Supabase Storage.
    
-   Pedido real de baixo valor por cartão é concluído.
    
-   Pedido real de baixo valor por Pix é validado, se operacionalmente possível.
    
-   Stripe confirma pagamento live.
    
-   Gelato recebe pedido.
    
-   E-mail de confirmação chega.
    
-   Tracking funciona quando disponível.
    
-   Sentry captura erro de teste controlado.
    
-   Backend registra duravelmente `purchase_completed` e PostHog recebe eventos mínimos quando a entrega assíncrona estiver operacional.
    
-   Alerta operacional de teste chega por e-mail.
    
-   Logs não exibem secrets.
    
-   SSL está válido.
    

----------

## 13. Deploy e Operação

### 13.1 Frontend

Requisitos conforme **§7.9 (Vercel)**:

#### Requisitos

-   Deploy na Vercel.
    
-   Build com TypeScript.
    
-   Variáveis de ambiente configuradas.
    
-   Domínio configurado quando definido.
    
-   Preview deployments por branch/PR.
    
-   Estratégia de cache definida por tipo de página.
    
-   Sentry frontend configurado.
    
-   PostHog configurado.
    

----------

### 13.2 Backend

Requisitos conforme **§7.10 (VPS Linux)**:

#### Requisitos

-   VPS Linux configurada.
    
-   Node.js compatível.
    
-   Redis instalado e ativo.
    
-   Backend Medusa rodando como processo gerenciado.
    
-   Worker rodando separadamente quando aplicável.
    
-   Nginx ou equivalente servindo HTTPS.
    
-   API em subdomínio próprio.
    
-   Admin em subdomínio próprio.
    
-   Certificado TLS válido.
    
-   Logs persistentes.
    
-   Health check exposto.
    
-   Variáveis de ambiente definidas.
    
-   Sentry backend configurado.
    
-   Alertas por e-mail configurados.
    

----------

### 13.3 Banco

#### Requisitos

-   Projeto Supabase configurado.
    
-   Banco de produção separado de dev/staging.
    
-   Connection pooling em produção.
    
-   Backups ativos.
    
-   Migrações versionadas.
    
-   Acesso restrito.
    

----------

### 13.4 Storage

#### Requisitos

-   Bucket Supabase para imagens de produto.
    
-   Políticas de acesso configuradas.
    
-   Separação por ambiente.
    
-   Upload validado.
    
-   URLs funcionais na storefront.
    
-   Estratégia de remoção ou arquivamento de imagens órfãs.
    

----------

### 13.5 Variáveis de Ambiente

#### Backend

```env
NODE_ENV=
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
COOKIE_SECRET=
STORE_CORS=
ADMIN_CORS=
AUTH_CORS=

STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=

RESEND_API_KEY=
RESEND_FROM_EMAIL=
ADMIN_ALERT_EMAIL=

GELATO_API_KEY=
GELATO_API_BASE_URL=
GELATO_WEBHOOK_SECRET=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET_PRODUCT_IMAGES=

SENTRY_DSN=
SENTRY_ENVIRONMENT=

POSTHOG_API_KEY=
POSTHOG_HOST=

MEDUSA_BACKEND_URL=
STORE_FRONTEND_URL=
ADMIN_URL=

```

#### Frontend

```env
NEXT_PUBLIC_MEDUSA_BACKEND_URL=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STORE_URL=
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=

```

----------

## 14. Critérios de Aceite do MVP

O MVP será considerado tecnicamente aceitável quando:

-   Storefront pública estiver funcional em produção.
    
-   Admin estiver acessível em subdomínio próprio com autenticação.
    
-   Produto puder ser cadastrado no Admin.
    
-   Imagens forem salvas e carregadas via Supabase Storage.
    
-   Produto publicado aparecer na storefront.
    
-   Produto tiver preço em BRL.
    
-   Variante tiver metadados Gelato válidos (GL-002).
    
-   Produto sem template Gelato válido não puder ser publicado (GL-014, BR-018).
    
-   Script ou rotina de validação Gelato pré-go-live estiver disponível (GL-012).
    
-   Cliente puder adicionar produto ao carrinho.
    
-   Cliente puder fazer checkout como convidado (CH-001).
    
-   Cliente autenticado puder concluir checkout com pedido associado à conta (CH-013).
    
-   Endereços fora do Brasil forem rejeitados no checkout (CH-003, BR-015).
    
-   Cliente puder criar conta, fazer login, recuperar senha (AC-004, EM-006) e consultar histórico de pedidos com tracking (AC-005).
    
-   Frete puder ser calculado para endereço no Brasil antes do pagamento (CH-005, CH-006, BR-004).
    
-   Pagamento por cartão funcionar.
    
-   Pagamento por Pix funcionar ou estar validado conforme disponibilidade operacional da conta Stripe.
    
-   Pedido Pix não gerar fulfillment antes da confirmação (BR-017, PG-011).
    
-   Pedido for criado no checkout em `awaiting_payment` e confirmado após pagamento (OR-001).
    
-   Pedido for enviado automaticamente para Gelato após pagamento confirmado, pedido confirmado e `purchase_completed` registrado duravelmente (BR-001), sem depender do sucesso de entrega ao PostHog.
    
-   Status Gelato for sincronizado via webhook.
    
-   Tracking for salvo e exibido ao convidado por link com token válido e ao cliente autenticado na área do cliente (OR-012, AC-005, BR-022).
    
-   E-mails de confirmação, envio e reembolso (quando aplicável) forem entregues (EM-001, EM-002, EM-004).
    
-   Falha no envio de e-mail não cancelar pedido pago (EM-008, BR-012).
    
-   Alertas críticos operarem conforme EM-009 e §11.3.
    
-   Sentry estiver capturando erros.
    
-   PostHog estiver registrando eventos mínimos conforme AN-001 e §7.7.
    
-   Política de Privacidade, Termos de Compra e Política de Trocas estiverem publicados (SF-011, RT-008).
    
-   Canal de consulta/exclusão de dados LGPD estiver definido e publicado (NFRLGPD-004, Q-009).
    
-   Admin puder registrar e acompanhar solicitações de troca no pedido.
    
-   Regra de primeira troca com frete pago pela empresa funcionar corretamente (BR-019).
    
-   Histórico de troca ficar visível no detalhe do pedido (RT-006).
    
-   Cliente receber e-mail com instruções quando troca for aprovada (EM-010).
    
-   Cliente puder solicitar troca via canal definido em RT-009.
    
-   Admin puder filtrar pedidos em `requires_attention` (AD-015).
    
-   Admin puder reprocessar fulfillment Gelato falho (GL-015, AD-016).
    
-   Pedidos pagos com falha de validação Gelato puderem ir para `requires_attention` (§8.2.1).
    
-   Logs permitirem auditoria básica.
    
-   Webhooks forem idempotentes.
    
-   Secrets não estiverem expostos.
    
-   Smoke test ponta a ponta for concluído.
    

----------

## 15. Fora do Escopo do MVP

Os seguintes itens não fazem parte do MVP:

-   Estoque físico.
    
-   Gestão logística própria de envio inicial.
    
-   Produção própria.
    
-   Editor visual de camiseta no navegador.
    
-   Upload de arte pelo cliente.
    
-   Marketplace multi-vendedor.
    
-   Programa de afiliados.
    
-   Cashback.
    
-   App mobile nativo.
    
-   Integração com ERP.
    
-   Integração com marketplaces.
    
-   Business Intelligence avançado.
    
-   Assinaturas recorrentes.
    
-   A/B testing avançado.
    
-   Personalização dinâmica de produto pelo cliente.
    
-   Multi-fornecedor POD.
    
-   Atendimento via chat integrado.
    
-   Sistema completo de reviews.
    
-   Automação de desfechos de troca (reenvio, reembolso e orquestração Gelato) além do registro manual de status `completed` — inclui fluxo sem intervenção do admin.
    
-   Venda internacional.
    
-   Multi-moeda.
    
-   Boleto, wallets ou outros métodos além de cartão e Pix.
    

----------

## 16. Riscos Técnicos

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 80px;">ID</th>
      <th style="text-align: left; width: 220px;">Risco</th>
      <th style="text-align: left; width: 100px;">Impacto</th>
      <th style="text-align: left; width: 120px;">Probabilidade</th>
      <th style="text-align: left;">Mitigação</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>R-001</strong></td>
      <td>Integração Gelato demandar mais esforço que o previsto.</td>
      <td>Alto</td>
      <td>Alta</td>
      <td>Priorizar módulo Gelato no início do backend.</td>
    </tr>
    <tr>
      <td><strong>R-002</strong></td>
      <td>Mapeamento incorreto de variantes gerar produto errado.</td>
      <td>Alto</td>
      <td>Média</td>
      <td>Criar script de validação de metadados e testes com pedidos reais de baixo valor.</td>
    </tr>
    <tr>
      <td><strong>R-003</strong></td>
      <td>Falha temporária da Gelato impedir fulfillment.</td>
      <td>Alto</td>
      <td>Média</td>
      <td>Retry, backoff, status <code>requires_attention</code>, alerta por e-mail e reprocessamento manual.</td>
    </tr>
    <tr>
      <td><strong>R-004</strong></td>
      <td>Redis indisponível paralisar workflows.</td>
      <td>Alto</td>
      <td>Baixa/Média</td>
      <td>Monitoramento, restart automático, Sentry e alerta por e-mail.</td>
    </tr>
    <tr>
      <td><strong>R-005</strong></td>
      <td>CORS incorreto bloquear checkout em produção.</td>
      <td>Médio</td>
      <td>Média</td>
      <td>Validar staging com domínios reais antes do go-live.</td>
    </tr>
    <tr>
      <td><strong>R-006</strong></td>
      <td>Pool de conexões Supabase esgotar.</td>
      <td>Médio</td>
      <td>Baixa/Média</td>
      <td>Usar connection pooling e monitorar conexões.</td>
    </tr>
    <tr>
      <td><strong>R-007</strong></td>
      <td>Webhook duplicado gerar efeitos duplicados.</td>
      <td>Alto</td>
      <td>Média</td>
      <td>Idempotência obrigatória por evento externo.</td>
    </tr>
    <tr>
      <td><strong>R-008</strong></td>
      <td>E-mails transacionais caírem em spam.</td>
      <td>Médio</td>
      <td>Média</td>
      <td>Domínio verificado, SPF/DKIM/DMARC e templates consistentes.</td>
    </tr>
    <tr>
      <td><strong>R-009</strong></td>
      <td>Pagamento confirmado sem fulfillment criado.</td>
      <td>Alto</td>
      <td>Média</td>
      <td>Alerta para pedido pago sem <code>gelato_order_id</code>.</td>
    </tr>
    <tr>
      <td><strong>R-010</strong></td>
      <td>Cancelamento solicitado após produção iniciada.</td>
      <td>Baixo/Médio</td>
      <td>Média</td>
      <td>Bloquear cancelamento e exibir mensagem clara ao admin.</td>
    </tr>
    <tr>
      <td><strong>R-011</strong></td>
      <td>Templates das camisetas não estarem prontos.</td>
      <td>Alto</td>
      <td>Média</td>
      <td>Bloquear publicação de produto sem template válido.</td>
    </tr>
    <tr>
      <td><strong>R-012</strong></td>
      <td>Custos de frete inviabilizarem conversão.</td>
      <td>Médio</td>
      <td>Média</td>
      <td>Exibir frete antes do pagamento e revisar precificação.</td>
    </tr>
    <tr>
      <td><strong>R-013</strong></td>
      <td>Pix gerar expectativa incorreta no cliente se pagamento ficar pendente.</td>
      <td>Médio</td>
      <td>Média</td>
      <td>UI clara, status de aguardando pagamento e e-mails adequados.</td>
    </tr>
    <tr>
      <td><strong>R-014</strong></td>
      <td>Supabase Storage mal configurado expor arquivos indevidos.</td>
      <td>Médio</td>
      <td>Baixa/Média</td>
      <td>Separar buckets/policies e revisar permissões.</td>
    </tr>
    <tr>
      <td><strong>R-015</strong></td>
      <td>PostHog capturar dados pessoais em excesso.</td>
      <td>Médio</td>
      <td>Média</td>
      <td>Definir plano de eventos sem payloads sensíveis.</td>
    </tr>
    <tr>
      <td><strong>R-016</strong></td>
      <td>Sentry capturar dados sensíveis em payloads.</td>
      <td>Médio</td>
      <td>Média</td>
      <td>Configurar scrubbing antes do go-live.</td>
    </tr>
    <tr>
      <td><strong>R-017</strong></td>
      <td>Processo de troca ficar manual demais e gerar inconsistência operacional.</td>
      <td>Médio</td>
      <td>Média</td>
      <td>Registrar histórico mínimo no pedido e padronizar status.</td>
    </tr>
  </tbody>
</table>

----------

## 17. Questões em Aberto

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 80px;">ID</th>
      <th style="text-align: left; width: 350px;">Questão</th>
      <th style="text-align: left; width: 200px;">Impacto</th>
      <th style="text-align: left;">Prazo para Decidir</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Q-001</strong></td>
      <td>Qual será o domínio final da loja e a URL da storefront (<code>www.&lt;dominio&gt;.com.br</code> vs apex <code>&lt;dominio&gt;.com.br</code>)?</td>
      <td>CORS, Resend, SEO, deploy, SSL, Vercel</td>
      <td>Antes de Staging</td>
    </tr>
    <tr>
      <td><strong>Q-002</strong></td>
      <td>Qual será o prefixo exato do subdomínio do Admin? Sugestão de prefixo: <code>admin</code> (URL final: <code>admin.&lt;dominio&gt;.com.br</code>, conforme §3.2).</td>
      <td>Segurança, deploy, CORS</td>
      <td>Antes de Staging</td>
    </tr>
    <tr>
      <td><strong>Q-003</strong></td>
      <td>Qual será o prefixo exato da API? Sugestão de prefixo: <code>api</code> (URL final: <code>api.&lt;dominio&gt;.com.br</code>, conforme §3.2).</td>
      <td>Webhooks, CORS, deploy</td>
      <td>Antes de Staging</td>
    </tr>
    <tr>
      <td><strong>Q-004</strong></td>
      <td>Qual será o nome do bucket final no Supabase Storage?</td>
      <td>Storage, env vars, deploy</td>
      <td>Antes da Fase Backend</td>
    </tr>
    <tr>
      <td><strong>Q-005</strong></td>
      <td>A integração com Correios será automatizada via API desde o MVP ou registrada manualmente no Admin?</td>
      <td>Escopo de trocas</td>
      <td>Antes da implementação de RT</td>
    </tr>
    <tr>
      <td><strong>Q-006</strong></td>
      <td>Qual será o e-mail remetente transacional?</td>
      <td>Resend, reputação, domínio</td>
      <td>Antes de Go-Live</td>
    </tr>
    <tr>
      <td><strong>Q-007</strong></td>
      <td>Qual será o e-mail destinatário de alertas operacionais?</td>
      <td>Operação</td>
      <td>Antes de Staging</td>
    </tr>
    <tr>
      <td><strong>Q-008</strong></td>
      <td>Qual política detalhada de troca será publicada ao cliente?</td>
      <td>Jurídico/UX</td>
      <td>Antes de Go-Live</td>
    </tr>
    <tr>
      <td><strong>Q-009</strong></td>
      <td>Qual será o canal e o fluxo operacional para solicitação de consulta ou exclusão de dados pessoais (LGPD)?</td>
      <td>Jurídico/Operação, NFRLGPD-004</td>
      <td>Antes de Go-Live</td>
    </tr>
  </tbody>
</table>

----------

## 18. Apêndices

### Apêndice A — Exemplo de Payload Interno para Criação Gelato

```json
{
  "orderReferenceId": "order_123",
  "customerReferenceId": "customer_or_guest_email",
  "currency": "BRL",
  "items": [
    {
      "templateId": "gelato_template_id",
      "productUid": "gelato_product_uid",
      "quantity": 1,
      "metadata": {
        "medusaVariantId": "variant_123",
        "sku": "TSHIRT-BLACK-G",
        "templateMode": "fixed"
      }
    }
  ],
  "shippingAddress": {
    "firstName": "Nome",
    "lastName": "Sobrenome",
    "address1": "Rua Exemplo, 123",
    "address2": "Apto 45",
    "city": "São Paulo",
    "state": "SP",
    "postalCode": "01000-000",
    "country": "BR",
    "email": "cliente@email.com",
    "phone": "+5511999999999"
  },
  "shipmentMethodUid": "gelato_shipping_method_uid"
}

```

----------

### Apêndice B — Códigos de Erro Internos

<table>
  <thead>
    <tr>
      <th style="text-align: left; width: 280px;">Código</th>
      <th style="text-align: left; width: 250px;">Descrição</th>
      <th style="text-align: left;">Ação</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>GELATO_METADATA_MISSING</code></td>
      <td>Variante sem metadados Gelato obrigatórios.</td>
      <td>Bloquear fulfillment e alertar admin.</td>
    </tr>
    <tr>
      <td><code>GELATO_TEMPLATE_INVALID</code></td>
      <td>Template Gelato ausente ou inválido.</td>
      <td>Bloquear publicação/fulfillment.</td>
    </tr>
    <tr>
      <td><code>GELATO_QUOTE_FAILED</code></td>
      <td>Falha ao calcular frete.</td>
      <td>Exibir retry ao cliente.</td>
    </tr>
    <tr>
      <td><code>GELATO_ORDER_CREATE_FAILED</code></td>
      <td>Falha ao criar pedido Gelato.</td>
      <td>Retry, Sentry e alerta por e-mail.</td>
    </tr>
    <tr>
      <td><code>GELATO_CANCEL_NOT_ALLOWED</code></td>
      <td>Pedido não pode mais ser cancelado.</td>
      <td>Exibir erro descritivo no Admin.</td>
    </tr>
    <tr>
      <td><code>STRIPE_WEBHOOK_INVALID</code></td>
      <td>Assinatura Stripe inválida.</td>
      <td>Rejeitar requisição.</td>
    </tr>
    <tr>
      <td><code>PIX_PAYMENT_PENDING</code></td>
      <td>Pagamento Pix ainda não confirmado.</td>
      <td>Manter pedido aguardando pagamento.</td>
    </tr>
    <tr>
      <td><code>PIX_PAYMENT_EXPIRED</code></td>
      <td>Pagamento Pix expirou.</td>
      <td>Atualizar status e permitir nova tentativa.</td>
    </tr>
    <tr>
      <td><code>PAYMENT_NOT_CONFIRMED</code></td>
      <td>Tentativa de fulfillment sem pagamento confirmado.</td>
      <td>Bloquear operação.</td>
    </tr>
    <tr>
      <td><code>EMAIL_SEND_FAILED</code></td>
      <td>Falha no envio de e-mail.</td>
      <td>Logar e permitir reprocessamento.</td>
    </tr>
    <tr>
      <td><code>OPERATIONAL_ALERT_FAILED</code></td>
      <td>Falha no envio de alerta operacional.</td>
      <td>Registrar no Sentry/logs.</td>
    </tr>
    <tr>
      <td><code>ORDER_ALREADY_FULFILLED</code></td>
      <td>Tentativa duplicada de fulfillment.</td>
      <td>Ignorar ou bloquear com idempotência.</td>
    </tr>
    <tr>
      <td><code>SUPABASE_STORAGE_UPLOAD_FAILED</code></td>
      <td>Falha no upload de imagem.</td>
      <td>Exibir erro ao admin e registrar Sentry.</td>
    </tr>
    <tr>
      <td><code>EXCHANGE_POLICY_CONFLICT</code></td>
      <td>Regra de frete de troca inconsistente.</td>
      <td>Bloquear ação e exigir revisão admin.</td>
    </tr>
    <tr>
      <td><code>TRACKING_TOKEN_INVALID</code></td>
      <td>Token de tracking ausente, inválido ou expirado.</td>
      <td>Retornar erro genérico sem expor dados do pedido.</td>
    </tr>
  </tbody>
</table>

----------