# Jev Context Preservation para Codex

Adaptação local para Windows e Codex 0.160.0. Usa a biblioteca MIT `fast-jev-compaction`, commit `e3f262a7f4d42bd8dd32ced30d26176f7cb545b0`, versão npm 0.2.0. O código original está em `vendor/fast-jev-compaction`, com sua licença.

O pacote usa `.codex-plugin/plugin.json`, pois o loader da versão 0.160.0 não carrega hooks de pacotes com manifesto portátil na raiz. Essa restrição foi confirmada no código dessa versão e no `hooks/list` do executável instalado.

Esta adaptação complementa a compactação nativa: não substitui seu resumo nem altera diretamente o histórico do Codex.

## Escopo global e fidelidade ao repositório

A instalação usa o marketplace pessoal `jev-local` e a ativação de plugin no `config.toml` global do usuário. A fonte permanente fica em `%USERPROFILE%\.codex\plugins\sources\jev-context\plugins\fast-jev-compaction-codex`; o Codex executa sua cópia instalada no cache global. Nenhum projeto precisa copiar arquivos ou instalar dependências. Projetos com overrides explícitos podem desabilitar o plugin ou mudar o gatilho global.

| Parte | Repositório original | Adaptação Codex |
| --- | --- | --- |
| Seleção semântica | Duas perguntas Noul por par de ferramentas | Mesma biblioteca compilada, sem alterações |
| Decisões | Manter chamada/resultado, truncar resultado ou remover o par | Mesmas decisões para selecionar as evidências locais |
| Parâmetros principais | Limiar 0,5; seis mensagens recentes; estado 25k; pedido 30k | Mesmos valores iniciais; mensagens mapeadas a partir dos itens nativos do Codex |
| Modelo | Alias `jev-latest` | Versão fixada `jev-1.13.0` |
| Gatilho | 60% do contexto no fim do turno | Compactação nativa em 100k tokens totais, conforme solicitado |
| Resultado no harness | Substitui o histórico por mensagens selecionadas, sem resumo | Resumo nativo mais evidências citadas, limitadas e recuperáveis em arquivo |
| Redução mínima | 25% de caracteres para aceitar a substituição | Não aplicada; não há substituição do histórico |
| Erro | Retorna ao resumo nativo | Permite que o resumo nativo continue |

Portanto, a seleção segue o código original, mas o comportamento completo não é equivalente ao plugin de Claude Code. Reproduzir a substituição integral exige modificar e manter o código do harness Codex.

## Funcionamento

1. `PreCompact` lê o transcript fornecido pelo Codex, considera o checkpoint mais recente e consulta Jev sobre chamadas/resultados de ferramentas.
2. A seleção é salva em arquivos locais no diretório de dados do plugin. São mantidos os três snapshots mais recentes de cada conversa; o transcript original não é alterado.
3. `SessionStart`, com origem `compact`, reapresenta até 6.000 caracteres de evidências citadas. O Codex armazena contexto adicional acima de aproximadamente 2.500 tokens em arquivo; esse parâmetro é um limiar de spill, não um teto rígido do prompt inteiro.
4. O modelo recebe um caminho para consultar as evidências selecionadas quando um trecho não for suficiente. Os textos da conversa continuam sendo tratados pela compactação nativa.

O estado enviado a Jev inclui texto da conversa e entradas das ferramentas. Resultados completos das ferramentas e raciocínio criptografado não são enviados a Jev. A chave configurada e propriedades comuns de credenciais são ocultadas antes da avaliação e do armazenamento local.

## Configuração

- Credencial: variável de usuário do Windows `TYPESAFE_API_KEY`. O wrapper lê a variável salva, inclusive quando o Codex foi aberto antes de ela existir.
- Parâmetros da seleção: `config.json` na fonte do plugin.
- Compactação nativa: `model_auto_compact_token_limit = 100000` e `model_auto_compact_token_limit_scope = "total"`, na configuração global do Codex.
- Hooks: `hooks/hooks.json`. Os dois handlers precisam ser revisados e confiados no Codex; a instalação não fornece essa confiança automaticamente.

No Codex CLI, abra `/hooks`, revise os handlers `PreCompact` e `SessionStart` deste plugin e marque-os como confiáveis. Reinicie/reabra a conversa para carregar o plugin recém-instalado. O requisito de confiança é do runtime do Codex: https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks.

Se `codex` não estiver disponível no terminal PowerShell, o seguinte comando localiza o executável gerenciado pelo aplicativo, sem copiar nem modificar o binário:

```powershell
$taskCodexExe = Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Filter codex.exe -Recurse |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
& $taskCodexExe
```

Dentro da interface interativa, digite `/hooks`. Essa revisão permanece global para os handlers instalados; não precisa ser repetida em cada projeto.

O modelo inicial está fixado em `jev-1.13.0`. Os orçamentos estimados de estado e requisição são 25k e 30k. A configuração inclui seis mensagens recentes protegidas e limiar de manutenção 0,5. Esses parâmetros são iniciais, sujeitos a avaliação em tarefas reais.

Depois de editar a fonte, atualize a instalação local com `codex plugin add fast-jev-compaction-codex@jev-local`. Alterações nos hooks exigem nova revisão de confiança pelo Codex.

## Verificação

`npm test` executa os testes do adaptador, sem chamadas externas.

Para verificar a credencial e uma inferência pequena, execute no PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-hook.ps1 -Mode Check
```

O resultado mostra `ok`, modelo e uso, sem exibir a chave. O arquivo `last-status.json`, no diretório de dados do plugin, registra o resultado mais recente da preparação, sem incluir textos da conversa ou credenciais.

## Falhas e compatibilidade

Chave ausente, erro HTTP, resposta inválida, timeout de 20 segundos ou transcript incompatível fazem a adaptação emitir uma mensagem e permitir a compactação nativa. A adaptação não interrompe a tarefa.

O formato do transcript não é uma interface estável do Codex. O parser cobre o rollout legado da versão 0.160.0, checkpoints com `replacement_history` e os itens nativos `function_call`/`custom_tool_call`. Rollbacks e checkpoints sem histórico substituto são recusados para evitar reapresentar evidências de um histórico desfeito. Nesses casos, a compactação nativa continua.

Os limites são de contexto adicional; não provam um teto rígido de 100k para toda requisição nem garantem a correção das decisões semânticas de Jev. O resultado completo desta adaptação depende do resumo nativo e das evidências selecionadas.

## Fontes

- Projeto original: https://github.com/tamaratran/fast-jev-compaction
- Contrato HTTP: https://docs.typesafe.ai/api
- Limites do Jev: https://docs.typesafe.ai/models
- Hooks e confiança: https://learn.chatgpt.com/docs/hooks

Adaptação produzida neste workspace para a configuração solicitada pelo usuário; não é um plugin oficial de OpenAI ou TypeSafe.
