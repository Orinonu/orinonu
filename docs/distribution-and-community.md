# Distribuição e comunidade

O objetivo é permitir que cada instalação configure suas próprias credenciais da TypeSafe e autentique sua própria assinatura do Codex. O código-fonte não deve carregar chaves, tokens de login, histórico privado, bancos locais, diretórios de trabalho dos agentes ou resultados de sessões pessoais.

## Antes de uma publicação

- Manter configuração e credenciais em diretório privado do usuário, fora do checkout.
- Distribuir exemplos de configuração sem segredos e instruções de instalação reproduzíveis.
- Validar uma instalação limpa, preservação de configurações e atualização sem perda das missões.
- Revisar arquivos e histórico Git em busca de segredos antes de criar qualquer repositório público.
- Registrar autoria, licenças de dependências e referências; análise de funcionalidades não autoriza copiar código.

## Licença e produtos

O código próprio do Orinonu usa PolyForm Noncommercial 1.0.0 (`LICENSE`): a classificação é source-available, não open source OSI. `NOTICE` identifica o titular; componentes de terceiros mantêm suas licenças e permissões. Contribuições seguem `CONTRIBUTING.md`, `CLA.md` e a direção oficial em `GOVERNANCE.md`.

O núcleo comunitário permanece disponível nos termos da licença não comercial. Serviços oficiais hospedados, infraestrutura, processamento e suporte poderão ser pagos. Contribuições incorporadas aos serviços exigem a autorização adicional explicitamente aceita no CLA. Multiusuário e cobrança ainda exigem implementação; documentos e testes locais não comprovam publicação externa ou configuração de proteções no GitHub.

## Configuração por instalação

O painel de Configurações deve apresentar o estado da TypeSafe, o modelo de decisão configurado e a autenticação Codex. Nunca deve retornar a chave salva pela API, incluí-la em logs, guardá-la no localStorage ou inseri-la nos prompts dos agentes. Alterar credenciais não concede novas permissões às missões.
