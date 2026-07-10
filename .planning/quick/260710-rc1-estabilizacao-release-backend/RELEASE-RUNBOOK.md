---
status: documented-not-validated
execution: prohibited-in-this-gate
---

# Runbook de release, rollback e recuperação

Este runbook foi documentado, mas não executado. O gate RC1 está bloqueado e a compatibilidade de schema entre releases não foi comprovada.

## Deploy futuro

Pré-condições:

1. Incidente de credenciais encerrado em gate separado.
2. Worktree limpo; `main` alinhada a `origin/main`; diferença para Heroku exclusivamente documental ou inexistente.
3. Suítes completas, lint e build verdes em banco de teste isolado.
4. Auditoria de migrations sem pendência aplicável.
5. Ausência de segredo rastreado e aprovação humana explícita.

Procedimento futuro:

```bash
git push heroku main
heroku ps -a espacoliminar
heroku releases -a espacoliminar
```

Confirmar release phase, `APP_VERSION` por saída sanitizada, `/health/live`, `/health/ready`, web/worker e smoke exclusivamente read-only.

## Rollback

- Release atual observada: `v68`.
- Release de deploy imediatamente anterior: `v67`, runtime `a729e653`.
- Deploy anterior: `v65`, runtime `290bff33`.
- Diferença de migrations entre `v67` e `v65`: **não comprovada**.

Comando documental, não executado:

```bash
heroku releases:rollback <RELEASE_ANTERIOR_APROVADA> -a espacoliminar
```

Não classificar rollback como seguro até provar compatibilidade de schema. Após rollback aprovado, exigir health live/ready, web e worker, `APP_VERSION` sanitizado, logs e consultas read-only das invariantes financeiras.

## Roll-forward

Após estabilizar ou reverter a causa, republicar somente o runtime SHA humano-aprovado e repetir release phase, health, dynos, logs e smokes read-only. Não reutilizar automaticamente uma release cujo schema ou credenciais não tenham sido validados.

## Recuperação de credenciais

A contenção e eventual rotação/revogação devem ocorrer em gate separado. O procedimento deve inventariar por categoria as credenciais potencialmente expostas, definir ordem para reduzir indisponibilidade, atualizar consumidores de forma coordenada e provar revogação das versões anteriores sem registrar valores em logs ou documentos.

## Tag futura

Somente após novo gate `PASS` ou `PASS WITH KNOWN DEBTS` e aprovação humana:

```bash
git tag -a v1.0-backend-rc1 <RUNTIME_SHA> -m "Backend MVP release candidate 1"
git push origin v1.0-backend-rc1
```

Nenhuma tag foi criada neste gate.
