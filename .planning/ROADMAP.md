# Roadmap: Milestone v1.1 â€” Backend Storefront Readiness

## Overview

Este milestone backend-only fecha as dependÃªncias que impedem o Frontend Milestone 1 de comeÃ§ar. Ele preserva integralmente o backend v1.0 e materializa, em ordem linear, superfÃ­cie Store autorizada, autenticaÃ§Ã£o, capability/concorrÃªncia de carrinho, merge, checkout BR/privacidade, frete Gelato, PaymentAttempt endurecido, confirmaÃ§Ã£o assÃ­ncrona, confirmaÃ§Ã£o de pedido/catÃ¡logo e kit contratual verificÃ¡vel.

**Core invariant:** `Order` continua existindo somente apÃ³s confirmaÃ§Ã£o confiÃ¡vel do pagamento pelo webhook Stripe canÃ´nico; nenhuma operaÃ§Ã£o Store, BFF ou browser pode criÃ¡-lo diretamente.

## Milestone v1.1: Backend Storefront Readiness

**Status:** OPEN â€” **4/10 phases closed**, **34/91 requirements complete**.

## GovernanÃ§a

- `mode = interactive`
- `workflow.auto_advance = false`
- `workflow._auto_chain_active = false`
- `parallelization = false`
- sequÃªncia obrigatÃ³ria: `13 â†’ 14 â†’ 15 â†’ 16 â†’ 17 â†’ 18 â†’ 19 â†’ 20 â†’ 21 â†’ 22`
- cada gate CONTEXT, RESEARCH, PLAN, SPEC/SDD, IMPLEMENTATION PROMPT, EXECUTION, VERIFICATION, REVIEW e CLOSURE permanece sujeito Ã  revisÃ£o humana aplicÃ¡vel
- Phase 13 estÃ¡ **CLOSED â€” HUMAN APPROVED**, FND-01..FND-08 COMPLETE
- Phase 14 estÃ¡ **CLOSED â€” HUMAN APPROVED**, AUTH-01..AUTH-09 COMPLETE
- `14-01..14-21` estÃ£o HUMAN APPROVED â€” PASS
- `14-07..14-21` estÃ£o DOCUMENTALLY CLOSED
- `B14-21-HR-01..HR-05` estÃ£o CLOSED â€” PASS
- Phase 15 CONTEXT estÃ¡ **HUMAN APPROVED â€” PASS**
- Phase 15 RESEARCH estÃ¡ **HUMAN APPROVED â€” PASS**
- Phase 15 PLAN estÃ¡ **HUMAN APPROVED â€” PASS** (8 plans / 8 serial waves)
- Phase 15 estÃ¡ **CLOSED â€” HUMAN APPROVED**; Plans `15-01`..`15-08` estÃ£o **8/8 HUMAN APPROVED â€” PASS**, `15-07` e `15-08` estÃ£o documentally closed, e CART-01..CART-09 estÃ£o **9/9 COMPLETE**
- Phase 16 estÃ¡ **CLOSED â€” HUMAN APPROVED**; Plans `16-01`..`16-14` estÃ£o **14/14 COMPLETE**; `MRG-01..MRG-08` estÃ£o **8/8 COMPLETE**; Phase 17 CONTEXT e RESEARCH estÃ£o **HUMAN APPROVED â€” PASS â€” CLOSED**; `R17-HR-01..R17-HR-10`, `R17-CONFLICT-01` e `R17-BLOCK-01` permanecem OPEN; PLAN e EXECUTION permanecem **NOT AUTHORIZED**; Phase 18+ permanecem nÃ£o autorizadas
- A remediaÃ§Ã£o pÃ³s-closure do PR #27 recebeu PASS humano; B15-PR27-HR-01..HR-06 estÃ£o CLOSED â€” PASS. Phase 16 CONTEXT, RESEARCH, PLAN e EXECUTION sÃ£o HUMAN APPROVED â€” PASS; Phase 16 estÃ¡ **CLOSED â€” HUMAN APPROVED**; remediaÃ§Ãµes `16-11-R1`, `16-11-R2` e `16-13-R1` sÃ£o artefatos histÃ³ricos de suporte, nÃ£o planos seriais adicionais
- A remediaÃ§Ã£o pÃ³s-closure do PR #28 recebeu aprovaÃ§Ã£o humana (HUMAN APPROVED â€” PASS) e foi mergeada (MERGED â€” CLOSED). A remediaÃ§Ã£o pÃ³s-closure nÃ£o reabriu a Phase 16 e nÃ£o alterou a conclusÃ£o de MRG-01..MRG-08. Phase 16 permanece CLOSED â€” HUMAN APPROVED. Phase 17 CONTEXT e RESEARCH estÃ£o HUMAN APPROVED â€” PASS â€” CLOSED; `R17-HR-01..R17-HR-10`, `R17-CONFLICT-01` e `R17-BLOCK-01` permanecem OPEN; PLAN e EXECUTION permanecem NOT AUTHORIZED. EvidÃªncia aditiva em `.planning/phases/16-cart-merge-review/16-PR28-REMEDIATION.md`
- deploy, real Resend/real providers, remote infra e frontend permanecem nÃ£o autorizados/bloqueados

## Milestones

| Milestone | Status | Phases | Requirements |
|---|---|---:|---:|
| v1.0 â€” Backend MVP | COMPLETE / CLOSED / ARCHIVED / IMMUTABLE | 13/13 | 45/45 |
| v1.1 â€” Backend Storefront Readiness | OPEN | **4/10 closed** | **34/91** |

O snapshot histÃ³rico de v1.0 permanece em `milestones/v1.0-ROADMAP.md`. A tag e a GitHub Release `v1.0` sÃ£o imutÃ¡veis e nÃ£o participam deste milestone.

## Phases

| Phase | Nome | Depends on | Requirements | Estado |
|---:|---|---|---:|---|
| 13 | Storefront Contract Foundation & Surface Lockdown | v1.0 | 8 | CLOSED â€” HUMAN APPROVED; 7/7 plans; 8/8 requirements |
| 14 | Customer Auth & Verification | 13 | 9 | **CLOSED â€” HUMAN APPROVED; 21/21 plans; 63/63 tasks; 9/9 requirements** |
| 15 | Guest Cart Capability & Concurrency | 14 | 9 | **CLOSED â€” HUMAN APPROVED; 8/8 plans; CART-01..CART-09 = 9/9 COMPLETE** |
| 16 | Cart Merge & Review | 15 | 8 | **CLOSED â€” HUMAN APPROVED; 14/14 plans COMPLETE; MRG-01..MRG-08 = 8/8 COMPLETE** |
| 17 | Authenticated BR Checkout & Privacy | 16 | 10 | **CONTEXT / RESEARCH HUMAN APPROVED â€” PASS â€” CLOSED; R17-HR-01..10 + R17-CONFLICT-01 + R17-BLOCK-01 OPEN; PLAN / EXECUTION NOT AUTHORIZED** |
| 18 | Gelato Shipping Quote & Selection | 17 | 8 | Not started |
| 19 | Storefront PaymentAttempt Hardening | 18 | 9 | Not started |
| 20 | Async Payment Confirmation | 19 | 10 | Not started |
| 21 | Order Confirmation & Catalog Handoff | 20 | 8 | Not started |
| 22 | Contract Kit, Verification & Release | 21 | 12 | Not started |

## Phase 13: Storefront Contract Foundation & Surface Lockdown

**Goal:** conhecer e bloquear a superfÃ­cie Store real antes de adicionar contratos, garantindo que nenhuma rota nativa incompatÃ­vel contorne as regras storefront ou crie `Order`.

**Status:** CLOSED â€” HUMAN APPROVED. 7/7 plans; FND-01..FND-08 COMPLETE.

Closure authority: `.planning/phases/13-storefront-contract-foundation-surface-lockdown/13-CLOSURE.md`.

## Phase 14: Customer Auth & Verification

**Goal:** entregar identidade/Customer, login, reset, refresh e verificaÃ§Ã£o sem contrariar a polÃ­tica de sessÃ£o inicial nÃ£o verificada.

**Depends on:** Phase 13 closed.  
**Requirements:** AUTH-01â€“AUTH-09.  
**Deliverables:** operaÃ§Ãµes auth/Customer, polÃ­tica flexÃ­vel, estado/token de verificaÃ§Ã£o, outbox auth, rate limits, anti-enumeraÃ§Ã£o, BFF-only surface e final Order-authority proof.  
**Exit criteria:** cadastro coordenado; sessÃ£o inicial compra; novo login nÃ£o verificado bloqueado; reset/update revogam credenciais antigas; refresh invÃ¡lido falha; tokens sÃ£o hash-only/uso Ãºnico/expirÃ¡veis; full regression e final human verify PASS.

### Closure status

- 21 planos em 21 waves seriais (`14-01 â†’ ... â†’ 14-21`).
- **63/63 tasks complete**.
- **21/21 plans HUMAN APPROVED â€” PASS**.
- **AUTH-01..AUTH-09 = 9/9 COMPLETE**.
- **D14-01..D14-16 = 16/16 PASS**.
- research blockers = **4/4 CLOSED**.
- MUST findings = **8/8 PASS**.
- `14-21 HUMAN APPROVED â€” PASS / DOCUMENTALLY CLOSED`.
- `Phase 14 HUMAN APPROVED â€” CLOSED`.
- Phase 15 CONTEXT HUMAN APPROVED â€” PASS.
- Phase 15 RESEARCH HUMAN APPROVED â€” PASS.
- Phase 15 PLAN HUMAN APPROVED â€” PASS (8 plans / 8 serial waves).
- Phase 15 CLOSED â€” HUMAN APPROVED; Plans 15-01..15-08 HUMAN APPROVED â€” PASS (8/8); 15-07 e 15-08 DOCUMENTALLY CLOSED; CART-01..CART-09 = 9/9 COMPLETE.
- Deploy NOT AUTHORIZED.
- Real Resend / real providers NOT AUTHORIZED.
- Remote DB/Redis changes NOT AUTHORIZED.
- Frontend BLOCKED.

### Phase 14 plans

- [x] `14-01-PLAN.md` â€” HUMAN APPROVED â€” PASS
- [x] `14-02-PLAN.md` â€” HUMAN APPROVED â€” PASS
- [x] `14-03-PLAN.md` â€” HUMAN APPROVED â€” PASS
- [x] `14-04-PLAN.md` â€” HUMAN APPROVED â€” PASS
- [x] `14-05-PLAN.md` â€” HUMAN APPROVED â€” PASS
- [x] `14-06-PLAN.md` â€” HUMAN APPROVED â€” PASS
- [x] `14-07-PLAN.md` â€” HUMAN APPROVED â€” PASS / DOCUMENTALLY CLOSED
- [x] `14-08-PLAN.md` â€” HUMAN APPROVED â€” PASS / DOCUMENTALLY CLOSED
- [x] `14-09-PLAN.md` â€” HUMAN APPROVED â€” PASS / DOCUMENTALLY CLOSED
- [x] `14-10-PLAN.md` â€” HUMAN APPROVED â€” PASS / DOCUMENTALLY CLOSED
- [x] `14-11-PLAN.md` â€” HUMAN APPROVED â€” PASS / DOCUMENTALLY CLOSED
- [x] `14-12-PLAN.md` â€” HUMAN APPROVED â€” PA²È="25ML¸()I•Í•…É …ÕÑ¡½É¥Ñäè€¹Á±…¹¹¥¹œ½Á¡…Í•Ì¼ÄØµ…ÉĞµµ•É”µÉ•Ù¥•Ü¼ÄØµIMI ¹µ‘€°É•Ù¥•İ•‰ä€¹Á±…¹¹¥¹œ½Á¡…Í•Ì¼ÄØµ…ÉĞµµ•É”µÉ•Ù¥•Ü¼ÄØµIMI µIY%\¹µ‘€ƒŠP!U58AAI=YƒŠPAMLìHÄØµ!H´ÀÄ¸¹HÄØµ!H´Àá€1=MƒŠPAAI=Y¸()A…ÑÑ•É¸…ÕÑ¡½É¥Ñäè€¹Á±…¹¹¥¹œ½Á¡…Í•Ì¼ÄØµ…ÉĞµµ•É”µÉ•Ù¥•Ü¼ÄØµAQQI9L¹µ‘€ƒŠP½™™¥¥…°ÑåÁ•ÍµÁ…ÑÑ•É¸µµ…ÁÁ•É€½ÕÑÁÕĞ¸()A±…¸É•Ù¥•Ü…ÕÑ¡½É¥Ñäè€¹Á±…¹¹¥¹œ½Á¡…Í•Ì¼ÄØµ…ÉĞµµ•É”µÉ•Ù¥•Ü¼ÄØµA18µIY%\¹µ‘€ƒŠPA18!U58AAI=YƒŠPAMLìÄØµA18µ!H´ÀÄ¸¸ÀÈ1=MƒŠPAMLìaUQ%=8=5A1QìA¡…Í”€ÄØ1=MƒŠP!U58AAI=Y¸()A±…¸µ¡•­•ÈÉ•ÍÕ±Ğè€¨©YI%%Q%=8AMMƒŠP€À	1=-H€¼€À]I9%9¨¨¸!Õµ…¸A18É•Ù¥•Üè€¨©!U58AAI=YƒŠPAML¨¨ìÄØµA18µ!H´ÀÅ€…¹ÄØµA18µ!H´ÀÉ€…É”€¨©1=MƒŠPAML¨¨¸!¥ÍÑ½É¥…°•á•ÕÑ¥½¸…ÕÑ¡½É¥é…Ñ¥½¸¥ÌÉ•½É‘•¥¸€¹Á±…¹¹¥¹œ½Á¡…Í•Ì¼ÄØµ…ÉĞµµ•É”µÉ•Ù¥•Ü¼ÄØµA18µIY%\¹µ‘€¸á•ÕÑ…‰±”½Ù•É…”¥ÌÄØ´ÀÄ¸¹ÄØ´ĞÉ€€ĞÈ¼ĞÈ°HÄØµ!H´ÀÄ¸¹HÄØµ!H´Àá€€à¼à…¹5I´ÀÄ¸¹5I´Àá€€à¼à=5A1Q¸Q¡”•¹•É¥Œ‘•¥Í¥½¸µ½Ù•É…”Á…ÉÍ•ÈÉ•Á½ÉÑÌ½Õ±µ¹½ĞµÁ…ÉÍ•€™½ÈÑ¡”…ÁÁÉ½Ù•ÄØµ99€¹…µ•ÍÁ…”ìÑ¡¥ÌÉ•µ…¥¹Ì„¹½¸µ‰±½­¥¹œ%9<‰…­•‰äÑ¡”¥¹‘•Á•¹‘•¹Ğ•á…ĞµÍ•ĞÁÉ½½˜…¹‘½•Ì¹½Ğ…ÕÑ¡½É¥é”É•¹…µ¥¹œÑ¡”‰¥¹‘¥¹œ‘•¥Í¥½¹Ì¸((ŒŒŒA¡…Í”€ÄØÁ±…¹ÌƒŠP¡Õµ…¸µ…ÁÁÉ½Ù••á•ÕÑ¥½¸Í•Ğ((´€¨©]…Ù”€Àè¨¨€ÄØ´ÀÄµA18¹µ‘€ƒŠPÁÉ½‘ÕÑ¥½¸ÑÉ…•È™½ÈÑÉ…¹Í…Ñ¥½¹…°Õ•ÍĞÁÉ½µ½Ñ¥½¸¸(´€¨©]…Ù”€Ä¨¨€¨¡‰±½­•½¸]…Ù”€À½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÀÈµA18¹µ‘€ƒŠP±½Í•‘•¥Í¥½¸•¹¥¹”°Í•É¥…±¥é•ÉÌ…¹Á•ÉÍ¥ÍÑ•¹”µ½‘•±Ì¸(´€¨©]…Ù”€È¨¨€¨¡‰±½­•½¸]…Ù”€Ä½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÀÌµA18¹µ‘€ƒŠP5•‘ÕÍ„µ½‘Õ±”İ¥É¥¹œ…¹•¹•É…Ñ•Í¡•µ„¥‘•¹Ñ¥Ñä¸(´€¨©]…Ù”€Ì¨¨€¨¡‰±½­•½¸]…Ù”€È½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÀĞµA18¹µ‘€ƒŠP‰±½­¥¹œ¡Õµ…¸0‘•¥Í¥½¸¡•­Á½¥¹Ğ¸(´€¨©]…Ù”€Ğ¨¨€¨¡‰±½­•½¸]…Ù”€Ì…ÁÁÉ½Ù…°¤è¨€ÄØ´ÀÔµA18¹µ‘€ƒŠPÑÉ…¹Í…Ñ¥½¹…°±…¥´°É••¥ÁĞ°É•Á±…ä…¹É½±±‰…¬¸(´€¨©]…Ù”€Ô¨¨€¨¡‰±½­•½¸]…Ù”€Ğ½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÀØµA18¹µ‘€ƒŠP…¹½¹¥…°ÕÍÑ½µ•È…ÉĞ…ÕÑ¡½É¥Ñä¸(´€¨©]…Ù”€Ø¨¨€¨¡‰±½­•½¸]…Ù”€Ô½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÀÜµA18¹µ‘€ƒŠP™Õ±°É•…¡…‰±”µ•É”½ÕÑ½µ•Ì…¹Á…ÉÑ¥…°É•Ù¥•Ü¸(´€¨©]…Ù”€Ü¨¨€¨¡‰±½­•½¸]…Ù”€Ø½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÀàµA18¹µ‘€ƒŠP•á…ĞÙ•ÉÍ¥½¹•É•Ù¥•Ü…­¹½İ±•‘”¸(´€¨©]…Ù”€à¨¨€¨¡‰±½­•½¸]…Ù”€Ü½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÀäµA18¹µ‘€ƒŠPÉ•Ù¥•Ü‰…ÉÉ¥•È™½ÈÍÑÉÕÑÕÉ…°µÕÑ…Ñ¥½¹Ì…¹¡•­½ÕĞ¸(´€¨©]…Ù”€ä¨¨€¨¡‰±½­•½¸]…Ù”€à½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÄÀµA18¹µ‘€ƒŠP½¹ÑÉ½±±•±•…ä…ÑÑ… …‘…ÁÑ•È¸(´€¨©]…Ù”€ÄÀ¨¨€¨¡‰±½­•½¸]…Ù”€ä½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÄÄµA18¹µ‘€ƒŠPMÑ½É”ÍÕÉ™…”½Í•ÕÉ¥Ñä•á…ĞµÍ•Ğ…¹±•…­…”ÁÉ½½™Ì¸(´€¨©]…Ù”€ÄÄ¨¨€¨¡‰±½­•½¸]…Ù”€ÄÀ½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÄÈµA18¹µ‘€ƒŠP…ÕÑ¡½É¥Ñ…Ñ¥Ù”QåÁ•MÉ¥ÁĞMÑ½É”½¹ÑÉ…Ğ¸(´€¨©]…Ù”€ÄÈ¨¨€¨¡‰±½­•½¸]…Ù”€ÄÄ½µÁ±•Ñ¥½¸¤è¨€ÄØ´ÄÌµA18¹µ‘€ƒŠP‰±½­¥¹œ¡Õµ…¸MÑ½É”µ½¹ÑÉ…Ğ‘•¥Í¥½¸¡•­Á½¥¹Ğ¸(´€¨©]…Ù”€ÄÌ¨¨€¨¡‰±½­•½¸]…Ù”€ÄÈ…ÁÁÉ½Ù…°¤è¨€ÄØ´ÄĞµA18¹µ‘€ƒŠP…ÁÁÉ½Ù•İÉ¥Ñ•È½ÕÑÁÕĞ…¹™¥¹…°Ñ•¡¹¥…°±•‘•È¸()É½ÍÌµÕÑÑ¥¹œ½¹ÍÑÉ…¥¹ÑÌè((´Ñ¡”Á±…¸Í•Ğ€ÄØ´ÀÄ¸¸ÄØ´ÄÑ€¥Ì€¨¨ÄĞ¼ÄĞ=5A1Q¨¨ìA¡…Í”€ÄØ¥Ì€¨©1=MƒŠP!U58AAI=Y¨¨ì(´A½ÍÑÉ•ME0…¹É•…°5•‘ÕÍ„Á•ÉÍ¥ÍÑ•¹”…É”½ÉÉ•Ñ¹•ÍÌ…ÕÑ¡½É¥Ñ¥•ÌìI•‘¥Ì¥Ì…Õá¥±¥…Éäì(´Íå¹¡É½¹½ÕÌA¡…Í”´ÄØ…ÉĞÁ…Ñ¡ÌÉ•…Ñ”é•É¼=É‘•ÉÌì…¹½¹¥…°Á…åµ•¹Ñ}¥¹Ñ•¹Ğ¹ÍÕ••‘•‘€É•µ…¥¹ÌÑ¡”Í½±”…•ÁÑ•=É‘•Èµ‰¥ÉÑ …ÕÑ¡½É¥Ñäì(´5I´ÀÄ¸¹5I´Àá€…É”€¨¨à¼à=5A1Q¨¨ì(´É•¥ÍÑÉäQåÁ•MÉ¥ÁĞ¥Ì=Á•¹A$…ÕÑ¡½É¥Ñäì•¹•É…Ñ•)M=8¥ÌİÉ¥Ñ•È½ÕÑÁÕĞ½¹±ä…¹Mİ…•ÈÉ•µ…¥¹Ì¹½¸µ¥¹Ñ•É…Ñ¥Ù”ì(´‘•Á±½ä°É•…°ÁÉ½Ù¥‘•ÉÌ°É•µ½Ñ”¥¹™É„…¹™É½¹Ñ•¹É•µ…¥¸9=PUQ!=I%i¸()AÉ¥µ…ÉäÁ±…¹Ìè€¨¨ÄĞ¼ÄĞ=5A1Q¨¨¸)I•µ•‘¥…Ñ¥½¹Ì€ÄØ´ÄÄµHÅ€°€ÄØ´ÄÄµHÉ€°€ÄØ´ÄÌµHÅ€è¡¥ÍÑ½É¥…°ÍÕÁÁ½ÉÑ¥¹œ…ÉÑ¥™…ÑÌ°¹½Ğ…‘‘¥Ñ¥½¹…°Í•É¥…°µÁ±…¸½Õ¹Ğ¸((ŒŒŒA½ÍĞµ±½ÍÕÉ”AH€ŒÈà½Ù•É¹…¹”()A¡…Í”€ÄØÉ•µ…¥¹Ì€¨©1=MƒŠP!U58AAI=Y¨¨…Ì¡¥ÍÑ½É¥…°±½ÍÕÉ”ÍÑ…ÑÕÌ¸)AH€ŒÈàÁ½ÍĞµ±½ÍÕÉ”É•µ•‘¥…Ñ¥½¸¥Ì€¨©!U58AAI=YƒŠPAML¨¨…¹€¨©5IƒŠP1=M¨¨¸)%8´ÀÄ¸¹%8´ÀĞ…¹HØ…É”€¨©1=MƒŠPAML¨¨¸)Q¡”Á½ÍĞµ±½ÍÕÉ”É•µ•‘¥…Ñ¥½¸‘¥¹½ĞÉ•½Á•¸A¡…Í”€ÄØ…¹‘¥¹½Ğ¡…¹”5I´ÀÄ¸¹5I´Àà½µÁ±•Ñ¥½¸¸)ĞÑ¡”AH€ŒÈàÁ½ÍĞµ±½ÍÕÉ”±½Í•½ÕĞ°A¡…Í”€ÄÜİ…Ì€¨©9=PMQIQƒŠP9=PUQ!=I%i¨¨¸)ÕÉÉ•¹ĞÍÑ…Ñ”èA¡…Í”€ÄÜ=9QaP…¹IMI …É”€¨©!U58AAI=YƒŠPAMLƒŠP1=M¨¨ì)HÄÜµ!H´ÀÄ¸¹HÄÜµ!H´ÄÁ€°HÄÜµ=91%P´ÀÅ€…¹HÄÜµ	1=,´ÀÅ€É•µ…¥¸=A8ìA18…¹aUQ%=8É•µ…¥¸€¨©9=PUQ!=I%i¨¨¸()5¥±•ÍÑ½¹”½Õ¹Ñ•ÉÌèÁ¡…Í•Ì±½Í•€Ğ¼ÄÁ€ìÉ•ÅÕ¥É•µ•¹ÑÌ€ÌĞ¼äÅ€ì½Á•¸)É•ÅÕ¥É•µ•¹ÑÌ€Ôİ€ìÁ±…¹Ì€ÔÀ¼ÔÁ€ìÁ•É•¹Ğ€ĞÁ€¸((ŒŒŒ•ÁÑ•A¡…Í”´ÄØ•Ù¥‘•¹”((´€ÄØ´ÄĞµMU55Id¹µ‘€ƒŠP™¥¹…°µ•É”½É•Ù¥•Ü½=Á•¹A$±•‘•È…¹¡Õµ…¸Ù•É¥™ä(´€ÄØµ1=MUI¹µ‘€ƒŠP¡Õµ…¸µ…ÁÁÉ½Ù•A¡…Í”´ÄØ±½ÍÕÉ”…ÕÑ¡½É¥Ñä(´€ÄØµAHÈàµI5%Q%=8¹µ‘€ƒŠP¡Õµ…¸µ…ÁÁÉ½Ù•Á½ÍĞµ±½ÍÕÉ”AH€ŒÈàÉ•µ•‘¥…Ñ¥½¸€¡%8´ÀÄ¸¹%8´ÀĞ°HØ1=MƒŠPAMLìAH€ŒÈà5IƒŠP1=M¤((ŒŒA¡…Í”€ÄÜèÕÑ¡•¹Ñ¥…Ñ•	H¡•­½ÕĞ€˜AÉ¥Ù…ä((¨©½…°è¨¨É¥…È¡•­½ÕĞ…ÕÑ•¹Ñ¥…‘¼Á…É„Á•ÍÍ½„›µÍ¥„¹¼	É…Í¥°Í•´…Éµ…é•¹…ÈAÉÔ¹¼…µ¥¹¡¼…ÑÕ…°¸((¨©MÑ…ÑÕÌè¨¨=9QaP…¹IMI €¨©!U58AAI=YƒŠPAMLƒŠP1=M¨¨¸•Á•¹‘Ì½¸A¡…Í”€ÄØ1=MƒŠP!U58AAI=Y¸HÄÜµ!H´ÀÄ¸¹HÄÜµ!H´ÄÁ€°HÄÜµ=91%P´ÀÅ€…¹HÄÜµ	1=,´ÀÅ€É•µ…¥¸=A8¸A18°aUQ%=8…¹¥µÁ±•µ•¹Ñ…Ñ¥½¸É•µ…¥¸Õ¹…ÕÑ¡½É¥é•Õ¹Ñ¥°„Í•Á…É…Ñ”¡Õµ…¸‘•¥Í¥½¸¸()I•Í•…É …ÕÑ¡½É¥Ñäè€¹Á±…¹¹¥¹œ½Á¡…Í•Ì¼ÄÜµ…ÕÑ¡•¹Ñ¥…Ñ•µ‰Èµ¡•­½ÕĞµÁÉ¥Ù…ä¼ÄÜµIMI ¹µ‘€ì…‘Ù•ÉÍ…É¥…°É•Ù¥•Üè€ÄÜµIMI µIY%\¹µ‘€ƒŠP@ÀôÀ°@ÄôÀ°µ…Ñ•É¥…°@ÈôÀì¡Õµ…¸…•ÁÑ…¹”…ÕÑ¡½É¥Ñäè€ÄÜµIMI µ!U58µIY%\¹µ‘€¸HÄÜµ	1=,´ÀÅ€É•µ…¥¹Ì½Á•¸™½È¹¼µA•±…Ñ¼½µÁ…Ñ¥‰¥±¥Ñä¸((ŒŒA¡…Í”€Äàè•±…Ñ¼M¡¥ÁÁ¥¹œEÕ½Ñ”€˜M•±•Ñ¥½¸((¨©½…°è¨¨ÍÕ‰ÍÑ¥ÑÕ¥È™É•Ñ”½Á•É…¥½¹…°™¥á¼Á½È½Ñ‡Ÿ¼”Í•±—Ÿ¼…ÕÑ½É¥Ñ…Ñ¥Ù…ÌÁÉ•Í•ÉÙ…‘…Ì…Ó¤¼‘¥ÍÁ…Ñ ¸((¨©MÑ…ÑÕÌè¨¨9½ĞÍÑ…ÉÑ•¸•Á•¹‘Ì½¸A¡…Í”€ÄÜ¸((ŒŒA¡…Í”€ÄäèMÑ½É•™É½¹ĞA…åµ•¹ÑÑÑ•µÁĞ!…É‘•¹¥¹œ((¨©½…°è¨¨•¹‘ÕÉ••È¼·Í‘Õ±¼•á¥ÍÑ•¹Ñ”Á…É„…ÉÓ¼…ÕÑ•¹Ñ¥…‘¼4Ä°µ…¹Ñ•¹‘¼Ñ½‘¼¼™±Õá¼ÁË¤µ=É‘•È¸((¨©MÑ…ÑÕÌè¨¨9½ĞÍÑ…ÉÑ•¸•Á•¹‘Ì½¸A¡…Í”€Äà¸((ŒŒA¡…Í”€ÈÀèÍå¹ŒA…åµ•¹Ğ½¹™¥Éµ…Ñ¥½¸((¨©½…°è¨¨µ…Ñ•É¥…±¥é…È½¹™¥Éµ‡Ÿ¼	µ½¹±äÉ•ÕÁ•Ë…Ù•°°É…Ñ”µ±¥µ¥Ñ•”™¥¹…¹•¥É…µ•¹Ñ”Í•ÕÉ„Í½ˆÉ•™É•Í °·é±Ñ¥Á±…Ì…‰…Ì”ÍÕ•ÍÍ¼Ñ…É‘¥¼¸((¨©MÑ…ÑÕÌè¨¨9½ĞÍÑ…ÉÑ•¸•Á•¹‘Ì½¸A¡…Í”€Ää¸((ŒŒA¡…Í”€ÈÄè=É‘•È½¹™¥Éµ…Ñ¥½¸€˜…Ñ…±½œ!…¹‘½™˜((¨©½…°è¨¨•¹ÑÉ•…È½¹™¥Éµ‡Ÿ¼‘”Á•‘¥‘¼Í•ÕÉ„”…Ó…±½¼É•Í½±ÛµÙ•°½É•Ù…±¥“…Ù•°Á…É„¼	¸((¨©MÑ…ÑÕÌè¨¨9½ĞÍÑ…ÉÑ•¸•Á•¹‘Ì½¸A¡…Í”€ÈÀ¸((ŒŒA¡…Í”€ÈÈè½¹ÑÉ…Ğ-¥Ğ°Y•É¥™¥…Ñ¥½¸€˜I•±•…Í”((¨©½…°è¨¨ÁÉ½Ù…ÈÅÕ”¼‰…­•¹•ÍÓ„ÁÉ½¹Ñ¼”•¹ÑÉ•…È¼­¥ĞÅÕ”Á•Éµ¥Ñ”…¼™É½¹Ñ•¹‘•Í•¹Ù½±Ù•ÈÍ•´¥¹Ù•¹Ñ…È½¹ÑÉ…Ñ¼¸((¨©MÑ…ÑÕÌè¨¨9½ĞÍÑ…ÉÑ•¸•Á•¹‘Ì½¸A¡…Í”€ÈÄ¸((ŒŒ•™¥¹¥Ñ¥½¸½˜½¹”()<µ¥±•ÍÑ½¹”ÏÌÁ½‘”™•¡…ÈÅÕ…¹‘¼¡½ÕÙ•È•Ù¥“©¹¥„AMLÁ…É„Ñ½‘½Ì½Ì…Ñ•ÌÁÉ•Ù¥ÍÑ½Ìè½¹ÑÉ…Ñ½ÌMÑ½É”½=Á•¹A$°…ÕÑ•¹Ñ¥‡Ÿ¼°…Á…‰¥±¥Ñä½½¹½ÉË©¹¥„”µ•É”‘”…ÉÉ¥¹¡¼°¡•­½ÕĞ	H½ÁÉ¥Ù…¥‘…‘”°•±…Ñ¼Í¡¥ÁÁ¥¹œ°A…åµ•¹ÑÑÑ•µÁĞ½½¹™¥Éµ…Ñ¥½¸°½É‘•È½…Ñ…±½œ¡…¹‘½™˜°­¥ĞÑåÁ•Ì½i½½™¥áÑÕÉ•Ì½µ½­Ì°½¹ÑÉ…ĞÑ•ÍÑÌ°ÍÕ¥Ñ•Ì‰…­•¹°µ¥É…Ñ¥½¹Ì½½¹ÍÑÉ…¥¹ÑÌ°‘É¥™Ğ½±¥¹Ğ½‰Õ¥±°Í•ÕÉ¥Ñä¹•…Ñ¥Ù”ÁÉ½½™Ì”É•±•…Í”Ù•É¥™¥…Ñ¥½¸…Á±¥…Ù•°¸()A¡…Í”€ÄÔ=9QaP°IMI °A18…¹±½ÍÕÉ”…É”!U58AAI=YƒŠPAMLì)A±…¹Ì€ÄÔ´ÀÄ¸¸ÄÔ´Àà…É”€¨¨à¼à!U58AAI=YƒŠPAML¨¨…¹A±…¹Ì€ÄÔ´ÀÜ…¹(ÄÔ´Àà…É”=U59Q11d1=M¸IP´ÀÄ¸¹IP´Àä…É”€ä¼ä=5A1Q¸A¡…Í”€ÄØ)¥Ì€¨©1=MƒŠP!U58AAI=Y¨¨ìA±…¹Ì€ÄØ´ÀÅ€¸¹€ÄØ´ÄÑ€…É”€¨¨ÄĞ¼ÄĞ=5A1Q¨¨ì)5I´ÀÄ¸¹5I´Àá€…É”€¨¨à¼à=5A1Q¨¨¸A¡…Í”€ÄÜ=9QaP…¹IMI …É”€¨©!U58AAI=YƒŠPAMLƒŠP1=M¨¨ìHÄÜµ!H´ÀÄ¸¹HÄÜµ!H´ÄÁ€°HÄÜµ=91%P´ÀÅ€…¹HÄÜµ	1=,´ÀÅ€É•µ…¥¸=A8ìA18…¹aUQ%=8É•µ…¥¸Õ¹…ÕÑ¡½É¥é•¸)I•…°ÁÉ½Ù¥‘•ÉÌ°¥¹™É…•ÍÑÉÕÑÕÉ„É•µ½Ñ„°ÁÕÍ °‘•Á±½ä…¹™É½¹Ñ•¹É•µ…¥¸Õ¹…ÕÑ¡½É¥é•¸(