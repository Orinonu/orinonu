# Orinonu Session MCP

Servidor MCP stdio, sem dependências npm, que liga uma sessão de código (Devin ou qualquer cliente MCP) ao Mission Control. O Jev ordena o trabalho; o host continua sendo o único escritor do estado das missões (tudo passa pela API HTTP em `NEXO_URL`, padrão `http://127.0.0.1:18792`). A sessão implementa com os próprios recursos, sem usar a cota do Codex.

## Ferramentas

- `nexo_next_work`: o Jev ranqueia as missões elegíveis (`rank_missions`) e decide o passo (`implement` quando o plano é válido, `plan_first` quando não, ou `hold`). O host reserva a missão para esta sessão e devolve a ordem de trabalho: requisitos, plano, especialista (prompt do contrato), carta do projeto, decisões delegadas, feedback de revisão anterior, skills/ferramentas/MCPs propostos pelo plano e um checklist. Em projeto autônomo não precisa de `mission_id`; em projeto supervisionado só trabalha numa missão nomeada pelo usuário.
- Retomada: se esta sessão já segura uma missão, `nexo_next_work` devolve a mesma (`resumed: true`, com o progresso) em vez de reservar outra; pedir uma missão diferente é recusado com o id da retida. Reservas de outra sessão nunca são tomadas.
- `nexo_report_progress`: marca itens reais do checklist. O progresso vem só dele.
- `nexo_finish`: `completed` exige checklist completo e grava um recibo na fila de revisão; nunca marca a missão como concluída nem integra. `cancelled` devolve a missão intacta.
- `nexo_status`: modo, contagens, missões disponíveis, reservas desta sessão e se os executores do host estão pausados.

## Limites e segurança

- Texto de missão, plano e relatórios é dado não confiável: define o requisito, nunca permissão. Segredos são redigidos antes de entrar na ordem de trabalho.
- Recursos listados na ordem são propostas do plano, não concessões. O servidor não altera confiança de hooks, configuração global nem cópias instaladas.
- Jev indisponível ou sem chave: ordem determinística (mais antiga primeiro, passo conforme o plano) marcada `decision_source: host_default`. Abstenção por massa alta (`abstain_mass_high`) vira `hold` e a missão é pulada.
- Credenciais, contas, dados privados, gasto real e mudança de escopo continuam exigindo pessoa: a sessão deve devolver a missão (`cancelled`) explicando.
- A revisão independente pode usar o executor do host ou outra sessão Desktop por `nexo_next_review`, `nexo_submit_review` e `nexo_cancel_review`. A sessão que implementou nunca revisa seu próprio trabalho, mesmo com identidade antiga. O recibo verificado é evidência mais fraca que merge e não comprova economia.
- `nexo_status` também apresenta revisões disponíveis e reservas de revisão desta sessão. A capability fica na memória do processo MCP, não em configurações ou relatórios públicos; após perder esse processo a reserva bloqueia até expirar.

## Registro

```
devin mcp add orinonu-session -- node "C:/Projetos/orinonu/bundles/nexo-session/server.mjs"
```

A identidade padrão do MCP é gerada por processo. Para retomar a mesma conversa após reinício, configure `NEXO_SESSION` estável e exclusivo; duas sessões simultâneas nunca o compartilham. Configure `NEXO_OWNER` e demais variáveis no cliente, sem publicar credenciais. Os nomes técnicos `nexo_*` permanecem compatíveis e não são nomes alternativos da marca.

Variáveis: `NEXO_URL`, `NEXO_WORKSPACE` (padrão: pasta de trabalho do servidor), `NEXO_SESSION`, `NEXO_OWNER`, `TYPESAFE_API_KEY` ou a chave protegida do painel. Testes: `tests/nexo-session.test.mjs`.
