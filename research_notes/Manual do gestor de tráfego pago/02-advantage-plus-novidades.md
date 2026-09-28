# Suite Advantage+ da Meta e principais mudanças de produto/algoritmo para anunciantes (2025–2026)

*Estado do conhecimento em 2026-09-27. Todas as afirmações estão datadas e com fonte. Reivindicações da Meta são marcadas explicitamente como tal; dados de terceiros/independentes também são marcados.*

## Consolidação em "Advantage+ on/off" (Sales, Leads, App) — o que é, o que a Meta recomenda, o que dados independentes mostram

### Takeaway
Em 2025 a Meta transformou "Advantage+" de um tipo de campanha separado em um **estado** da campanha: com as três automações (orçamento, audiência, posicionamentos) ligadas, a campanha é rotulada Advantage+; desligar qualquer uma vira uma campanha manual "com recursos Advantage". Ad sets voltaram a existir dentro de campanhas de vendas Advantage+ (não existiam no antigo Advantage+ Shopping). Dados independentes (Foxwell Digital) mostram ganhos reais de CPA no mês de migração, mas a Meta também está fechando as portas de criação via API legada em fases durante 2025–2026.

### Cited Findings
- Em fevereiro de 2025 a Meta remodelou o antigo formato Advantage+ Shopping para "Advantage+ sales campaigns" e trouxe de volta os ad sets — o antigo Advantage+ Shopping não tinha ad sets, mas agora é possível estruturar a campanha e dar a cada ad set suas próprias criações e exclusões — [Bir.ch / AdManage.ai, 2026](https://bir.ch/blog/advantage-plus-sales-campaigns-guide)
- "Advantage+" não é mais um tipo de campanha separado, mas um estado: com as três automações (orçamento, audiência, posicionamentos) ligadas, a Meta rotula a campanha como Advantage+; desligar uma delas faz virar campanha manual de vendas com recursos Advantage — [AdManage.ai, 2026](https://admanage.ai/blog/meta-advantage-plus-shopping-campaigns)
- Em junho de 2025 a Meta começou a lançar mudanças que fazem campanhas de Vendas, Leads e App rodarem automaticamente em modo Advantage+ — [Jon Loomer Digital (via busca), 2025](https://www.jonloomer.com/advantage-plus-sales-app-leads-campaigns/)
- A campanha Advantage+ Sales revisada agora inclui alternâncias individuais: Advantage+ On, Advantage+ Off, Advantage+ Creatives, Advantage+ Catalogs, Advantage+ Destinations, permitindo ligar/desligar automações separadamente em vez de comprometer-se com automação total — [Bir.ch/1clickreport, 2026](https://www.1clickreport.com/blog/meta-advantage-plus-campaign-setup-2026)
- Teste de campo independente da Foxwell Digital: o mês em que as Advantage+ Shopping Campaigns foram implementadas mostrou uma redução de 25% no CPA em relação ao mês anterior (não-ASC) — [Foxwell Digital, 2025/2026](https://www.foxwelldigital.com/blog/advantage-shopping-campaigns)
- Dado da própria Meta (reivindicação da empresa, não verificação independente): usando recursos Advantage+ para servir tipos de criativo otimizados, Meta reporta 12% de redução em CPA e 55% de aumento em CTR — [citado via AdManage.ai / agregadores, 2025–2026](https://admanage.ai/blog/meta-advantage-plus-vs-manual-creative)
- No lado de API: a partir da versão 25.0 da Marketing API, anunciantes não usarão mais a flag `smart_promotion_type` para criar campanhas ASC ou AAC; a partir da versão 24.0 (lançada em 8 de outubro de 2025) a Meta proibiu a criação de novas campanhas ASC/AAC pelas APIs legadas; a versão 25.0 (prevista para o 1º trimestre de 2026) completa a migração faseada, após a qual a criação de novas campanhas ASC/AAC pelas APIs legadas deixa de ser possível em todas as versões — [ppc.land, 2025–2026](https://ppc.land/meta-deprecates-legacy-campaign-apis-for-advantage-structure/)
- O novo campo `advantage_state_info` da API é somente leitura e mostra em tempo real se a campanha está em estado `ADVANTAGE_PLUS_SALES`, `ADVANTAGE_PLUS_APP`, `ADVANTAGE_PLUS_LEADS` ou `DISABLED` — [ppc.land, 2025–2026](https://ppc.land/meta-launches-unified-api-structure-for-advantage-campaigns/)

### Inferences
- Para um restaurante pequeno local, a reintrodução de ad sets dentro do Advantage+ Sales é relevante porque permite segmentar por criativo/produto sem abrir mão das automações de orçamento/audiência/posicionamento — algo que o antigo Advantage+ Shopping (sem ad sets) não permitia.
- A obrigatoriedade técnica cada vez maior (deprecação de `smart_promotion_type`, fim da criação via API legada) significa que qualquer integração própria via Marketing API para criar campanhas precisa migrar para os novos campos de automação/estado antes do 1º trimestre de 2026.

### Gaps
- Não encontrei dados independentes específicos sobre o desempenho do Advantage+ Sales/Leads em contas de restaurante local com orçamento de R$ 20–100/dia; os números disponíveis (Foxwell, Meta) vêm de e-commerce/DTC de maior escala.
- Não localizei uma data exata e documento oficial da Meta (Business Help Center) confirmando o toggle "Advantage+ on/off" na interface do Ads Manager — a informação vem de fontes secundárias/agregadoras, não do Meta Business Help Center diretamente.

---

## Advantage+ audiência — original audiences, sugestões de audiência, e interação com raio/localização

### Takeaway
A diferença central: localização (incluindo raio) e idade mínima são as únicas restrições rígidas no Advantage+ Audience — todo o resto (interesses, exclusões, sugestões demográficas) vira apenas "sugestão" que a IA pode ignorar em busca de melhor desempenho. Audiências originais (manuais) continuam sendo hard constraints em tudo, incluindo raio. Para campanhas hiper-locais (raio pequeno em torno de uma única loja), a recomendação de mercado é usar Audiência Original, pois a IA "não tem espaço para explorar".

### Cited Findings
- Com Advantage+ Audience, é possível ainda fornecer sugestões de audiência (faixa etária, localização, interesses), mas funcionam como dicas de partida, não limites rígidos: a IA usa isso como ponto de partida e depois se expande para além desses parâmetros quando encontra usuários com melhor desempenho em outro lugar da plataforma — [Affect Group / TrueFuture Media (via busca agregada), 2026](https://affectgroup.com/blog/meta-ads-advantage-plus-or-original-audiences-when-to-use/)
- Apenas localização e idade mínima são restrições rígidas (hard constraints) no Advantage+ Audience — outros parâmetros (interesses, targeting detalhado) tornam-se flexíveis/sugestões — [agregadores citando Jon Loomer Digital, 2026](https://www.jonloomer.com/advantage-audience-vs-original-audiences/)
- Com audiências originais, a Meta não entrega o anúncio para pessoas fora das localizações selecionadas, faixa etária, gênero, exclusões (audiência personalizada ou targeting detalhado) ou idiomas — [agregadores, 2026](https://theleadsource.co.uk/whats-the-difference-between-original-audience-and-advantage-audience/)
- Recomendação de mercado: para campanhas hiper-locais mirando um raio de 10 milhas (~16 km) em torno de uma única loja, a IA não tem espaço suficiente para "explorar", então Audiências Originais seriam mais apropriadas nesses casos, pois garantem controle estrito de localização — [alexneiman.com / agregadores, 2026](https://alexneiman.com/meta-advantage-plus-audience-targeting-2026/)
- No campo da API: Advantage+ audience exige opt-in explícito, expresso como `targeting_automation` com `advantage_audience` definido como 1 em pelo menos um ad set — [ppc.land / documentação técnica agregada, 2025–2026](https://ppc.land/advantage/)

### Inferences
- Para o cenário de um restaurante com raio de entrega de 3–8 km (bem menor que o exemplo de 16 km citado acima), a recomendação de mercado de usar Audiência Original (não Advantage+ Audience) para preservar o raio como limite rígido parece ainda mais aplicável — quanto menor o raio, menor o "espaço de exploração" que a Meta teria antes de vazar entrega para fora da área de entrega viável.
- Mesmo dentro do Advantage+ Audience, o raio de localização é tecnicamente respeitado como hard constraint (segundo as fontes), então o risco não é a Meta entregar fisicamente fora do raio, mas sim o algoritmo relaxar demais interesses/demografia dentro do raio, potencialmente reduzindo a relevância para o público de delivery local.

### Gaps
- Não encontrei o texto original do Meta Business Help Center sobre Advantage+ Audience (apenas fontes secundárias/agregadoras) — as citações acima vêm de sites de terceiros que parafraseiam Jon Loomer Digital e outros; não foi possível confirmar a redação exata da Meta sobre "audience suggestions" por bloqueio de acesso a jonloomer.com nesta sessão (egress bloqueado).
- Não há dado numérico independente (teste A/B com números) comparando Advantage+ Audience vs. Original Audiences especificamente para raio pequeno (3–8 km) e orçamento baixo (R$20–100/dia).

---

## Advantage+ posicionamentos (placements) — o que é, recomendação da Meta, dados independentes para orçamento pequeno

### Takeaway
Dados agregados de mercado (não verificados de forma independente e primária nesta pesquisa) apontam CPMs 15–30% menores e CPA ~11,7% melhor com Advantage+ Placements vs. Feed apenas; para orçamentos pequenos, mais posicionamentos elegíveis aceleram a saída da fase de aprendizado, o que favorece especificamente contas pequenas/locais com poucos dados históricos.

### Cited Findings
- Ad sets usando Advantage+ Placements tiveram melhoria média de CPA de 11,7% — [Madgicx (via busca agregada), 2025–2026](https://madgicx.com/blog/advantage-plus)
- Marcas tipicamente veem CPMs 15–30% menores com Advantage+ Placements vs. seleção apenas de Feed — [agregadores, 2025–2026](https://roaspig.com/blog/pros-cons-advantage-placements/)
- Mais posicionamentos significam mais impressões mais rápido; campanhas saem da fase de aprendizado mais cedo com Advantage+ Placements, especialmente em orçamentos mais baixos — [1clickreport/adamigo (via busca agregada), 2026](https://www.adamigo.ai/blog/advantage-placements-vs-manual-placements)
- Advantage+ é indicado para pequenas empresas e profissionais de marketing solo que querem focar em estratégia em vez de gestão detalhada, e essa abordagem se destaca ao testar novos mercados ou quando falta histórico de dados para decisões manuais — [agregadores, 2026](https://zeely.ai/blog/meta-advantage-vs-manual-setup/)
- Recomendação de orçamento citada: para orçamentos pequenos, sugere-se pelo menos US$30–50/dia por ad set; para contas de alto volume uma semana pode mostrar padrões úteis, mas contas menores precisam de mais tempo para reunir dados de conversão significativos — [agregadores, 2026](https://madgicx.com/blog/advantage-plus)

### Inferences
- Para um restaurante com R$20–100/dia (aproximadamente US$4–20/dia), mesmo a recomendação "mínima" de mercado de US$30–50/dia por ad set citada acima está acima do orçamento típico do caso de uso — isso sugere que campanhas de orçamento muito baixo terão dificuldade extra para sair da fase de aprendizado mesmo com Advantage+ Placements ativado, e os números de CPA/CPM citados (que vêm de contas maiores) podem não se replicar integralmente em orçamentos tão pequenos.

### Gaps
- Todas as fontes numéricas encontradas são agregadores de conteúdo de marketing (não big publishers como Search Engine Land/Digiday/AdExchanger, nem o Meta Business Help Center) — não foi possível confirmar a metodologia por trás dos números de 11,7% (CPA) e 15–30% (CPM) citados; tratar como estimativas de mercado, não como estudo controlado auditável.
- Nenhuma fonte encontrada trata especificamente de Advantage+ Placements para delivery/restaurante local com raio de 3–8 km.

---

## Advantage+ criativo — otimizações automáticas e recursos de IA generativa (fundo, expansão de imagem, variações de texto, vídeo)

### Takeaway
Os recursos de Advantage+ Creative/IA generativa (geração de fundo, expansão de imagem, variações de texto, vídeo a partir de imagem estática) foram lançados/expandidos ao longo de 2025, com "geração de fundo" chegando em março/abril de 2025. A Meta reivindica ganhos de CTR/CPA (não verificados de forma independente nesta pesquisa); teste de campo independente da Foxwell relatou 25% de redução de CPA no mês de adoção do formato Advantage+ Shopping (que inclui otimizações de criativo).

### Cited Findings
- Expansão de imagem adapta imagens para diferentes proporções e posicionamentos nas plataformas (Feed, Stories, Reels), enquanto geração de fundo cria novos fundos ao redor de imagens de produto, com base em um prompt — [Flighted (via busca agregada), 2025–2026](https://www.flighted.co/blog/metas-advantage-plus-ai-creative-enhancements-each-one-explained)
- Geração de fundo substitui ou estende o fundo de imagens de produto usando IA generativa, funcionando melhor para fotos de produto em fundos simples/brancos; o sistema cria diferentes cenários de fundo com base nas características da audiência — [agregadores, 2025–2026](https://coinis.com/blog/meta-advantage-plus-ai-ads-updates-2025)
- Os principais recursos de IA criativa da Meta são Advantage+ creative e Meta AI Studio; Advantage+ creative otimiza os anúncios com base nas versões com que a audiência tem mais probabilidade de interagir; recursos adicionais incluem variações de texto para títulos e texto principal, e criação de vídeo assistida por IA que transforma imagens estáticas em vídeos curtos animados — [Bir.ch (via busca agregada), 2025](https://bir.ch/blog/meta-ai-creative-tools)
- Geração de fundo é novidade de março/abril de 2025, com a IA criando fundos estilizados com um clique; adições recentes incluem geração de fundo por IA e expansão de imagem para anúncios de catálogo — [agregadores, 2025](https://bir.ch/blog/meta-ai-creative-tools)
- Reivindicação da própria Meta (não verificação independente): usando recursos Advantage+ para servir tipos de criativo otimizados, redução de 12% em CPA e aumento de 55% em CTR — [citado via agregadores, 2025–2026](https://admanage.ai/blog/meta-advantage-plus-vs-manual-creative)
- Teste de campo independente (Foxwell Digital): mês de adoção do Advantage+ Shopping (que usa otimizações de criativo automáticas) teve 25% de redução de CPA vs. mês anterior — [Foxwell Digital, 2025–2026](https://www.foxwelldigital.com/blog/advantage-shopping-campaigns)

### Inferences
- Para um restaurante local, geração de fundo e expansão de imagem podem ser úteis especificamente para reaproveitar fotos de produto (pratos) tiradas em fundo simples, mas as fontes indicam que a técnica funciona melhor com fotos de produto isoladas em fundo branco/simples — fotos de pratos "no prato, na mesa" (contexto real de restaurante) podem não se beneficiar tanto quanto fotos de e-commerce puras.

### Gaps
- Não encontrei o CTR/CPA relatado pela Meta com metodologia (tamanho de amostra, período, segmento de indústria) — é uma reivindicação da empresa citada de forma solta por agregadores, sem link direto a um relatório oficial da Meta com esses números.
- Não há teste independente específico separando o efeito de "geração de fundo"/"expansão de imagem" isoladamente (vs. o pacote Advantage+ Creative como um todo) para pequenas empresas locais.

---

## Andromeda / mudanças no modelo de ranqueamento (GEM) — o que muda na produção de criativos

### Takeaway
Andromeda é o motor de recuperação de anúncios com IA que substituiu o sistema legado de seleção de anúncios da Meta entre o final de 2024 e outubro de 2025, deslocando o foco de estrutura de campanha/segmentação manual para diversidade e volume de criativos. Dados de mercado (não plenamente auditáveis nesta pesquisa) indicam que anúncios semanticamente parecidos são agrupados sob um único "Entity ID", e uma pontuação de similaridade de criativo acima de 60% dispara supressão na recuperação — ou seja, variações cosméticas não contam como anúncios separados.

### Cited Findings
- Meta Andromeda é o motor de recuperação de anúncios com IA que substituiu o sistema legado de seleção de anúncios da Meta entre o final de 2024 e outubro de 2025; introduzido silenciosamente no final de 2024 e integrado ao longo de 2025, Andromeda deslocou a Meta de um modelo focado em estrutura para um sistema de recuperação — [Admove.ai (via busca agregada), 2026](https://www.admove.ai/blog/meta-andromeda-guide)
- Pesquisa da Foxwell Digital (citada por terceiros) confirma que, enquanto campanhas pré-Andromeda dependiam fortemente de segmentação de audiência, campanhas pós-Andromeda invertem essa proporção drasticamente — diversidade criativa é agora o principal fator de desempenho; as três alavancas mais importantes sob Andromeda são: diversidade criativa (15–20 anúncios ativos com ganchos e formatos diferentes), estrutura de campanha simplificada (Advantage+ Shopping como principal) e qualidade limpa do sinal de conversão — [citado via tryatria.com/agregadores, 2025–2026](https://www.tryatria.com/blog/andromeda-meta-ads)
- Andromeda organiza anúncios em uma árvore hierárquica com base em similaridade semântica; anúncios e criativos parecidos são agrupados e recebem um único "Entity ID" (identificador interno do Andromeda para o que ele considera um anúncio conceitualmente único); pontuações de Similaridade Criativa acima de 60% disparam supressão de recuperação — o algoritmo colapsa anúncios parecidos em uma única entidade, então variações cosméticas não contam como anúncios separados — [madwise-agency.com (via busca agregada), 2025–2026](https://madwise-agency.com/blog/meta-ads-facebook-algorithms-andromeda/)
- Dado citado (fonte agregadora, não confirmada de forma independente com metodologia): um ad set com 25 criativos diversos gera 17% mais conversões a um custo 16% menor do que cinco ad sets com cinco criativos cada — [madwise-agency.com / agregadores, 2025–2026](https://madwise-agency.com/blog/meta-ads-facebook-algorithms-andromeda/)
- Guia da Foxwell Digital para 2026 sugere 8–10 conceitos novos e 40–50 ativos totais novos por mês para marcas com gasto de US$100 mil+; e apenas 4–5 ativos por mês para gasto em torno de US$5 mil — [Foxwell Digital (via busca agregada), 2026](https://www.foxwelldigital.com/blog/advantage-shopping-campaigns)
- Motion 2026 Benchmarks (citado por terceiros) constatou que marcas testando 10+ conceitos por mês alcançam CPA 31% menor vs. marcas testando menos de 5 — [Motion (via agregadores), 2026](https://admanage.ai/blog/facebook-ad-creative-testing-framework)

### Inferences
- Para um restaurante pequeno com orçamento de R$20–100/dia, a recomendação de escala da Foxwell (4–5 ativos/mês para contas de ~US$5 mil de gasto) já é o patamar mais baixo citado no mercado — um orçamento de R$20–100/dia (bem abaixo de US$5 mil/mês mesmo no teto) provavelmente não sustenta 15–20 anúncios ativos simultâneos como recomendado para contas maiores; o gestor de tráfego precisa priorizar qualidade/diversidade sobre volume bruto, com foco em evitar duplicação semântica (mesmo ângulo de foto, mesma composição) entre os poucos anúncios que rodar.
- A mecânica de "Entity ID" e supressão por similaridade >60% implica que simplesmente duplicar um anúncio e trocar a cor do botão de CTA, por exemplo, não gera diversidade real aos olhos do Andromeda — o gestor deveria variar ângulo de câmera, formato (imagem vs. vídeo vs. carrossel), gancho de texto e cenário, não apenas parâmetros cosméticos.

### Gaps
- Não localizei a fonte primária/técnica da Meta descrevendo "Entity ID" e o limiar de 60% de similaridade — essas informações vêm de agregadores de marketing (madwise-agency.com) sem um link para um paper, changelog oficial ou post técnico da Meta que confirme os números exatos; tratar o "60%" e o "17%/16%" como estimativas de mercado não verificadas em fonte primária.
- Não encontrei confirmação direta do termo "GEM" (mencionado no objetivo da pesquisa) associado a Andromeda nas buscas realizadas — pode ser um nome de modelo interno adicional (Generative Embedding Model ou similar) não coberto pelas fontes de mercado consultadas nesta sessão; marcar como gap para o escritor do relatório verificar separadamente.

---

## Atribuição incremental (Incremental Attribution) — o que é, dados de desempenho, aplicabilidade a pequenos negócios

### Takeaway
A Atribuição Incremental da Meta foi lançada em abril de 2025 e usa testes holdout + machine learning para estimar atribuição automaticamente dentro do Ads Manager, filtrando vendas orgânicas que ocorreriam de qualquer forma. Um estudo citado (Haus, via busca) mostra que o desempenho relativo à atribuição padrão mudou de pior (0,80x) no período jul/2024–jun/2025 para melhor (1,26x, média geométrica pooled) no período jul/2025–jun/2026 — com marcas DTC-only se beneficiando mais (1,38x) do que omnichannel (1,02x, quase paridade).

### Cited Findings
- O recurso de Atribuição Incremental da Meta foi lançado em abril de 2025 e usa testes holdout e machine learning para estimar atribuição automaticamente dentro do Ads Manager; é um modelo de medição orientado por IA que identifica conversões causadas diretamente pelos anúncios, filtrando vendas orgânicas que teriam ocorrido sem qualquer exposição ao anúncio — [Haus.io (via busca agregada), 2026](https://www.haus.io/blog/is-metas-incremental-attribution-outperforming-standard-attribution-what-the-data-shows)
- No período de teste de julho de 2025 a junho de 2026, otimizar para Atribuição Incremental entregou um retorno incremental maior do que a atribuição padrão no teste típico (média geométrica pooled de 1,26x) — uma reversão em relação ao período de julho de 2024 a junho de 2025, quando a atribuição padrão saiu na frente (0,80x) — [Haus.io (via busca agregada), 2026](https://www.haus.io/blog/is-metas-incremental-attribution-outperforming-standard-attribution-what-the-data-shows)
- Marcas exclusivamente DTC tiveram média de 1,38x (Atribuição Incremental sobre padrão), enquanto marcas omnichannel tiveram média de 1,02x, próximo da paridade — [Haus.io (via busca agregada), 2026](https://www.haus.io/blog/is-metas-incremental-attribution-outperforming-standard-attribution-what-the-data-shows)
- A Meta vem expandindo o acesso progressivamente desde o lançamento em abril de 2025; em meados de 2026 já está amplamente disponível para os objetivos de Vendas e Leads, enquanto ainda está sendo lançada para outros objetivos e locais de conversão — [agregadores, 2026](https://theoptimizer.io/blog/how-meta-ads-attribution-actually-works-in-2026)
- Reivindicação da própria Meta (não verificada independentemente): aumento de 24% nas conversões incrementais no rollout do modelo mais recente em comparação com o modelo de atribuição padrão, reportado na atualização de Q4 2025 (janeiro de 2026) — [agregadores citando a Meta, 2026](https://coinis.com/blog/meta-advantage-plus-ai-ads-updates-2025)

### Inferences
- Como o recurso já está "amplamente disponível" para os objetivos de Vendas e Leads em meados de 2026, um restaurante rodando campanhas de leads/mensagens (ex.: WhatsApp) provavelmente já tem acesso, mas o dado de "1,02x para omnichannel" (quase paridade) é o mais próximo do perfil de um restaurante físico com delivery (que não é DTC puro online) — sugerindo que o ganho incremental da atribuição incremental da Meta pode ser mínimo/neutro para esse perfil, ao contrário do ganho maior visto em marcas DTC-only.
- Nada nos dados encontrados aponta especificamente para volume mínimo de conversões necessário para a Atribuição Incremental funcionar bem (testes holdout tipicamente precisam de volume razoável) — isso é uma preocupação relevante para orçamentos de R$20–100/dia, que geram poucas conversões por semana.

### Gaps
- Não encontrei o volume mínimo de conversões/gasto que a Meta exige ou recomenda para a Atribuição Incremental gerar leituras confiáveis — relevante e não respondido para o caso de um restaurante pequeno.
- Não foi possível acessar a página do Meta Business Help Center para confirmar a definição oficial da Meta (o WebFetch para developers.facebook.com e outros domínios foi bloqueado pelo proxy de rede nesta sessão) — as informações vêm de agregadores secundários (Haus.io, TheOptimizer, Coinis) que não puderam ser verificados na fonte primária diretamente.

---

## Opportunity Score

### Takeaway
Opportunity Score é uma métrica de 0 a 100 no Ads Manager que mede o quanto uma campanha está alinhada com as recomendações internas da Meta (não é uma métrica de desempenho real) — foi disponibilizada para todos os anunciantes, com recursos Advantage+ (posicionamentos, audiência, orçamento de campanha) tendo o maior peso na pontuação. Fontes de mercado enfatizam que a pontuação é diagnóstica, não uma nota de qualidade da conta.

### Cited Findings
- A Meta disponibilizou a métrica de otimização "Opportunity Score" para todos os anunciantes; é uma métrica de 0 a 100 pontos que representa o grau em que suas campanhas estão alinhadas com as orientações de desempenho da Meta — [Swipe Insight / Social Media Today (via busca agregada), 2025–2026](https://www.socialmediatoday.com/news/meta-launches-opportunity-score-all-advertisers/750231/)
- A pontuação é gerada analisando quantas das recomendações do Ads Manager da Meta você implementou; cada recomendação dentro do Ads Manager carrega um valor de pontos diferente dependendo do quão impactante é considerada para sua conta — [agregadores, 2025–2026](https://www.adsmurai.com/en/articles/opportunity-score-meta)
- Recursos Advantage+ como posicionamentos, audiência e orçamento de campanha têm a maior influência na pontuação — [Digital Six / Media Proper (via busca agregada), 2025](https://mediaproper.com/should-you-care-about-meta-opportunity-scores/)
- Você pode encontrar a Opportunity Score na Visão Geral da Conta (Account Overview) no Meta Ads Manager, exibida como porcentagem no topo da página, também visível nos níveis de campanha e conjunto de anúncios — [agregadores, 2025–2026](https://bir.ch/blog/meta-opportunity-score)
- Uma pontuação alta significa que você está seguindo as recomendações da Meta — mas o desempenho da campanha ainda depende da oferta, audiência e criativo; a recomendação de mercado é ver a Opportunity Score como uma ferramenta de diagnóstico, não um relatório de desempenho — [Digital Six (via busca agregada), 2025](https://www.digitalsix.co.uk/news-and-insights/meta-ads-opportunity-score/)
- Há também referência oficial da Meta em página do Business Help Center intitulada "About Opportunity Score in Meta Ads Manager" — [Meta Business Help Center, URL localizada mas conteúdo não verificado nesta sessão por bloqueio de acesso à página](https://www.facebook.com/business/help/804913634782260)

### Inferences
- Para o gestor de tráfego de um restaurante pequeno, perseguir uma Opportunity Score alta na prática significa adotar mais recursos Advantage+ (posicionamentos, audiência, orçamento de campanha) — o que, como já discutido nas seções acima, pode entrar em tensão direta com a necessidade de manter o raio de entrega rígido (que favorece Original Audiences em vez de Advantage+ Audience). Ou seja, seguir a Opportunity Score "à risca" pode não ser a recomendação certa para esse perfil de negócio.

### Gaps
- Não consegui acessar diretamente a página oficial do Meta Business Help Center sobre Opportunity Score (bloqueio de rede ao tentar WebFetch em facebook.com/developers.facebook.com nesta sessão) para citar a definição literal da Meta; as informações acima vêm de agregadores de mercado que parafraseiam o conteúdo oficial.
- Não há data de lançamento exata confirmada em fonte primária (apenas "2025" de forma genérica nos agregadores).

---

## Ferramentas de IA da Meta para pequenas empresas

### Takeaway
Em 2025 a Meta lançou um "Meta AI business assistant" (chat de IA dentro do Ads Manager/Business Support Home) e o "Business AI" (agente de vendas para PMEs, incluindo integração com Shopify), com disponibilidade inicial limitada a pequenas empresas selecionadas e expansão planejada para 2026.

### Cited Findings
- A Meta revelou uma nova experiência de chat de IA dentro do Ads Manager e do Business Support Home, chamada "Meta AI business assistant", projetada para ajudar marcas a otimizar campanhas, receber recomendações orientadas por IA e resolver problemas de conta, como gerenciar contas desabilitadas e limites de gasto diário — [Marketing Dive (via busca agregada), 2025](https://www.marketingdive.com/news/meta-streamlines-ai-use-brands-new-business-agent-creative-tools/801763/)
- Essa ferramenta de chat de IA atua como um consultor de campanha sempre ativo, capaz de fornecer recomendações personalizadas usando Opportunity Score e dados de desempenho ao vivo, sinalizar e ajudar a resolver problemas de conta (limites de gasto, contas desabilitadas), com plano futuro de guiar anunciantes por todo o ciclo de vida da campanha, do planejamento à otimização — [Social Media Today (via busca agregada), 2025](https://www.socialmediatoday.com/news/meta-outlines-ai-chatbots-for-websites-ai-music-generation-try-on-custom-ad-text/801848/)
- Entre as novidades está o lançamento do "Business AI", um agente que ajuda pequenas e médias empresas a usar IA mais facilmente para gerar conversões; varejistas online podem usar o assistente digital Business AI em apps como Facebook e Instagram, além de seus próprios sites via Shopify — [Marketing Dive (via busca agregada), 2025](https://www.marketingdive.com/news/meta-streamlines-ai-use-brands-new-business-agent-creative-tools/801763/)
- O Meta AI business assistant estará disponível apenas para pequenas empresas selecionadas neste ano (2025), com a empresa planejando ampliar a disponibilidade em 2026 — [Social Media Today (via busca agregada), 2025](https://www.socialmediatoday.com/news/meta-outlines-ai-chatbots-for-websites-ai-music-generation-try-on-custom-ad-text/801848/)
- A Meta também revelou novas ferramentas de IA generativa para anúncios em vídeo e imagem, incluindo música gerada por IA — [Marketing Dive, 2025](https://www.marketingdive.com/news/meta-streamlines-ai-use-brands-new-business-agent-creative-tools/801763/)

### Inferences
- Um restaurante pequeno que já usa apenas Facebook/Instagram (sem site Shopify) provavelmente teria acesso apenas ao "Meta AI business assistant" (consultor de campanha dentro do Ads Manager), não ao "Business AI" de vendas (mais focado em e-commerce/Shopify) — vale confirmar disponibilidade regional/setorial no momento da implementação, já que o rollout inicial (2025) foi limitado a "pequenas empresas selecionadas".

### Gaps
- Não há confirmação de disponibilidade desses recursos no Brasil / para o segmento de restaurantes especificamente — os anúncios encontrados são genéricos e globais, sem detalhamento por país.
- Não encontrei dados independentes (fora do marketing da própria Meta) medindo a eficácia real do Meta AI business assistant ou do Business AI para PMEs.

---

## Mudanças 2026 em Click-to-WhatsApp e posicionamentos do Threads

### Takeaway
Anúncios de Clique-para-WhatsApp continuam a funcionar via evento "Messaging Conversation Started"; o Threads expandiu anúncios globalmente no início de 2026 (atualização de 25 de março de 2026 da API de Marketing do Threads trouxe suporte global a anúncios de app e moderação de respostas). Também em janeiro de 2026, o Instagram Explore foi removido como posicionamento do Ads Manager para novas campanhas.

### Cited Findings
- Ao configurar uma campanha com WhatsApp como local de conversão, a Meta exibe o anúncio com um botão de CTA "Enviar mensagem"; quando o usuário toca, é levado ao WhatsApp com uma saudação pré-preenchida; no momento em que envia essa primeira mensagem, a Meta registra um evento "Messaging Conversation Started" e o atribui à campanha — [WATI / Enrich Labs (via busca agregada), 2026](https://www.wati.io/en/blog/set-up-click-to-whatsapp-ads/)
- Anúncios do Threads foram expandidos globalmente no início de 2026, e a atualização de 25 de março de 2026 da API de Marketing do Threads adicionou suporte global a anúncios de app mais moderação de respostas; o Threads suporta anúncios de imagem, vídeo e carrossel através da estrutura de marketing da Meta, com mais de 400 milhões de usuários ativos mensais no início de 2026 — [EmbedSocial (via busca agregada), 2026](https://embedsocial.com/blog/new-threads-features-2026/)
- As mudanças de precificação de outubro de 2026 da Meta estão afetando campanhas de Clique-para-WhatsApp — [AdsUploader (via busca agregada), 2026](https://adsuploader.com/blog/meta-ads-updates)
- O Instagram Explore foi removido como posicionamento do Ads Manager em janeiro de 2026; não está mais disponível para novas campanhas — [AdsUploader (via busca agregada), 2026](https://adsuploader.com/blog/meta-ads-updates)

### Inferences
- Para um restaurante que usa Clique-para-WhatsApp como canal principal de conversão (comum no Brasil), a mudança de precificação de outubro de 2026 é potencialmente a mais relevante e merece acompanhamento direto assim que detalhes específicos forem publicados oficialmente — mas os detalhes concretos dessa mudança de precificação não foram encontrados nesta pesquisa (ver Gaps).
- A expansão do Threads como posicionamento pode ser testada dentro do pacote Advantage+ Placements (a Meta tende a incluir novos posicionamentos automaticamente nesse pacote), mas não há confirmação de que o Threads já esteja incluído por padrão no conjunto Advantage+ Placements no Brasil.

### Gaps
- Não encontrei detalhes concretos (percentuais, mecanismo) das "mudanças de precificação de outubro de 2026" para Clique-para-WhatsApp mencionadas por AdsUploader — apenas a menção de que existem, sem especificação; recomendo o escritor do relatório sinalizar isso como incerto/pendente de confirmação oficial.
- Não encontrei uma fonte primária da Meta (Business Help Center ou developer changelog) para a data exata de expansão global do Threads em anúncios nem para a remoção do Instagram Explore — vêm de agregadores secundários.
- Não pesquisei especificamente a interação de WhatsApp Ads com Advantage+ audience/placements para restaurantes (fora do escopo coberto pelas buscas realizadas); marcar como gap se o relatório final precisar desse detalhe.

---

## Nota metodológica desta pesquisa

- O acesso via WebFetch a domínios como jonloomer.com, developers.facebook.com, haus.io e madwise-agency.com foi bloqueado pelo proxy de rede desta sessão (erro `EGRESS_BLOCKED`). Por isso, os achados acima se baseiam nos resumos/trechos retornados pela ferramenta de busca (WebSearch), que cita e resume o conteúdo dessas páginas — não na leitura direta e integral das páginas primárias. Onde a fonte é uma citação indireta (agregador citando outro agregador ou citando a Meta), isso foi sinalizado explicitamente acima.
- Não foi possível verificar diretamente páginas do Meta Business Help Center (facebook.com/business/help/...) nem developers.facebook.com nesta sessão pelo mesmo motivo de bloqueio de rede — os campos de API citados (`targeting_automation`, `advantage_audience`, `advantage_state_info`, `smart_promotion_type`) vêm de reportagens técnicas de terceiros (ppc.land) que cobrem changelogs da Meta, não da documentação oficial lida diretamente.
- Recomenda-se ao escritor do relatório final tratar os números percentuais específicos (11,7% CPA, 15–30% CPM, 17%/16% conversões/custo, 25% CPA Foxwell, 12%/55% Meta) como estimativas de mercado agregadas de 2025–2026, e não como estudos com metodologia auditável em mãos — nenhuma dessas fontes fornece tamanho de amostra, período exato ou segmento de indústria verificável nesta pesquisa.
