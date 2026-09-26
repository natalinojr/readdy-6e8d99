# Veículos, Logística e Casos de Sucesso de Intermediação (Brasil, 2025–2026)

## (A) Consulta/débitos veiculares e pagamento de IPVA/multas parcelado (Zapay, Celcoin, APIs de Detran)

### Takeaway
Existe API pronta (Celcoin) e um app white-label-ready (Zapay) para consulta e pagamento parcelado de IPVA/multas/licenciamento em cartão de crédito (até 12x), com taxa média citada de ~4,5% sobre o valor — modelo de "banking as a service" para débito veicular, credenciado diretamente nos Detrans estaduais. Não há um número público de "comissão por transação repassada ao parceiro/revendedor"; o modelo de receita fica na taxa de parcelamento cobrada do motorista.

### Cited Findings
- Celcoin lançou API de Débito Veicular (parte do programa EIR — Entrepreneur in Residence) permitindo a qualquer fintech/empresa oferecer consulta e pagamento de IPVA, multas (municipais/estaduais/federais), licenciamento e seguro obrigatório de 18 estados dentro do próprio sistema — [Finsiders Brasil](https://finsidersbrasil.com.br/reportagem-exclusiva-fintechs/celcoin-lanca-api-para-consulta-e-pagamento-de-multas-e-ipva/); [Celcoin](https://www.celcoin.com.br/news/nova-api-debito-veicular-celcoin/)
- A API da Celcoin permite pagar o débito diretamente pelo sistema do parceiro, com valor debitado da conta Celcoin e repassado ao órgão competente; e "enriquece" a consulta com dados oficiais do veículo — [Celcoin Suporte](https://suporte.celcoin.com.br/hc/pt-br/articles/10508448529435-Qual-a-funcionalidade-da-API-de-D%C3%A9bito-Veicular)
- Zapay é credenciada nos Detrans estaduais e permite parcelar em até 12x no cartão de crédito débitos de multas, IPVA, licenciamento e seguro obrigatório — [Zapay](https://www.usezapay.com.br/multas/instituicoes)
- Taxa cobrada varia conforme a forma de pagamento, com média de 4,5% — (fonte: resultado agregado de busca sobre Celcoin/Zapay, sem link único de origem primária — tratar como indicativo, não confirmado por documento oficial)
- Zapay também atua via parceria white-label com concessionárias de pedágio (ex.: Sem Parar) para oferecer o mesmo serviço de consulta/pagamento de débitos veiculares dentro do app do parceiro — [Sem Parar/Zapay](https://ipva.semparar.com.br/)

### Inferences
- O modelo replicável para um ERP/SaaS de terceiros (ex.: para postos, oficinas, concessionárias, ou até um ERP de restaurante que atenda entregadores/motoboys donos de frota) seria "embutir" a API da Celcoin (ou revenda via Zapay/similar) e cobrar do usuário final uma taxa de parcelamento, ficando com o spread entre custo de capital e taxa cobrada — modelo de crédito, não de comissão fixa.
- Como não há corretora de seguro envolvida diretamente (é órgão público/DETRAN), o principal risco regulatório é ser instituição de pagamento (arranjo Celcoin) — o parceiro não precisa de licença própria, pois opera como usuário de conta/API da IP licenciada.

### Gaps
- Não encontrei o percentual exato de comissão pago pela Celcoin/Zapay a um parceiro white-label/revendedor (contrato comercial não é público). Precisaria contato comercial direto com Celcoin/Zapay para números de repasse.
- Não encontrei dado sobre volume transacionado (TPV) da Zapay em 2025/2026 publicamente.

---

## (A) Rastreamento veicular — revenda white label (Getrak, Positron, Omnilink)

### Takeaway
Existe mercado consolidado de plataformas de rastreamento "white label" (não são as próprias fabricantes, mas integradoras de software) que permitem a qualquer empresa revender rastreamento veicular com marca própria; não encontrei números públicos de margem/comissão para os grandes fabricantes (Positron/Grupo Stoneridge, Omnilink) atuando como fornecedores diretos de revenda white label — o modelo público e citável é o de integradoras de software (NuvoTrack, Rekta, Lógica Soluções) que fornecem a plataforma para o revendedor comprar hardware à parte e vender rastreamento como serviço (mensalidade).

### Cited Findings
- Omnilink atua há mais de 25 anos em rastreamento veicular, monitoramento de frotas e gestão de risco, com tecnologia GPS/GNSS de precisão de até 5 metros — [Omnilink](https://material.omnilink.com.br/rastreador-veicular-omniturbo)
- Positron é marca do Grupo Stoneridge, referência em segurança e tecnologia automotiva há mais de 38 anos no Brasil (alarmes, rastreamento, som, tacógrafos) — [Positron](https://positron.com.br/rastreamento)
- Plataformas white label (ex.: NuvoTrack, Rekta Soluções, Lógica Soluções) permitem que uma empresa tenha plataforma de rastreamento própria, com marca e domínio próprios, sem desenvolver o software, revendendo como se fosse tecnologia proprietária — [Rekta Soluções](https://www.rektasolucoes.com.br/white-label/); [NuvoTrack](https://nuvotrack.com.br/)

### Inferences
- Para um ERP verticalizado (ex.: de restaurantes com frota de entrega), o caminho mais viável de intermediação de rastreamento não é revender hardware Positron/Omnilink diretamente (que exige estoque e logística de instalação), mas white-labelar uma plataforma de gestão de frota (SaaS) e cobrar assinatura mensal por veículo — modelo recorrente, não de comissão única.

### Gaps
- Não encontrei programas formais de parceria/revenda com percentual de comissão publicados por Getrak, Positron ou Omnilink (provavelmente exigem contato comercial direto/NDA).
- "Getrak" (citado na pergunta) não apareceu nos resultados de busca — pode ter sido descontinuada, renomeada ou adquirida; não confirmado.

---

## (A) Frete e etiquetas — Melhor Envio, Frenet, Kangu (revenue share com plataformas/afiliados)

### Takeaway
Melhor Envio tem programa de afiliados formal, mas com comissão baixa e fixa (R$ 0,25 por envio efetivado, não por etiqueta gerada). Frenet tem parcerias B2B (integradores/plataformas) com comissão sobre fretes gerados via integração, mas sem percentual público. Kangu descontinuou seu serviço de intermediação de fretes em fevereiro de 2025.

### Cited Findings
- Melhor Envio paga R$ 0,25 de comissão por cada envio efetivamente postado (não apenas etiqueta gerada) feito por um cliente indicado, que fica vinculado ao afiliado por 1 ano após cadastro via link — [Central de Ajuda Melhor Envio](https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220449520660-Como-funciona-o-Programa-de-Afiliados)
- Saldo de comissões do afiliado pode ser resgatado (saque ou uso para pagar etiquetas) a partir de R$ 25 acumulados — [E-Commerce Brasil](https://www.ecommercebrasil.com.br/noticias/programa-de-afiliados-do-melhor-envio)
- Frenet oferece API gratuita para parceiros (sem mensalidade nem taxa de uso) com cotação em tempo real de múltiplas transportadoras; parcerias oficiais podem incluir comissão sobre os fretes gerados via a integração, além de materiais de apoio e onboarding — [Frenet Parcerias](https://frenet.com.br/parcerias/); [Frenet - seja parceiro](https://www.frenet.com.br/quero-ser-um-parceiro-frenet/)
- Os serviços de intermediação de fretes da Kangu foram descontinuados a partir de 23 de fevereiro de 2025 — [Bling Ajuda](https://ajuda.bling.com.br/hc/pt-br/articles/4422759713047-Conferir-a-cota%C3%A7%C3%A3o-de-frete-por-produto-da-Kangu)

### Inferences
- O modelo de afiliados de frete (Melhor Envio) tem ticket de comissão muito baixo (R$0,25/envio) — não é um modelo de receita relevante isoladamente; só faz sentido em escala (milhares de envios/mês) ou como "sweetener" dentro de um ERP que já cobra assinatura.
- O modelo de "plataforma parceira" da Frenet (B2B, para ERPs/marketplaces embutirem cotação de frete) é o caminho mais relevante para um SaaS — mas a comissão real depende de negociação comercial, não é tabelada publicamente.
- A saída da Kangu do negócio de intermediação sinaliza consolidação/dificuldade de manter esse modelo com múltiplas operadoras rodoviárias no Brasil — atenção a esse risco de descontinuidade ao escolher fornecedor.

### Gaps
- Não encontrei percentuais concretos de comissão nas parcerias B2B da Frenet (contrato não público).
- Não encontrei dados de revenue share de Correios (contrato empresarial) com plataformas.
- Last-mile on-demand (Uber Direct, Lalamove, Loggi): não encontrei "programa de parceiro/revendedor" B2B2C com comissão explícita para uma plataforma SaaS embutir entrega sob demanda dentro do seu produto — o que existe documentado é: (i) parceria operacional Uber+Loggi ("Flash Nacional", entregas em >5.500 municípios) e (ii) integração da Frete Rápido com Uber, Lalamove e Loggi para uso da malha física desses parceiros em estratégias de expedição (ship-from-store, multi-origem) — [Bloomberg Línea](https://www.bloomberglinea.com.br/negocios/uber-acerta-parceria-com-loggi-e-desafia-correios-com-servico-flash-nacional/); [Modais em Foco](https://www.modaisemfoco.com.br/noticias/frete-rapido-fecha-parceria-com-a-uber-lalamove-e-loggi). Não achei números de comissão/take rate dessas integrações — é integração de API operacional, não um programa de afiliados com % divulgado. O "Uber affiliate program" encontrado é para motoristas/entregadores pessoa física, não para plataformas de software — [Uber Affiliate Program](https://www.uber.com/pt/pt-pt/affiliate-program) (não é o que a pergunta busca).

---

## (A) Seguros via "representante de seguros" (Resolução CNSP nº 431/2021) — rota para não corretores

### Takeaway
A Resolução CNSP nº 431/2021 criou a figura do "representante de seguros" — pessoa jurídica que pode ofertar/distribuir seguros em nome da seguradora **sem ser corretora**, mediante remuneração acordada diretamente com a seguradora. É a via regulatória que permite a um ERP/plataforma (não corretor) vender seguros embutidos (ex.: seguro residencial, vida, proteção de celular) como canal de distribuição da seguradora — mas há restrição explícita: corretores de seguros e seus agentes NÃO podem atuar como representantes.

### Cited Findings
- O representante de seguros é pessoa jurídica que assume a obrigação de promover, ofertar ou distribuir produtos de seguro de forma não eventual e sem vínculo de dependência, em nome e por conta da seguradora, podendo exercer outras atividades paralelamente — [Demarest](https://www.demarest.com.br/resolucao-cnsp-no-431-2021-novas-regras-aplicaveis-aos-representantes-de-seguros/)
- É vedado a corretores de seguros e seus prepostos atuar como representantes de seguros — ou seja, a figura foi desenhada como canal alternativo/complementar ao corretor, não substituto dele — [Demarest](https://www.demarest.com.br/resolucao-cnsp-no-431-2021-novas-regras-aplicaveis-aos-representantes-de-seguros/)
- O representante é um preposto autorizado da seguradora, não detém poderes de representação do segurado, e é considerado intermediário dos produtos da seguradora — [Mattos Filho](https://www.mattosfilho.com.br/unico/novas-regras-representantes-seguros/)
- A resolução ampliou o escopo de atividades do representante: além de ofertar/distribuir, pode prestar assessoria sobre os produtos ofertados, receber e tratar questões operacionais, renovação/cancelamento, subscrição de risco e regulação de sinistro, entre outras, desde que especificadas em contrato — [Mattos Filho](https://www.mattosfilho.com.br/unico/novas-regras-representantes-seguros/)
- A remuneração do representante de seguros deve ser acordada com a seguradora, observando as normas de conduta na relação com o cliente, inclusive dever de transparência de informação por parte dos intermediários — [texto da Resolução CNSP 431/2021 via LegisWeb](https://www.legisweb.com.br/legislacao/?id=422842)
- A resolução entrou em vigor em 1º de dezembro de 2021, revogando a Resolução CNSP nº 297/2013 — [LegisWeb](https://www.legisweb.com.br/legislacao/?id=422842)

### Inferences
- Para um ERP de restaurante virar "representante de seguros" (ex.: oferecer seguro do estabelecimento, seguro de vida para o dono/funcionários, ou seguro de equipamentos), o caminho não é abrir corretora, mas fechar contrato de representação diretamente com uma seguradora (ou com uma insurtech que já opere como emissora/gestora e ofereça essa modalidade de parceria "embedded insurance").
- Esse modelo é estruturalmente parecido com o "representante de seguros" que fintechs de embedded insurance no Brasil (ex.: Justos, Pier, Azos, Warren Seguros) usam para distribuir via parceiros digitais — não encontrei nesta rodada de busca nomes concretos de insurtechs brasileiras com programa de parceria "plug-and-play" e percentual de comissão publicado (ver Gaps).

### Gaps
- Não encontrei, nesta pesquisa, uma lista de seguradoras/insurtechs brasileiras com API pronta + contrato de representação de seguros já plugável para SaaS de terceiros, nem percentuais de comissão (típico é % sobre prêmio, mas não encontrei número publicado nesta rodada — precisaria pesquisa dedicada a "embedded insurance Brasil API" que não foi coberta aqui por limite de escopo/tempo).
- Seguro viagem, seguro residencial/vida via API, proteção de celular: não pesquisado diretamente nesta rodada (fora do orçamento de buscas) — GAP a ser coberto por outro pesquisador ou rodada adicional.

---

## (A) Energia solar (geração distribuída/cooperativas), gás, água, internet fibra (revenda ISP)

### Takeaway
O mercado de geração distribuída cresceu fortemente (36,2 GW → 45,0 GW instalados entre 2024 e 2025; 7,2 milhões de consumidores atendidos), mas não encontrei números públicos de comissão de indicação/revenda para cooperativas de energia solar. Já para internet fibra, há múltiplos ISPs regionais brasileiros com programas formais de parceiro/revendedor pagando comissão por venda instalada — sem tabela pública de percentual, mas com estrutura de "comissão crescente por volume".

### Cited Findings
- Entre 2024 e 2025, a capacidade instalada de geração distribuída no Brasil passou de 36,2 GW para 45,0 GW; consumidores com geração distribuída chegaram a 7,2 milhões; geração estimada de 54.483 GWh — (fonte agregada de busca, sem link único primário confirmado — tratar como indicativo; recomenda-se checar diretamente dados da ANEEL para confirmar)
- O modelo de cooperativa/consórcio para geração compartilhada é regulamentado pela Lei 14.300, que amplia acesso a energia renovável e reduz custo na conta de luz — [Aldo Energia](https://www.aldo.com.br/blog/geracao-compartilhada); [Canal Solar](https://canalsolar.com.br/saiba-como-funcionam-as-cooperativas-e-os-consorcios-de-energia-solar/)
- Exemplos concretos de cooperativas: Coopsolar (Nordeste) e Coopsol (Minas Gerais) — [Coopsolar](https://coopsolar.com.br/)
- Vero Internet: comissão por cada instalação confirmada, aberto a qualquer pessoa com rede de contatos ou atuação em telecom, atuando em MG, Centro-Oeste e Sul do Brasil — [Vero Parceiros](https://www.ofertasverointernet.com.br/parceiros/)
- Brisanet (maior telecom do Nordeste): comissão por venda instalada, com possibilidade de exclusividade territorial ao parceiro — [Brisanet Parceiro](https://www.brisanet.com.br/parceiro)
- Giga+ Fibra: comissão escalonada — aumenta conforme volume de vendas, instalações e primeira fatura paga do cliente — [Giga+ Fibra Embaixadores](https://www.gigamaisfibra.com.br/embaixadoresgiga/)
- IBI Telecom (grupo IBIPAR, +15 anos em MG interior) já tem mais de 140 revendedores ativos no seu programa de revenda de fibra — [IBI Telecom](https://ibitelecom.com.br/seja-um-revendedor/)

### Inferences
- Para um ERP de restaurante, a intermediação de energia solar/cooperativa faz mais sentido como "indicação simples" (lead) para uma cooperativa/empresa especializada, não como operação própria — o ticket de economia (20-30% na conta, ver seção de revisão de energia abaixo) é o gancho comercial, mas falta dado de comissão de indicação nesta pesquisa.
- Internet fibra tem programas de parceria mais maduros e replicáveis (comissão por instalação, escalonada por volume) — modelo aplicável a um SaaS que atenda pequenos comerciantes que também precisam contratar/trocar de provedor de internet.

### Gaps
- Não encontrei percentual/valor de comissão numérico para nenhum dos programas de parceria de internet fibra (Vero, Brisanet, Giga+, IBI Telecom) — os sites de parceiro não publicam tabela de comissão, exigem cadastro/contato comercial.
- Não encontrei programas de revenda/indicação de gás ou água com comissão nesta pesquisa (não priorizado por escassez de resultados relevantes no tempo disponível).

---

## (A) Nichos de alta margem: recuperação tributária (PIS/COFINS monofásico), revisão de conta de energia, transação tributária PGFN

### Takeaway
Recuperação de créditos de PIS/COFINS monofásico para bares/restaurantes/padarias/mercados e revisão de conta de energia elétrica são nichos de "honorário de êxito" (fee sob sucesso, tipicamente 20-30%) muito relevantes para clientes de ERP de restaurante — ambos com potencial de "no cure, no pay". Já a "transação tributária" com a PGFN não opera com honorário de êxito no sentido clássico (não há sucumbência em execução fiscal, pois já incide o encargo legal do Decreto-Lei 1.025/1969); o modelo de remuneração ali é consultoria/honorário contratual, não % de êxito capturado da dívida.

### Cited Findings
- Regime de tributação monofásica do PIS/COFINS cobra o tributo uma única vez na fase inicial da cadeia (produtor/importador), sem nova tributação em distribuição/venda — aplicável a bares, restaurantes, padarias, supermercados, farmácias e cosméticos que pagaram indevidamente o tributo em etapas subsequentes — [Legalize Contabilidade](https://www.legalizecontabilidade.com.br/tributacao-monofasica-bares-restaurantes/); [Império Contabilidade](https://www.imperiocontabilidade.com.br/post/recupera%C3%A7%C3%A3o-de-pis-e-cofins-monof%C3%A1sicos-oportunidade-para-varejo)
- Modelo de honorário de êxito citado: 20% sobre o valor do benefício quando realizado (valor restituído), com possibilidade de recuperação retroativa de até 5 anos — [TSLaw / Oliveira & Carvalho](https://oliveiraecarvalho.com/servicos/tax-recovery/recuperacao-de-pis-cofins-monofasico-valor-agregado/); [TSLaw](https://www.tslaw.com.br/blog/recuperacao-de-credito-pis-e-cofins-monofasicos-simples-nacional)
- Estimativa de valor agregado médio de 23% do PIS/COFINS recolhido como potencial de recuperação para o contribuinte, considerando margem de valor agregado de referência de 30% — (fonte agregada, sem link único primário confirmado — checar contra fonte contábil especializada antes de usar como número definitivo)
- Revisão de conta de energia: ação judicial contra o estado pode representar economia de até 30% na conta mensal, questionando a inclusão de TUSD/TUST na base de cálculo do ICMS — [Figueiredo & Ferreira Advocacia](https://figueiredoeferreira.com.br/revisao-conta-energia-eletrica/)
- Empresas especializadas em revisão de conta de energia relatam economia média de 20-25% no consumo mensal, podendo superar 30% conforme região/perfil de consumo/condições de contratação — (fonte agregada, sem link único primário — necessário validar diretamente com empresa citada, ex.: Energy Review, antes de reportar como fato definitivo)
- A "Assistente de Revisão de Energia" (AER, citada em resultado de busca) aponta até 21 oportunidades de redução, podendo recuperar até 27% do valor total da conta — [Energy Review](https://www.energyreview.com.br/) (checar detalhes diretamente no site antes de usar como dado definitivo — não há link de artigo específico confirmando o percentual)
- PGFN: existem dois formatos de transação tributária — "por adesão" (edital padronizado, sem negociação de termos, para débitos menores) e "individual" (negociada caso a caso, tipicamente para débitos acima de R$ 1 milhão, com proposta fundamentada de capacidade de pagamento) — [Trad & Cavalcanti Advogados](https://www.tradecavalcanti.com.br/publicacoes/transacao-por-adesao-pgfn-como-funciona); [ConJur](https://conjur.com.br/2024-mar-12/negociacao-de-debitos-inscritos-em-divida-ativa-no-ambito-da-pgfn/)
- A PGFN usa a ferramenta "PRJ – Potencial Razoável de Recuperação" para avaliar propostas, considerando probabilidade de êxito, tempo estimado de litígio, custos administrativos/judiciais e jurisprudência já formada — [ConJur](https://conjur.com.br/2024-mar-12/negociacao-de-debitos-inscritos-em-divida-ativa-no-ambito-da-pgfn/)
- Em execução fiscal movida pela Fazenda Nacional NÃO cabem honorários de sucumbência, pois sobre o débito inscrito em dívida ativa já incide o "encargo legal" do Decreto-Lei nº 1.025/1969, que substitui os honorários — [Formação Tributária](https://formacaotributaria.com.br/honorariosnatributaria/)

### Inferences
- Para um ERP de restaurante, o nicho de maior encaixe direto é PIS/COFINS monofásico (setor claramente listado como beneficiário) — modelo de parceria com escritório especializado, com fee de êxito de ~20% sobre o valor recuperado, dividido entre escritório e canal indicador (ERP) via comissão de indicação — mas não encontrei número de comissão que caberia ao "indicador"/ERP nessa cadeia (ver Gaps).
- Revisão de conta de energia é outro nicho de fácil "cross-sell" para restaurantes (alto consumo de energia — geladeiras, freezers, cozinha), com fee de êxito também na faixa de 20-30%, mas as fontes citadas misturam economia tarifária (via mercado livre/geração distribuída) com recuperação judicial de ICMS sobre TUSD/TUST — são mecanismos diferentes que precisam ser diferenciados na oferta comercial.
- "Transação tributária PGFN" não é um bom encaixe para modelo de comissão de indicação de ERP: é serviço jurídico/consultivo tradicional (contratual, não % de êxito capturado da dívida em si), mais difícil de "produtizar" via API/plataforma.

### Gaps
- Não encontrei percentual de comissão de indicação (revenue share) que um ERP/plataforma receberia ao indicar clientes para escritórios de recuperação tributária ou de revisão de energia — esses acordos são B2B bilaterais e não publicados.
- Não encontrei dados sobre "compensação de ICMS" como nicho separado nesta rodada (não pesquisado diretamente — GAP).
- Os números de "23% de recuperação" e "27% de economia via AER" vieram de sínteses de busca sem link de artigo único e devem ser tratados como indicativos até confirmação em fonte primária.

---

## (B) Casos de sucesso brasileiros de monetização por intermediação de serviços de terceiros (embedded finance / take rate)

### Takeaway
Entre os players de SaaS/plataforma brasileiros, os casos mais documentados de monetização por serviços intermediados/embutidos em 2025 são: TOTVS Techfin (crédito embutido no ERP, JV com Itaú), iFood Pago (banking para restaurantes, ~25% da receita do grupo), Nuvemshop (Nuvem Pago como motor de GMV), Olist (aquisição da fintech Flip para entrar em antecipação de recebíveis, projetando virar metade da receita em ~2 anos), LWSA/Bling (ecossistema de comércio com R$79 bi de GMV) e Hotmart (ajuste de taxas de parcelamento/antecipação como alavanca de receita).

### Cited Findings
- **TOTVS Techfin** (joint venture TOTVS + Itaú, embutida no ERP): encerrou 2025 com carteira de crédito líquida de R$ 2,49 bilhões e originação de R$ 13,2 bilhões no ano, com receita líquida de crédito de R$ 350,2 milhões (+13,9% a/a) — tornando-se a terceira maior unidade de negócio da TOTVS — [Bloomberg Línea](https://www.bloomberglinea.com.br/tech/banco-da-totvs-com-o-itau-techfin-quer-ampliar-oferta-de-servicos-financeiros-no-erp/); [Investing.com (3T25)](https://br.investing.com/news/company-news/apresentacao-do-3o-tri-2025-da-totvs-crescimento-de-receita-acelera-e-techfin-se-destaca-93CH-1736326)
- No 1T25, Techfin cresceu 26% em receita líquida de funding, puxado por alta de 23% na produção de crédito; no 3T25, a divisão registrou alta de 30% na receita líquida de funding e 72% no lucro líquido ajustado a/a — [Bloomberg Línea](https://www.bloomberglinea.com.br/tech/banco-da-totvs-com-o-itau-techfin-quer-ampliar-oferta-de-servicos-financeiros-no-erp/); [Investing.com](https://br.investing.com/news/company-news/apresentacao-do-3o-tri-2025-da-totvs-crescimento-de-receita-acelera-e-techfin-se-destaca-93CH-1736326)
- TOTVS planeja expandir Techfin em 2026 com foco em Cash Management e conta digital — [Investing.com](https://br.investing.com/news/company-news/apresentacao-do-3o-tri-2025-da-totvs-crescimento-de-receita-acelera-e-techfin-se-destaca-93CH-1736326)
- **Stone/Linx**: a venda da Linx e outros ativos de software (incluindo SimplesVet) para a TOTVS em 2025 foi por valor patrimonial total de R$ 3,41 bilhões (R$ 3,05 bi enterprise value + R$ 360 milhões de caixa líquido estimado da Linx); esses ativos representavam ~79% da receita do segmento de software da Stone em 2024 e 71% de sua rentabilidade, além de 9% da receita total da Stone e 6% de sua rentabilidade — [Seu Dinheiro](https://www.seudinheiro.com/2025/empresas/totvs-tots3-enfim-abocanha-a-linx-da-stone-por-mais-de-r-3-bilhoes-o-que-esta-por-tras-da-compra-bilionaria-bdap-miql/)
- Stone: segmento de software teve EBITDA de R$ 292 milhões em 2024, com margem EBITDA de 21,6% no 4T24 (+5,4 p.p. a/a); projeção de lucro bruto ajustado 2025 acima de R$ 7,05 bilhões (crescimento de ao menos 14% a/a) — [Central do Varejo](https://centraldovarejo.com.br/stone-divulga-resultados-financeiros-de-2024-e-apresenta-projecoes-para-2025-e-2027/); [XP Investimentos](https://conteudos.xpi.com.br/acoes/relatorios/stone-stne-finalmente-anunciada-venda-da-linx/)
- **iFood Pago**: cresceu 96% em receita em um ano (2024→2025), atingiu rentabilidade em setembro de 2025, com mais de 205 mil contas digitais ativas; meta de dobrar a receita em 2025 para R$ 2,5 bilhões; oferece R$ 8,56 bilhões em recursos pré-aprovados para mais de 91 mil restaurantes — [NeoFeed](https://neofeed.com.br/negocios/ifood-pago-vira-cada-vez-mais-banco-e-agora-mira-60-milhoes-de-pessoas-fisicas/); [Bloomberg Línea](https://www.bloomberglinea.com.br/negocios/ifood-pago-cresce-acima-do-esperado-e-chega-a-r-16-bi-em-receita-e-so-o-comeco/)
- iFood Pago atingiu R$ 1,6 bilhão em receita em 2025 (crescimento acima do esperado) — [Bloomberg Línea](https://www.bloomberglinea.com.br/negocios/ifood-pago-cresce-acima-do-esperado-e-chega-a-r-16-bi-em-receita-e-so-o-comeco/)
- iFood Pago já representa 25% da receita do grupo iFood e cresce mais rápido que o núcleo de delivery — [Let's Money](https://www.letsmoney.com.br/noticias/ifood-pago-25-receita-cresce-mais-delivery/)
- Banco digital do iFood (iFood Pago) bateu receita de R$ 1,2 bilhão (nota: número um pouco diferente do R$1,6 bi acima — checar qual período/base cada fonte usa; possível não-comparabilidade entre trimestres/anos-safra) — [BPMoney](https://bpmoney.com.br/negocios/banco-digital-do-ifood-bate-receita-de-r12-bilhao/)
- iFood Benefícios (cartão multibenefícios para RH/corporativo) cresceu 260% a/a — [NeoFeed](https://neofeed.com.br/negocios/ifood-pago-vira-cada-vez-mais-banco-e-agora-mira-60-milhoes-de-pessoas-fisicas/)
- Cartão de crédito iFood Pago: anuidade zero, até 35 dias para pagar a fatura, cashback de 4% no iFood Shop, benefícios Visa — [Blog Parceiros iFood](https://blog-parceiros.ifood.com.br/cartao-de-credito-ifood-pago/)
- iFood Pago oferece D7 e D1 (recebimento em 7 ou 1 dia) independentemente da forma de pagamento — [Blog Parceiros iFood](https://blog-parceiros.ifood.com.br/ifood-pago/)
- **Nuvemshop / Nuvem Pago**: responsável por mais de R$ 6,5 bilhões em vendas online no Brasil em 2025; na Black Friday 2025 processou R$ 33 milhões em 24h sem instabilidade; aprova 99% das vendas na camada antifraude (para 80% dos lojistas) e mantém 92% das lojas sem nenhum chargeback — [Nuvemshop](https://www.nuvemshop.com.br/blog/nuvem-pago/) (checar página oficial para validar números antes de usar em relatório final, pois vieram de página de marketing, não de release de resultados)
- Usando o Nuvem Pago, o lojista fica isento da "Tarifa de Plataforma" em todas as transações processadas por ele; taxa fixa de R$ 0,35 por venda e taxa de saque de R$ 0,99 (concorrentes cobram até R$ 2,50) — [Nuvemshop](https://www.nuvemshop.com.br/blog/nuvem-pago/)
- **LWSA/Bling**: no 4T25, a divisão Commerce (que inclui Bling, Tray e Bagy) teve receita líquida de R$ 279,7 milhões (+16,4% a/a); o ecossistema (~211 mil lojistas) movimentou R$ 79 bilhões em GMV em 2025 — [Nord Investimentos](https://www.nordinvestimentos.com.br/blog/lwsa-lwsa3-resultados-4t25/)
- Bling está integrando serviços financeiros da LWSA de forma mais transparente, incluindo conta PJ e outras soluções de gestão financeira para pequenas empresas — [Startups.com.br](https://startups.com.br/negocios/bling-quer-ir-alem-do-erp-e-ser-one-stop-shop-para-pmes/)
- **Asaas**: expectativa de superar R$ 1 bilhão em receita anual até 2026 — [CB Insights via busca agregada](https://www.cbinsights.com/company/asaas) (checar release oficial da Asaas para confirmar número antes de reportar como definitivo — fonte primária não fornecida no resultado de busca)
- **Olist**: comprou a fintech Flip (antecipação de recebíveis) e criou um FIDC de R$ 90 milhões para financiar as operações de antecipação; em 2024 a Flip teve receita de R$ 40 milhões, com projeção de dobrar em 2025; expectativa de que o crédito se torne uma das três principais linhas de receita da Olist, podendo representar metade da receita e parte relevante da margem operacional em pouco mais de 2 anos — [Finsiders Brasil](https://finsidersbrasil.com.br/noticias-sobre-fintechs/olist-compra-flip-e-entra-em-antecipacao-de-recebiveis/); [Startups.com.br](https://startups.com.br/negocios/ma/olist-compra-fintech-e-quer-avancar-em-credito/)
- **Hotmart**: taxa de parcelamento em cartão de crédito no Brasil foi reajustada de 2,89% para 3,49% ao mês; cronograma de pagamento e antecipação de recebíveis também ajustados (demais métodos/taxas mantidos) — [Hotmart Blog](https://hotmart.com/en/blog/reajuste-taxa-parcelamento-2025)
- **Omie.Cash**: conta digital PJ integrada ao ERP Omie, operada via parceria com o Letsbank (ex-Smartbank); cobra R$ 1,99 por boleto emitido (sem custo adicional) e R$ 0,50 por Pix — modelo evoluindo de SaaS puro para "stack contábil-fintech", com distribuição gratuita do Omie.Fit para contadores, crédito/antecipação de recebíveis embutidos e pacotes verticalizados para aumentar ARPU e reduzir churn — [Vetor Financeiro](https://www.vetorfinanceiro.com.br/parametrizacao-modulo-financeiro-omie/); [Startups.com.br](https://startups.com.br/negocios/fintech/omie-faz-novas-integracoes-com-bancos-e-quer-ser-iniciador-de-pagamentos/)
- **Ecossistema restaurantes (Saipos/Anota AI/Goomer)**: Saipos integra pedidos de iFood, Rappi, 99 Food, Keeta, Anota AI, Goomer e mais de 100 plataformas, atendendo mais de 25 mil restaurantes; Anota AI atende mais de 38 mil restaurantes; iFood adquiriu a Anota AI (bot de atendimento via WhatsApp) como parte de estratégia "all-in-one" para restaurantes — [Startups.com.br](https://startups.com.br/negocios/ifood-compra-tres-startups-para-ser-o-all-in-one-dos-restaurantes/); [Saipos](https://saipos.com/integracoes)

### Inferences
- O padrão comum entre os casos de sucesso é: o serviço financeiro embutido (crédito, conta digital, antecipação de recebíveis) cresce mais rápido que o núcleo SaaS/marketplace e passa a representar uma fatia desproporcional da receita em poucos anos (iFood Pago em ~25% da receita do grupo; Olist projetando ~50% via Flip em ~2 anos) — é o benchmark mais forte para justificar que um ERP de restaurante persiga uma estratégia semelhante (crédito para capital de giro, antecipação de recebíveis de cartão/delivery, conta PJ).
- O caso TOTVS Techfin mostra que uma joint venture com banco estabelecido (Itaú) permite escalar rapidamente originação de crédito (R$ 13,2 bi/ano) sem que o ERP precise ser ele mesmo uma instituição financeira licenciada — modelo replicável em menor escala via parceria com um banco/fintech (ex.: Letsbank, como fez a Omie).
- Fees de parcelamento/antecipação (Hotmart, Nuvem Pago) são um mecanismo de receita mais simples de implementar (via um Banking-as-a-Service) do que originação de crédito própria — bom primeiro passo para monetização.

### Gaps
- Não obtive, nesta pesquisa, o "take rate" (percentual sobre volume processado/GMV) explícito e comparável entre as empresas — os números públicos são majoritariamente em R$ absolutos de receita, não em % de GMV/TPV, dificultando comparação direta de eficiência de monetização.
- Divergência entre fontes sobre a receita do iFood Pago em 2025 (R$ 1,2 bi vs. R$ 1,6 bi vs. meta de R$ 2,5 bi) não foi resolvida — as fontes não deixam claro se são períodos diferentes (ano fiscal completo vs. anualizado vs. meta) — reportar com essa ressalva.
- Não pesquisei diretamente Mercado Livre/Mercado Pago, Conta Azul e Booking/Expedia TAAP nesta rodada (fora do orçamento de tempo) — GAP a cobrir por outro pesquisador se necessário.
- Números de Nuvem Pago vieram de página de blog/marketing da própria Nuvemshop, não de release de resultados financeiros formal — tratar com cautela até confirmação em relatório de investidores (Nuvemshop é controlada pela VTEX/tem capital aberto via VTEX? confirmar estrutura societária antes de citar como "resultado auditado").
