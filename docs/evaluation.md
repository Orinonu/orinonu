# Evals e pesquisa do harness

A avaliação inicial contém oito casos de roteamento, quatro de desenvolvimento e quatro holdout. Busca limiares 0,6 / 0,8 / 0,9 em desenvolvimento; uma única validação final no holdout. Guarda hash do conjunto, resultados, uso e latência. Confiança do Jev é um sinal, não garantia estatística de correção.

Critérios provisórios: acurácia ≥90%, cobertura ≥50%, zero escolha insegura, pelo menos dez amostras pareadas de tarefas reais. O conjunto atual é smoke test, não certificação de qualidade do código. Nenhum limiar é aplicado automaticamente ao harness global. Sem amostras pareadas, o painel marca Precisa melhorar mesmo se os casos semânticos passarem.

Para um estudo real, fixe tarefas, testes de aceitação, versões, modelos, orçamento e configurações de cache. Rode referência e candidato em checkouts isolados equivalentes, alterne ordem e repita. Registre sucesso de testes, regressões, comandos falhos, tempo total, tokens de entrada/saída/cache e custo medido. Julgamento Jev pode auxiliar a triagem; testes e métricas independentes verificam a entrega. Não permita ao candidato editar os testes/evals usados para aceitá-lo.

Economia em USD só existe com custo medido ou tabela de preços datada explícita; economia em tempo exige execução equivalente de referência. Tokens de API não se convertem diretamente em franquia/créditos do Codex. Campos desconhecidos são null, nunca zero inventado. A latência do Jev e seus tokens entram no custo total do candidato.

Na interface, importe um JSON com `pairs`. Cada par tem `id`, `benchmark_id` (conjunto fixo de tarefas/testes), `controlled` e os braços `baseline` e `candidate`. Cada braço tem `config`, `accepted`, `seconds` (tempo total incluindo Jev), `cost_usd` (medido ou null) e `evidence` (referência do relatório de teste). O painel valida o formato, detecta regressão de aceitação e calcula diferenças, inclusive negativas. Importação não verifica os arquivos referenciados: reveja as evidências. Pares não controlados não contam para o mínimo de promoção. Consulte `docs/comparison-example.json`.

Adaptação de autoresearch: hipótese → candidato isolado → orçamento fixo → avaliação imutável → comparação com baseline → manter/rejeitar. A implementação atual explora apenas o limiar de roteamento em memória; não instala treinamento GPU nem roda experimentos indefinidos sem orçamento. A extensão para tarefas reais exige checkouts isolados e critérios verificáveis antes de qualquer promoção.
