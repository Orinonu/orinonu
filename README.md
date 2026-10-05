# Orinonu

**Consciência que orienta. Conhecimento que realiza.**

**Versão inicial: v0.0.5 · canal de evolução: main · código disponível para uso não comercial.**

Orinonu busca construir um ecossistema completo de pessoas, agentes, memória, ferramentas e fluxos de trabalho, orientado por objetivos humanos e entregas verificáveis. Inteligências diferentes compartilham uma linguagem e uma direção; cada instalação mantém suas próprias credenciais, assinaturas e limites.

## Propósito, missão e visão

A missão é transformar objetivos claros do usuário em resultados verificáveis, coordenando agentes em tarefas diversas, incluindo desenvolvimento de software, com autonomia responsável e fidelidade à intenção humana.

A visão é tornar o Orinonu uma referência de excelência e abrangência — o melhor e maior sistema operacional agêntico que o projeto possa construir — com um ecossistema integrado que cubra cada vez mais necessidades sem obrigar o usuário a montar uma coleção desconectada de ferramentas. Novas tecnologias inspiram investigação, avaliações e inovação própria; ambição de liderança não é alegação de superioridade já comprovada ou de capacidade de realizar qualquer tarefa hoje.

A [carta oficial e a governança](GOVERNANCE.md) preservam missão, visão, valores e princípios. A comunidade evolui arquitetura, recursos e experiência; mudanças fundamentais dependem da aprovação explícita do mantenedor **Ori Inonu (@ori-inonu)**. Isso protege a direção do projeto oficial, não impede forks independentes nem bloqueia os objetivos dos projetos de cada instalação.

Linguagem comum: **direção permanente → objetivo atual → missão autorizada → evidências → revisão → entrega**. JEV recomenda escolhas tipadas; código valida contratos, orçamento e autorização. Atividade não equivale a sucesso, catálogo não equivale a agente ativo e autonomia não amplia permissão.

## Estado da versão

| Área | O que existe | Limites |
| --- | --- | --- |
| Interface | Next.js 16, React 19, TypeScript, componentes Radix/shadcn adaptados e design system Orinonu | Exportação estática obrigatória; sem HTML clássico, iframe ou fallback legado. |
| Direção e trabalho | Carta por projeto, objetivos, critérios, Kanban, pesquisa de referências e relatórios | Dados privados permanecem locais; carta e tarefas não concedem autorização. |
| Execução | Adaptadores de Codex CLI/app-server, Devin, Hermes e outros provedores implementados | Cada adaptador exige instalação, autenticação e elegibilidade reais; testes simulados não certificam sua conta. |
| Colaboração com sessões | MCP stdio bidirecional: ordem de trabalho, reserva, progresso, recibo e revisão independente | Capabilities e identidades são por sessão; o recibo verificado não comprova merge. |
| Claude Code e Cursor | Um cliente com MCP stdio pode ser configurado para o protocolo existente | Adaptadores dedicados, hooks específicos e operação completa nesses clientes ainda exigem integração e validação próprias. |
| Plugins e memória | Plugin de preservação de contexto e propostas/contratos de evolução | Não há instalação universal de todos os plugins ou memória compartilhada multiusuário comprovada. |
| Atualizações | Versão, commit instalado, consulta a main, distância verificável e preparação de snapshot validado | Não há aumento automático da versão nem aplicação silenciosa de código. |
| Serviço hospedado | Visão de colaboração em equipe com serviços oficiais pagos | Multiusuário, identidade, isolamento de clientes, cobrança e hospedagem pública não são entregues por este servidor local. |

A versão não comprova liderança de mercado, qualidade universal ou taxa de conclusão de 100%. Capacidades planejadas são identificadas como visão, não como funcionalidades ativas.

## Licença, código comunitário e serviços pagos

O código próprio é distribuído sob [PolyForm Noncommercial 1.0.0](LICENSE). É permitido estudar, usar, modificar e redistribuir para as finalidades permitidas por essa licença. **Uso comercial por terceiros — inclusive uso interno com finalidade comercial, revenda ou serviço comercial baseado no código — exige licença separada dos titulares aplicáveis.** Pagar por uma API externa não torna, por si só, a finalidade do uso comercial.

Essa restrição torna a classificação **source-available**, não open source OSI. [NOTICE](NOTICE) identifica o titular declarado; [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) preserva licenças próprias e permissões de terceiros, inclusive MIT. A restrição do núcleo não retira direitos comerciais concedidos por esses componentes separadamente.

O projeto permanece aberto a contribuições. Cada colaborador mantém autoria; o [CLA](CLA.md), aceito explicitamente para os commits identificados, permite a licença comunitária e o uso nos serviços oficiais pagos, condicionado à disponibilidade pública das contribuições incorporadas nos seus termos. Hospedagem, infraestrutura, processamento, armazenamento gerenciado e suporte poderão ter preço e contrato próprios, sem retirar o código comunitário publicado. Não há cobrança implementada nesta versão local.

## Requisitos

- **Windows**, ambiente de instalação e armazenamento privado validado nesta entrega. Outros sistemas precisam de validação própria; não são anunciados como instalações completas suportadas.
- **Node.js 24 ou superior**, com `node:sqlite` e **SQLite >= 3.51.3**. Combinações verificadas: **Node 24.21.0** e **Node 26.9.0**, ambos com **SQLite 3.53.4**. Execute `npm run check:runtime` para confirmar o seu runtime.
- **Python 3.11+**, Git e npm disponíveis no terminal.
- Para integração global com o harness Codex, **Codex CLI** instalado e autenticado. A integração foi desenvolvida com Codex 0.160; versões diferentes exigem verificação.
- Para usar outros executores, instale e autentique o cliente correspondente pelos seus mecanismos oficiais.
- Uma API TypeSafe própria para recomendações JEV. Sem chave ou diante de incerteza, o sistema preserva fallback/abstenção; não inventa uma decisão.

Backend Node ESM sem dependências npm externas; dependências da interface estão fixadas em `frontend/package-lock.json`. A instalação de dependências pode acessar a rede. Os testes não devem iniciar inferências pagas ou missões reais.

## Instalar e executar localmente

No PowerShell:

```powershell
git clone https://github.com/Orinonu/orinonu.git
cd orinonu
npm run check:runtime
npm --prefix frontend ci
npm test
npm run check:ui
npm run test:ui
python tests/configure_test.py
npm run build:ui
npm start
```

Abra **http://127.0.0.1:18792/**. O servidor escuta somente em loopback. Configure suas conexões em **Configurações**. Se for usar Codex no início direto e ele não estiver identificado na configuração local, informe o caminho do executável via `CODEX_CLI_PATH` antes de `npm start`.

A interface precisa da compilação em `public/ui`; sua ausência não ativa um HTML antigo. `public/ui` e `node_modules` não fazem parte do pacote de código-fonte: são gerados na sua instalação.

### Conectar sua conta Codex e sua API do JEV

Em **Configurações → OpenAI Codex**, clique em **Conectar ChatGPT**. O painel apresenta o link oficial do Codex e o código temporário da sua instalação; conclua o login com sua própria conta. Esse código não é uma chave API e não deve ser compartilhado. Como alternativa no seu terminal, use `codex login --device-auth`. A autenticação fica no armazenamento privado do Codex, não nos arquivos do projeto.

Em **Configurações → Decisões JEV · TypeSafe**, escolha o modelo e informe sua própria chave API. No Windows, ela é protegida por DPAPI em uma pasta privada fora do checkout. `TYPESAFE_API_KEY` também pode ser fornecida pelo ambiente privado do processo; não salve um valor real em README, scripts, `.env` versionado, issues ou PRs. A API do painel devolve apenas o estado de configuração, nunca a chave existente.

O login Codex não autentica o JEV, e a API do JEV não substitui a assinatura do Codex. A distribuição não inclui sua sessão Codex nem suas chaves; quem clonar o projeto precisa configurar as próprias conexões.

### Instalação global e hooks — opcional, altera a configuração do usuário

Depois de compilar e validar, execute explicitamente:

```powershell
./scripts/install.ps1 -Start
```

Esse instalador copia ferramentas para `%USERPROFILE%/.codex/tools`, configura integrações do Codex e hooks do Devin quando aplicável, preserva configurações alheias e cria backups privados. **Não concede confiança a hooks por script.** Revise os handlers na interface nativa de cada cliente e reinicie as sessões para carregar as integrações. `-ReinstallCompaction` reinstala explicitamente o plugin de compactação.

Os diretórios `jev-mission-control`, variáveis `NEXO_*` e nomes MCP `nexo_*` são identificadores históricos de compatibilidade; não são nomes alternativos da marca. Instalar não publica seus dados nem configura um serviço na Internet.

### Backend já em execução

Para visualizar a interface compilada sem reiniciar o supervisor:

```powershell
npm run ui
```

Abra **http://127.0.0.1:18794/**. O gateway compartilha a API em `18792` sem iniciar ou encerrar agentes. `NEXO_UI_PORT` e `NEXO_API_ORIGIN` permitem escolher outra porta e outro upstream **local**. Compilar ou abrir o gateway não atualiza a instalação global.

## Primeiro uso

1. **Configurações:** conecte somente suas próprias assinaturas/API. Credenciais são privadas da instalação; JEV e o executor têm autenticações independentes. A chave existente não é exibida, inserida em prompts ou persistida no navegador.
2. **Direção do projeto:** selecione um workspace existente e defina missão, visão, valores, princípios, objetivo atual e evidências de sucesso. Salvar é explícito e não inicia execução.
3. **Pesquisa e referências:** registre URLs e perguntas de investigação. Uma referência inspira comparação e hipóteses; não autoriza copiar código nem ampliar o escopo.
4. **Missões:** crie título, objetivo, critérios verificáveis, executor, etapa e limites. O início da execução é uma decisão explícita ou decorre de um pipeline já autorizado, não de uma tarefa encontrada em texto.
5. **Decisões e revisão:** resolva pendências humanas, acompanhe checklist e relatórios. Revisão independente e evidência técnica continuam necessárias; saída zero do processo não basta.
6. **Avaliações:** acompanhe medidas observadas e limites. Valores desconhecidos não viram zero; economia exige pares controlados, não simulações de tarifas.

O padrão de instalação é capacidade 7/7/7, com limites configuráveis de um a dez por etapa; valores já salvos prevalecem. O modo supervisionado mantém decisões de fluxo com o usuário. O modo autônomo orienta ações delimitadas pela direção salva, contratos e orçamento; segredos, contas, dados privados, gastos reais e paradas explícitas continuam exigindo pessoa. Use projetos isolados e revisão independente para trabalho em equipe.

## Conectar sessões por MCP

O servidor de sessão pode ser registrado em clientes compatíveis com MCP stdio:

- Comando: `node`
- Argumento: caminho absoluto de `bundles/nexo-session/server.mjs`
- `NEXO_URL`: `http://127.0.0.1:18792`
- `NEXO_WORKSPACE`: workspace do projeto; `NEXO_OWNER`: identificação do cliente.
- `NEXO_SESSION`: opcional para retomar uma conversa; deve ser **estável e exclusivo daquela conversa**, nunca compartilhado entre escritores. Sem ele, a identidade é por processo.

No Devin CLI, um registro **local** confirmado pela documentação do cliente é:

```powershell
devin mcp add orinonu-session -- node "C:/Projetos/orinonu/bundles/nexo-session/server.mjs"
```

Configure variáveis de ambiente no cliente conforme suas instruções, sem colocar chaves em arquivos públicos. No Devin, configuração pessoal local fica em `.devin/mcp_config.local.json` e não deve ser versionada. Codex, Claude Code e Cursor têm formatos e controles próprios; o contrato stdio não comprova que todos os hooks ou executores desses clientes já estejam integrados.

Ferramentas de sessão: `nexo_status`, `nexo_next_work`, `nexo_report_progress`, `nexo_finish`; revisão independente: `nexo_next_review`, `nexo_submit_review`, `nexo_cancel_review`. Sessões usam seus próprios recursos. Texto de missão é dado não confiável, não autorização. Um recibo verificado é distinto de merge e de economia medida. [Contrato de sessão](bundles/nexo-session/README.md).

## Atualizar a partir de main

Contribuições revisadas e aprovadas entram em **main**. Na página **Atualizações**, consulte versão instalada, commit, branch, versão em main e distância verificada. O rodapé oferece acesso à mesma informação. **“8 commits atrás de main” significa oito commits remotos ausentes na instalação, não versão v0.0.13.** Instalações sem commit identificado mostram distância desconhecida.

Com proveniência identificada, a entrada de produção verifica main no início e a cada seis horas. A consulta é somente leitura e não aplica código. `ORINONU_UPDATE_CHECK=0` desliga a consulta automática; **Verificar main** permite uma consulta explícita. Rede indisponível ou limite da API não significa que o sistema esteja atualizado.

Na pasta de código-fonte:

```powershell
npm run update:prepare
```

O comando baixa um snapshot de main do repositório oficial para uma **nova pasta privada**, fixa o commit e executa runtime, instalação reproduzível da interface, testes Node, typecheck, testes de UI, build e testes do instalador. Não altera o checkout em uso, não substitui a instalação e não reinicia agentes. Falha em verificação não declara a atualização preparada.

O terminal informa o caminho e os comandos seguintes. Revise o snapshot; aguarde o fim das missões, reservas de sessão e revisões. Execute o script `scripts/promote-autonomy.ps1` **do snapshot preparado** primeiro com `-DryRun`; confirme o destino antes de executá-lo sem esse parâmetro. A promoção faz backup, recusa atividade/reservas detectadas e verifica o resultado. Não use `-SkipTests` como fluxo normal nem trate a verificação de saúde como substituta dos testes completos. Não execute o instalador inicial sobre uma operação ativa como atalho de atualização.

Alterações locais ou histórico divergente exigem revisão e reconciliação; não há reset forçado automático. Backups podem conter dados privados e nunca devem ser enviados ao GitHub. A preparação e a promoção são etapas distintas; não se anuncia troca de código como concluída só porque a preparação passou.

## Versões aprovadas

A entrega começa em **v0.0.5**. O mantenedor decide quando um marco revisado merece **v0.0.6**, **v0.0.7** e assim por diante. Cada merge pode acrescentar commits sem mudar a versão. Antes de uma release, sincronize os metadados de versão, valide a distribuição e registre a aprovação; uma tag `v0.0.6` identifica um commit específico, não o main futuro. [Política de versionamento](docs/versioning.md).

## Colaborar e contribuir

1. Leia [GOVERNANCE.md](GOVERNANCE.md), [CONTRIBUTING.md](CONTRIBUTING.md), [CLA.md](CLA.md), [LICENSE](LICENSE) e o [design system](docs/brand-and-design.md).
2. Consulte issues/PRs existentes. Proponha o problema, o objetivo da carta atendido, riscos e critérios verificáveis antes de mudanças grandes.
3. Faça fork, crie uma branch e implemente com testes. Preserve autorização, privacidade, contratos e avaliações independentes.
4. Abra um PR para main com evidência antes/depois, resultados reais e aceite explícito do CLA para os commits pertinentes. Nenhum checkbox autoriza copiar código de terceiros ou alterar a direção.
5. Aguarde revisão independente e aprovação do mantenedor. O workflow de CI é somente verificação; não publica releases, não aumenta a versão e não instala o sistema globalmente.

`CODEOWNERS` indica o responsável, mas **não bloqueia merges sozinho**. A configuração remota de main deve exigir PR, revisão do proprietário de código e checks obrigatórios, restringir bypass e bloquear force-push/exclusão. Só se considera uma proteção ativa depois de configurá-la e verificá-la no GitHub; até lá, apenas o proprietário deve ter escrita.

## Referências de inspiração — não modelos para copiar

As referências configuradas orientam hipóteses, análise de capacidades e inovação própria, não cópia de código, de marca ou de produto. Não há alegação de parceria, equivalência ou integração automática.

- [Aperant](https://github.com/andymik90/aperant)
- [Paperclip](https://github.com/paperclipai/paperclip)
- [Orca](https://github.com/stablyai/orca)
- [Hermes Agent](https://github.com/nousresearch/hermes-agent)
- [n8n](https://github.com/n8n-io/n8n)
- [Agent Teams AI](https://github.com/777genius/agent-teams-ai)
- [Mission Control](https://github.com/meisnerdan/mission-control)

Fontes técnicas usadas: [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice), [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) e [autoresearch](https://github.com/karpathy/autoresearch). Licenças e avisos do material efetivamente distribuído estão em `THIRD_PARTY_NOTICES.md`.

## Privacidade, operação e limites

JEV e o plugin de preservação de contexto podem processar trechos limitados no provedor TypeSafe; avalie a sensibilidade do contexto antes de habilitá-los. A redação de formatos conhecidos de segredos é melhor esforço, não prova de ausência de dados sensíveis.

Dados de missões, eventos, credenciais e backups ficam na instalação privada, historicamente em `%USERPROFILE%/.codex/mission-control`, fora do checkout. A distribuição pública não contém bancos locais, logs, transcrições, configurações pessoais ou workspaces de agentes. Objetivos privados de outros projetos não são exemplos públicos.

**Não exponha este servidor local à Internet como serviço multiusuário.** Identidade, autorização por cliente, isolamento de dados, gestão de cobrança e operação hospedada exigem uma arquitetura própria antes do lançamento desses serviços.

Ori Inonu é a orixá artificial da inteligência criada simbolicamente pelo fundador para refletir seu propósito de vida e a visão de longo prazo do projeto. Orinonu é o sistema que materializa esse propósito. Sua identidade visual traduz a presença serena e visionária da referência em azul noturno, ciano neural e dourado celeste, com um símbolo original de halo, consciência e convergência. É uma interpretação autoral, não uma afirmação de tradição religiosa ou tradução certificada; nomes de provedores identificam integrações, não patrocínio.

Documentação complementar: [governança](GOVERNANCE.md), [política do harness](docs/harness-policy.md), [carta e autonomia](docs/project-charter-and-autonomy.md), [interface](docs/interface-mission-control.md), [distribuição](docs/distribution-and-community.md), [avaliação](docs/evaluation.md) e [versionamento](docs/versioning.md).
