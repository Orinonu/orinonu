# Jev Decisions para Codex no Windows

MCP stdio pequeno, sem dependências npm: Node.js 22+ e PowerShell. Duas ferramentas consultam Jev 1.13.0 quando uma decisão semântica compensa uma chamada externa.

- `rank_evidence`: recebe objetivo e candidatos encontrados por `rg`/leitura limitada; retorna prioridade com Score e confiança, IDs restantes e IDs incertos. Não elimina os candidatos nem lê arquivos por conta própria.
- `evaluate_conditions`: agrupa até 24 julgamentos Noul independentes sobre um estado textual. Retorna probabilidades, sem executar ações ou autorizar comandos.

Use terminal/código para buscas, contagens, cálculo, exit codes e testes. Use Jev quando a ambiguidade semântica causa exploração ou análise repetida. Depois do ranking, leia o arquivo original e confirme se contém a evidência necessária. Amplie a busca se a shortlist for incompleta. Uma probabilidade não substitui aceite nem autorização.

O wrapper lê `TYPESAFE_API_KEY` da variável de ambiente do usuário do Windows. A chave não fica no `config.toml`, nos fontes ou nos relatórios. O servidor aplica redação básica de credenciais ao conteúdo enviado; não é um detector completo de informações sensíveis. Envie somente o contexto necessário ao objetivo.

Limites: 32 candidatos, 4.000 caracteres por trecho, até 22.000 bytes UTF-8 no pedido completo, 5 segundos por chamada e até seis chamadas simultâneas, com fila de 64 pedidos (o limite oficial é de 80 pedidos por segundo). A entrada excedente é rejeitada, sem truncamento silencioso. Erros de rede/contrato preservam todos os IDs. Há uma única repetição, com espera, para 429 e 529; os demais erros HTTP não são repetidos. Cache local em memória por conteúdo/perguntas/modelo/política: até 128 entradas, cinco minutos; reiniciar o processo limpa o cache. O cache não guarda decisões em arquivo.

A incerteza indicada é um sinal provisório: confiança Score abaixo de 0,6; Noul entre 0,15 e 0,85. Esses limites não foram calibrados em projetos reais e não controlam exclusão de evidência ou ações.

Validação: 12 testes automatizados de contrato/fallback/cache/cancelamento e seis casos sintéticos em português com API real. Todas as evidências exigidas ficaram entre os três primeiros; um caso sem correspondência recebeu notas baixas. Essa amostra não estima acurácia de produção nem economia de franquia. Os resultados completos estão em `validacao-jev-decisions.json`.

Instalação global: `%USERPROFILE%\.codex\tools\jev-decisions`, referenciada por `[mcp_servers.jev_decisions]` em `%USERPROFILE%\.codex\config.toml`. O Codex carrega a ferramenta ao iniciar/recarregar a conexão MCP. Reiniciar o aplicativo e abrir uma nova conversa aplica a configuração às novas instâncias. O modelo/esforço padrão e os hooks existentes são configurações independentes.

Para desabilitar: ajuste `enabled = false` no bloco `mcp_servers.jev_decisions` e recarregue o Codex. Não precisa apagar arquivos nem a chave usada pela compactação. Há backup do `config.toml` global anterior à instalação.

O servidor anuncia somente tools; não fornece prompts, recursos, execução de comandos nem roteamento automático de modelos. Segue transporte JSON-RPC em linhas do [MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) e API [TypeSafe](https://docs.typesafe.ai/api), usando [Score](https://docs.typesafe.ai/primitives/score) para relevância e [Noul](https://docs.typesafe.ai/primitives/noul) para condições. Combina recuperação seguida de [reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe) com [perguntas independentes em lote](https://docs.typesafe.ai/cookbooks/parallel_questions).
