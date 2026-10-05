# Versionamento do Orinonu

A entrega inicial é **0.0.5**. O número é a versão aprovada do produto, não uma contagem de commits, tarefas, chamadas de IA ou qualidade.

## Main e releases são fatos diferentes

Pull requests revisados e aprovados entram em `main`; main pode evoluir por vários commits dentro de v0.0.5. O mantenedor @ori-inonu decide quando um marco funcional revisado e verificado passa a v0.0.6, v0.0.7 e versões seguintes. CI e merges não aumentam o número automaticamente.

Uma release exige: decisão registrada do mantenedor, critérios atendidos, testes completos, build, revisão de compatibilidade e privacidade da distribuição e sincronização dos metadados. Alinhar `package.json`, `frontend/package.json` e seu lockfile, o estado exposto pelo servidor, a identificação do MCP quando pertinente e a compatibilidade de `scripts/start.ps1`. A marca lê a versão do pacote principal. Criar a tag correspondente, por exemplo `v0.0.6`, no commit aprovado e publicar a release com evidências reais; nunca mover uma tag existente para esconder uma correção.

## Proveniência e distância

A interface distingue versão instalada, commit instalado, branch/canal, versão em main, data da consulta e distância. A comparação `instalado...main` da API GitHub apresenta commits remotos ausentes como `ahead_by`; na perspectiva da instalação isso significa **commits atrás de main**. Commits exclusivos da instalação são apresentados como locais à frente. As duas diferenças simultâneas indicam divergência.

A instalação registra `installation.json` com versão, commit, branch e hashes dos arquivos de código. Sem commit verificável, a distância permanece desconhecida. Alterações de código instaladas são sinalizadas; comparar um hash antigo com uma instalação diferente invalida a distância anterior. Não há número fabricado, reset forçado ou troca silenciosa de código.

`GET /api/updates` apresenta metadata/cache sem iniciar consulta remota. `POST /api/updates/check` verifica somente o repositório oficial `Orinonu/orinonu`, main, via API pública GitHub. O entrypoint de produção faz consultas periódicas em instalações com commit identificado; `ORINONU_UPDATE_CHECK=0` permite desativá-las. Erro de rede, resposta inválida ou limite da API não é estado atualizado.

## Preparação e aplicação

`npm run update:prepare` cria outro checkout de main em pasta privada e valida runtime, dependências fixadas, backend, interface, build e instalador. Retorna o commit e a versão; não muda a instalação ativa. O snapshot é aplicado somente por ação explícita do operador, após inspeção e encerramento das missões/reservas, usando o procedimento de promoção com backup e verificações. Uma instalação inicial e uma atualização de uma operação em uso não são o mesmo procedimento.

A checagem, a preparação, a aplicação e a aceitação da release são etapas distintas. Logs e backups privados não são evidência publicável sem sanitização.

## Progresso não é versão

O progresso de uma etapa é a proporção de itens concluídos sobre um checklist válido e verificável daquela etapa. Sem escala definida, permanece indeterminado. O checklist não substitui revisão independente; uma revisão de recibo não comprova merge nem economia medida.
