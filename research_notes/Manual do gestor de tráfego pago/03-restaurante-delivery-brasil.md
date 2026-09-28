# Tráfego pago no Meta (Facebook/Instagram) para restaurantes com canal próprio de delivery — Brasil, 2025-2026

> Nota metodológica: a maior parte das fontes brasileiras encontradas são agências/blogs de nicho (Brendi, Trafius, HSG, Wayno, Connexads, Trafego Pago Pro), não estudos acadêmicos ou o próprio Meta. Vários desses domínios foram bloqueados pelo proxy de rede desta sessão (não consegui abrir a página completa), então os números abaixo vêm dos **snippets indexados pela busca**, que resumem o conteúdo dessas páginas — trato-os como fonte secundária/de agência, não como dado auditado, e sinalizo isso explicitamente. Não encontrei estudos com metodologia declarada (amostra, período) para nenhum dos benchmarks numéricos brasileiros; são números de blogs de agência, sem transparência de amostra.

## Qual objetivo de campanha usar para delivery próprio (WhatsApp vs. site com pixel vs. tráfego)

### Takeaway
O padrão reportado por agências é usar **Cliques para o WhatsApp (CTWA)** como objetivo primário de aquisição para pequenos restaurantes — menor fricção, resposta imediata —, e reservar **objetivo de vendas/conversão com Pixel + CAPI** para quando o restaurante tem site/cardápio próprio com checkout, pois isso permite otimização por evento de compra real. Um ponto técnico importante e pouco divulgado: o Pixel/CAPI **não fecha o funil dentro do WhatsApp** — quem resolve esse gap é o parâmetro de referral do WhatsApp Business API (WABA), não a Conversions API.

### Cited Findings
- "Click to WhatsApp ads deliver a combination where someone sees a dish, taps, and is already ordering, with a 72-hour window open and campaign origin tracked" — [WebSearch snippet agregando resultados sobre CTWA para restaurantes](https://brendi.com.br/blog/whatsapp-delivery-restaurante-automatizar/) (página de origem não pôde ser aberta diretamente; conteúdo via busca)
- "A estratégia é usar delivery apps para aquisição de clientes e o WhatsApp para retenção — clientes podem chegar pelo app, mas o segundo pedido deve vir pelo canal próprio, onde a margem é sua" — [Unnica, Como Divulgar Restaurante e Delivery Sem Depender Só de App](https://unnica.com.br/blog/como-divulgar-restaurante-delivery)
- "WhatsApp, instalado em 99% dos smartphones, permite que pedidos cheguem sem comissão e o cliente permanece seu para sempre" — [SocialHub, WhatsApp para Restaurantes e Delivery](https://www.socialhub.pro/blog/whatsapp-restaurantes-delivery-conversao/)
- "CAPI resolve o problema de rastreamento em ambientes onde cookies são bloqueados — mas não resolve o rastreamento dentro do WhatsApp. Para fechar o loop CTWA → venda, o caminho correto é o WABA com parâmetro de referral, não o CAPI" — [gui.marketing, WhatsApp Tracking de Conversões: CTWA, WABA e BSPs](https://gui.marketing/blog/whatsapp-tracking-conversoes/) (página não pôde ser aberta diretamente; conteúdo via snippet de busca)
- "67% dos brasileiros preferem pedir delivery pelo WhatsApp do restaurante quando a opção é apresentada (vs. iFood/Uber)" — [WebSearch snippet, contexto WhatsApp tracking/UTM para delivery](https://gui.marketing/blog/whatsapp-tracking-conversoes/) (número sem link direto de estudo original citado no snippet; tratar como não verificado por fonte primária)
- Recomendação de separar criativos por oferta (frete grátis, cupom, combo) e fazer remarketing para quem "instalou e não pediu" — abordagem aplicável também a quem visitou o cardápio no site e não converteu — [WebSearch snippet sobre estratégia de anúncios de apps de delivery](https://blog.mobapps.com.br/2026/09/21/como-conseguir-clientes-para-um-aplicativo-de-delivery/)
- O Meta Pixel permite registrar visitantes do site (evento PageView/ViewContent) e depois usar isso como público personalizado para remarketing — aplicável ao cardápio online do restaurante — [Alura, fórum sobre remarketing com pageview no Meta](https://cursos.alura.com.br/forum/topico-remarketing-com-pageview-no-meta-454615); [Central de Ajuda Deeliv, Meta Pixel & CAPI](https://centraldeajuda.deeliv.app/modulos/impulsionadores/meta-pixel-capi)

### Inferences
- Para o restaurante pequeno sem site/checkout próprio robusto (caso comum no Brasil, onde o "canal próprio" é frequentemente só um número de WhatsApp com atendente/bot), CTWA é o objetivo mais praticável porque não depende de instrumentação de pixel/CAPI para funcionar — mas também é o mais difícil de medir com precisão de "pedido real" sem integração com o BSP (Business Solution Provider) do WhatsApp.
- Quando o restaurante tem cardápio digital próprio com carrinho e link de pagamento, objetivo de Vendas com Pixel + CAPI deveria, em teoria, otimizar melhor por permitir ao algoritmo aprender com o evento "Purchase" — mas não encontrei nenhum estudo brasileiro comparando CTWA vs. Vendas (site) lado a lado com números de CPA para delivery. Isso é uma lacuna relevante.

### Gaps
- Não encontrei nenhum teste A/B ou estudo comparando diretamente CTWA vs. objetivo "Vendas" (site) vs. "Tráfego" em custo por pedido para restaurantes brasileiros — todas as fontes falam do tema em termos de recomendação/opinião de agência, não de dado experimental.
- Não encontrei detalhamento técnico de como integrar o parâmetro de referral do WhatsApp com o CRM/PDV do restaurante para fechar o funil (que sistemas brasileiros de PDV — Saipos, Goomer, Anota AI — oferecem isso nativamente).

## Geotargeting por raio ao redor da loja (raio, pin-drop vs. cidade, "moram aqui" vs. "estiveram recentemente")

### Takeaway
Fontes internacionais (não há dado brasileiro específico sobre raio ótimo para delivery) recomendam usar **pin drop no endereço da loja** em vez de segmentação por cidade/bairro, com raio configurável de 1 a 50 milhas (Meta permite esse range); para negócios locais como restaurantes, raios pequenos (1–5 milhas / ~1,6–8 km) são indicados para tráfego/pedidos locais, enquanto raios maiores (20–50 milhas) servem para reconhecimento de marca regional, não para delivery. Nenhuma fonte encontrada trata do detalhe "moram aqui" vs. "estiveram recentemente" com dados — é um recurso padrão do Gerenciador de Anúncios da Meta, mas não achei recomendação com evidência sobre qual opção converte melhor para delivery.

### Cited Findings
- "Drop Pin" permite fixar um local no mapa e definir um raio entre 1 e 50 milhas; a plataforma de anúncios da Meta suporta segmentação por raio de 1 a 50 milhas ao redor de um pino ou endereço" — [ADEN'S LAB, Meta Ads Geo Targeting: Cities, Radius, and Exclusions](https://www.adenslab.com/blog/ultimate-geo-targeting-meta-ads-guide) — fonte internacional, não Brasil
- "O raio padrão para Anúncios de Reconhecimento Local é de 1 milha a partir do endereço listado na Página do Facebook" — [Thread Transfer, Meta Ads Location Targeting: Minimum Radius, Geo Hacks, and Local Strategy](https://thread-transfer.com/blog/2026-06-17-meta-ads-location-targeting-radius-minimum/) — fonte internacional
- "Um restaurante pode anunciar promoções de almoço dentro de um raio de cinco milhas para captar clientes próximos. De forma mais ampla, raios pequenos (1 a 5 milhas) geram tráfego a pé, enquanto raios maiores (20 a 50 milhas) constroem reconhecimento regional e são melhores para zonas de delivery, áreas de serviço ou eventos regionais" — [RadiusMapper, Local Marketing Radius Targeting for Businesses](https://radiusmapper.com/blog/local-marketing-radius-targeting) — fonte internacional; nota: esta fonte trata raios grandes (20-50 milhas) como adequados a "zonas de delivery", o que conflita com a lógica de foco hiperlocal (3-8 km) do objetivo desta pesquisa — sinalizo a contradição, não é consenso
- "Usar pin drops em vez de nomes de cidade permite segmentar com precisão áreas de alto tráfego como shoppings, parques empresariais ou campi universitários" — [ADEN'S LAB, mesma fonte acima](https://www.adenslab.com/blog/ultimate-geo-targeting-meta-ads-guide)

### Inferences
- Para a faixa de 3–8 km pedida no objetivo desta pesquisa, a prática mais alinhada com as fontes encontradas é pin-drop no endereço exato da loja com raio custom (não há trava técnica: o mínimo do Meta é maior que isso em milhas, mas o raio é ajustável em incrementos que permitem cobrir ~3-8 km, dentro da faixa de 1-50 milhas / ~1,6-80 km).
- Não há consenso entre as fontes sobre se um raio pequeno (foco em pedido/entrega) ou grande (reconhecimento de marca) é mais indicado para delivery — a resposta parece depender do objetivo da campanha (conversão vs. awareness), não é uma regra fixa.

### Gaps
- Nenhuma fonte brasileira específica sobre food delivery testando raios (ex. 3km vs 5km vs 8km) com CPA comparado.
- Não encontrei dado sobre a opção "pessoas que moram nesse local" vs. "pessoas que estiveram recentemente nesse local" (ambas disponíveis no Gerenciador de Anúncios) e qual performa melhor para restaurante — gap total, precisa de busca adicional ou teste primário.

## Dayparting em torno dos horários de refeição ("hunger hours")

### Takeaway
Fontes (majoritariamente internacionais/agência, sem estudo brasileiro nomeado) recomendam programar anúncios de restaurante para aparecerem **antes e durante as janelas de decisão de refeição** — não durante a própria refeição — com relatos de melhora de CTR e queda de CPA quando comparado a campanhas sem dayparting. O Meta Ads Manager no Brasil (`pt-br.facebook.com`) confirma nativamente a existência da função de programação de anúncios por dia da semana e faixa de horário.

### Cited Findings
- "Restaurantes e serviços de delivery devem anunciar somente nos horários de pico de pedidos — almoço (11h–14h) e jantar (18h–22h)" — [WebSearch snippet, LeadEnforce/HappyChef sobre dayparting para restaurantes](https://leadenforce.com/blog/running-facebook-ads-for-restaurants-how-to-target-local-diners-by-time-and-day) — fonte internacional
- "Programe anúncios de almoço das 10h às 12h, anúncios de jantar das 15h às 18h, para menor concorrência e CPC mais baixo, alcançando clientes enquanto ainda decidem o que comer" — [WebSearch snippet, mesma família de fontes acima] — fonte internacional; note a contradição parcial com o ponto anterior (11h-14h vs 10h-12h) — ambos aparecem em snippets diferentes sem metodologia declarada, tratar como opinião de agência, não dado controlado
- "Em um case de restaurantes usando anúncios com dayparting, o CTR melhorou 29%, enquanto o custo por reserva caiu 18% comparado a campanhas sem programação" — [WebSearch snippet citando case de dayparting em restaurantes](https://foodshot.ai/blog/social-media-advertising-restaurants) — fonte internacional, sem nome do restaurante, sem link para o case original nem período — tratar como afirmação não verificável, não confirmada
- No Brasil, o Meta Ads permite nativamente escolher dias da semana e faixas de horário de veiculação ("programação de horários") — [Central de Ajuda da Meta para Empresas (pt-BR), Sobre a programação de anúncios](https://pt-br.facebook.com/business/help/1037425549606837)

### Inferences
- A lógica repetida (ainda que sem fonte primária robusta) é antecipar o anúncio à decisão: mostrar o anúncio 1–3h antes do horário de pico de pedido, não durante o pico, para captar a pessoa enquanto ainda decide o que comer.
- O case de "CTR +29% / CPA -18%" não tem fonte primária (case study com nome/link), então deve ser tratado como afirmação de blog, não achado verificado — incluo como dado mas com essa ressalva clara para o redator do relatório.

### Gaps
- Nenhum dado brasileiro específico (agência ou Meta) sobre dayparting para delivery — todas as fontes achadas são de blogs internacionais ou sem nacionalidade clara.
- Não encontrei o case original citado como "case study" de dayparting com CTR +29%/CPA -18% — não há link para a fonte primária, portanto o dado não é verificável e deveria ser tratado com cautela.

## Ofertas que convertem em delivery (cupom de primeiro pedido, frete grátis, combos, promoções de dia de semana)

### Takeaway
As fontes (sem estudo controlado, mas convergentes entre si) apontam **frete grátis no primeiro pedido** e **cupom de primeira compra** como as ofertas mais citadas para reduzir fricção de conversão vinda de anúncio; a prática recomendada é segmentar criativos por tipo de oferta (frete grátis / cupom / combo) e medir CAC por oferta (mídia + desconto) contra o lucro médio do primeiro pedido, com controles de uso por CPF e validade.

### Cited Findings
- "Uma boa maneira de conquistar novos clientes é oferecer frete grátis na primeira compra, o que aumenta as chances do cliente fechar o primeiro pedido" — [WebSearch snippet sobre cupons/frete grátis](https://blog.mobapps.com.br/2026/09/21/como-conseguir-clientes-para-um-aplicativo-de-delivery/)
- "O frete grátis reduz fricções e aumenta a sensação de vantagem na compra, já que grande parte dos clientes abandona o carrinho ao descobrir o valor do frete apenas no checkout" — mesma fonte acima
- "Para anúncios de delivery, recomenda-se separar criativos por oferta (frete grátis, cupom, combo) e fazer remarketing para quem instalou [ou visitou] e não pediu" — mesma fonte acima
- "É importante definir valor mínimo de pedido, limite de uso por CPF e prazo de validade, além de calcular o custo de aquisição somando anúncio mais desconto e comparar com o lucro médio das primeiras compras" — mesma fonte acima

### Inferences
- Não há, nas fontes localizadas, dado quantitativo (ex. "frete grátis converteu X% a mais que cupom de R$10") — a superioridade do frete grátis é citada como afirmação repetida em marketing/e-commerce geral, aplicada por analogia ao delivery, não como resultado medido especificamente em restaurante.

### Gaps
- Nenhuma fonte com teste A/B específico comparando frete grátis vs. cupom percentual vs. combo para restaurante/delivery no Brasil.
- Nenhum dado sobre "promoção de dia de semana específico" (ex. terça de rodízio, quarta de pizza) como oferta de anúncio pago — não encontrado; é prática comum de marketing de restaurante mas não achei fonte ligando isso a Meta Ads.

## Migração de clientes do iFood/marketplaces para canal próprio (estratégias, legalidade, relatos)

### Takeaway
A estratégia mais repetida é o **modelo de dois canais**: usar marketplaces (iFood, Rappi, Uber Eats) para aquisição de novos clientes e migrar a recorrência para o canal próprio (WhatsApp/site), evitando pagar comissão sobre pedidos repetidos. No campo legal, o CADE (autoridade concorrencial brasileira) proibiu o iFood de firmar **novos** contratos de exclusividade com grandes redes desde 2021, com um Termo de Cessação de Conduta assinado em 2023 que limita ainda mais a prática — o que é relevante porque, historicamente, cláusulas de exclusividade eram um dos obstáculos para restaurantes divulgarem abertamente seu canal próprio.

### Cited Findings
- "iFood está proibido de pactuar novos contratos com cláusula de exclusividade desde 10 de março de 2021", por decisão do CADE — [Jus.com.br / Tecnoblog, cobertura da decisão do CADE](https://jus.com.br/artigos/89697/ifood-esta-proibido-de-pactuar-novos-contratos-com-clausula-de-exclusividade); [Tecnoblog](https://tecnoblog.net/noticias/ifood-esta-proibido-de-fechar-exclusividade-com-grandes-redes-decide-cade/)
- "Em 8 de fevereiro de 2023, iFood e CADE assinaram um Termo de Cessação de Conduta que estabeleceu critérios e limites para a prática de exclusividade em contratos entre iFood e restaurantes parceiros" — [gov.br/CADE, nota oficial](https://www.gov.br/cade/pt-br/assuntos/noticias/cade-impede-ifood-de-celebrar-novos-contratos-de-exclusividade-com-restaurantes) (conteúdo obtido via snippet de busca; a página gov.br não pôde ser aberta diretamente por bloqueio de rede desta sessão)
- Regras do Termo: iFood não pode contratar exclusividade com redes de 30 ou mais estabelecimentos; até 25% do GMV do iFood pode estar vinculado a restaurantes exclusivos; nos 49 municípios com mais de 500 mil habitantes, apenas 8% dos restaurantes parceiros podem ter contrato de exclusividade; contratos de exclusividade não podem durar mais de 2 anos, com carência de 1 ano para renovação — mesma fonte acima
- "O WhatsApp já responde por 26% do faturamento de delivery [nota: não fica claro no snippet se isso é um dado nacional agregado ou de uma amostra de clientes de um fornecedor de software — tratar com cautela], o que permite que o restaurante retenha 100% do valor sem pagar comissão" — [WebSearch snippet sobre planos e taxas do iFood 2026](https://brendi.com.br/blog/planos-ifood-taxas-2026/) — fonte de agência/fornecedor de software (Brendi vende sistema de canal próprio), possível viés comercial
- "Para restaurantes com faturamento de delivery acima de R$ 50.000 mensais, o modelo de dois canais — marketplace para aquisição e canal próprio para recorrência — é a estratégia recomendada em 2026" — mesma fonte acima, mesma ressalva de viés comercial

### Inferences
- A remoção (parcial) da exclusividade contratual pelo CADE não impede diretamente um restaurante de anunciar seu canal próprio no Meta — o obstáculo real relatado pelas fontes é operacional/comercial (dependência do fluxo de pedidos do marketplace), não uma proibição legal de fazer publicidade paga para WhatsApp/site próprio.
- Como a fonte "26% do faturamento via WhatsApp" e "modelo de dois canais para +R$50k/mês" vêm de um fornecedor de sistema de canal próprio (Brendi), há conflito de interesse potencial — esses números devem ser citados no relatório final como "segundo fornecedor de software de canal próprio", não como estatística de mercado neutra.

### Gaps
- Não encontrei nenhuma fonte jurídica (contrato público do iFood, ou nota da Abrasel) tratando especificamente se há cláusula que restrinja o restaurante de anunciar/mencionar seu WhatsApp ou site próprio dentro do card do restaurante no iFood, ou se há retaliação de ranking por isso — isso é mencionado informalmente no mercado mas não achei fonte documentada nesta pesquisa.
- Não encontrei estudo de caso nomeado (restaurante real, com número antes/depois) de migração de clientes do iFood para canal próprio via Meta Ads — apenas recomendações genéricas de agência.

## Retenção e remarketing (listas de clientes do PDV/ERP, lookalike, remarketing de visitantes do site/cardápio)

### Takeaway
A prática documentada (fontes de agência/consultoria de Meta Ads, sem estudo controlado específico de restaurante) é subir a lista de clientes do CRM/PDV como Público Personalizado (Custom Audience) — por e-mail e telefone —, criar Lookalike de 1–3% a partir dela ou de compradores dos últimos 180 dias via Pixel/CAPI, e usar o Pixel do site/cardápio para remarketing de quem visualizou conteúdo (ViewContent/PageView) sem comprar.

### Cited Findings
- "É possível explorar o CRM do restaurante, importando uma lista de clientes do Mailchimp, subindo um arquivo, ou pegando diretamente e-mails e números de telefone" — [Casuo Ishimine, Públicos de Lista de Clientes no Meta Ads](https://casuoishimine.com.br/publico-lista-clientes-meta-ads-crm/)
- "Lookalike é uma audiência nova criada pelo algoritmo da Meta com perfil similar a uma lista de referência (clientes, compradores, leads qualificados). O Lookalike de Lista de Clientes (1-3%) permite converter novos usuários com características similares aos melhores clientes" — [SI Digital, Como criar público lookalike no Facebook em 2026](https://sidigital.group/blog/como-criar-publico-lookalike-facebook)
- "Para criar um lookalike, é necessário montar um público personalizado com uma fonte de qualidade, como compradores dos últimos 180 dias registrados pelo Pixel da Meta e pela API de Conversões, ou uma lista de clientes do CRM" — [Ciclo Blog, Tipos de Lookalike no Meta Ads para E-commerce](https://cicloecommerce.com.br/blog/tipos-de-lookalike-no-meta-ads-para-e-commerce)
- "O lookalike funciona com uma base de origem contendo no mínimo 100 pessoas, idealmente entre 1.000 e 50.000. O percentual de similaridade vai de 1% a 10% da população da região — 1% é mais parecido com a origem; percentuais maiores ampliam o alcance com menos similaridade" — [Retina Web, Estratégias avançadas de lookalike audiences](https://retinaweb.com.br/blog/estrategias-avancadas-de-lookalike-audiences/); [Ciclo Blog, mesma referência acima]
- "O Meta Pixel registra visitantes do site para exibir anúncios no Facebook/Instagram, permitindo segmentação combinando comportamento no site com dados demográficos e de interesse da Meta" — [Alura, fórum sobre remarketing com pageview](https://cursos.alura.com.br/forum/topico-remarketing-com-pageview-no-meta-454615)

### Inferences
- Para restaurante pequeno com PDV (Saipos, Goomer, Anota AI etc.), a viabilidade prática do lookalike depende de ter pelo menos ~100-1.000 clientes com e-mail/telefone exportável do sistema — algo que a maioria das lojas pequenas com movimento moderado deveria conseguir acumular em poucos meses de operação com CRM ativo.
- Nenhuma fonte tratou de "lookalike a partir de melhores clientes" (ex. top 20% por LTV) especificamente para restaurante — o conceito geral de e-commerce se aplica por analogia, mas não há validação setorial.

### Gaps
- Nenhum estudo de caso com CPA/ROAS comparando lookalike de clientes de restaurante vs. segmentação por interesse padrão.
- Não encontrei dado sobre integração nativa de PDVs brasileiros de restaurante (Saipos, Goomer, Anota AI, Consumer) com exportação direta de lista de clientes para Meta Ads Custom Audiences — gap técnico relevante para o "como fazer" do playbook.

## Orçamentos e custo por pedido esperado para pequenos restaurantes no Brasil

### Takeaway
Fontes de agência (sem estudo com amostra declarada) convergem em uma faixa de **R$ 10 a R$ 20/dia (~R$ 300–600/mês)** como orçamento mínimo viável para começar a testar tráfego pago para um negócio local pequeno, com a ressalva de que esse valor serve para teste/aprendizado (validar oferta e demanda), não para escalar, e que a otimização real do algoritmo do Meta só ocorre depois de ~7–14 dias de veiculação contínua. Não encontrei uma cifra de custo-por-pedido (CPO) em reais, com fonte confiável e datada, especificamente para delivery de restaurante no Brasil — esse é um gap importante da pesquisa.

### Cited Findings
- "É recomendado investir entre R$ 10 e R$ 20 por dia [em tráfego pago para restaurante pequeno], o que chega a cerca de R$ 300 a R$ 600 por mês" — [WebSearch snippet agregando Brendi/EJFGV/outras agências sobre orçamento mínimo](https://ejfgv.com/blog/como-comecar-trafego-pago-r-20-dia-sem-erro/)
- "R$ 20 por dia bastam para começar, mas não bastam para improvisar — é sobre testar uma oferta com pouco risco para entender se existe demanda" — mesma fonte acima
- "A otimização real acontece depois que o algoritmo coleta dados suficientes, geralmente entre 7 e 14 dias de campanha ativa, e orçamentos abaixo do mínimo recomendado atrasam esse processo" — mesma fonte acima
- CPM para o setor de "food and beverage" citado como um dos mais baixos entre verticais (referência internacional/mista, ~US$8,14 CPM, CTR ~2,7%) — [WebSearch snippet citando Mesha/Digital Applied benchmarks 2025-2026](https://trymesha.com/benchmark/facebook/cpm-restaurants/) — atenção: essa fonte (Mesha) é de benchmark internacional (não fica claro no snippet se é dado global ou específico de mercado, e o valor está em dólar, não em real) — não tratar como dado de custo no Brasil sem confirmação adicional
- "iFood, Rappi e Uber Eats cobram de 12% a 30% de comissão por pedido" [contexto comparativo ao CAC de tráfego pago] — [WebSearch snippet citando Brendi sobre tráfego pago para restaurante](https://brendi.com.br/blog/trafego-pago-restaurante-salario-2026/) — fonte de fornecedor de sistema de canal próprio, possível viés comercial

### Inferences
- Nenhuma fonte localizada fornece um número confiável de "custo por pedido em reais" para delivery de restaurante brasileiro via Meta Ads — os números de CPM/CTR encontrados são benchmarks genéricos de "food & beverage" (mistura restaurante presencial, bebidas, food service em geral), não isolam delivery/pedido via WhatsApp.
- A faixa de R$10-20/dia como "mínimo viável" aparece repetida em múltiplos blogs de agência de forma quase idêntica, o que sugere prática de mercado comum, mas não é um dado com metodologia (não é baseado em teste controlado divulgado).

### Gaps
- **Gap crítico**: não encontrei nenhuma fonte com metodologia declarada (agência específica, período, número de contas analisadas) reportando CPM, CTR, CPC, custo por conversa e custo por pedido reais, em reais, especificamente para delivery de restaurante no Brasil em 2025-2026. Os números que existem em português vêm de sites de agência sem citar amostra, e os números internacionais (Mesha, Digital Applied) estão em dólar e não são específicos de delivery/WhatsApp.
- Não encontrei relatório de caso de agência brasileira especializada em food service (Delivery Much, Cardápio Web, Goomer, Anota AI, Saipos, Consumer, Abrasel, Galunion, Instituto Foodservice Brasil) com números de campanha publicados — busquei mas não localizei estudo de caso público com métricas de Meta Ads dessas empresas.

## Sazonalidade da demanda de delivery/restaurante (fins de semana, quinzena/salário, feriados, jogos de futebol, chuva, Dia dos Namorados, Black Friday)

### Takeaway
Há evidência documentada (Abrasel) de que jogos decisivos de futebol e a Copa do Mundo aumentam significativamente o movimento em bares/restaurantes (chegando a ~30% de alta em receita na primeira semana da Copa 2022), e que o delivery já responde por 58% das vendas de restaurantes segundo pesquisa Abrasel de agosto de 2026. Não encontrei dado quantificado especificamente sobre chuva, quinzena de pagamento de salário, ou Dia dos Namorados aplicado a delivery — só menções genéricas de que são "eventos que movimentam" o setor.

### Cited Findings
- "Após jogos decisivos de futebol, bares e restaurantes registraram aumento de vendas e fluxo de clientes. Em 2022, durante a Copa do Mundo, uma pesquisa da Abrasel registrou aumento de cerca de 30% na receita de bares e restaurantes na primeira semana do torneio" — [Abrasel, Semana de decisões no futebol lota bares e impulsiona faturamento](https://abrasel.com.br/noticias/noticias/semana-de-decisoes-no-futebol-lota-bares-e-impulsiona-faturamento/)
- "Eventos que movimentam bares e restaurantes incluem Dia dos Namorados e jogos da Copa do Mundo" [sem número associado especificamente a Dia dos Namorados] — mesma família de fontes Abrasel
- "Aplicativos de delivery já respondem por 58% das vendas de restaurantes, segundo pesquisa 'Capacidade Operacional do Delivery' realizada pela Abrasel em agosto de 2026. Porém, 78% das cozinhas ainda não separam a produção para delivery da produção para salão" — [BPMoney / Times Brasil-CNBC, cobertura da pesquisa Abrasel](https://bpmoney.com.br/negocios/delivery-ja-responde-por-58-das-vendas-de-restaurantes/); [Times Brasil](https://timesbrasil.com.br/empresas-e-negocios/alimentos-e-bebidas/delivery-cresce-gargalo-cozinha-restaurantes-abrasel/)
- "A Abrasel lançou um Calendário de Sazonalidade de Alimentos, ferramenta para apoiar bares e restaurantes na tomada de decisão sobre compras, planejamento de cardápio e controle de custos, mês a mês, indicando quais alimentos estão na safra" — [Abrasel, Abrasel lança calendário de sazonalidade de alimentos](https://abrasel.com.br/noticias/noticias/abrasel-calendario-sazonalidade-alimentos-auxiliar-empreendedores-compras/) — nota: esse calendário é sobre safra/custo de insumo, não sobre demanda do consumidor/tráfego pago
- "Entre fevereiro e março de 2025, supermercados registraram alta de 1,0% no número de transações e 1,1% no valor de vendas [com cartões de benefício corporativo]" — [Mercado&Consumo, Valor gasto em supermercados e restaurantes avança, mesmo com inflação, 28/04/2025](https://mercadoeconsumo.com.br/28/04/2025/foodservice/valor-gasto-em-supermercados-e-restaurantes-avanca-mesmo-com-inflacao/) — nota: este dado é de supermercado com vale-alimentação, não de delivery de restaurante diretamente; e desde novembro de 2025 refeições prontas em restaurantes não são mais cobertas por vale-alimentação (ver abaixo), o que reduz a relevância direta desse número para delivery pago com cartão-benefício
- "Novas regras do vale-alimentação entraram em vigor em novembro de 2025, com teto de taxa de 3,6% para operadoras; refeições prontas em restaurantes e lanchonetes não são cobertas por vale-alimentação, que se destina a compras de alimentos em supermercados, padarias, açougues e sacolões" — [Saipos, Novas regras do vale-alimentação 2026: impacto nos restaurantes](https://saipos.com/cartao-alimentacao/novas-regras-do-vale-alimenta%C3%A7%C3%A3o); [iFood para parceiros, Vale-alimentação no delivery: seu negócio aceita?](https://blog-parceiros.ifood.com.br/vale-alimentacao/)

### Inferences
- A confirmação de que vale-alimentação **não cobre** refeição pronta desde novembro/2025 é relevante para o playbook: campanhas que tentassem mirar "dia de recebimento de VA" como gatilho para delivery de restaurante teriam base legal/prática fraca — esse gatilho de sazonalidade funciona mais para supermercado/hortifruti do que para pedido de comida pronta.
- O efeito de jogos de futebol (Abrasel, +30% na Copa) é o único gatilho de sazonalidade desta lista com número documentado e fonte primária (associação setorial) — vale destacar isso no relatório como o dado mais sólido da seção.

### Gaps
- Nenhum dado quantificado sobre efeito de chuva na demanda de delivery no Brasil.
- Nenhum dado quantificado sobre efeito de quinzena/dia de pagamento de salário CLT na demanda de delivery (distinto do vale-alimentação, que não cobre comida pronta).
- Nenhum dado quantificado especificamente sobre Dia dos Namorados ou Black Friday para delivery de restaurante (Black Friday é tradicionalmente varejo/e-commerce, não achei fonte tratando isso para food delivery no Brasil).
- Nenhum dado sobre variação de demanda por fim de semana (sexta/sábado vs. dia de semana) especificamente para delivery — presumido pelo senso comum do setor, mas sem fonte citável encontrada nesta pesquisa.

## Como medir pedidos reais (UTM em links de delivery, WhatsApp → pedido, evento Purchase no pixel, CAPI)

### Takeaway
A pilha de mensuração recomendada nas fontes é: (1) UTM nos links de anúncio que apontam para o site/cardápio; (2) Meta Pixel + evento Purchase no checkout do site próprio; (3) API de Conversões (CAPI) do lado do servidor para complementar o pixel em ambientes com cookies bloqueados; e (4) para pedidos via WhatsApp, o parâmetro de referral do WhatsApp Business API (WABA) — não o CAPI — como a peça que efetivamente liga o clique no anúncio (CTWA) à conversa e, dali, ao pedido registrado no PDV/CRM.

### Cited Findings
- "A Conversions API é uma forma de enviar dados de conversão diretamente do seu servidor ou plataforma (como CRM ou central de atendimento) para os sistemas de otimização de anúncios da Meta, em vez de depender apenas do Pixel/navegador. Isso ajuda o algoritmo a entender melhor quais ações geram resultados reais, melhorar a entrega das campanhas e reduzir o custo por resultado" — [Poli Digital, WhatsApp + API de Conversões no Meta Ads](https://poli.digital/blog/api-de-conversoes/)
- "CAPI resolve o problema de rastreamento em ambientes onde cookies são bloqueados — mas não resolve o rastreamento dentro do WhatsApp. Para fechar o loop CTWA → venda, o caminho correto é o WABA com parâmetro de referral, não o CAPI" — [gui.marketing, via snippet de busca, WhatsApp Tracking de Conversões](https://gui.marketing/blog/whatsapp-tracking-conversoes/)
- "Ao instalar o Facebook Pixel no site, cada acesso é registrado como evento (ex. PageView), permitindo criar público personalizado e planejar remarketing ao longo da jornada de compra" — [Alura, fórum sobre remarketing com pageview](https://cursos.alura.com.br/forum/topico-remarketing-com-pageview-no-meta-454615)
- A Meta documenta oficialmente rastreamento com Pixel dentro de soluções de mensageria do WhatsApp para provedores de solução de negócios (BSPs) — [Meta for Developers, Tracking with the Meta Pixel](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/pixel-tracking/)

### Inferences
- Para o restaurante que só usa WhatsApp comum (não a API oficial/WABA integrada a um BSP), não há como fechar o funil de forma automatizada — a "mensuração" vira manual (perguntar/observar "veio pelo anúncio?" no atendimento), o que é uma limitação prática relevante a destacar no playbook.
- Restaurantes com site/cardápio próprio e checkout (não apenas WhatsApp) têm o caminho de mensuração mais robusto e testável (Pixel + CAPI + evento Purchase), o que é um argumento a favor de investir em ter, no mínimo, uma landing page/cardápio com link de pagamento, mesmo operando majoritariamente via WhatsApp.

### Gaps
- Não encontrei detalhamento de como um PDV/CRM de restaurante brasileiro (Saipos, Goomer, Anota AI, Consumer) integra nativamente o parâmetro de referral do WABA ao pedido registrado — ficou apenas no nível conceitual/genérico nas fontes encontradas.
- Não encontrei nenhum caso publicado de restaurante brasileiro reportando "X% dos pedidos confirmados vieram de CTWA" com metodologia de matching declarada.

## Custo por conversa no WhatsApp (contexto de mudança de precificação Meta, 2025-2026)

### Takeaway
A Meta migrou, a partir de 1º de julho de 2025, o modelo de cobrança de mensagens no WhatsApeApp Business Platform de "por conversa" para "por mensagem enviada", o que muda a forma de calcular custo de campanhas de retenção/broadcast (mas não necessariamente do clique no anúncio CTWA em si, cujo custo é pago no Meta Ads como CPM/CPC normal). Isso é relevante para o playbook porque broadcasts de remarketing via WhatsApp (ex. "sentimos sua falta") agora têm custo por mensagem, não mais por janela de conversa de 24h.

### Cited Findings
- "A Meta cobra por mensagem enviada desde 1º de julho de 2025, descontinuando o modelo anterior baseado em conversa" — [WebSearch snippet agregando fontes sobre preços da API WhatsApp Business 2026](https://www.nimochat.com.br/blog/geral/quanto-custa-api-oficial-whatsapp-waba-2026/); [JetChat](https://jetchat.com.br/whatsapp-business-api-e-cloud/blog-custos-whatsapp-business-api-precificacao-2025/)
- "No Brasil: Marketing ≈ R$ 0,31 por mensagem entregue; Utilidade e Autenticação ≈ US$ 0,0068 por mensagem enviada (≈ R$ 0,035); Serviço: sem custo até 30/09/2026, e a partir de 1º/10/2026 cada número tem 1.000 respostas grátis/mês, pagando R$ 0,035 por resposta a partir da 1.001ª" — [WebSearch snippet agregando SocialHub/Nimochat/JetChat sobre tabela de preços WhatsApp API 2026](https://www.socialhub.pro/blog/api-oficial-whatsapp-preco-2026/)

### Inferences
- Essa mudança de precificação (por mensagem, não por conversa) é mais relevante para o custo de **retenção/broadcast** (campanhas de reativação via WhatsApp) do que para o custo de **aquisição via CTWA** propriamente dito — no CTWA, o anunciante paga ao Meta Ads pelo clique/impressão do anúncio; a mensagem subsequente no WhatsApp é o que passou a ter esse novo custo por mensagem quando enviada fora da janela de atendimento gratuita ou em campanhas de marketing.

### Gaps
- Não encontrei um valor de "custo por conversa iniciada a partir de anúncio CTWA" isolado do custo de mídia do Meta Ads — os números encontrados são de tarifação de mensagens da API do WhatsApp Business, não do leilão de anúncios.
