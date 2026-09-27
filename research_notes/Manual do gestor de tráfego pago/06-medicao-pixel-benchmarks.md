# Medição, Pixel/CAPI e benchmarks para Meta Ads (Brasil e delivery, 2025-2026)

> **Nota metodológica importante**: o acesso direto às páginas oficiais da Meta (facebook.com/business/help, developers.facebook.com) esteve bloqueado durante esta pesquisa (proxy de rede bloqueou o domínio). As informações sobre CAPI, EMQ, AEM e janelas de atribuição abaixo vêm de buscas que **resumem** o conteúdo dessas páginas oficiais via agregadores e blogs especializados — trate como "segundo a Meta, conforme reportado por X" e não como citação literal do texto oficial. Vários números de benchmark vêm de blogs de ferramentas/agências (alguns com forte cheiro de conteúdo gerado para SEO, com "2026" no título de tudo) — sinalizei explicitamente onde a fonte é frágil.

## O que exatamente implementar (Pixel + CAPI) para a Meta otimizar por compra em um site pequeno de pedidos

### Takeaway
A configuração mínima recomendada em 2026 é rodar Pixel (navegador) **e** Conversions API (servidor) em paralelo para os mesmos eventos padrão, usando um `event_id` idêntico nos dois para deduplicação, e enviar o máximo de parâmetros de correspondência (e-mail/telefone hasheados, `fbp`/`fbc`) para maximizar o Event Match Quality (EMQ). Sem isso, a perda de dados do iOS/ATT e de bloqueadores de rastreio no navegador reduz a base de otimização da Meta.

### Cited Findings
- Os eventos padrão essenciais para um funil de pedido são ViewContent, AddToCart, InitiateCheckout e Purchase; o evento Purchase **exige obrigatoriamente** os parâmetros `currency` e `value` — sem eles, o bidding por valor (value-based bidding) é desativado e o ROAS no Ads Manager aparece em branco; contas internacionais podem perder de 20% a 40% da receita atribuída por não mandar `currency`/`value` corretamente — [Meta for Developers / resumo via AdBeacon e outros](https://www.adbeacon.com/meta-pixel-event-tracking-standard-vs-custom-events/); ver também a doc oficial (não acessada diretamente, bloqueada) [Conversion Tracking – Meta for Developers](https://developers.facebook.com/docs/meta-pixel/implementation/conversion-tracking/)
- A deduplicação entre Pixel e CAPI roda em dois campos que precisam bater exatamente nos dois lados: `event_name` e `event_id`, e as duas cópias do evento (browser + servidor) precisam chegar dentro de uma janela de 48 horas uma da outra — [AdBeacon, "Meta Conversions API Deduplication in 2026"](https://www.adbeacon.com/conversions-api-deduplication/)
- Um erro comum em 2026: a integração servidor manda `event_id` (porque foi implementada certo), mas o Pixel do site é um snippet antigo sem `event_id` — nesse caso a Meta não tem o que casar e conta os dois eventos, o que pode inflar as compras reportadas para perto do dobro (~2×) da realidade, com ROAS "ótimo" e CPA "barato" só na aparência — [AdBeacon](https://www.adbeacon.com/conversions-api-deduplication/)
- Rodar Pixel + CAPI juntos, com deduplicação por `event_id`, é descrito como recuperando de 20% a 30% dos dados de conversão que se perderiam só com o Pixel — [AdBeacon](https://www.adbeacon.com/conversions-api-deduplication/) (número de blog especializado em CAPI, não é dado oficial da Meta; tratar como estimativa de mercado, não como métrica publicada pela Meta)
- Event Match Quality (EMQ) é uma pontuação de 0 a 10 que mede o quanto os dados de um evento (Pixel e/ou CAPI) conseguem ser casados com um perfil de usuário real; a pontuação reflete tanto a quantidade quanto a qualidade dos parâmetros de identificação enviados — [CustomerLabs, "What is EMQ Score?"](https://www.customerlabs.com/blog/improve-your-event-match-quality-from-ok-to-great/)
- Os parâmetros com mais peso em um evento de Purchase na web são e-mail e telefone hasheados, os identificadores de navegador de um clique recente em anúncio da Meta (`fbp`/`fbc`) e um identificador estável de cliente (ex.: `external_id`); CAPI do lado servidor é o que permite enviar o conjunto completo desses parâmetros em todo evento de Purchase e empurra a pontuação para a faixa 8+ — [CustomerLabs](https://www.customerlabs.com/blog/improve-your-event-match-quality-from-ok-to-great/)
- Um caso relatado mostra que subir o EMQ de 8,6 para 9,3 reduziu o CPA em 18%, aumentou a taxa de correspondência (match rate) em 24% e elevou o ROAS em 22% — [CustomerLabs](https://www.customerlabs.com/blog/improve-your-event-match-quality-from-ok-to-great/) (case isolado de um único anunciante/agência, não é benchmark de mercado — tratar como ilustrativo, não como taxa esperada)
- Meta possui o "Advanced Matching" automático, que varre o site em busca de campos reconhecíveis (e-mail, nome, sobrenome) e usa qualquer informação disponível para melhorar o EMQ mesmo sem configuração manual — [CustomerLabs](https://www.customerlabs.com/blog/improve-your-event-match-quality-from-ok-to-great/)
- Sobre o "porquê" da CAPI após a perda de rastreamento no iOS/ATT (App Tracking Transparency) e nos navegadores: a lógica repetida nas fontes é que o Pixel sozinho depende de cookies e JS no navegador, que ad blockers, o Safari (ITP) e o opt-out de rastreamento no iOS interrompem; a CAPI manda o mesmo evento a partir do servidor do anunciante, contornando esses bloqueios — [Blotout, "Meta EMQ Score"](https://www.blotout.io/blog/meta-event-match-quality-score-what-it-means-and-how-to-improve-it) (raciocínio consistente entre várias fontes de mercado, mas não há citação direta e verificada do texto oficial da Meta nesta pesquisa — página oficial bloqueada)

### Inferences
- Para uma loja pequena com poucas dezenas de pedidos/dia, a implementação prioritária é: (1) Pixel via snippet padrão + Advanced Matching automático ligado, (2) CAPI do lado servidor disparando os mesmos 4 eventos (ViewContent, AddToCart, InitiateCheckout, Purchase) com `event_id` = mesmo ID usado no Pixel (ex.: ID do pedido/sessão), (3) sempre `currency` e `value` no Purchase, (4) enviar e-mail/telefone hasheados sempre que capturados no checkout.
- Como a Meta remove o limite manual de 8 eventos web (ver seção AEM abaixo) e passa a agregar tudo automaticamente, a prioridade de otimização deixa de exigir configuração manual de ranking de eventos — mas a qualidade de cada evento (EMQ) continua sendo o alavanca que a equipe de tráfego controla diretamente.

### Gaps
- Não foi possível confirmar, a partir de página oficial da Meta acessada diretamente nesta pesquisa, a lista canônica completa de parâmetros do CAPI (ex.: todos os campos de `user_data` e `custom_data` aceitos) nem o texto exato da documentação sobre EMQ — acesso a developers.facebook.com e facebook.com/business/help bloqueado pelo proxy de rede durante esta sessão. Recomenda-se que quem for redigir o manual final confirme diretamente em https://developers.facebook.com/docs/marketing-api/conversions-api/ e https://www.facebook.com/business/help/765081237991954 (Event Match Quality) antes de publicar como regra oficial.
- Não há dado nesta pesquisa sobre "volume mínimo de eventos" necessário para a Meta otimizar bem por compra (o tipo de número que a própria Meta costuma recomendar, ex. "~50 conversões/otimização a cada 7 dias" para sair do período de aprendizagem) — vale confirmar diretamente na doc oficial de "Fase de aprendizagem" (Learning Phase) da Meta, não coberta nesta pesquisa por bloqueio de acesso.

## Status do Aggregated Event Measurement (AEM) em 2026

### Takeaway
Em meados de 2025 a Meta removeu o limite manual de 8 eventos web priorizados e passou a agregar automaticamente todos os eventos elegíveis; a aba "Aggregated Event Measurement" foi removida do Gerenciador de Eventos para web, e o Pixel foi incorporado a um "dataset" mais amplo (o antigo Pixel ID virou o dataset ID). O modelo de 8 eventos priorizados ainda vale para campanhas de app iOS e contas que a Meta ainda não migrou.

### Cited Findings
- "Em meados de 2025 a Meta removeu o ranking manual de 8 eventos para eventos web e agora agrega automaticamente todos os eventos elegíveis. A aba 'Aggregated Event Measurement' foi removida do Gerenciador de Eventos, e não é mais necessário configurar AEM manualmente para eventos web" — [Segwise, "Aggregated Event Measurement (AEM): 2026 Meta Setup Guide"](https://segwise.ai/blog/facebook-aggregated-event-measurement)
- "O modelo de 8 eventos priorizados ainda se aplica a campanhas de app iOS e a contas que a Meta ainda não migrou" — [Segwise](https://segwise.ai/blog/facebook-aggregated-event-measurement)
- "A Meta recomenda rodar o Pixel junto com a Conversions API, com deduplicação de eventos, para a medição mais resiliente. Verificação de domínio não é mais exigida para o AEM" — [Segwise](https://segwise.ai/blog/facebook-aggregated-event-measurement)
- "A Meta incorporou o Pixel a um 'dataset' mais amplo, em que o antigo Pixel ID agora é o dataset ID, e os sinais de AEM alimentam campanhas Advantage+, que rodam por padrão em 2026" — [Segwise](https://segwise.ai/blog/facebook-aggregated-event-measurement)
- Em abril de 2026, três problemas relatados por praticantes: (1) a prioridade do AEM é resetada após atualizações do pixel, (2) uma regressão no sistema de entrega Andromeda, e (3) uma onda de reprovações falsas de anúncios em contas de varejo — [HyperFX, "Meta Ads Issues in April 2026"](https://www.hyperfx.ai/blog/meta-ads-issues-april-2026) (fonte única, não confirmada em outro lugar — tratar como relato pontual de praticante, não como fato estrutural do sistema)

### Inferences
- Para uma loja de pedidos pequena, a mudança prática é: não há mais necessidade de "escolher os 8 eventos mais importantes" manualmente — a estratégia correta é garantir que todos os eventos relevantes (ViewContent → AddToCart → InitiateCheckout → Purchase) estejam implementados com boa EMQ, porque a Meta agrega automaticamente.

### Gaps
- Não foi possível verificar essa mudança na documentação oficial da Meta (bloqueio de acesso a developers.facebook.com/business/help). O relato vem de um único blog especializado (Segwise); antes de tratar como regra definitiva, verificar diretamente no Gerenciador de Eventos da conta real do cliente, já que mudanças de produto da Meta variam por conta/região/fase de rollout.

## Medição de clique-para-WhatsApp (Click-to-WhatsApp) e atribuição de pedidos via WhatsApp

### Takeaway
A métrica primária no Gerenciador de Anúncios para CTWA é "Conversas iniciadas por mensagem" (Messaging Conversations Started); para ligar isso a vendas reais, a Meta oferece desde 2024-2025 uma variante do CAPI para mensageria ("Conversions API for Business Messaging"), que exige os campos `action_source: "business_messaging"` e `messaging_channel: "whatsapp"`, e usa o parâmetro `ctwa_clid` (capturado no clique do anúncio e repassado pelo webhook do WhatsApp) para linkar a conversa ao pedido fechado.

### Cited Findings
- "A métrica primária no Ads Manager é 'Messaging Conversations Started'; também é possível acompanhar custo por conversa e taxa de conversa (conversas ÷ impressões)" — [síntese de múltiplas fontes, ver Wati "Click to WhatsApp Ads: 2026 Playbook"](https://www.wati.io/en/blog/set-up-click-to-whatsapp-ads/)
- Custo por conversa = Gasto em anúncios ÷ Conversas iniciadas — [Wati](https://www.wati.io/en/blog/set-up-click-to-whatsapp-ads/)
- "Entre 2024 e 2025 a Meta lançou uma variante específica de CAPI para mensageria: Conversions API for Business Messaging, com dois campos obrigatórios: `action_source: 'business_messaging'` e `messaging_channel: 'whatsapp'`" — [síntese de fontes, incluindo Meta for Developers "Conversions API for Business Messaging"](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/) (página oficial não acessada diretamente por bloqueio de rede; conteúdo relatado por agregadores)
- "A Meta isenta a tarifa de conversa do WhatsApp por 3 dias após a primeira mensagem, quando a conversa começou a partir de um ponto de entrada de anúncio" — [Wati](https://www.wati.io/en/blog/set-up-click-to-whatsapp-ads/)
- "Uma abordagem de implementação captura o `ctwa_clid` da Meta a partir do webhook do WhatsApp, persiste esse valor no pedido, e dispara um evento CAPI de Purchase com `action_source: business_messaging` quando o pedido é concluído. Por padrão, o modelo de atribuição é Last Click, com janela de atribuição de 7 dias" — [Academy InsiderOne, "Meta Conversions API for Click to WhatsApp Ads"](https://academy.insiderone.com/docs/meta-conversions-api-for-click-to-whatsapp-ads)
- "Segundo dados da Meta e cases publicados por anunciantes na América Latina, Índia e Brasil, uma campanha CTWA bem implementada entrega custo por lead até 92% menor e até 94% mais conversão do que uma campanha equivalente com destino em landing page" — [Wati](https://www.wati.io/en/blog/set-up-click-to-whatsapp-ads/) (número muito favorável, sem link direto para o estudo original da Meta citado — tratar com cautela, típico de material de vendas de ferramenta de CTWA)
- "O resultado para o anunciante é um canal com custo de aquisição entre 40% e 70% menor do que a média de campanhas de conversão via web, em mercados onde o WhatsApp é a ferramenta de comunicação predominante" — [Wati](https://www.wati.io/en/blog/set-up-click-to-whatsapp-ads/) (mesma ressalva acima — número de material promocional, não de estudo auditável)

### Inferences
- Para atribuir corretamente um pedido feito por WhatsApp ao clique de origem, a peça técnica indispensável é capturar e persistir o `ctwa_clid` assim que a conversa chega (via webhook da WhatsApp Business Platform/Cloud API), gravá-lo junto ao registro do pedido no ERP/PDV, e só então disparar o evento de Purchase via CAPI de Business Messaging quando o pedido fechar — sem isso, não há como ligar "conversa iniciada" a "pedido pago" de forma confiável.
- "Conversa iniciada" (Messaging Conversations Started) é uma métrica de topo de funil — não confundir com pedido fechado; o gestor de tráfego precisa de uma segunda camada (CAPI Purchase com `ctwa_clid`) para ver o funil completo até a venda.

### Gaps
- Não há, nesta pesquisa, um número confiável e público (fora de material de marketing de fornecedores) sobre taxa de conversão típica de "conversa iniciada" → "pedido fechado" para restaurantes brasileiros — os números de 92%/94%/40-70% citados acima vêm de material de vendas de uma ferramenta de CTWA (Wati) sem link para o estudo original; não incluir como benchmark confiável sem confirmação em fonte primária da Meta.
- Não foi possível confirmar diretamente na documentação oficial da Meta a lista completa de eventos aceitos pela Conversions API for Business Messaging (além de Purchase) — acesso bloqueado a developers.facebook.com.

## Janelas de atribuição e por que os números do Ads Manager diferem do ERP/PDV

### Takeaway
O padrão de atribuição da Meta em 2026 é 7 dias de clique + 1 dia de visualização (7-day click + 1-day view); os números no Ads Manager continuam sendo revisados por até 72 horas após o fim do dia (e até 7 dias para eventos com janela de atribuição estendida), por causa de conversões modeladas que preenchem parte da perda de rastreamento — por isso relatórios do dia seguinte são sistematicamente mais baixos que os de 3 dias depois.

### Cited Findings
- "A janela de atribuição padrão em 2026 é 7 dias de clique + 1 dia de visualização (7-day click + 1-day view)" — [AdStellar, "Meta Ads Attribution Tracking Problems"](https://www.adstellar.ai/blog/meta-ads-attribution-tracking-problems)
- "As conversões da Meta continuam se ajustando por pelo menos 72 horas após o fim do dia, e para eventos com janela de atribuição estendida podem continuar se movendo por até 7 dias" — [Aimerce, "Why Are My Meta Ad Results Delayed by 72 Hours?"](https://www.aimerce.ai/blogs/why-are-my-meta-ad-results-delayed-by-72-hours)
- "A Meta aplica modelagem de conversão — usando sinais estatísticos (tipo de dispositivo, horário do clique, campanha, audiência) para estimar atribuição — que roda com um atraso de aproximadamente 72 horas. A medição de privacidade da Meta espera por sinal agregado suficiente antes de liberar conversões modeladas dentro da janela de atribuição — frequentemente entre 24 e 72 horas" — [Improvado, "Facebook/Meta Ads Data Challenges"](https://improvado.io/blog/facebook-ads-data-challenges)
- "Estimativas em nível agregado recuperam aproximadamente 70-80% do volume real de conversões, mas números por anúncio carregam variância significativa para tamanhos de audiência menores" — [Improvado](https://improvado.io/blog/facebook-ads-data-challenges)
- "Na prática, a maior parte da revisão acontece nas primeiras 72 horas, e se você pausar uma campanha com base no ROAS do mesmo dia, está tomando decisões sobre 40-60% dos dados eventuais" — [Aimerce](https://www.aimerce.ai/blogs/why-are-my-meta-ad-results-delayed-by-72-hours)

### Inferences
- Para reconciliar "compras" do Ads Manager com pedidos reais do PDV/ERP, o gestor deve: (1) nunca comparar o número do Ads Manager do dia corrente com o total de pedidos do dia — esperar pelo menos 72h para o número "assentar"; (2) lembrar que parte do número final é modelado estatisticamente (não é 1:1 com clique/visualização real rastreados), então uma divergência residual entre Ads Manager e ERP é esperada mesmo depois de 72h — a modelagem recupera ~70-80% do volume real em nível agregado, não 100%; (3) checar se há visualização (view-through, janela de 1 dia) inflando compras atribuídas sem clique real — para uma loja pequena com CTWA e pedidos via link, uma regra prática é reconciliar por pedido usando o parâmetro de origem (`ctwa_clid` ou UTM) gravado no próprio pedido, não confiar cegamente no número agregado do Ads Manager.

### Gaps
- Não há confirmação em fonte primária da Meta, apenas em agregadores/blogs, do texto exato sobre "72 horas" e "7 dias" — o número é citado de forma consistente em várias fontes de mercado, mas a página oficial (business.facebook.com/help) não pôde ser acessada nesta pesquisa para citar o texto original.
- Não foi encontrado nesta pesquisa um percentual público e confiável específico de "quanto do total de compras reportadas pela Meta é modelado vs. rastreado diretamente" por segmento/mercado (o número de 70-80% é de recuperação agregada geral, não específico para pequenos anunciantes de delivery no Brasil).

## Básico de incrementalidade (lift, geo holdout, teste liga/desliga) para uma loja só

### Takeaway
Testes de incrementalidade nativos da Meta (Conversion Lift) exigem volume de gasto alto para ter poder estatístico (a referência citada é ~US$ 30 mil/mês como piso); abaixo disso, o caminho recomendado por praticantes é geo holdout ou teste pré/pós (liga/desliga) simples, com holdout de 10-20% do público ou período.

### Cited Findings
- "O Meta incrementality testing usa experimentos randomizados controlados para isolar o impacto causal da publicidade, criando um contrafactual através de desenho experimental cuidadoso. Estudos de Conversion Lift gerenciados pela plataforma randomizam usuários no nível de conta, com a Meta atribuindo contas de Facebook e Instagram a grupos de tratamento ou controle, medindo conversões via pixel, Conversions API ou upload de eventos offline" — [Haus, "Understanding Meta incrementality testing"](https://www.haus.io/article/meta-incrementality-testing)
- "Experimentos de geo-holdout atribuem aleatoriamente regiões geográficas a tratamento ou controle, comparando resultados agregados com métodos de controle sintético" — [Haus](https://www.haus.io/article/meta-incrementality-testing)
- "O Conversion Lift self-serve da Meta exige gasto suficiente para superar uma taxa mínima diária de conversão incremental, e abaixo de aproximadamente US$ 30.000/mês de gasto, o holdout fica sem poder estatístico, tornando pré/pós ou testes geo mais adequados para anunciantes menores" — [WeDiscover, "GeoLift Testing on Meta"](https://we-discover.com/blog/geolift-testing-on-meta-a-how-to-guide/) (número específico de um único blog de agência de mídia performance — não é regra publicada pela Meta; tratar como referência de mercado, não como limite oficial)
- "Para a maioria das marcas de e-commerce com gasto abaixo de US$ 100 mil/mês, o geo holdout e a ferramenta nativa de Conversion Lift da Meta são os pontos de partida mais acessíveis" — [WeDiscover](https://we-discover.com/blog/geolift-testing-on-meta-a-how-to-guide/)
- "Um holdout de 10-20% é o ideal — holdouts maiores criam um sinal mais forte" — [Blip, "Incrementality Testing for Meta Ads: Holdout Groups Guide"](https://withblip.com/blog/meta-ads-incrementality-testing-holdout-groups-2026/)
- "Focar em campanhas com volume de conversão suficiente para gerar resultados significativos, já que campanhas muito pequenas ou recém-lançadas frequentemente não produzem estimativas de lift confiáveis" — [Blip](https://withblip.com/blog/meta-ads-incrementality-testing-holdout-groups-2026/)

### Inferences
- Para uma única loja de delivery com orçamento de tráfego pago tipicamente bem abaixo de US$ 30 mil/mês, o Conversion Lift nativo da Meta provavelmente não terá poder estatístico suficiente — o caminho prático é um teste liga/desliga simples (ex.: pausar todo o tráfego pago por 1-2 semanas alternadas, comparando pedidos totais do período "ligado" vs. "desligado", controlando por sazonalidade/dia da semana) em vez de tentar rodar a ferramenta nativa de lift.
- Como uma loja única não tem "geografias" para dividir em teste/controle da forma clássica (múltiplas lojas/regiões), o geo holdout citado nas fontes é mais aplicável a redes com várias lojas; para loja única, liga/desliga temporal é o teste de incrementalidade mais viável.

### Gaps
- Não há, nesta pesquisa, uma metodologia detalhada e passo a passo especificamente desenhada para "uma loja só" (a maior parte do conteúdo de incrementalidade encontrado é voltado a e-commerce multi-região/multi-produto) — recomenda-se buscar especificamente conteúdo de incrementalidade para redes de franquia/varejo físico local, não coberto nesta pesquisa.

## UTMs e parâmetros dinâmicos de URL da Meta

### Takeaway
A Meta suporta tokens dinâmicos entre chaves duplas (`{{campaign.name}}`, `{{adset.name}}`, `{{ad.name}}`, `{{placement}}`, entre outros) que devem ser preenchidos apenas no campo "Parâmetros de URL" no nível do anúncio — nunca dentro do campo "URL do site" — e a boa prática de mercado é usar IDs (`{{campaign.id}}`, `{{adset.id}}`, `{{ad.id}}`) em paralelo aos nomes, porque nomes de campanha podem ser renomeados depois, quebrando o histórico de relatórios baseado em nome.

### Cited Findings
- "Os parâmetros dinâmicos disponíveis incluem: `campaign_id` (identificador numérico da campanha), `campaign_name` (nome da campanha como definido no Ads Manager), `adset_id`, `adset_name`, `ad_id`, `ad_name`, `placement` (onde o anúncio foi exibido) e `site_source_name` (fb, ig, messenger, etc.)" — [metricfixer, "Meta Ads Dynamic URL Parameters for UTM Tracking"](https://metricfixer.com/publications/online-advertising/meta-ads-dynamic-url-parameters-utm-tracking)
- "Os tokens dinâmicos usam chaves duplas — `{{campaign.id}}`, `{{adset.name}}`, `{{site_source_name}}`. A sintaxe de chave dupla é exclusiva da Meta; não confundir com a chave simples do Google Ads (`{campaignid}`). Errar a sintaxe faz o token aparecer literalmente como `{{campaign.id}}` na URL" — [utm.new, "Meta Ads UTM parameters"](https://utm.new/platforms/meta-ads)
- "O campo Parâmetros de URL existe apenas no nível do anúncio — deve-se configurá-lo por anúncio, ou usar a edição em massa do Ads Manager. Não incorporar as UTMs no campo 'Website URL'; esse campo deve conter apenas a URL limpa da página de destino" — [utm.new](https://utm.new/platforms/meta-ads)
- Template de exemplo: `utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{ad.id}}&utm_content={{adset.name}}&placement={{placement}}` — [utm.new](https://utm.new/platforms/meta-ads)
- "Nomes quebram, IDs não. `{{campaign.name}}` retorna o nome atual da campanha, mas renomear a campanha amanhã faz com que todo join de relatório baseado em UTM se desalinhe silenciosamente contra as linhas históricas" — [utm.new](https://utm.new/platforms/meta-ads)

### Inferences
- Para o painel de gestão do ERP/loja de delivery, a recomendação é gravar tanto o nome quanto o ID de campanha/conjunto/anúncio na UTM (ou pelo menos o ID, que é estável), para permitir reconciliação confiável de pedidos por campanha mesmo depois de renomeações no Ads Manager.

### Gaps
- Nenhum gap relevante identificado — este ponto tem boa cobertura e consistência entre fontes.

## Definições de métricas-chave e faixas saudáveis

### Takeaway
As faixas "saudáveis" citadas por praticantes de mercado (não por documentação oficial da Meta) apontam frequência de anúncio entre 1,5-3,5 (ideal 1,8-3,5 para campanhas de conversão) como ponto de equilíbrio antes da saturação, com custo por ação subindo de forma acelerada acima de frequência 4,0; CTR médio geral (todas as indústrias) de referência global é ~1,55%.

### Cited Findings
- "Para campanhas de conversão no Facebook/Instagram, a faixa ideal é entre 1,8 e 3,5 por semana. Uma frequência moderada entre 2 e 3 é geralmente o ponto ideal para conversão" — [síntese de fontes de mercado brasileiras, ver Cobalto Consulting e Rogério Ramalho Digital](https://www.cobaltomarketing.com.br/blog/frequencia-no-meta-ads-como-interpretar-repeticao-alcance-e-saturacao/)
- "Acima de 4,0, o custo por ação sobe de forma acelerada; campanhas com frequência acima de 3,4 apresentam redução média de 25% no CTR em relação ao ponto inicial" — [fontes de mercado brasileiras, mesma síntese acima] (números específicos sem link para estudo primário auditável — tratar como consenso de praticantes de agências brasileiras, não como dado com metodologia publicada)
- "O CTR médio (link) de todas as indústrias, referência global, é 1,55%" — [WordStream/agregador, citado em síntese sobre benchmarks Meta Ads Brasil](https://www.superads.ai/facebook-ads-costs/cpm-cost-per-mille/brazil)

### Inferences
- Essas faixas de frequência (1,8-3,5) são consenso de praticantes, úteis como heurística operacional para o gestor de tráfego da loja de teste, mas não devem ser citadas como "regra da Meta" no manual final — apresentar como "boas práticas de mercado", com a ressalva de que a Meta não publica um número oficial de frequência ideal.

### Gaps
- Não foi possível localizar, nesta pesquisa, definições oficiais da Meta (ou de publicador independente com metodologia auditável) de faixas saudáveis para CPM, cost per conversation e cost per purchase especificamente para o setor de restaurante/delivery no Brasil — os números de CPC/CTR por indústria encontrados (seção de benchmarks abaixo) são a aproximação mais próxima disponível.
- Share of ad-driven orders (percentual de pedidos atribuíveis a anúncios pagos sobre o total de pedidos) não tem benchmark publicado localizável nesta pesquisa — é uma métrica interna do negócio (pedidos com origem em campanha ÷ total de pedidos), sem "faixa saudável" de mercado documentada nas fontes consultadas.

## Benchmarks de Meta Ads para o Brasil 2025-2026 (CPM, CPC, CTR) e comparação com os EUA

### Takeaway
Os números de CPM/CPC do Brasil em 2025 mostram um mercado historicamente mais barato que a média global (CPM ~US$ 3,46-4,20 no Brasil vs. média global ~US$ 20,59), mas as fontes específicas de CPC do Brasil (superads.ai) reportam uma queda muito acentuada e possivelmente atípica no período — sinalizada aqui como fonte a confirmar, não como fato assentado. Todos os números desta seção vêm de blogs de ferramentas/agências, não de publicador com metodologia auditada publicamente — usar como ordem de grandeza, não como número exato de planejamento.

### Cited Findings
- "O CPM médio do Brasil foi de cerca de US$ 3,46, aproximadamente 83% abaixo da média global de US$ 20,59. Dados mais recentes indicam CPM do Brasil de US$ 4,20. De final do verão até o Q4 de 2025 houve CPMs mais suaves no Brasil (agosto-dezembro majoritariamente abaixo de US$ 2,5), embora o início do Q1 2026 tenha produzido uma recuperação para a casa de US$ 3" — [SuperAds, "Facebook Ads CPM Benchmarks in Brazil (2025)"](https://www.superads.ai/facebook-ads-costs/cpm-cost-per-mille/brazil) (fonte de ferramenta comercial, sem metodologia pública detalhada — tratar como estimativa de mercado)
- "Para todas as indústrias no Brasil, o CPC mediano abriu em US$ 0,54 em janeiro de 2025 e caiu para US$ 0,06 em janeiro de 2026, um declínio de 88%. Ao longo da janela de 13 meses, o CPC médio do Brasil foi de US$ 0,35, variando de US$ 0,06 a US$ 0,58" — [SuperAds, "Facebook Ads CPC Benchmarks in Brazil (2025)"](https://www.superads.ai/facebook-ads-costs/cpc-cost-per-click/brazil) (queda de 88% em 12 meses é uma variação extrema e incomum — **sinalizar como não confirmada**; pode refletir metodologia de amostra pequena/viesada da ferramenta, não uma tendência real de mercado; não usar como dado de planejamento sem confirmação cruzada)
- "A América Latina oferece alguns dos CPMs de Facebook Ads mais baixos, com Brasil, Chile, Colômbia e México tendo custos de publicidade relativamente baixos" — [Lebesgue, "Facebook Ads CPM by Country: 2026 Ecommerce Benchmarks"](https://lebesgue.io/facebook-ads/facebook-cpm-by-country)
- "No Meta Ads no Brasil, CPMs abaixo de R$ 10 são tipicamente considerados bons; no Google Display, CPMs abaixo de R$ 5 são sinal de bom desempenho" — [Trafius, "Benchmark de CPM no Brasil em 2026"](https://trafius.com.br/blog/benchmark-de-cpm-no-brasil-em-2026-por-nicho) (heurística de praticante brasileiro, sem metodologia publicada — usar como referência de conversa com o dono da loja, não como número científico)
- Comparação Brasil vs. EUA: não foi encontrado nesta pesquisa um número direto e comparável de CPC/CPM Meta Ads Brasil vs. EUA na mesma unidade e metodologia — apenas a afirmação qualitativa de que a América Latina/Brasil está entre os mercados mais baratos globalmente (ver Lebesgue acima).

### Inferences
- Diante da fragilidade das fontes de CPC específicas do Brasil (queda de 88% em 12 meses não confirmada em outra fonte), o manual final deveria apresentar apenas a ordem de grandeza — Brasil como mercado de CPM baixo comparado a EUA/Europa — e recomendar que o gestor de tráfego da loja registre e acompanhe seus próprios CPM/CPC/CTR reais na conta, em vez de fixar metas rígidas baseadas nesses números de blog.

### Gaps
- Não foi localizada, nesta pesquisa, nenhuma fonte com metodologia pública e auditável (ex.: agregação declarada de X contas, Y período, Z filtro por objetivo de campanha) para os números de CPM/CPC Brasil citados acima — todas as fontes encontradas são blogs de ferramentas comerciais (SuperAds, Lebesgue, Trafius) sem transparência de amostra. Fontes brasileiras mais tradicionalmente citadas para isso (Cortex/Ibope, RD Station, Adtail) não retornaram, nesta pesquisa, um relatório específico de benchmark de CPM/CPC/CTR do Meta Ads — o que foi encontrado do IAB Brasil/Ibope (ver abaixo) é sobre investimento total em publicidade digital, não sobre CPM/CPC.
- Não foi encontrado um número direto e comparável de CTR médio do Brasil especificamente (apenas a referência global de 1,55%, sem quebra por país) — gap a preencher com fonte adicional (ex.: relatório setorial específico do Brasil), não coberta nesta pesquisa.

## Investimento em publicidade digital no Brasil (contexto de mercado, não específico de Meta Ads)

### Takeaway
O mercado brasileiro de publicidade digital somou R$ 42,7 bilhões em 2025 (+12,7% vs. 2024), segundo estudo do IAB Brasil em parceria com o Ibope (Digital Adspend 2026); redes sociais concentram 55% desse investimento.

### Cited Findings
- "O mercado brasileiro de publicidade digital recebeu R$ 42,7 bilhões em investimentos em 2025, um crescimento de 12,7% em relação ao ano anterior. Os dados vêm do relatório Digital Adspend 2026, pesquisa conjunta do IAB Brasil e Ibope" — [Meio & Mensagem, "IAB: publicidade digital atinge R$ 42,7 bilhões em 2025"](https://www.meioemensagem.com.br/midia/iab-publicidade-digital-atinge-r-427-bilhoes-em-2025)
- "Redes sociais absorvem 55% dos investimentos em publicidade digital. Mecanismos de busca seguem com 26%, e publishers/verticais de conteúdo respondem por 19%" — [Meio & Mensagem](https://www.meioemensagem.com.br/midia/iab-publicidade-digital-atinge-r-427-bilhoes-em-2025)
- "Vídeo lidera com 49% de participação, refletindo a convergência entre plataformas, streaming e consumo de conteúdo sob demanda, além do uso de dispositivos móveis" — [Meio & Mensagem](https://www.meioemensagem.com.br/midia/iab-publicidade-digital-atinge-r-427-bilhoes-em-2025)
- "Cinco segmentos concentram quase metade dos investimentos, cerca de 48%: comércio (25%), eletrônicos e TI (8%), setor financeiro (6%), educação (5%) e mídia (4%)" — [Meio & Mensagem](https://www.meioemensagem.com.br/midia/iab-publicidade-digital-atinge-r-427-bilhoes-em-2025)
- Este é um relatório de investimento agregado de mercado (macro), não um benchmark de CPM/CPC/CTR por conta/campanha — útil como contexto, não como referência operacional de custo.

### Inferences
- Nenhuma inferência operacional direta para a loja — este dado serve apenas de pano de fundo macro (o quanto o mercado brasileiro move em digital), útil como abertura de capítulo do manual, não como número de meta de custo.

### Gaps
- Não é um gap desta chave específica — dado bem fundamentado em fonte de imprensa especializada citando estudo de mercado nomeado (IAB Brasil + Ibope, "Digital Adspend 2026").

## Benchmarks para restaurantes/delivery/food (global, com nota sobre confiabilidade)

### Takeaway
Múltiplas fontes de blogs de ferramentas de mídia paga (Hawky, Sovran, LocaliQ/WordStream via agregação) convergem para o setor "Restaurantes & Alimentação" com CPC de tráfego web na faixa de US$ 0,42-0,74 e CTR na faixa de 1,67%-2,97%, e custo por lead de cerca de US$ 3,16 em campanhas de geração de leads — entre os setores mais baratos do Meta Ads. Como nenhuma dessas fontes publica a amostra/metodologia com transparência total, tratar como ordem de grandeza direcional, não como benchmark de referência rígido, e dar preferência ao WordStream/LocaliQ (fontes mais estabelecidas no mercado de benchmarks de mídia paga) sobre as demais quando houver conflito.

### Cited Findings
- "Os benchmarks do Hawky para 2026 colocam Restaurantes & Alimentação em US$ 0,74 de CPC e 2,97% de CTR, enquanto a análise da Sovran mostra US$ 0,72 de CPC e 1,67% de CTR usando dados de 2025" — [Hawky, "Facebook Ads Benchmarks by Industry (2026 Data)"](https://hawky.ai/blog/facebook-ads-benchmarks) e [Sovran, "Restaurant Facebook Ads: Targeting & ROI Guide (2026)"](https://sovran.ai/blog/restaurant-facebook-ads)
- "Para campanhas de tráfego especificamente, o setor de Alimentação & Bebidas tem CPC médio de US$ 0,42 e CTR mediano de 1,85%" — [Missing Ingredient, "Facebook Benchmarks for Food and Beverage Ads"](https://themissingingredient.com/facebook-benchmarks-for-food-and-beverage-brands/)
- "Restaurantes & Alimentação têm a segunda menor CPC de qualquer indústria rastreada pela Hawky, atrás apenas de Colecionáveis & Compras, tornando-o um setor altamente custo-eficiente para Meta Ads" — [Hawky](https://hawky.ai/blog/facebook-ads-benchmarks)
- "Campanhas de geração de leads para restaurantes atingem uma taxa de conversão (CVR) de 18,25% — 341,52% acima da média de todas as outras indústrias — com custo por lead de até US$ 3,16" — [Hawky/agregação de fontes](https://hawky.ai/blog/facebook-ads-benchmarks)
- "Restaurantes & Alimentação têm um dos CPCs mais baixos para anúncios de tráfego, em US$ 0,45, com queda de 25% no CTR médio em comparação com 2024 para campanhas de tráfego, mas aumento de 41% no CTR para outros tipos de campanha ano a ano" — [síntese via LocaliQ/WordStream, "Facebook Advertising Benchmarks for 2026"](https://localiq.com/blog/facebook-advertising-benchmarks/)
- "Restaurantes e Alimentação têm um dos CPCs mais baixos, em US$ 0,74 para anúncios de leads; o custo por lead da campanha de leads no Facebook para Restaurantes & Alimentação é de US$ 3,16" — [LocaliQ/WordStream](https://localiq.com/blog/facebook-advertising-benchmarks/)
- "A média de CPC no Facebook Ads para campanhas de tráfego em todas as indústrias é de US$ 0,60 — abaixo da média do ano passado de US$ 0,70. A média de CPC para o objetivo de campanha de leads em todas as indústrias é de US$ 1,80 — queda de 6,25% em relação à média do ano passado de US$ 1,92" — [LocaliQ/WordStream](https://localiq.com/blog/facebook-advertising-benchmarks/)

### Inferences
- Restaurante/delivery é consistentemente citado, em todas as fontes consultadas (apesar de nenhuma ser Meta oficial), como um dos setores de menor CPC no Meta Ads — isso é coerente com a natureza de alta intenção/impulso do público de comida, e serve como argumento de que campanhas de tráfego pago para delivery local tendem a ter custo de clique abaixo da média geral de mercado.
- Todos esses números são globais (majoritariamente ponderados por mercado dos EUA, já que a maioria das fontes de benchmark de indústria é americana) — **não há benchmark específico de restaurante/delivery para o Brasil** nesta pesquisa; a analogia deve ser usada com cautela, ajustando pela diferença geral de CPM/CPC Brasil vs. EUA (Brasil mais barato, ver seção anterior).

### Gaps
- Nenhuma fonte brasileira (Sebrae, Abrasel, Galunion) retornou, nesta pesquisa, benchmark específico de custo de mídia paga (CPC/CPM/CTR) para restaurante/delivery no Brasil — as buscas por esses publicadores não trouxeram relatório direto sobre o tema; recomenda-se pesquisa adicional direcionada aos sites da Abrasel e Sebrae (não cobertos com sucesso nesta rodada) antes de publicar um capítulo específico de "benchmark de restaurante no Brasil".
- Não foi possível confirmar a metodologia (tamanho de amostra, período exato, definição de "restaurante" no dataset) de nenhuma das fontes de benchmark por indústria citadas acima — todas são blogs comerciais, não papers/relatórios com nota metodológica pública. Tratar os números como "ordem de grandeza direcional citada por múltiplas fontes de mercado", nunca como número exato de meta.

## Fórmula de CPA/custo-por-pedido alvo a partir de ticket médio e margem

### Takeaway
A lógica de mercado (não específica de Meta Ads, mas de gestão financeira de restaurante/delivery) é: Margem de Contribuição = Preço de venda − Custo variável direto (CMV + embalagem + eventual comissão de entrega); o CPA/custo por pedido "sustentável" no primeiro pedido é limitado por essa margem de contribuição, e negócios com recorrência alta podem justificar CPA acima da margem do primeiro pedido, amortizando pelo LTV (valor de vida do cliente) em pedidos subsequentes sem custo de aquisição adicional.

### Cited Findings
- "A margem de contribuição no food service é a diferença entre o preço de venda de um item e seu custo variável direto (CMV + embalagem + eventual comissão de entrega), representando o valor que cada venda efetivamente contribui para cobrir custos fixos e gerar lucro. Uma boa referência é uma margem bruta de 40% — ou seja, R$ 0,40 de lucro bruto para cada R$ 1,00 faturado" — [Sisfood, "Margem de Lucro para Restaurante: 8% a 15% por Tipo (2026)"](https://www.sisfood.com.br/saiba-mais/gestao-financeira/margem-lucro-restaurante)
- "O ticket médio de delivery é de R$ 66,21, um valor 12% acima do consumo presencial em restaurantes" — [Rei do Delivery, "Delivery Dá Lucro? Margem Real por Nicho (2026)"](https://reidodelivery.com.br/blog/delivery-da-lucro)
- "A fórmula é simples: CPA = Investimento Total ÷ Número de conversões. Se você investiu R$ 5.000 em campanhas e conseguiu 100 vendas, o CPA é R$ 50 por venda" — [CalculoHub, "Calculadora de CPA — Custo por Aquisição de Clientes"](https://www.calculohub.com.br/calculadoras/cpa)
- "Uma forma simples de visualizar o cálculo é usar um CMV padrão de 28-35% para delivery" — [Brendi, "Calculando o custo de venda para restaurantes: guia"](https://brendi.com.br/blog/calculadora-custo-venda-restaurante/)
- "iFood, Rappi e outros apps de delivery cobram entre 12% e 35% por pedido, além de taxas de pagamento online, assinaturas mensais e anúncios pagos" — [OlaClick, "Calculadora de Comissões de Delivery para Restaurante"](https://olaclick.com/herramientas/calculadora-de-comissoes-de-delivery/)
- "Em um exemplo hipotético para um canal próprio, com ticket médio de R$ 66,21 e custo fixo mensal estimado de R$ 5.000, o cálculo resulta em cerca de 150 pedidos por mês apenas para atingir o ponto de equilíbrio" — [Rei do Delivery](https://reidodelivery.com.br/blog/delivery-da-lucro)

### Inferences
- Fórmula de CPA-alvo (payback no primeiro pedido) derivável dos achados acima: **CPA-alvo (primeiro pedido) = Ticket médio × Margem de contribuição %** (onde Margem de contribuição % = 100% − CMV% − % embalagem − % comissão de entrega/marketplace, se aplicável, antes de custo fixo). Ex.: ticket médio R$ 66 × margem de contribuição de ~40% (referência Sisfood) = CPA-alvo de aproximadamente R$ 26 por pedido para "empatar" no primeiro pedido (sem considerar ainda custo fixo/overhead).
- Para canal próprio (site/WhatsApp, sem comissão de marketplace de 12-35%), a margem de contribuição disponível para financiar aquisição é maior do que em pedidos vindos de iFood/Rappi — o que sustenta, do ponto de vista de unit economics, priorizar tráfego pago para o canal próprio em vez de marketplace, já que no canal próprio praticamente toda a margem de contribuição fica livre para CPA + lucro, enquanto no marketplace 12-35% já saem antes de qualquer cálculo de CPA.
- Payback em LTV: se o cliente repete o pedido (taxa de recompra), o CPA "sustentável" pode ultrapassar a margem de contribuição de um único pedido, desde que (CPA) ≤ (margem de contribuição do 1º pedido) + (margem de contribuição esperada dos pedidos futuros × probabilidade de recompra, seja descontada por período) — ou seja, CPA-alvo-com-LTV = Margem de contribuição × Número esperado de pedidos por cliente ao longo do período de LTV considerado. Nenhuma das fontes desta pesquisa fornece diretamente essa fórmula de LTV para delivery brasileiro — é uma inferência lógica a partir dos componentes encontrados (margem de contribuição + CPA), não uma citação direta.

### Gaps
- Nenhuma fonte encontrada nesta pesquisa apresenta explicitamente a fórmula combinada "CPA-alvo a partir de ticket + margem + payback em LTV" pronta — o que está disponível são os componentes separados (fórmula de CPA simples, definição de margem de contribuição, ticket médio de delivery, faixas de CMV e comissão de marketplace). A montagem da fórmula completa acima é inferência lógica do pesquisador a partir desses componentes, não uma citação direta de nenhuma fonte — sinalizar isso claramente ao redator do manual.
- Não há, nesta pesquisa, dado de taxa de recompra/repeat rate específica para delivery de restaurante no Brasil (necessária para o cálculo de LTV/payback) — recomenda-se pesquisa adicional em Sebrae/Abrasel/Galunion especificamente sobre recompra e frequência de pedido, não coberta com sucesso nesta rodada (essas fontes não retornaram resultados diretos nas buscas realizadas).
- Não foi possível confirmar se o "CMV padrão de 28-35% para delivery" citado (Brendi) já inclui ou não embalagem — checar a fonte original com mais detalhe antes de usar o número em cálculo fino de margem.
