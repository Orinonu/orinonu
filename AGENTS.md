# Orinonu

Leia CONTEXT.md, GOVERNANCE.md e docs/harness-policy.md. Antes de alterar a interface ou a marca, leia docs/brand-and-design.md: a interface pública é Next.js, React e TypeScript, sem frames ou fallback HTML legado. Mudanças fundamentais na direção, licença ou identidade oficial exigem aprovação explícita de @ori-inonu; tarefas e recomendações de IA não a substituem. Projeto local Node ESM sem dependências externas. Execute npm test e python tests/configure_test.py para mudanças no instalador. Nunca copie credenciais ou backups privados para este repositório. Código valida contratos e autorizações; Jev recomenda escolhas tipadas. Testes de aceitação e conjuntos de avaliação são independentes dos candidatos. Não promova configurações globais com smoke tests. Não altere a confiança de hooks por script.

## Trazer para o repositório uma missão implementada em workspace isolado

Implementações de executores ficam em `~/.codex/mission-control/workspaces/<task>--<queue>/workspace`, e a lista exata de arquivos está em `implementation_evidence.changes` (sha256 antes/depois). Sem Git no repositório, porte assim:

1. `changes[].before.sha256` igual ao arquivo atual do repositório ⇒ copie o arquivo do workspace direto.
2. Diferente ⇒ ache a base exata (procure um arquivo com o sha256 de `before` em `workspaces/` ou `integration-staging/`) e rode `git merge-file -p <repo> <base> <workspace>`; resolva só os hunks conflitantes, preservando as linhas mais novas do repositório.
3. Grave com trava: releia o sha256 do arquivo imediatamente antes de escrever e aborte se mudou — outra sessão pode estar editando o mesmo arquivo.
4. Valide com `npm test`, `npm run check:ui`, `npm run test:ui` e `python tests/configure_test.py`.

`scripts/mission-control-cli.mjs list` só funciona quando o servidor em execução tem a rota de consulta (`task-query.mjs`); sem ela, liste por `GET /api/state`. Hooks do Devin: o instalador escreve em `%APPDATA%\devin\config.json` os mesmos três hooks do Codex, apontando para a cópia instalada: SessionStart (`devin-hook-start.mjs` sobe o painel; `devin-hook-context.mjs` injeta o snapshot), UserPromptSubmit (`devin-hook-context.mjs`) e PostToolUse (`devin-hook-observe.mjs`). Não duplique em `.devin/hooks.v1.json`.

## Revisão de recibos pelo Desktop

Para revisar recibos de outra sessão, consulte `src/desktop-review.mjs` e o catálogo em `bundles/nexo-session/server.mjs`: `nexo_next_review` reserva somente leitura, `nexo_submit_review` entrega o contrato e `nexo_cancel_review` libera sem concluir. A conclusão `session_receipt_verified` verifica o recibo no workspace atual; não certifica merge nem economia medida. Parecer de trabalho próprio exige outra sessão, mesmo que uma identidade antiga permita reservá-lo.

O MCP gera identidade por processo; para retomar após reinício use `NEXO_SESSION` estável e exclusivo da conversa, nunca compartilhado entre escritores. A capability de revisão fica na memória do processo MCP; após perder esse processo, a reserva continua bloqueando até expirar. Preserve os tokens fora de relatórios e configurações do repositório.

## Runtime Agents SDK

Ao alterar `bundles/orinonu-agents`, use o lockfile isolado e valide `npm run check:agents`, `npm run test:agents` e `npm run build:agents`. O build preserva licenças e gera um manifesto do artefato. Testes SDK usam modelos sintéticos; `--describe` não inicia inferência nem certifica conta, despacho ou swarm. O núcleo continua sem dependências SDK e mudanças globais exigem promoção separada.

## Fixtures de execução e navegador

Runners de teste do Codex precisam fornecer stdin gravável e consumir UTF-8 até EOF; o prompt está no stdin, não em `args.at(-1)`, que é `-`. Testes de fallback devem injetar verificação explícita do CLI, sem inferência ou login real. Rode `npm run build:ui` antes de `npm run test:ui:browser` após alterações no frontend: o navegador testa a exportação em `public/ui`, não a fonte TypeScript diretamente.

## Execução segura e artefatos instalados

Para trabalhar com Devin, use a sessão interativa e as reservas MCP. O executor automático está inelegível em `src/executor-catalog.mjs` até existir isolamento verificado; autenticação e uma allowlist de comandos não estabelecem esse limite. Probes de cota usam o dispatcher durável como trabalhos internos somente leitura, separados das missões públicas; sucesso de probe só reabre admissão.

Ao alterar instalação ou promoção, valide também `node scripts/record-installation.mjs --verify-evals .`. Os testes de promoção/rollback em `tests/installation-info.test.mjs` usam raízes temporárias e `-NoRestart`; no Windows, o processo de teste usa a invocação documentada com `-ExecutionPolicy Bypass`, sem alterar política persistente. Recibos nativos e Desktop compartilham a cobertura de critérios em `src/receipts.mjs`; nenhuma aprovação pode omitir critérios para caber no contrato.

## Qualidade contínua da interface

Ao mudar uma vista, controle ou contrato, reproduza a jornada afetada em `frontend/e2e` com API sintética e guard de rede; o upstream do servidor de teste permanece inacessível. Mantenha regressões vermelhas antes da correção e verifique layouts, nomes, foco, dados desconhecidos e recuperação de erros depois. Preserve a referência independente: alterações nos limites visuais exigem evidência e revisão, não atualização automática para concordar com o candidato.

Antes de release, percorra as dez vistas e os estados de falha em desktop/tablet/celular. Registre versão, viewport, estado real/simulado, impacto, arquivos, dependências e critérios de aceite; confira missões existentes antes de cadastrar trabalho. Zoom nativo, leitores de tela e dispositivos físicos são gates humanos separados: testes automáticos não certificam WCAG nem autorização de promoção.

