# Contribuir com o Orinonu

O Orinonu recebe contribuições de código, acessibilidade, design, testes, documentação, investigação e relatos de problemas. O código próprio está disponível para finalidades permitidas pela PolyForm Noncommercial License 1.0.0; isso é source-available, não open source OSI. Leia `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `GOVERNANCE.md` e, para contribuições de código, `CLA.md`.

## Um propósito compartilhado

A carta oficial em `GOVERNANCE.md` orienta a colaboração. A comunidade evolui os meios, sem redefinir automaticamente missão, visão, valores ou princípios. O mantenedor @ori-inonu aprova a integração ao projeto oficial e decide propostas de mudança fundamental. Os objetivos dos projetos de quem instalar o sistema continuam configuráveis.

## Antes de implementar

1. Consulte issues e pull requests existentes para evitar trabalho duplicado. Abra uma proposta com o problema, o objetivo da carta atendido e os critérios verificáveis.
2. Discuta alterações grandes ou fundamentais antes de implementar. Identifique riscos de segurança, privacidade, custos, compatibilidade e licenças.
3. Faça fork e trabalhe em uma branch própria. Separe mudanças independentes e preserve contratos, formatos persistidos e migrações compatíveis.
4. Para novos recursos visuais, use os tokens compartilhados em `public/brand.css`, as primitivas existentes e a identidade Orinonu. Preserve foco, navegação por teclado, layout móvel e movimento reduzido. Cores não substituem rótulos de estado.

## Verificação

```powershell
npm --prefix frontend ci
npm test
npm run check:ui
npm run test:ui
npm run build:ui
python tests/configure_test.py
```

Use o runtime descrito no README e execute os testes pertinentes antes dos testes completos. Casos de aceitação e benchmarks são independentes da implementação; preservar seu objetivo é mais importante que fazer um teste passar alterando o esperado. Testes devem usar dados sintéticos, executores simulados e diretórios isolados; não iniciar inferências pagas, missões reais ou instalações globais como validação automática.

## Conteúdo do pull request

- Problema e objetivo atendido; princípios da carta preservados.
- Solução, alternativas relevantes e compatibilidade.
- Critérios verificáveis, comandos executados e resultados reais; limites não verificados.
- Impactos de privacidade, segurança, dependências e materiais de terceiros.
- Para código original: aceite explícito do CLA versão 1.0 com identificação dos commits, como descrito em `CLA.md`. Cada colaborador mantém autoria; o acordo permite a licença pública não comercial e os serviços oficiais pagos, sem fechar o núcleo comunitário.

A revisão pode pedir ajustes ou recusar uma proposta incompatível com a direção. Isso não retira os direitos de uso ou de fork concedidos pelas licenças aplicáveis.

## Segurança e privacidade

Compartilhe somente código e evidências sanitizadas. Credenciais, bancos de dados, backups, logs, transcrições, objetivos privados, contas pessoais e diretórios de execução não pertencem ao repositório. Para relatar uma vulnerabilidade, contate o mantenedor por um canal privado previamente confirmado; não publique segredos ou uma exploração ativa em issues públicas.

## Respeito à marca

Orinonu é um nome autoral inspirado por consciência, ferramentas, caminhos e observação. Não apresenta sua narrativa como tradução linguística certificada ou como tradição religiosa estabelecida. Referências culturais são tratadas com respeito; marcas de provedores integrados não sugerem afiliação oficial. Forks devem identificar sua independência e não se passar pela distribuição oficial.
