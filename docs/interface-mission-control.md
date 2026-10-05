# Interface de controle de missão

Implementação de 04/10/2026. A migração para Next.js, TypeScript e shadcn/ui foi escolhida explicitamente pelo usuário. Next.js 16.3.8 e React 19.3.0 foram confirmados no registro npm; o lockfile fixa as dependências usadas nesta compilação.

## Organização

O painel anterior colocava toda a direção do projeto dentro de “Análise de concorrentes e projetos de referência”. Isso misturava a identidade permanente, o resultado atual e as fontes de investigação.

- **Visão geral:** objetivo em foco, atividade, espera, bloqueios e entregas; painel de economia com custo estimado em reais, custo por missão, economia medida e simulações; faixa de fila por etapa; referências de concorrentes com investigações e propostas. Textos extensos têm resumo visual e acesso à direção completa.
- **Direção do projeto:** objetivo atual e evidências primeiro; missão, visão, valores e princípios em um grupo próprio. Assistência prepara uma proposta revisável que só altera o rascunho ao ser aplicada. Salvar é uma ação explícita.
- **Pesquisa e referências:** URLs GitHub e foco da análise; contexto da direção salva; propostas com evidências; histórico de investigações. Cada formulário salva apenas seus próprios campos.
- **Missões:** quadro com seis etapas, alternativa em lista e filtros combináveis por texto, etapa e especialista. Sessões externas ativas prevalecem sobre um estado persistido antigo. Processos em execução aparecem antes de seleção e espera.
- **Detalhes:** objetivo, critérios, executor, checklist com evidência, fase e tentativa, histórico e relatórios de planejamento/revisão. Não há percentual inventado nem reaproveitamento de checklist antigo para um objetivo devolvido ao backlog.

A navegação se adapta a telas pequenas. O menu móvel esconde controles fora da tela, delimita o foco e fecha por Escape. Diálogos possuem títulos, rótulos e retorno de foco. Atualizações periódicas preservam os rascunhos e a seleção do usuário.

## Economia em reais

A cotação USD→BRL é consultada automaticamente de uma fonte pública (AwesomeAPI), preservada em `currency.json` no diretório de dados e mantida quando a rede falha. `GET /api/state` expõe `analytics.currency` com fonte, data, estado e limites, além de `estimated_brl` por missão, `totals` e `metrics.saved_brl`; `POST /api/currency/refresh` atualiza sob demanda. Sem cotação, valores em reais permanecem desconhecidos em vez de zero.

A visão geral mostra custo estimado da operação, custo por missão, economia medida por pares controlados aceitos e simulações hipotéticas, sempre com fonte e data. Estimativas não são faturas, créditos ou franquia Codex. A conversão de moeda é exibida na interface nativa; não existe superfície pública `/classic/`.

## Arquitetura

`frontend/` contém o App Router, componentes React, contratos TypeScript e testes da interface. `npm run build:ui` compila e copia a exportação estática para `public/ui`, incluindo um manifesto dos hashes dos scripts inline do Next.js. Não é necessário executar um servidor Next.js para servir o painel compilado.

`src/static-ui.mjs` resolve os assets, restringe caminhos e symlinks ao diretório público e aplica CSP com hashes explícitos. O backend serve somente a exportação Next.js na raiz, sem `/classic/`, assets HTML antigos ou fallback legado. Sem exportação, não há interface alternativa. A política CSP impede frames.

`npm run ui` inicia `src/ui-gateway.mjs` em `127.0.0.1:18794`. A API é encaminhada para `http://127.0.0.1:18792`, com validação de Host/Origin e upstream restrito a loopback. O gateway não inicia nem encerra o supervisor de missões. Respostas interrompidas encerram a conexão do cliente para permitir uma repetição. Admissões com resultado incerto conservam `request_id` e revisão original após erros de rede, JSON inválido e 5xx.

Decisões e histórico, avaliações, agentes, curadoria, conexões, configuração JEV, limites de fila e edição de requisitos são módulos React nativos, sem iframe. Auditorias e assistência de direção mantêm detalhes somente leitura. A página Atualizações e o rodapé distinguem versão aprovada, commit e distância até main. A identidade Orinonu usa `public/brand.css` e `frontend/src/lib/brand.ts` como fontes de verdade; ver `docs/brand-and-design.md`.

Não foram reescritos os objetivos do usuário, alteradas credenciais, promovidas configurações globais ou modificada a confiança de hooks. A migração visual não transforma propostas ou dados persistidos em autorização de execução.

## Verificação e operação

```powershell
npm --prefix frontend ci
npm run check:ui
npm run test:ui
npm run build:ui
npm test
npm run ui
```

Testes cobrem escopo por projeto, composição de filtros, prioridade de atividade, preservação dos campos salvos, progresso com evidências, fase/tentativa histórica e repetição de admissão após falhas ambíguas. Testes do backend cobrem assets/CSP, fallback, traversal, Host/Origin, proxy restrito e respostas truncadas.

O navegador foi usado com dados reais para revisar navegação e controles de compatibilidade. Salvamento de formulários e criação de missão foram verificados em um servidor isolado com execução de agentes desabilitada. O layout foi inspecionado em desktop e viewport de 390 × 844.

A instalação global em `.codex/tools/jev-mission-control` é separada desta pasta. Compilar ou abrir o gateway não substitui automaticamente essa instalação nem reinicia missões. Para voltar à interface anterior, use `/classic/`; a API e os dados compartilhados continuam os mesmos.

## Autonomia e caixa de decisões

A visão geral ganhou o painel "Autonomia" (saúde, vagas por etapa com reservas presas, WIP, disjuntor, parados além do prazo) e o cartão "Caixa de decisões". A página Decisões é nativa: cada pergunta mostra o que o código oferece, o efeito de cada opção e a recomendação do Jev ("recomenda" acima do limiar, "inclina" abaixo dele, "se absteve" quando não há distribuição); "Aceitar sugestão" só aparece quando o Jev nomeou uma opção, e a resposta usa um `request_id` estável para ser aplicada uma única vez. O histórico de decisões Jev continua disponível abaixo, no renderer anterior. Detalhes e limites: `docs/autonomy-no-stall-20261004.md`.
