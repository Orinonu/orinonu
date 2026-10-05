# Identidade e design system do Orinonu

## Marca e propósito

O nome é **Orinonu**, sem hífen e sem o segundo “i” da forma exploratória Ori-Inonu. `ORINONU` é a apresentação do wordmark; outros nomes são históricos ou identificadores de compatibilidade, não marcas alternativas.

**Ori Inonu** é a orixá artificial da inteligência criada simbolicamente pelo fundador para personificar seu propósito de vida e a visão de longo prazo do projeto. **Orinonu** é o nome do sistema, sem repetir os dois “i” da junção exploratória. A figura é uma interpretação autoral de consciência, direção, forja e conhecimento: aproxima a inspiração de Orí, os caminhos e a tecnologia associados a Ogum, a comunicação de Exu e a observação dos Vigilantes da narrativa de Enoque. Essa simbologia não se apresenta como tradução certificada ou como uma divindade tradicional reconhecida.

A referência visual mostra presença feminina serena e firme, olhos ciano luminosos, azul noturno, halo dourado, redes estelares e traços de circuitos. A interface traduz essas características em **serenidade, precisão e visão**: hierarquia clara, ações deliberadas, redes discretas e luz reservada aos pontos de foco. O símbolo original combina halo, chama de consciência e caminhos que convergem. O favicon usa o mesmo desenho simplificado, legível em escala pequena. A apresentação do propósito inclui uma ilustração vetorial autoral inspirada nessa presença, sem copiar símbolos litúrgicos ou marcas de provedores.

**Consciência que orienta. Conhecimento que realiza.** O produto busca um ecossistema de agentes e pessoas que compartilham linguagem, direção e critérios de entrega. A imagem proposta de uma construção comum expressa alinhamento explícito, não centralização de credenciais ou supressão dos objetivos das instalações independentes.

## Linguagem comum

- **Direção do projeto:** missão, visão, valores e princípios que orientam a colaboração.
- **Objetivo atual:** resultado operacional a alcançar, separado da direção permanente.
- **Missão de trabalho:** unidade de trabalho autorizada, com escopo e critérios verificáveis.
- **Agente:** executor com capacidades e autorização efetivamente disponíveis.
- **Especialista:** contrato de escopo; sua presença no catálogo não comprova um agente filho ativo.
- **Evidência:** observação verificável com fonte; atividade não equivale a entrega.
- **Colaboração comunitária:** propostas, código e revisão no projeto oficial. Colaboração multiusuário hospedada exige infraestrutura e controles próprios; não deve aparecer como recurso entregue enquanto não existir.

Cada instalação usa sua assinatura, API e armazenamento privado. Interfaces não exibem chaves existentes nem as persistem no navegador. Serviços oficiais hospedados poderão ser pagos; o núcleo publicado permanece sob a licença não comercial aplicável. A interface usa “código disponível” ou “source-available”, não um selo open source OSI incompatível com `LICENSE`.

## Fonte de verdade e stack

`frontend/src/lib/brand.ts` contém nome, identidade simbólica, personalidade, narrativa e mensagens da marca. `frontend/src/components/brand-mark.tsx` contém o símbolo original; `frontend/src/app/icon.svg` o apresenta no favicon, e `frontend/src/components/ori-inonu-presence.tsx` contém a presença vetorial ilustrada. `public/brand.css` é a fonte de tokens compartilhados, importada pela interface Next.js. `frontend/src/app/globals.css` define os padrões dos módulos e seus estados. Primitivas em `frontend/src/components/ui` seguem os tokens e preservam os avisos MIT de origem.

A interface pública usa Next.js, React e TypeScript. Telas especializadas são módulos React, não HTML clássico embutido. A aplicação exige exportação compilada antes de servir a interface; não oferece `/classic/`, assets legados ou fallback HTML antigo. IDs de API, variáveis `NEXO_*`, chaves de preferências persistidas e diretórios técnicos podem conservar seus nomes por compatibilidade. Não alterar contratos de dados apenas para renomear a marca.

## Tokens semânticos

| Família | Uso |
| --- | --- |
| Azul noturno `--deep-space` | Base cósmica discreta; navegação, painéis, elevação e entrada têm níveis distintos. |
| Ciano neural `--neural-cyan` | Conhecimento em ação, conexão, foco de teclado e ação primária, com texto escuro de alto contraste. |
| Dourado celeste `--celestial-gold` | Propósito, direção, halo e pontos de convergência; não é indicador universal de sucesso. |
| Sucesso, aviso e perigo | Estados de resultado, pendência e risco, sempre acompanhados de texto. |
| Texto primário, secundário e terciário | Hierarquia legível sobre superfícies escuras. |
| Espaço, raios e tipografia | Unidade de 4 px, controles, cartões e painéis consistentes; corpo local sans-serif e evidências monoespaçadas. |

Use nomes semânticos e `var(...)`, não valores de marca espalhados nos módulos. Cores de provedores só identificam integrações, sem substituir a identidade Orinonu ou sugerir endosso.

## Padrões de interação

Navegação lateral organiza direção, missões e pesquisa, depois operação e configuração. A marca retorna à visão geral. A direção e as evidências têm prioridade sobre decoração; o símbolo não impede leitura ou interação. “Sobre Orinonu” explica narrativa, comunidade, licenciamento e limites de capacidades.

Cartões apresentam um contexto, uma informação principal, evidências e ação clara. Formulários preservam rascunhos durante consultas periódicas, identificam escopo local/global e mostram erros sem incluir valores secretos. Mudanças em contas, direção e execução são ações explícitas, não efeitos de carregar uma tela.

Use rótulos acessíveis, foco visível, retorno de foco em diálogos e menu móvel com Escape e contenção de foco. Conteúdo se adapta a 390 px sem rolagem horizontal da página; o Kanban pode ter trilho horizontal próprio e colunas com rolagem independente. Controles têm alvos adequados ao toque e texto legível. Respeite `prefers-reduced-motion`; decoração não gera animações contínuas indispensáveis à compreensão.

Métricas ausentes são desconhecidas, não zero. Cotas e dias de assinatura vêm de dados observados, não contagens promocionais. Um modo autônomo não amplia autorização. Tela ou catálogo de recurso planejado deve declará-lo como futuro; não inventar colaboradores, equipe conectada, gasto ou economia.

## Governança da identidade

A comunidade pode melhorar ergonomia, acessibilidade, componentes e fluxos alinhados. Mudanças fundamentais no nome, símbolo, narrativa ou direção oficial seguem `GOVERNANCE.md` e exigem aprovação explícita do mantenedor. `CODEOWNERS` identifica revisão, mas a proteção efetiva de merge depende de regras verificadas no GitHub.
