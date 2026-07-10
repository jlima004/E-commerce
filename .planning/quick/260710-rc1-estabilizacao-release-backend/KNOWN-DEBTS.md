---
status: active
release_gate: blocked
---

# Dívidas e riscos conhecidos

| Dívida / risco | Impacto | Probabilidade | Mitigação atual | Correção recomendada | Blocker frontend? | Blocker venda pública? |
|---|---|---|---|---|---|---|
| Possível exposição de credenciais no transcript operacional | crítico: acesso indevido a infraestrutura e providers | indeterminada | gate interrompido; valores não reproduzidos | gate de incidente imediato, inventário, rotação/revogação coordenada e auditoria | sim para RC | sim |
| Tabela core `refund` não sincronizada | verdade financeira core divergente da trilha customizada | alta no fluxo atual | `refund_request` e metadata da Order preservam a confirmação | próxima fatia de refund aprovada | não | avaliar antes de público |
| `payment_collection.refunded_amount` não recalculado | consumidores core podem exibir agregado incorreto | alta após refund | usar `RefundRequest` confirmado como fonte operacional | próxima fatia financeira | não | avaliar antes de público |
| Ausência de e-mail específico de refund | cliente não recebe comunicação automática | alta | comunicação operacional manual | fase de notificações posterior | não | não isoladamente |
| Lock de refund não distribuído entre dynos | corrida entre solicitações concorrentes | possível | idempotência persistida reduz duplicação | implementar lock distribuído em gate próprio | não | sim se concorrência não for mitigada |
| Providers incompletos/desativados | e-mail, analytics e fulfillment não operam integralmente | certa no ambiente observado | flags e ausência de config impedem chamadas indevidas | configurar e validar por provider em gates separados | sim para integrações | sim |
| `REDIS_CACHE_PROVIDER_DISABLED=true` | cache Redis permanece desativado | certa | Redis segue saudável para dependências observadas | investigar TLS/provider e remover flag somente após prova | não | não isoladamente |
| Avisos de providers locais/em memória na release phase | risco de inicialização não durável durante migration/release | possível | runtime health e dynos estavam saudáveis | correlacionar bootstrap da release phase sem alterar runtime neste gate | não | avaliar |
| Phase 12 não executada (`OperationalAlert`, `AdminActionLog`, TEST-01) | lacunas operacionais e de auditoria | certa | Phase 12 explicitamente bloqueada | planejar somente após aprovação humana | não | avaliar antes de público |
| Migrations `TBD`/draft deliberadamente não confrontadas com produção | schema pode divergir do repositório | possível | smoke histórico demonstra parte do schema | auditoria read-only completa e classificação individual | não | sim se houver pendência aplicável |
| Suítes de integração sem banco de teste isolado comprovado | não há validação segura e reproduzível | alta | suites bloqueadas para proteger dados | provisionar/identificar banco descartável e `.env.test` | sim para RC | sim |
| Logs do release atual não analisados | erros novos podem estar ocultos | possível | health e dynos verdes são evidência parcial | repetir gate após contenção | sim para RC | sim |

## Critérios para reabrir estabilização

- Incidente de credenciais contido e versões anteriores revogadas quando aplicável.
- Banco de integração isolado e descartável comprovado.
- Suíte completa, lint e build com resultados conclusivos.
- Auditoria read-only de migrations, Supabase, Stripe e logs concluída.
- Nenhum risco imediato de corrupção financeira, duplicação ou fulfillment indevido.
