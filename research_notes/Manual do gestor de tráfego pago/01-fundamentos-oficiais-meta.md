# Fundamentos oficiais do Meta Ads (estado em 2026)

**Nota metodológica importante:** o ambiente de pesquisa bloqueia acesso direto (WebFetch/curl) aos domínios `facebook.com`, `developers.facebook.com`, `business.facebook.com` e `transparency.meta.com` (erro `EGRESS_BLOCKED` / `connect_rejected` por política de rede do ambiente). Não foi possível abrir essas páginas diretamente para citar o texto integral. As afirmações abaixo atribuídas a essas URLs vêm de **buscas (WebSearch)** cujos resultados retornaram trechos/citações dessas páginas oficiais — a URL é a página oficial correta (confirmada pelo título e pelo domínio nos resultados de busca), mas o trecho citado é o que a busca devolveu, não uma leitura integral verificada por mim da página. Onde isso se aplica, marco explicitamente "via busca, não verificado por leitura direta". Datas de acesso: 2026-09-27.

---

## 1. Estrutura de conta (campanha → conjunto de anúncios → anúncio; CBO/Advantage+ vs orçamento no conjunto)

### Takeaway
A hierarquia campanha → conjunto de anúncios (ad set) → anúncio continua sendo a estrutura básica do Meta Ads em 2026. O que mudou foi a nomenclatura e o padrão: "Campaign Budget Optimization" (CBO) foi renomeado para **"Meta Advantage+ campaign budget"** e, segundo fontes secundárias, passou a ser o padrão em novas campanhas a partir de fevereiro de 2026 (não confirmado por leitura direta da página oficial).

### Cited Findings
- "Meta Advantage+ campaign budget (formerly campaign budget optimization) automatically manages your campaign budget across ad sets to achieve optimal results at the lowest cost. Your budget, enabled by Meta AI, continuously distributes to ad sets with the best opportunities in real time throughout the course of your campaign." — [Meta for Business — Advantage+ Campaign Budget](https://www.facebook.com/business/ads/meta-advantage-plus/budget) (via busca, não verificado por leitura direta; página não tem data visível na busca)
- Estrutura de duas abordagens de orçamento continua existindo: orçamento no nível da campanha (Advantage+/CBO), que Meta distribui automaticamente entre os conjuntos de anúncios, versus orçamento no nível do conjunto de anúncios (ABO — Ad Set Budget Optimization), no qual o gestor define o valor de cada conjunto manualmente — [Meta for Business — Advantage+ Campaign Budget](https://www.facebook.com/business/ads/meta-advantage-plus/budget) (via busca)
- Fonte secundária (não oficial) afirma que "em fevereiro de 2026, Meta fez do Advantage+ o padrão para todas as novas campanhas, fundindo os fluxos manual e automatizado em uma única configuração" — [1clickreport.com — Meta Advantage+ Campaign Setup Guide 2026](https://www.1clickreport.com/blog/meta-advantage-plus-campaign-setup-2026) (secundária, sem confirmação oficial direta)
- Fonte secundária cita depreciação de APIs de campanha legadas em favor da estrutura Advantage+, incluindo remoção do campo `smart_promotion_type` para criação de campanhas a partir da v25.0 da Marketing API — [ppc.land — "Meta deprecates legacy campaign APIs for Advantage+ structure"](https://ppc.land/meta-deprecates-legacy-campaign-apis-for-advantage-structure/) (secundária; não foi possível abrir a página para confirmar o texto exato, domínio bloqueado no ambiente)

### Inferences
- A estrutura de três níveis (campanha/conjunto/anúncio) não mudou; o que mudou é o quanto de decisão de orçamento e segmentação fica automatizado por padrão (Advantage+ como default), reduzindo o controle manual granular que antes era a norma.

### Gaps
- Não consegui confirmar por leitura direta da página oficial (`facebook.com/business/help/...` sobre CBO/Advantage+ budget) o texto completo, condições exatas de elegibilidade, ou se "default" realmente significa que ABO deixou de ser oferecido como opção — isso precisa ser conferido diretamente no Gerenciador de Anúncios ou em fonte oficial acessível.
- Não encontrei a página oficial do Marketing API changelog (bloqueada) para confirmar exatamente em qual versão `smart_promotion_type` foi removido — cito apenas a alegação de fonte secundária.

---

## 2. Objetivos de campanha atuais (as 6 OUTCOME) e quais optimization goals/destinos cada um suporta

### Takeaway
Meta consolidou os objetivos de campanha no framework **ODAX (Outcome-Driven Ad Experiences)**, com 6 objetivos: `OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_SALES` e `OUTCOME_APP_PROMOTION`. Para click-to-WhatsApp (destino de conversas), 4 objetivos são elegíveis (`OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_SALES`, `OUTCOME_TRAFFIC`), mas cada um expõe metas de otimização diferentes; em `OUTCOME_LEADS` o goal de otimização é `CONVERSATIONS` (ou, mais recentemente, otimização por lead/qualificação de lead dentro do WhatsApp).

### Cited Findings
- "The six ODAX campaign objectives in Facebook Ads are: Awareness, Traffic, Engagement, Leads, App Promotion, and Sales" e "All six are built on the ODAX (Outcome-Driven Ad Experiences) framework, fully rolled out across Facebook, Instagram, and Threads in 2025" — [get-ryze.ai — Meta Ads Campaign Objectives Explained (2026)](https://www.get-ryze.ai/blog/meta-ads-campaign-objectives-explained) (secundária; conteúdo consistente com a nomenclatura oficial `OUTCOME_*` da Marketing API, mas não confirmado por leitura da doc oficial)
- "Four campaign objectives are eligible for Click to WhatsApp ads: OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES, and OUTCOME_TRAFFIC, and each one exposes a different menu of optimization goals" — [adlibrary.com — Meta Click-to-WhatsApp Ads: Complete 2026 Setup Guide](https://adlibrary.com/posts/meta-click-to-whatsapp-ads-guide) (secundária)
- "OUTCOME_LEADS, the objective most CTWA advertisers reach for, allows exactly one optimization goal: CONVERSATIONS" — [customerlabs.com — Why Meta Algorithm Chases Chatters, Not Buyers For CTWA Ads?](https://www.customerlabs.com/blog/why-meta-algorithm-chases-chatters-not-buyers-for-ctwa-ads/) (secundária)
- "Meta has launched lead optimization for ads that click to WhatsApp. Previously, click-to-WhatsApp ads could only optimize for conversations. Now they can optimize for actual leads generated. [...] businesses using lead-optimized WhatsApp ads have seen 24% lower cost per lead compared to conversation-optimized campaigns" — [wpreset.com — Meta Ads WhatsApp Lead Generation Best Practices for Agencies in 2026](https://wpreset.com/meta-ads-whatsapp-lead-generation-best-practices-for-agencies-in-2026-from-click-to-chat-campaigns-to-qualified-leads/) (secundária — indica uma evolução relevante de 2025→2026 no destino WhatsApp, de "otimizar por conversa" para "otimizar por lead", mas não localizei o anúncio oficial correspondente do Meta for Developers/Business Help Center)
- "The ctwa_clid is the only durable link between a specific ad click and a specific WhatsApp conversation, and ctwa_clid is valid for a 7-day post-click attribution window" — [customerlabs.com](https://www.customerlabs.com/blog/why-meta-algorithm-chases-chatters-not-buyers-for-ctwa-ads/) (secundária)
- Para vendas com pixel/CAPI (compras), o goal de otimização típico continua sendo conversões offsite/on-site (histórico: `OFFSITE_CONVERSIONS`, atualmente reportado sob `OUTCOME_SALES`), com `LANDING_PAGE_VIEWS` disponível como meta de otimização de tráfego mais qualificado (visualizações de página de destino carregada) dentro de `OUTCOME_TRAFFIC` — inferido de fontes secundárias, **não confirmado com nomenclatura oficial de campo por falta de acesso à doc da API**.

### Inferences
- Para o setor de restaurante/delivery com WhatsApp como canal principal, a escolha mais alinhada às recomendações de Meta em 2026 tende a ser `OUTCOME_LEADS` com destino de conversas do WhatsApp, testando o goal de otimização por lead (mais recente) contra `CONVERSATIONS` (mais antigo/estável), dado o ganho de custo por lead relatado.

### Gaps
- Não consegui acessar a documentação oficial de referência de campos (`developers.facebook.com/docs/marketing-api/reference/ad-campaign` e o guia de `destination_type`/`optimization_goal`) para listar exaustivamente, por objetivo, todas as combinações válidas de `optimization_goal` × `destination_type` × `promoted_object` (isso é bloqueado no ambiente). Recomendo ao gestor validar a combinação exata dentro do Gerenciador de Anúncios (a interface só oferece as combinações válidas) ou puxar a doc oficial de um ambiente sem esse bloqueio.
- Não confirmei se `destination_type: WHATSAPP` continua sendo o nome de campo atual na Marketing API ou se foi renomeado/depreciado em 2025-2026.

---

## 3. Fase de aprendizado (learning phase)

### Takeaway
A regra histórica de "50 eventos de otimização em 7 dias" por conjunto de anúncios para sair da fase de aprendizado segue sendo citada como vigente em 2026 por múltiplas fontes secundárias que remetem à página oficial "Learning Phase" do Meta Business Help Center, mas eu não consegui abrir essa página diretamente (bloqueio de rede) para citar o texto oficial literal.

### Cited Findings
- Página oficial identificada: "Learning Phase | Meta Business Help Center" — [facebook.com/business/help/411605549765586](https://www.facebook.com/business/help/411605549765586) (bloqueada para leitura direta neste ambiente; localizada via busca)
- Página oficial identificada: "Significant Edits and Learning Phase | Meta Business Help Center" — [facebook.com/business/help/316478108955072](https://www.facebook.com/business/help/316478108955072) (idem, bloqueada)
- Página oficial identificada: "About learning limited | Meta Business Help Centre" — [facebook.com/business/help/269269737396981](https://en-gb.facebook.com/business/help/269269737396981) (idem, bloqueada)
- Página oficial identificada: "Last Significant Edit | Meta Business Help Center" — [facebook.com/business/help/942374239243867](https://www.facebook.com/business/help/942374239243867) (idem, bloqueada)
- Resumo agregado por busca (não é citação literal da página oficial, é uma síntese do buscador a partir de vários resultados): "the learning phase ends once an ad set generates 50 optimization events within a 7-day rolling window"; "the count includes browser pixel events, CAPI server-side events, and modeled (inferred) conversions — all at ad set level, not per individual ad"; "when an ad set isn't getting enough optimization events to exit the learning phase, the Delivery column reads 'Learning limited,' which isn't a penalty but an indication that budget isn't being spent effectively because the ad delivery system can't optimize performance"; "a significant edit occurs when you pause your ad set or make a change to optimization event, audience or creative, and changes to bid strategy or budget may also be significant depending on the magnitude of the change" — via busca agregada a partir de [Meta Business Help Center (learning phase)](https://www.facebook.com/business/help/411605549765586) e [Meta Business Help Center (significant edits)](https://www.facebook.com/business/help/316478108955072)
- A regra de "alteração de orçamento acima de 20% reinicia a fase de aprendizado" aparece **apenas em fontes secundárias** ("significant edits, including budget shifts above 20 percent, new creative, optimization event changes, or major audience updates, restart the phase" — [adlibrary.com — Meta Ads Learning Phase 50 Events: The Complete Explainer](https://adlibrary.com/posts/meta-ads-learning-phase-50-events-guide)). **Não encontrei o número "20%" atribuído textualmente à página oficial "Significant Edits and Learning Phase"** nos resultados de busca — é uma cifra amplamente repetida por agências, mas eu não tenho confirmação de que ela está escrita literalmente na página oficial atual.

### Inferences
- É prudente para o gestor tratar "50 eventos/7 dias" como a regra prática confirmada por consenso amplo de fontes secundárias que remetem à página oficial correta, mas tratar o "20% de mudança de orçamento" como uma heurística de mercado/agência, não uma regra numerada oficialmente confirmada — a menos que o próprio Gerenciador de Anúncios mostre esse número em algum aviso de UI (o que seria uma fonte de primeira mão observável na conta).

### Gaps
- **Gap crítico:** não consegui verificar, por leitura direta da página oficial, se o texto de Meta menciona algum percentual específico (20% ou outro) para "mudança significativa de orçamento". Isso precisa ser confirmado em um ambiente com acesso a `facebook.com/business/help/316478108955072`, ou diretamente no aviso que o Gerenciador de Anúncios exibe ao editar o orçamento de um conjunto em aprendizado.
- Não confirmei a lista completa e oficial (verbatim) de quais edições contam ou não como "significativas" — a busca deu apenas uma paráfrase.

---

## 4. Leilão (auction): valor total, bid × taxa de ação estimada, qualidade do anúncio; rankings

### Takeaway
A fórmula difundida (inclusive por Meta em materiais de negócio) é **Valor Total = Lance × Taxa de Ação Estimada + Qualidade e Relevância do Anúncio**, e o vencedor do leilão é quem tem maior valor total, não maior lance. A "pontuação de relevância" única foi substituída por três "Ad Relevance Diagnostics": Quality Ranking, Engagement Rate Ranking e Conversion Rate Ranking.

### Cited Findings
- "The auction selects the ad with the highest total value, not the highest bid. An ad with a lower bid can easily outperform a higher-bidding competitor if it scores better on estimated action rates and ad quality" — síntese de busca a partir de múltiplas fontes secundárias (dotidot.io, wittelsbach.ai, clarigital.com); página oficial correspondente não localizada/acessada diretamente. (secundária)
- Componentes: "Bid: the maximum you are willing to pay for the objective action... Estimated Action Rate: Meta's prediction of how likely a specific user is to take the specific action... Ad Quality: an assessment of ad creative quality based on feedback from users... Ads that receive high engagement, low negative feedback (hide, report), and strong post-click experience score higher" — via busca (secundária, mas conteúdo alinhado ao que Meta descreve publicamente sobre o leilão)
- Página oficial identificada: "About Ad Relevance Diagnostics | Meta Business Help Center" — [facebook.com/business/help/403110480493160](https://www.facebook.com/business/help/403110480493160) (bloqueada para leitura direta; localizada via busca)
- Página oficial identificada: "About Quality Ranking | Meta Business Help Center" — [facebook.com/business/help/303639570334185](https://www.facebook.com/business/help/303639570334185) (idem)
- "Quality Ranking shows how your ad's perceived quality compared to ads competing for the same audience... Engagement Rate Ranking shows how your ad's expected engagement rate compared to ads competing for the same audience... Conversion Rate Ranking reveals how your ad's expected conversion rate compares to ads with the same optimization goal competing for the same audience. Each metric is rated Above Average, Average, or Below Average... The diagnostic metrics appear at the ad level once an ad clears 500 impressions" — via busca agregada, atribuída às páginas oficiais acima (não é citação literal verificada por leitura direta)

### Inferences
- Para o gestor de tráfego, a implicação prática é: melhorar qualidade de criativo e reduzir feedback negativo (esconder anúncio, denunciar) tem efeito direto no custo/leilão, tanto quanto ajustar o lance — e as três rankings (não mais uma "relevance score" única) são a ferramenta de diagnóstico correta a monitorar por anúncio, mas só após ~500 impressões.

### Gaps
- Não consegui confirmar a fórmula exata (com ou sem multiplicação vs. soma) na fonte oficial primária — fontes secundárias divergem entre "Bid × Taxa de Ação + Qualidade" e "Bid × Taxa de Ação × Qualidade". Isso precisa ser verificado na doc oficial (Business Help Center / Blueprint) quando houver acesso.

---

## 5. Estratégias de lance (bid strategies)

### Takeaway
Quatro estratégias seguem sendo as citadas em 2026: **Lowest Cost** (menor custo, sem teto, recomendada para maioria dos casos/fase de aprendizado), **Cost Cap** (teto de custo médio por ação, para escalar com previsibilidade de CPA), **Bid Cap** (teto rígido por leilão — uso avançado/raro) e **ROAS mínimo / meta de ROAS** (para priorizar retorno sobre gasto, tipicamente e-commerce/vendas). Não localizei a nomenclatura oficial atual verbatim (ex.: se "Minimum ROAS" e "Cost Cap" ainda são os nomes exatos usados na interface/documentação 2026).

### Cited Findings
- "Lowest Cost bidding is all about getting the most results possible within your set budget, without any constraints on cost. It is ideal for new campaigns and learning phase" — via busca (secundária, múltiplas fontes convergentes: jonloomer.com, adlibrary.com, benly.ai, stackmatix.com)
- "Cost Cap... allows you to set a maximum average cost for each desired action, such as a purchase, lead, or other conversions... helps ensure you don't exceed your target CPA, while still enabling you to reach a larger audience" — via busca (secundária)
- "Bid Cap — you set a hard per-auction ceiling; Meta cannot exceed it on any individual bid... This should rarely be used, and only if you understand predicted conversion rates" — via busca (secundária, jonloomer.com)
- "By setting a minimum ROAS goal, you effectively tell Meta to prioritize delivering your ads only in situations where the expected return justifies the cost... useful for e-commerce businesses or any advertiser focused on profitability" — via busca (secundária)
- "Start with lowest cost for learning, graduate to cost cap for controlled scaling, and consider ROAS goals for value optimization" — via busca (secundária, resumo agregado)

### Inferences
- Nenhuma das citações acima veio de uma página oficial da Meta que eu tenha efetivamente aberto — são todas de agências/blogs especializados (Jon Loomer Digital é uma fonte secundária respeitada no setor, mas ainda secundária). O conteúdo é consistente entre si e com o conhecimento de treinamento sobre o assunto, o que aumenta a confiança, mas **isso não substitui a citação oficial**.

### Gaps
- **Gap:** não consegui localizar/abrir a página oficial de referência de bid strategies (`facebook.com/business/help/...` ou developers.facebook.com sobre `bid_strategy` — valores como `LOWEST_COST_WITHOUT_CAP`, `COST_CAP`, `LOWEST_COST_WITH_BID_CAP`, `LOWEST_COST_WITH_MIN_ROAS`). Recomendo verificar a Marketing API reference (`Ad Set > bid_strategy`) diretamente quando houver acesso, para confirmar os nomes de enum atuais em 2026 e se algum foi descontinuado/renomeado.

---

## 6. Orçamentos mínimos e diário vs. vitalício (lifetime)

### Takeaway
O mínimo técnico da plataforma segue sendo citado como US$1/dia por conjunto de anúncios, mas esse valor é considerado irrelevante na prática — o "mínimo prático" para conseguir sair da fase de aprendizado (50 eventos/semana) é muito maior. Não encontrei confirmação oficial literal do valor de US$1/dia.

### Cited Findings
- "Meta's platform minimum is $1/day per ad set. However, a $1/day conversion campaign generates roughly 70 to 100 impressions daily, nowhere near enough for the algorithm to find your audience or exit the learning phase" — via busca (secundária, tryvizup.com/stackmatix.com)
- "A Daily Budget allows you to set a specific amount to spend each day... A Lifetime Budget lets you set a total budget for the entire duration of your ad campaign. For campaigns using lifetime budgets, Meta requires the lifetime budget to equal at least the daily minimum multiplied by the number of scheduled days" — via busca (secundária)
- "Meta recommends starting with at least $5 and running the campaign for a minimum of six days to give the algorithm enough time and spend to exit the learning phase and optimize delivery" — via busca (secundária; atribuição a "Meta recomenda" não confirmada em página oficial acessada diretamente)

### Inferences
- Para uso prático no BRIEFING-EP-PARANAGUA (loja de restaurante), o piso técnico de US$1/dia é irrelevante para planejamento — o gestor deve dimensionar orçamento pela meta de 50 eventos de otimização/semana, não pelo mínimo da plataforma.

### Gaps
- Não confirmei o valor mínimo em reais (R$) para contas brasileiras — o mínimo pode variar por moeda/país e a cifra de "US$1" pode não corresponder exatamente ao mínimo em BRL. Precisa checagem direta no Gerenciador de Anúncios da conta em questão.

---

## 7. Frequência e alcance (reach)

### Takeaway
Definições estáveis e sem mudança relevante identificada para 2025-2026.

### Cited Findings
- "Frequency is the average number of times each person saw your ad" — [Meta Business Help Center — Glossary of Reach and Frequency Terms](https://www.facebook.com/business/help/230299314945919) (via busca; página bloqueada para leitura direta)
- "Reach is the number of people who saw your ads at least once during the campaign's lifetime. Reach is different from impressions, which may include multiple views of your ads by the same people" — mesma fonte acima (via busca)

### Inferences
- Nenhuma mudança de definição identificada; útil apenas como referência de vocabulário para relatórios.

### Gaps
- Não verifiquei se há alguma mudança de metodologia de contagem de alcance/frequência em 2025-2026 (ex.: por causa das mudanças de atribuição — ver seção 9). Não encontrei nada a respeito nas buscas realizadas.

---

## 8. Políticas de anúncios relevantes para alimentação/restaurantes/álcool

### Takeaway
Álcool é permitido no Meta Ads no Brasil, mas com segmentação obrigatória de idade mínima de 18 anos e conformidade com leis locais; não há uma "categoria de anúncio especial" (Special Ad Category) para alimentação/restaurante — as categorias especiais oficiais cobrem crédito, emprego, moradia e questões sociais/eleitorais/político, não food & beverage.

### Cited Findings
- "Ads that promote or reference alcohol must comply with all applicable local laws, required or established industry codes, guidelines, licenses and approvals, and include age and country targeting criteria consistent with Meta's targeting requirements and applicable local laws. At a minimum, ads may not be targeted to people under 18 years of age" — [Meta Transparency Center — Alcohol ad standards](https://transparency.meta.com/policies/ad-standards/restricted-goods-services/alcohol/) (via busca; domínio bloqueado para leitura direta neste ambiente, não confirmei o texto integral)
- "Meta's policies prohibit ads promoting or referencing alcohol in some countries, based on local law" — mesma fonte acima (via busca)
- "When content contains alcohol, it cannot show U18s consuming alcohol" — via busca, atribuído à mesma página (paráfrase, não citação literal confirmada)
- A busca não trouxe uma página oficial específica de Meta para "food and restaurant advertising" nem para "special ad category" cobrindo alimentação — os resultados indicam que as categorias especiais reconhecidas publicamente são crédito, emprego, moradia e questões sociais/eleições/política, **não alimentação/restaurante** (inferência a partir da ausência de resultados + conhecimento de treinamento, marcada como gap abaixo para confirmação).
- Sobre texto em imagem: "Facebook's ad guidelines previously required that advertisers could cover their ad images with no more than 20% text... even though the rule is no longer a requirement, it should still serve as a recommendation" — via busca (secundária). Também: "Meta's new multimodal review process evaluates text, image, video, audio, and your landing page content simultaneously as a single unit" — via busca (secundária, interestexplorer.io/cinerads.com)

### Inferences
- Para uma loja de restaurante/delivery com álcool no cardápio (se houver promoção de bebida alcoólica em anúncio), o gestor deve configurar segmentação de idade mínima 18+ e país explicitamente na campanha, e evitar qualquer peça criativa mostrando consumo por pessoas aparentando menos de 18 anos.
- A regra de "20% de texto na imagem" não é mais um requisito de aprovação (não bloqueia o anúncio), mas continua sendo citada como boa prática de entrega/qualidade — o gestor não deve tratá-la como bloqueio técnico obrigatório em 2026, mas pode considerá-la para performance.

### Gaps
- **Gap crítico não resolvido:** não consegui confirmar, por leitura oficial direta, se existe alguma política Meta específica para "food and restaurant" (por exemplo, restrições sobre claims de saúde/nutrição, "under 18" em anúncios de fast-food em certos países, etc.) — os resultados de busca não trouxeram uma página oficial dedicada a isso. Isso precisa de pesquisa adicional dedicada (possivelmente sob "Advertising Standards" > categorias de "Health and Wellness" ou legislação local brasileira, ex. CONAR, que é fora do escopo desta pesquisa sobre documentação da própria Meta).
- Não confirmei se "Special Ad Category: Alcohol" existe como opção formal na interface (diferente de crédito/emprego/moradia/social) — não encontrei essa confirmação nas buscas.
- Não consegui acessar `transparency.meta.com` diretamente para citar o texto integral e a data de última atualização da página de álcool.

---

## 9. Atribuição (attribution settings): 7-day click / 1-day view e mudanças 2025-2026

### Takeaway
Múltiplas fontes secundárias (não a página oficial diretamente) relatam uma mudança relevante em 2025-2026: a configuração padrão passou a incluir uma janela separada de "1-day engage-through" (curtidas, compartilhamentos, comentários, salvamentos) distinta do "click-through" (que agora conta só cliques em link), e as janelas de 7-day view e 28-day view foram removidas da Ads Insights API em janeiro de 2026.

### Cited Findings
- "The default attribution setting when creating an ad set is 7-day click-through, 1-day engage-through, and 1-day view-through. This represents a significant change from the previous default of 7-day click and 1-day view" — via busca (secundária — jonloomer.com, dataslayer.ai, theoptimizer.io, get-ryze.ai — convergente entre várias fontes)
- "January 2026: Meta now supports only 1-day view and 7-day click as the default attribution window, with 7-day view and 28-day view options permanently removed from the Ads Insights API in January 2026" — via busca (secundária)
- "March 2026: Click-through used to include all clicks (likes, shares, saves, comments, and link clicks), but now only link clicks count, with everything else moved to engage-through with a 1-day window" — via busca (secundária, dataslayer.ai)
- "Since March 2026, many advertisers have been seeing lower click-through conversion numbers without any change in actual ad spend or campaign setup, as Meta changed how it defines and counts conversions" — via busca (secundária)

### Inferences
- Isso é relevante para o BRIEFING/DIRETRIZES de análise de dados do projeto: comparações de conversão "antes vs. depois de março de 2026" podem estar distorcidas por essa mudança metodológica de atribuição, não por mudança real de performance — o gestor deve anotar esse corte temporal ao analisar tendências de CPA/ROAS no Meta Ads Manager.

### Gaps
- **Não consegui confirmar isso com uma página oficial da Meta** (Business Help Center ou developers.facebook.com sobre "attribution setting" / "engage-through") — todas as fontes encontradas são de agências/blogs de terceiros, ainda que convergentes entre si em datas e mecânica. Recomendo fortemente validar esse ponto específico assim que houver acesso a `developers.facebook.com` ou `facebook.com/business/help`, dado o impacto que teria em relatórios do projeto.

---

## 10. Versões da Marketing API e depreciações (2025-2026)

### Takeaway
Não consegui acessar o changelog oficial da Marketing API (bloqueado no ambiente). Fontes secundárias mencionam a v26.0 (lançada em 29 de julho de 2026) como a versão mais recente citada, com depreciações relacionadas a Shop Ads e categorias especiais, mas não obtive confirmação oficial linha a linha.

### Cited Findings
- "On July 29, Meta shipped Graph API v26.0 and Marketing API v26.0, and the version changelog carries the most ad-facing batch of deprecations of the year. Shop Ads creatives default to a website-and-shop destination unless you opt out, and web-only destinations are banned for Web-plus-App campaigns" — via busca (secundária, fonte não identificada com URL confiável nos resultados — tratar com cautela)
- "Beginning with v25.0, the smart_promotion_type field will no longer be available for creating ad campaigns" — via busca (secundária, ppc.land, página bloqueada para confirmação direta)
- "Special-ad-category ad sets now error without an explicit Advantage+ audience flag" (a partir de v26.0, segundo fonte secundária) — via busca (secundária)
- "Meta phases out Advantage Shopping and App Campaign APIs by Q1 2026, introducing unified automation framework for Marketing API developers" — via busca (secundária, socialmediatoday.com)

### Inferences
- Se o projeto ERPOS ou qualquer integração futura vier a usar a Marketing API diretamente (criação programática de campanhas/conjuntos/anúncios), é importante verificar a versão vigente e os campos obrigatórios (`optimization_goal`, `promoted_object`, `destination_type`, `bid_strategy`) na doc oficial antes de codificar — não usar os nomes de campo mencionados aqui sem confirmação, pois vieram só de fontes secundárias.

### Gaps
- **Gap crítico:** não consegui abrir `developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog` (bloqueado). Todo o conteúdo desta seção 10 vem de fontes secundárias e deve ser tratado como não confirmado até checagem direta na doc oficial.
- Não confirmei o número de versão "atual" no sentido de "mínima suportada" vs. "mais recente" em setembro de 2026.

---

## Resumo de limitações desta pesquisa

Este ambiente de execução bloqueia por política de rede o acesso direto a `facebook.com` (e subdomínios como `developers.facebook.com`, `business.facebook.com`) e a `transparency.meta.com` — os dois principais domínios de documentação oficial da Meta para publicidade. Toda citação atribuída a esses domínios neste documento vem de **resultados de busca (snippets)**, não de leitura integral verificada da página. Recomendo fortemente que, antes de qualquer decisão operacional de alto risco (ex.: mudança de política de orçamento pensando na regra dos "20%", ou configuração de segmentação de álcool 18+), o gestor ou um ambiente sem esse bloqueio de rede confirme o texto oficial diretamente nas URLs listadas acima.
