# Diretrizes — Análise de dados com IA no ERPOS

> Conhecimento extraído de uma auditoria financeira real (EP Paranaguá, abril–julho/2026)
> conduzida manualmente ao longo de uma sessão inteira. O objetivo deste documento é que a
> análise automatizada **nasça sabendo o que só descobrimos errando**.
>
> Complementa `BRIEFING-EP-PARANAGUA.md`, que traz os fatos do negócio e os KPIs.
> Este aqui trata de **como a análise deve pensar** — vale para qualquer loja, não só a de Paranaguá.
> Última revisão: 2026-08-03.

---

## 1. A regra que governa tudo: triangulação

Nenhum número vira conclusão sem uma segunda fonte independente.

Na auditoria, o fator de consumo de junho só virou afirmação quando três medições feitas por
métodos e pessoas diferentes convergiram:

| Fonte | Fator |
|---|---:|
| Contagem física de estoque (semanal, Thatielle) | 1,09 |
| Caderno de saída do freezer (diário, WhatsApp) | 1,11 |
| Bebidas engarrafadas (contagem × compras × vendas) | 1,09 |

**Diretriz:** o sistema deve marcar cada conclusão com seu nível de confirmação.
Uma medição = hipótese. Duas independentes que convergem = conclusão. Duas que divergem =
**problema de dado**, e o alerta deve ser sobre a divergência, não sobre o negócio.

---

## 2. Hierarquia de confiabilidade das fontes

Nem toda medição vale o mesmo. Quando duas discordam, esta ordem decide quem ganha:

| Nível | Fonte | Por quê |
|---|---|---|
| 1 | **Unidade fechada** (barril, caixa lacrada) | Não admite erro de estimativa. Foi o que sustentou o achado do chope quando tudo mais foi revisado. |
| 2 | **Contagem física pesada** (balança) | Erro pequeno e aleatório |
| 3 | **Extrato bancário** | Verdade sobre dinheiro que se moveu |
| 4 | **Maquininha** | Verdade sobre dinheiro que entrou |
| 5 | **Sistema de venda (TOTVS/PDV)** | Depende de o operador ter lançado |
| 6 | **Contagem física estimada** ("meio pacote", "1 peça") | Erro pode ser da ordem do que se está medindo |
| 7 | **Consumo derivado por fórmula** | Herda o erro de todas as parcelas |

**Diretriz prática:** quando o erro possível de leitura é da mesma ordem do desvio medido,
o resultado não é conclusão — é ruído. Na mussarela, 2,27 kg de desvio medidos a partir de
uma contagem escrita como "882" sem vírgula não sustentam ação. No chope, 155 litros
medidos por barril fechado sustentam.

---

## 3. Constante × pontual: o diagnóstico que separa causa

Ler o desvio **ao longo do tempo** vale mais que o valor agregado. Os dois padrões pedem
soluções opostas:

| Padrão | Exemplo real | Causa provável | Solução |
|---|---|---|---|
| Alto e **constante** em todas as janelas | Sour cream: 2,10 / 1,79 / 2,17 / 1,55 | Porção errada | Balança + treino (20 min) |
| Alto e **pontual**, volta ao normal | Barbacoa: 2,96 → 0,95 → 1,15 → 0,21 | Evento com data | Investigar aquele turno |
| **Baixo** persistente (< 0,7) | Chilli com soja: 0,42 | Compra em excesso | Ajustar pedido, não a cozinha |

**Diretriz:** todo KPI de variância deve ser calculado por janela e apresentado como série,
nunca só como total do mês. O agregado de junho escondia que o problema tinha data.

---

## 4. Valores impossíveis são sinal de dado ruim, não achado

Consumo negativo, estoque que cresce sem entrada, venda maior que o consumo físico:
o sistema deve **classificar como erro de dado** e sinalizar para revisão — nunca reportar
como resultado de negócio.

Casos reais que apareceram: pernil com consumo −4 pacotes numa semana; chilli com soja −1;
tortilha com 612 unidades consumidas contra 245 justificadas, sendo que os três lotes foram
lançados a R$ 1,07, R$ 2,46 e R$ 3,49 a unidade — sinal claro de quantidade digitada em
unidades diferentes (caixa × pacote × unidade).

**Diretriz:** validação na entrada resolve isso de graça. Campo numérico tipado, unidade em
coluna própria, e uma checagem de sanidade (`consumo >= 0`, `preço_unitário` dentro de ±30%
da média histórica do insumo) antes de gravar.

---

## 5. Período mente. Bimestre não.

O CMV mensal é distorcido sempre que a compra não acompanha a venda:

| | Junho | Julho | Bimestre |
|---|---:|---:|---:|
| Compras / receita | 52,9% | 33,8% | — |
| Variação de estoque | +2.508 | −693 | — |
| Fator | 1,30 | 0,96 | **1,09** |

Junho comprou para o julho forte que vinha. Nenhuma das duas leituras mensais é a verdade;
o bimestre é.

**Diretriz:** todo relatório de CMV deve exibir mês **e** acumulado móvel de 2–3 meses lado a
lado, e disparar um aviso automático quando `compras / receita` sair da faixa de 30–40% —
sinal de que o mês vai mentir.

---

## 6. Uma base de receita por relatório, sempre declarada

O erro mais sutil da sessão: percentuais por família calculados sobre a receita do TOTVS
(R$ 53.278) comparados com um CMV real calculado sobre a receita do DRE (R$ 60.322).
Os números individuais estavam certos; a comparação não existia.

**Diretriz:** todo indicador percentual carrega, no metadado, qual base de receita usou.
O sistema recusa comparar dois indicadores de bases diferentes — ou converte explicitamente
e informa que converteu.

---

## 7. Toda fonte de venda está incompleta até prova em contrário

| Fonte | Junho | Julho | O que falta |
|---|---:|---:|---|
| Goomer | 26.765 | — | Dinheiro e parte dos pedidos |
| TOTVS | 35.619 | 53.278 | **A maior parte do iFood** |
| DRE (maquininha + iFood + Goomer) | 37.715 | 60.322 | — |

O "furo de R$ 6,9 mil entre maquininha e sistema" que atravessou metade da análise era o
painel Goomer incompleto. E o TOTVS registrou R$ 2.126 de iFood em julho contra R$ 9.093
no DRE.

**Diretriz:** o sistema deve reconciliar as fontes de venda **antes** de qualquer análise de
consumo, e recusar-se a calcular CMV teórico quando a cobertura estiver abaixo de um limiar
(sugestão: 95% da receita do DRE). Um teórico calculado sobre base incompleta nasce
subestimado e faz o fator parecer pior do que é.

---

## 8. O contrato de saída de qualquer análise

Um relatório automático que diz *"CMV alto, revisar porções"* não vale nada. Todo output
deve trazer, obrigatoriamente:

1. **A conta aberta.** `0,882 + 15,7 − 5,75 = 10,84 kg` — não só o resultado.
2. **A fonte de cada parcela.** "contagem 01/06", "pedido 19/06 nota X", "TOTVS linha Y".
3. **As premissas declaradas.** "assumindo que a compra de 19/06 foi entregue em junho".
4. **O nível de confirmação.** Uma fonte ou duas? Convergem?
5. **A margem de erro quando ela é da ordem do achado.** Dizer explicitamente quando o
   desvio não sustenta ação.
6. **O que fazer, com valor.** "porção do sour cream: R$ 152/mês" — não "revisar processos".

Foi exatamente por a conta estar aberta que os erros desta sessão foram pegos: o usuário viu
"mussarela não contada" e respondeu "mas foi contada, deu 5,75 kg". Se o relatório tivesse
dito apenas "estoque incompleto", o erro teria sobrevivido.

---

## 9. Regras para o prompt do analista

Quando for implementar, o `system` prompt precisa carregar — além do conhecimento de negócio
do `BRIEFING`:

- **Sempre mostrar a aritmética.** Nunca entregar só a conclusão.
- **Declarar premissas** e marcar quais mudariam o resultado se erradas.
- **Não afirmar sem segunda fonte.** Uma medição isolada é hipótese, e deve ser rotulada como tal.
- **Classificar impossíveis como erro de dado**, nunca como achado.
- **Distinguir constante de pontual** ao diagnosticar variância.
- **Recusar-se a concluir** quando a margem de erro é da ordem do desvio — e dizer por quê.
- **Nunca truncar dados em silêncio.** Se não coube, avisar.
- **Priorizar por dinheiro**, não por percentual. Um fator 2,97 num item de R$ 65 importa
  menos que 1,28 num de R$ 480.

E uma regra de contexto: **não mandar o banco inteiro para o modelo.** Manda o resultado de
uma query já agregada (dezenas de linhas), não milhares de registros. Custo, latência e
qualidade melhoram juntos.

---

## 10. Segurança e limites

- **Ferramentas de leitura apenas.** O modelo escolhe qual query chamar e com quais
  parâmetros; **nunca escreve SQL.** Queries parametrizadas, sempre com `tenant_id`.
- **Nenhuma ação com efeito colateral por decisão do modelo.** Análise sugere; humano executa.
- **Dados de pessoas** (folha, nomes de funcionários) só entram na análise quando a pergunta
  exige, e a saída não deve nomear pessoas em conclusões sobre desvio — a auditoria mostrou
  que a coincidência entre troca de equipe e anomalia é *pista de investigação*, não conclusão.
- **Alerta é caro.** Um sistema que dispara todo dia é ignorado em duas semanas. Calibrar
  limiares pelo que exige ação, não pelo que é estatisticamente diferente.

---

## 11. O princípio que resume tudo

O problema da loja nunca foi falta de dado — era dado atrasado 40 dias e espalhado por cinco
sistemas que não conversam.

**A meta da análise automatizada não é "ver tudo". É encurtar o ciclo de descoberta de seis
semanas para um dia nos poucos números que mudam decisão.**

A diferença entre descobrir o chope sumindo no dia 10 ou no dia 60 foi de uns R$ 4 mil. Todo
o resto — dashboards, gráficos, relatórios bonitos — é secundário a isso.
