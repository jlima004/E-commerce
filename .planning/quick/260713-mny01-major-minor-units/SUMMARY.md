---
quick_task: 260713-mny01-major-minor-units
status: complete
classification: PASS
completed_at: 2026-07-13
---

# Summary — Hotfix MNY-01

## Resultado

**PASS.** A causa raiz era o reuso do mesmo `amount` para valores Medusa major e Stripe/custom minor. Isso enviava `9900` à PaymentSession/Order como se fosse R$ 9.900,00, embora o PaymentIntent Stripe `9900` representasse R$ 99,00. O hotfix separa os contratos, converte de forma decimal exata e mantém o gate financeiro fail-closed.

## Manual gate

1. **Matriz final:** Medusa Product/PriceSet/Cart/Order/line items/PaymentSession = major; Stripe PaymentIntent/Refund, PaymentAttempt, RefundRequest, captured/refunded, analytics/e-mail canônicos e payload financeiro Gelato = minor.
2. **Causa raiz:** um campo genérico `amount` atravessava as duas unidades e fixtures Medusa modelavam centavos.
3. **Utilitário:** `apps/backend/src/utils/money-units.ts`, sem dependência, usa parsing decimal + `BigInt` e falha fechado.
4. **Conversões:** `99 -> 9900`, `99.9 -> 9990`; cada `49.5` vira `4950` antes de `x 2 = 9900`.
5. **PaymentSession:** recebe `99` major para um Cart de R$ 99,00.
6. **Stripe:** recebe `9900` minor via DTO interno `amount_minor`.
7. **PaymentAttempt:** persiste e expõe `amount = 9900` minor, copiado do PaymentIntent validado.
8. **Order:** preserva `total = 99` major; o guard compara seus componentes convertidos com `9900` minor.
9. **Runtime alterado:** utility monetária; eligibility; Card/Pix; Stripe real; rota Card; guard/entrypoint da Order; catálogo e mensagem Admin.
10. **Fixtures alteradas:** somente campos Medusa major em checkout, catálogo, payment initiation e Order; Stripe/PaymentAttempt/refund/downstream permaneceram minor.
11. **Focados:** utility 29/29; fronteiras principais 145/145; fixtures unitárias 69/69; entrypoint/outbox final 31/31; PaymentAttempt HTTP 33/33; bateria HTTP focada 91/91.
12. **Unit completo:** 44/44 suítes, 717/717 testes, exit 0; nenhum teste removido.
13. **Modules completo:** 28/28 suítes, 462/462 testes, PostgreSQL 16 local, exit 0.
14. **HTTP completo:** 14/14 suítes, 170/170 testes, PostgreSQL 16 local, exit 0 após correção e repetição de uma referência de mock em fixture.
15. **Lint:** exit 0, 0 erros, 208 warnings; sem aumento contra RC1-H.
16. **Build:** exit 0 e compilação final concluída com sucesso.
17. **Integridade:** sem diff em model, migration, package, manifest ou lockfile; `git diff --check` limpo.
18. **Correção manual do catálogo em produção:** seguir o plano abaixo; este gate não alterou dados.
19. **Commits:** `47e76d5` (runtime/testes focados), `db89573` (integrações/fixtures) e um terceiro commit documental `docs(payments): record monetary unit hotfix`.
20. **Divergência:** antes do commit documental, `origin/main...HEAD = 0 2`; a contagem final será reportada após o terceiro commit.
21. **Infra:** APP_VERSION, Redis, Event Bus, locking, Heroku e providers de produção não foram tocados.
22. **Não ações:** nenhum push, deploy, rollback, tag, produção/Supabase, provider externo, dado real, PaymentIntent/refund/webhook real ou Phase 12.

## Plano manual separado para dados existentes

1. Identificar as variantes cujo preço comercial pretendido era R$ 99,00.
2. No Admin Medusa, alterar somente o preço da variante de `9900` para `99`.
3. Não alterar PaymentAttempt `9900`, Stripe PaymentIntent `9900` nem RefundRequest `100`.
4. Descartar ou não reutilizar carts criados com preço Medusa `9900`.
5. Criar cart novo depois da correção manual do catálogo.
6. Aceitar que Orders históricas de smoke continuam exibindo R$ 9.900,00.
7. Não reescrever Orders históricas automaticamente.
8. Decidir em gate separado se essas Orders de smoke serão excluídas ou preservadas.

Essa correção de catálogo em produção exige aprovação e execução manual próprias; nenhuma heurística por faixa de valor foi introduzida.
