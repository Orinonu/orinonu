# Referência anterior à otimização de /api/state

Snapshots de código público do workspace, capturados antes das alterações desta execução.

- `src/server.mjs` original SHA-256: `3a58384ec274e2d51968ce29505444905596137937af453251505c95c5cc11d5`.
- `src/pricing.mjs` original SHA-256: `094d07bdc98ebff5399211fa35fe1f9b994357b6069f073534193224c9830b34`.

`server.mjs` tem apenas caminhos de imports ajustados para esta pasta; pricing aponta para a cópia congelada. As demais dependências são compartilhadas e não foram modificadas nesta missão. Não usar a referência para servir arquivos estáticos: o benchmark consulta somente a API. Não regenerar estes arquivos a partir do candidato: testes diferenciais e benchmark precisam da semântica anterior independente.

Nenhum diário, SQLite, configuração privada ou credencial foi copiado. Fixtures são sintéticas, criadas em diretórios temporários e removidas pelo harness.
