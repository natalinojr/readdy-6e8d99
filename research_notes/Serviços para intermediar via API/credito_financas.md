# Crédito e Finanças — Serviços que um ERP/SaaS pode intermediar via API/white label/parceria (Brasil, 2025–2026)

## Crédito do Trabalhador / consignado privado CLT — como parceiros/correspondentes ganham, quais fintechs têm API

### Takeaway
O "Crédito do Trabalhador" (Lei nº 15.179/2025) é um consignado privado para CLT com desconto via eSocial/CTPS Digital e margem de 35%; a integração exige APIs de consulta de margem e averbação plugadas ao eSocial, e o modelo dominante para quem quer ganhar dinheiro nisso é virar (ou usar) um correspondente bancário digital ("Corban as a Service") remunerado por comissão sobre o contrato originado. Não encontrei uma tabela pública de % de comissão específica para este programa — é a maior lacuna desta seção.

### Cited Findings
- A Lei nº 15.179/2025 institui o Crédito do Trabalhador para trabalhadores CLT do setor privado, com desconto em folha limitado a 35% da remuneração e operação integrada ao eSocial/CTPS Digital — [SERPRO](https://www.serpro.gov.br/menu/noticias/noticias-2025/consignado-clt/); [Manual do Empregador — Min. do Trabalho](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/credito-do-trabalhador/empregador/manual-operacional-do-empregador)
- O modelo "Corban as a Service" (correspondente bancário como serviço) permite que correspondentes ofereçam averbação e originação via API, eliminando processos manuais e integrando diretamente aos sistemas de crédito — [Celcoin Pulse](https://pulse.celcoin.com.br/api-originacao-credito-consignado-privado/)
- Originadores e correspondentes bancários precisam de APIs de consulta de margem e averbação conectadas à plataforma do Crédito do Trabalhador, com elegibilidade calculada a partir de dados do eSocial e CNIS — [Celcoin Pulse](https://pulse.celcoin.com.br/api-originacao-credito-consignado-privado/)
- A autenticação das APIs do programa deve usar JWT assinado com certificado ICP-Brasil, seguindo o perfil do Open Finance Brasil; o fluxo completo (consulta de margem via eSocial, simulação, score, emissão de CCB, averbação pelo Corban e liberação via Pix) é automatizável ponta a ponta — [Celcoin — regras 2026](https://celcoin.com.br/articles/regras-apis-credito-consignado-privado/)
- A MP/lei que criou o crédito consignado CLT também abrange motoristas de aplicativo como público elegível — [Agência Brasil, jun/2025](https://agenciabrasil.ebc.com.br/politica/noticia/2025-06/comissao-mista-aprova-mp-de-credito-consignado-trabalhador-privado)

### Inferences
- Como o desenho técnico é modelado sobre o padrão Open Finance (mTLS/JWT com certificado ICP-Brasil) e sobre o eSocial, um ERP que já processa folha de pagamento (ou dados de vínculo empregatício) de PMEs está estruturalmente bem posicionado para plugar essa API e originar consignado para a base de clientes/funcionários — mas isso exige, no mínimo, virar (ou contratar) um correspondente bancário certificado (ver seção de regulação abaixo), não é uma simples chamada de API sem licença.
- A Celcoin se posiciona explicitamente como provedora de infraestrutura ("Corban as a Service") para quem quer entrar nesse mercado sem ser banco — um caminho plausível de parceria para o ERP é branded/white-label via Celcoin, mas a documentação pública não revela o split de receita.

### Gaps
- Não encontrei percentual de comissão por contrato, nem tabela de remuneração de correspondentes especificamente para o Crédito do Trabalhador (o programa é muito recente — lançamento efetivo em 2025).
- Não encontrei lista fechada de fintechs com "programa de parceiro" formalmente documentado e público para este produto específico (Celcoin aparece como infraestrutura; QI Tech, BMP e outras SCDs/SCFIs atuam no consignado em geral, mas não achei página de parceiro dedicada ao Crédito do Trabalhador).
- Não confirmei se o valor de referência da MP (redação final da lei) é exatamente 35% de margem consignável ou se há teto adicional — vale checar a redação final da Lei 15.179/2025 diretamente no Planalto antes de publicar como número definitivo.

## Antecipação de FGTS saque-aniversário, capital de giro PME, antecipação de recebíveis de cartão, duplicata escritural — comissões de parceiro e APIs

### Takeaway
No FGTS saque-aniversário há um modelo de correspondente bem consolidado com comissão dupla dígito por operação (ex.: 12% no cadastro em um caso citado) e pelo menos uma fintech (Juca) com API aberta para varejistas cobrarem comissão por contrato originado; capital de giro/antecipação de recebíveis está migrando para dentro do próprio ERP (TOTVS Techfin é o caso mais maduro, com origem de R$ 13,2 bi em 2025); duplicata escritural está em fase de implantação regulatória (produção assistida em 2026, obrigatoriedade plena prevista para 2027) e exige integração via API padronizada do ERP com as registradoras (CERC, B3, Núclea, SPC Grafeno, TAG, CRDC, Quicksoft).

### Cited Findings
- Juca, fintech fundada em 2023, é especializada em antecipação de saque-aniversário do FGTS e oferece API para integração, plataforma para promotores de crédito, e permite que varejistas ofereçam a antecipação direto no site/e-commerce/redes sociais, ganhando comissão sobre os contratos — [Businesswire, fev/2025](https://www.businesswire.com/news/home/20250212637416/pt) (nota: fetch da página completa foi bloqueado pelo proxy da sessão; informação obtida via snippet do resultado de busca — recomenda-se revalidação direta antes de publicar como fato definitivo)
- A Juca superou 3.000 pontos de venda com sua plataforma de antecipação de saque-aniversário do FGTS para varejistas — [Businesswire, fev/2025](https://www.businesswire.com/news/home/20250212637416/pt)
- CredSpot opera como correspondente bancário regulado pelo Banco Central, conectando trabalhadores a bancos autorizados a operar empréstimos via FGTS — [CredSpot](https://fgts.credspot.net/)
- TOTVS Techfin (joint venture com Itaú Unibanco desde 2023) fechou 2025 com carteira de crédito líquida de R$ 2,49 bilhões e originação de R$ 13,2 bilhões no ano; tornou-se a terceira maior unidade de negócio da TOTVS — [Bloomberg Línea](https://www.bloomberglinea.com.br/tech/banco-da-totvs-com-o-itau-techfin-quer-ampliar-oferta-de-servicos-financeiros-no-erp/)
- O produto "Antecipa Techfin" permite selecionar notas fiscais/faturas dentro do próprio ERP e receber o valor no mesmo dia, com capital de giro e antecipação de recebíveis operando "conciliados" dentro da jornada do ERP — [Techfin](https://www.techfin.com.br/antecipa/); [TOTVS](https://produtos.totvs.com/ficha-tecnica/tudo-sobre-o-totvs-antecipa/)
- Depois do Techfin, a TOTVS planeja lançar conta digital, rendimento de saldo e linha de "hot money" para caixa imediato — [Let's Money](https://www.letsmoney.com.br/noticias/techfin-totvs-itau-credito-erp-conta-digital-pmes/)
- Registradoras homologadas pelo Banco Central para duplicata escritural, conforme convenção assinada em 29/11/2024: CERC, Núclea, B3, TAG, CRDC, Grafeno e Quicksoft — [Convenção BCB (PDF)](https://www.bcb.gov.br/content/estabilidadefinanceira/spb_docs/convencoes/Conven%C3%A7%C3%A3o%20entre%20Entidades%20Registradoras,%20Depositários%20Centrais%20e%20Escrituradores%20-%20Duplicatas%20Escriturais.pdf)
- A duplicata escritural entrou em fase de produção assistida em 2026, com implementação obrigatória plena prevista para 2027, exigindo integração do ERP/originador com as registradoras via API REST padronizada e certificado digital — [Antecipa Fácil](https://antecipafacil.com.br/artigo/como-registrar-duplicata-escritural-cerc-b3-passo-a-passo-2026); [Economia S/A — Vertrau](https://economiasa.com.br/blog/vertrau-cria-barramento-de-api-unico-para-duplicata-escritural-em-multiplas-registradoras/)
- Existe pelo menos um agregador (BIBlue) que oferece "CERC, TAG e CIP em uma única API" para registro de recebíveis, indicando que há intermediários de API que evitam integrar com cada registradora separadamente — [BIBlue](https://biblue.com.br/casos-de-uso/registro-recebiveis)
- Stone integra Capital de Giro (empréstimo pago via retenção diária de parte das vendas recebidas na maquininha) com diversos ERPs/PDVs, incluindo Loja Integrada, Bling, Tiny e sistemas Linx — [Stone](https://www.stone.com.br/capital-de-giro); busca web
- Em julho de 2025, a Stone vendeu a Linx para a TOTVS por cerca de R$ 3 bilhões (valor citado como menos da metade do que a Stone pagou originalmente pela Linx cinco anos antes) — [Finsiders Brasil](https://finsidersbrasil.com.br/negocios-em-fintechs/fusoes-e-aquisicoes/stone-vende-linx-para-totvs-por-r-3-bi-para-focar-na-estrategia/)

### Inferences
- O padrão que está se consolidando é "crédito embutido dentro do fluxo do ERP" (Techfin dentro do ERP TOTVS, capital de giro Stone dentro da maquininha/PDV) — ou seja, o modelo de maior sucesso comercial não é "vender lead para banco", é o ERP virar o ponto de originação com parceiro regulado por trás (SCD/SCFI/banco) fazendo o funding e o compliance.
- Para duplicata escritural, como a integração com múltiplas registradoras via API própria de cada uma é operacionalmente cara, existe uma oportunidade de nicho para ERPs médios: usar um agregador de API (como BIBlue/Vertrau) em vez de integrar diretamente com CERC/B3/Núclea/TAG uma a uma.
- O prazo de obrigatoriedade plena da duplicata escritural em 2027 sugere que 2026 é a janela para ERPs de faturamento/gestão financeira testarem a integração antes que vire requisito de mercado.

### Gaps
- Não encontrei percentual de comissão específico e verificável (fonte primária, não citada por segunda mão) para a Juca (FGTS) nem para nenhum parceiro de antecipação de recebíveis de cartão — os números "12% de comissão no cadastro" e "70% das vendas via 1.200 lojas correspondentes comissionadas" que apareceram no resultado de busca vieram de uma fonte que o próprio resultado descreveu como "fictícia" (uma "fintech Adianta" hipotética) — **não usar esse número**, é especulativo/não confiável.
- Não encontrei dados sobre comissão de parceiro para BMP, Lendico, Creditas parceiros, Nexoos, Tino ou Iouu especificamente em capital de giro PME ou antecipação de recebíveis de cartão — apenas confirmei que BMP oferece acesso via API e modelo white label completo, e que Nexoos é uma SEP (Sociedade de Empréstimo entre Pessoas, Resolução CMN 4.656/2018), mas não há % de comissão público.
- Não encontrei dados sobre CERC, TAG ou Núclea especificamente com "programa de parceiro" e remuneração para quem registra volume de recebíveis via essas registradoras (elas são infraestrutura regulatória, não necessariamente pagam comissão por volume — isso precisa ser verificado diretamente com cada registradora).

## BaaS / embedded finance — conta digital white label, cartão pré-pago/gift corporativo

### Takeaway
Dock, Zoop e Swap operam como provedoras de BaaS com modelo de revenue share sobre volume transacionado e/ou percentual de receita de interchange, mas nenhuma das fontes públicas encontradas revela o percentual exato do split — os números de pricing (setup, mensalidade, % por transação) não são divulgados publicamente e exigem contato comercial direto.

### Cited Findings
- Dock oferece cartões white label em que o parceiro recebe uma parcela da receita de interchange sobre o volume total transacionado (TPV) — [Dock](https://dock.tech/solucao/cartoes-white-label/)
- Dock aproveita mais de 20 anos de experiência como processadora de cartões para simplificar a estruturação e o lançamento de operações financeiras com cartões white label — [Dock](https://dock.tech/solucao/cards-credit/)
- A solução da Zoop permite que qualquer empresa, de qualquer segmento, ofereça produtos como cartões pré-pagos, cartões de débito e outras opções de pagamento personalizadas a seus clientes, monetizando via tarifas cobradas pelo uso de maquininhas e outros serviços financeiros, como conta digital — [Zoop](https://www.zoop.com.br/blog/neg%C3%B3cios/white-label-pagamentos)
- Swap é uma emissora de moeda eletrônica (IP) com capacidade de gerar e gerenciar contas de pagamento, e está evoluindo para emissão de cartões pós-pagos; é citada ao lado de Dock e Zoop como provedora de BaaS — [Finsiders Brasil](https://finsiders.com.br/2022/07/08/swap-baas-especialista-em-segmentos-entra-em-despesas-corporativas/)
- Celcoin também opera modelo de infraestrutura white label completa (conta, cartão, Pix, crédito) sob marca do parceiro, com APIs RESTful modulares, SDKs e sandbox — [Celcoin — plataforma white label banco digital](https://celcoin.com.br/articles/plataforma-white-label-banco-digital/); [Celcoin — CCB white label](https://celcoin.com.br/articles/emissao-ccb-white-label-fintechs/)
- Na modalidade CCB white label, uma fintech emite Cédulas de Crédito Bancário usando a licença SCD do parceiro tecnológico, mantendo marca e jornada próprias, sem precisar de licença própria — [Celcoin](https://celcoin.com.br/articles/emissao-ccb-white-label-fintechs/) (nota: fetch direto da página bloqueado pelo proxy; conteúdo obtido via snippet de busca)

### Inferences
- Como nenhum provedor de BaaS publica o percentual exato de revenue share de interchange, isso reforça que esse tipo de negociação é feita caso a caso, dependendo do volume de TPV esperado do ERP parceiro — um ERP com base grande de PMEs de um segmento específico (como restaurantes) tem poder de negociação para conseguir melhores splits do que uma empresa pequena.
- O modelo "sem precisar de licença própria" (usando a SCD do parceiro) é a via de entrada mais rápida para um ERP oferecer crédito/cartão sob marca própria — mas a responsabilidade regulatória (e a exposição a risco de crédito, se for o caso de garantir os recebíveis) fica descrita de forma incompleta nas páginas de marketing consultadas; contratos reais provavelmente detalham quem assume o risco de inadimplência.

### Gaps
- Não encontrei números de pricing público (fee fixo mensal, % por transação, % de revenue share de interchange) para Dock, Zoop, Swap, Pismo ou Celcoin — todas essas informações parecem estar atrás de processo comercial/NDA.
- Não pesquisei Pismo especificamente devido ao orçamento de buscas (ficou de fora desta rodada); vale pesquisa adicional dedicada se necessário.

## Consórcio (parceiro/representante de administradoras) e previdência privada — níveis de comissão

### Takeaway
A pesquisa não confirmou de forma confiável o intervalo de comissão de 3–6% do valor da carta citado na literatura de mercado; a única cifra concreta encontrada (via snippet, não verificada em fonte primária) foi de cerca de 1% sobre o valor vendido para vendedores externos da Embracon, com tabelas de comissão variando entre 0,40 e 0,70 (unidade não especificada) em período não identificado — **tratar como não confiável até confirmação direta com as administradoras**.

### Cited Findings
- Segundo um resultado de busca (Indeed, avaliação de funcionário, não fonte oficial da empresa), as comissões para vendedores externos da Embracon giram em torno de 1% sobre o valor do crédito vendido, com tabelas de comissão de 0,70, 0,60 ou 0,40 em determinado período — [Indeed — FAQ Embracon](https://br.indeed.com/cmp/Embracon-Administradora-De-Cons%C3%B3rcio/faq/de-quanto-%C3%A9-a-comiss%C3%A3o-para-vendedores-externo-na-embracon-essa-comiss%C3%A3o-%C3%A9-a-mesma-para-todas-as-cidades?quid=1dcspla88d067800)

### Inferences
- Nenhuma.

### Gaps
- Não encontrei dados oficiais/primários (site institucional de representante, contrato de representação, release financeiro) confirmando percentuais de comissão para Embracon, Porto, Rodobens ou Ademicon — a fonte encontrada é uma avaliação informal de funcionário em site de emprego, não confiável para citar como número de mercado.
- Não pesquisei previdência privada nesta rodada (ficou fora do escopo coberto por falta de tempo/tool calls) — é uma lacuna a ser preenchida por outro researcher ou rodada adicional. Recomendo buscar diretamente "corretor previdência privada comissão % PGBL VGBL" e páginas de parceiro de seguradoras (Porto Seguro, BB Seguros, Itaú, Bradesco Vida e Previdência).

## Open Finance — uso de dados por empresa não regulada para originar crédito/vender produtos

### Takeaway
Pluggy e Belvo são as duas iniciadoras/agregadoras mais citadas no mercado brasileiro; ambas evoluíram de simples "leitura de dados" para atuar também como Iniciadoras de Transação de Pagamento (ITP) certificadas pelo Banco Central, e a Belvo firmou parceria com a FICO para desenvolver scoring de crédito baseado em dados de Open Finance — o que confirma que dados de Open Finance via essas provedoras já são usados para originação/decisão de crédito por terceiros não bancários.

### Cited Findings
- A Pluggy é autorizada pelo Banco Central como Iniciadora de Transação de Pagamento (ITP) e opera dentro do ecossistema regulado, com todas as etapas de certificação e homologação concluídas — [Finsiders Brasil](https://finsidersbrasil.com.br/economia-open/pluggy-obtem-autorizacao-para-operar-como-iniciador-de-pagamento/)
- Com a nova funcionalidade de iniciação de pagamento via Pix, a Pluggy esperava dobrar sua base de clientes e receita até junho de 2024 — [Finsiders Brasil](https://finsidersbrasil.com.br/negocios-em-fintechs/na-pluggy-chegou-a-hora-de-plugar-o-open-finance-regulado/)
- A Belvo (fundada citada, com dado de 2025 no resultado) projeta quadruplicar sua receita, alcançando R$ 4 milhões em receita em 2026; a empresa também passou a atuar como iniciadora de pagamento (ITP) e adquiriu a empresa de pagamentos Skilopay — [Startups.com.br](https://startups.com.br/negocios/fintech/belvo-preve-conectar-5-milhoes-de-contas-via-open-finance-no-brasil/) (nota: o valor de R$4 milhões de receita parece baixo/possivelmente mal capturado pelo resumo automático da busca — checar a matéria completa antes de citar esse número)
- A Belvo anunciou em junho (ano não especificado claramente no snippet, mas contexto indica 2025) um acordo com a FICO para desenvolver um scoring de crédito baseado em dados de Open Finance — [Startups.com.br](https://startups.com.br/negocios/fintech/belvo-preve-conectar-5-milhoes-de-contas-via-open-finance-no-brasil/)
- A Belvo projeta conectar 5 milhões de contas via Open Finance no Brasil — [Startups.com.br](https://startups.com.br/negocios/fintech/belvo-preve-conectar-5-milhoes-de-contas-via-open-finance-no-brasil/)

### Inferences
- Sim, uma empresa não regulada (como um ERP) pode usar dados de Open Finance para originar crédito — na prática, contratando uma iniciadora/agregadora certificada (Pluggy, Belvo) como camada de dados/consentimento, e depois um parceiro de crédito regulado (SCD, banco, fintech) como funding. O ERP em si não precisa de licença de instituição de pagamento para consumir dados via essas provedoras, mas precisa de um parceiro financeiro regulado para de fato conceder o crédito.
- A entrada da Belvo/Pluggy em ITP (iniciação de pagamento) sugere que a combinação "dado (Open Finance) + iniciação de pagamento (Pix)" está convergindo num único fornecedor — o que facilita a um ERP contratar um único parceiro de tecnologia para todo o fluxo de decisão + desembolso.

### Gaps
- Não encontrei modelo de precificação/comissão da Pluggy ou Belvo para uso de dados por terceiros que queiram originar crédito (pricing por CPF consultado, por chamada de API, por conta conectada) — essa informação normalmente está atrás de processo comercial.
- O número de receita da Belvo (R$ 4 milhões em 2026) parece inconsistente com o tamanho de mercado que a empresa reivindica (5 milhões de contas) — recomendo forte cautela e re-verificação antes de usar esse dado no relatório final; pode ser erro de captura do resumo automático da ferramenta de busca (poderia ser R$ 400 milhões ou outra ordem de grandeza).

## Pix Automático — resenda como produto

### Takeaway
O Pix Automático (lançado em 2025, com ajustes regulatórios formalizados pela Instrução Normativa BCB 769 em set/2026, atualizando o Manual de Padrões de Iniciação do Pix — MPI — para a versão 2.10.0) já é suportado por todos os grandes bancos e por fintechs recebedoras (incluindo Asaas, Stone, PagBank, Iugu, Vindi), e empresas podem contratá-lo via instituição participante para plugar em seus sistemas de venda/gestão — um ERP pode revender esse fluxo de cobrança recorrente (mensalidades, assinaturas) como feature de monetização.

### Cited Findings
- As mudanças no Pix Automático foram formalizadas pela Instrução Normativa BCB 769, que publicou a versão 2.10.0 do Manual de Padrões de Iniciação do Pix (MPI) e atualizou a API do Pix para a versão 2.10.0 — [Agência Gov](https://agenciagov.ebc.com.br/noticias/202609/ajustes-pontuais-organizam-regras-operacionais-do-pix-automatico)
- Empresas (incluindo MEIs) interessadas em usar a API do Pix podem contratar o serviço com instituições financeiras participantes do Pix para conectar seus sistemas de venda ou gestão às funcionalidades de cobrança do Pix — [Diário do Comércio](https://diariodocomercio.com.br/economia/pix-automatico-banco-central-regras-empresas/)
- Segundo o Relatório de Gestão do Pix 2023–2025, os QR Codes dinâmicos cresceram de 5% das transações em 2021 para 40% em 2025 — [ISTOÉ Dinheiro](https://istoedinheiro.com.br/pix-api-banco-central-atualiza-sistema-cobrancas-automatizadas)
- Em 2026, todos os grandes bancos (Itaú, Bradesco, Santander, BB, Caixa) suportam Pix Automático, junto com bancos digitais (Nubank, C6, Inter, Mercado Pago) e recebedores fintech (PagBank, PagSeguro, Cielo, Stone, Adyen, Vindi, Iugu, Asaas) — [ISTOÉ Dinheiro](https://istoedinheiro.com.br/pix-automatico-bc-atualiza-regras-pagamentos-recorrentes-empresas) (nota: esse número/lista veio do resumo automático da busca, não de fonte primária lida integralmente — recomenda-se confirmação)
- A API Pix Automático já está documentada publicamente por pelo menos um banco (Inter Empresas) para desenvolvedores — [Developers Inter](https://developers.inter.co/references/pix-automatico)

### Inferences
- Como o Pix Automático é acessado via instituição financeira participante (não diretamente do Banco Central), o caminho natural de monetização para um ERP é usar um PSP parceiro (ex.: Asaas, Iugu, Vindi, Stone) que já ofereça a funcionalidade via API, embutindo a cobrança recorrente no próprio produto e cobrando um markup sobre a tarifa por transação repassada pelo PSP.
- O fato de bancos oferecerem tarifas muito baixas por transação direta (centavos) versus PSPs cobrando R$1-3 por cobrança recorrente (dado do resumo de busca, não verificado em fonte primária) sugere que a integração direta com banco tem custo menor mas exige mais trabalho técnico/regulatório do que usar um PSP intermediário — trade-off relevante para um ERP decidir "integrar direto com banco" vs "usar PSP como camada".

### Gaps
- Não verifiquei em fonte primária (documentação do PSP) os valores de "R$ 0,01–0,50 por transação direto com banco" e "R$ 1–3 por cobrança recorrente via Asaas" citados no resumo automático da busca — tratar como estimativa não confirmada até checagem direta na tabela de preços do Asaas/Iugu/Vindi.
- Não encontrei informação sobre se ERPs (como os citados no restante do documento — Omie, Conta Azul, Bling, Nibo) já embutiram Pix Automático como funcionalidade paga/com markup — é uma lacuna a explorar com um researcher focado em cada ERP individualmente.

## Regulação de correspondente bancário (Res. CMN 4.935/2021) e certificação (ANEPS/FEBRABAN)

### Takeaway
A Resolução CMN nº 4.935/2021 exige que toda pessoa que intermedeia operações de crédito como correspondente bancário seja certificada, e a ANEPS (Associação Nacional dos Profissionais e Empresas Promotoras de Crédito e Correspondentes no País) foi a primeira entidade a oferecer certificação obrigatória alinhada a essa resolução — com duas certificações principais: CAE (para quem opera consignado) e CAEP (para portfólio mais amplo, incluindo financiamentos, seguros e consórcio).

### Cited Findings
- A Resolução 4.935/2021 do Banco Central modernizou e padronizou as regras de atuação de correspondentes bancários, cobrindo a contratação de correspondentes por instituições financeiras e demais instituições autorizadas a funcionar pelo Banco Central — [ANEPS](https://aneps.org.br/blog/resolucao-4935-21-explicada-mudancas-na-atuacao-dos-correspondentes-bancarios/); [LegisWeb — texto da resolução](https://www.legisweb.com.br/legislacao/?id=418036)
- Segundo a Resolução, o correspondente deve operar estritamente dentro das diretrizes da instituição contratante, que permanece integralmente responsável por todos os serviços prestados ao usuário final — [Mattos Filho](https://www.mattosfilho.com.br/unico/cmn-regras-contratacao-correspondentes/); [Conjur](https://www.conjur.com.br/2022-fev-05/opiniao-novas-regras-contratacao-correspondentes-bancarios/)
- A resolução introduziu a figura do "correspondente digital" e reforçou controles sobre as atividades dos correspondentes — [Jusbrasil — texto da resolução](https://www.jusbrasil.com.br/legislacao/4198754306/resolucao-4935-21)
- A certificação ANEPS atende às exigências da Resolução 4.935/21 e valida competências de profissionais que atuam como correspondentes bancários; a ANEPS foi a primeira entidade a oferecer certificação obrigatória conforme a legislação do BC — [ANEPS — blog](https://aneps.org.br/blog/como-escolher-a-melhor-certificacao-para-correspondente-bancario/); [ANEPS — certificações](https://aneps.org.br/certificacoes/)
- Certificações oferecidas: CAE (Certificação de Autoridade Externa, voltada a quem opera crédito consignado) e CAEP (Certificação de Autoridade Externa Plena, para quem atua com financiamentos, seguros e consórcios) — [ANEPS — blog](https://aneps.org.br/blog/como-tirar-a-certificacao-de-correspondente-bancario/)

### Inferences
- Para um ERP que quer intermediar crédito diretamente (não apenas embutir a API de um parceiro já licenciado), o caminho regulatório mínimo é: (1) constituir-se ou contratar pessoa(s) certificada(s) ANEPS (CAE ou CAEP conforme o produto), (2) firmar contrato de correspondente bancário nos termos da Res. 4.935/21 com uma instituição financeira ou SCD/SCFI/SEP autorizada, e (3) operar sob a marca/responsabilidade regulatória dessa instituição parceira. Isso é mais leve que obter uma licença própria (SCD/SEP), mas ainda exige processo formal de certificação e contrato — não é "plugar uma API e pronto".
- A alternativa mais rápida ao correspondente bancário tradicional é o modelo "white label" onde o parceiro tecnológico/financeiro (Celcoin, BMP, QI Tech) já detém a licença (SCD, IP) e assume a responsabilidade regulatória, deixando o ERP apenas com a interface/distribuição — essa parece ser a via mais viável para um ERP que não quer virar instituição regulada.

### Gaps
- Não encontrei o custo/investimento exato da certificação ANEPS (taxa de prova, curso preparatório) nem prazo de validade da certificação — recomenda-se checagem direta em aneps.org.br/certificacoes.
- Não pesquisei diretamente "certificação FEBRABAN" citada na pergunta original de forma separada da ANEPS — os resultados de busca só retornaram ANEPS como entidade certificadora relevante para correspondentes bancários; pode ser que a certificação relevante da FEBRABAN seja para outro tipo de profissional (ex.: CPA-10/CPA-20 para investimentos, que é da ANBIMA, não da FEBRABAN) — vale checagem adicional dedicada.
- Não abordei especificamente requisitos para constituição de SCD (Sociedade de Crédito Direto) ou SEP (Sociedade de Empréstimo entre Pessoas) — capital mínimo, prazo de autorização do BC, etc. — ficou fora do escopo coberto nesta rodada de busca; recomendo pesquisa dedicada nas normas do BC (Resolução CMN 4.656/2018) se o dono quiser avaliar constituir uma licença própria em vez de usar parceiro white label.

## Exemplos de empresas que já ganham dinheiro intermediando crédito/finanças (ERPs e adjacentes)

### Takeaway
Os dois casos mais bem documentados de ERP monetizando crédito embutido são a TOTVS Techfin (joint venture com Itaú, hoje 3ª maior unidade de negócio da TOTVS, com R$13,2 bi originados em 2025) e a Omie via Omie.cash (parceria com o banco Letsbank, antigo Smartbank, evoluindo de conta de recebimento para conta digital completa, mais um acordo — não exclusivo — com o Itaú); no lado de meios de pagamento, iFood consolidou o iFood Pago como "banco" para restaurantes, com 140 mil contas digitais ativas oferecendo crédito com taxas exclusivas.

### Cited Findings
- TOTVS Techfin, joint venture com o Itaú Unibanco desde 2023, tornou-se a terceira maior unidade de negócio da TOTVS, com carteira de crédito líquida de R$ 2,49 bilhões e originação de R$ 13,2 bilhões em 2025 — [Bloomberg Línea](https://www.bloomberglinea.com.br/tech/banco-da-totvs-com-o-itau-techfin-quer-ampliar-oferta-de-servicos-financeiros-no-erp/)
- Omie.cash opera através de parceria com o Letsbank (antigo Smartbank); começou como conta para recebimentos dos clientes Omie e hoje é uma conta digital completa — [Nibo blog / comparativo](https://www.nibo.com.br/blog/nibo-x-conta-azul-x-omie-qual-e-a-melhor-gestao-financeira-para-sua-empresa-de-servicos) (nota: fonte é blog de concorrente comparando ERPs, não release oficial da Omie — checar página oficial da Omie antes de usar como definitivo)
- O acordo entre Itaú e Omie não é exclusivo: o Itaú pode fechar acordos com outros provedores de software de gestão, assim como a Omie pode trabalhar com outros players do setor financeiro — [Baguete](https://www.baguete.com.br/noticias/itau-fecha-acordo-com-omie)
- Omie também está se movendo para se tornar iniciadora de pagamentos, além de já ter integrações bancárias ampliadas — [Finsiders Brasil](https://finsidersbrasil.com.br/reportagem-exclusiva-fintechs/omie-se-integra-a-mais-bancos-e-quer-ser-iniciador-de-pagamentos/)
- Em 2024, o iFood consolidou o iFood Pago como "banco" para restaurantes, com contas digitais e meios de pagamento; atualmente o iFood Pago tem 140 mil contas digitais ativas, com produtos financeiros específicos, incluindo crédito com taxas exclusivas, transferência em uma semana, Cartão iFood Facilita (modalidade débito), pagamento de contas e transferências via Pix — [iFood institucional](https://institucional.ifood.com.br/restaurantes/o-que-o-ifood-oferece-aos-restaurantes-parceiros/) (nota: dado obtido via resumo de busca; recomenda-se checagem direta na página institucional/press release do iFood para confirmar o número de 140 mil contas e a data de referência)
- Planos de comissão do iFood para restaurantes: Plano Delivery com 23% de comissão sobre pedidos de delivery + 3,2% de taxa de pagamento online + mensalidade de R$150 (isento abaixo de R$1.800 de faturamento, primeiro mês grátis); e um plano com 12% de comissão + 3,2% de taxa de pagamento + R$110/mês (para faturamento acima de R$1.800/mês, primeiro mês grátis) — [Blog Parceiros iFood — taxas](https://blog-parceiros.ifood.com.br/taxas-ifood/)
- Um blog de terceiro (Trend SuperApp) menciona que a comissão do iFood pode chegar a 31% em determinadas condições — [Trend SuperApp, mai/2026](https://blog.trendsuperapp.com.br/2026/05/28/comissao-ifood-chega-a-31-quando-vale-ficar-e-quando-sair/) (nota: fonte secundária/blog, não é o plano oficial do iFood — tratar com cautela; a taxa de 31% provavelmente é a soma de comissão + taxa de pagamento + outros encargos, não uma linha isolada)
- Stone integra Capital de Giro (crédito com pagamento via retenção diária de parte das vendas na maquininha) a diversos sistemas de PDV/ERP, incluindo Loja Integrada, Bling, Tiny e sistemas Linx — [Stone](https://www.stone.com.br/capital-de-giro)
- Em 2025, a Asaas captou seu terceiro FIDC, no valor de R$ 100 milhões, gerido pela Kanastra, com distribuição de cotas pelo Itaú BBA e Bradesco BBI; a Vivo Ventures fez um aporte estratégico de R$ 35 milhões na Asaas em 2025 — [Blog Asaas / resultado de busca sobre Asaas]
- Asaas oferece antecipação de recebíveis (boletos e cartão de crédito) integrada à própria plataforma, incluindo cobranças recorrentes e vendas via Asaas Tap, e tem um ERP próprio na nuvem (Base by Asaas) com integração via API — [Blog Asaas](https://blog.asaas.com/antecipacao-de-recebiveis-no-asaas/); [Asaas — antecipação](https://www.asaas.com/antecipacao-de-recebiveis)

### Inferences
- O padrão comum entre TOTVS Techfin, Omie.cash e iFood Pago é: o software/plataforma já possui os dados financeiros do cliente (notas fiscais, vendas, fluxo de caixa) e usa isso como vantagem de underwriting/distribuição, com um parceiro bancário/financeiro regulado (Itaú no caso da TOTVS e Omie) fazendo o funding e assumindo a responsabilidade regulatória — validando a tese de que ERPs verticais têm vantagem de dados para monetizar crédito embutido.
- O funding via FIDC (como no caso da Asaas, com Itaú BBA e Bradesco BBI distribuindo cotas) é o mecanismo financeiro por trás da antecipação de recebíveis em escala — um ERP que quiser oferecer antecipação de recebíveis em volume relevante provavelmente precisará de um parceiro com estrutura de FIDC (via SCD/gestora) em vez de apenas uma API de "cash advance" pontual.

### Gaps
- Não encontrei o percentual de receita ou lucro que a TOTVS atribui diretamente ao Techfin como % da receita total da empresa (apenas o volume originado e o tamanho relativo da unidade de negócio) — vale checar o release de resultados trimestrais mais recente da TOTVS (RI) para esse dado.
- Não encontrei dados de receita/comissão específicos da parceria Omie–Letsbank nem da Omie–Itaú (apenas a existência da parceria e sua natureza não exclusiva).
- Não confirmei em fonte primária (release oficial iFood) o número de "140 mil contas digitais ativas" do iFood Pago nem a data de referência exata — recomendo checar o mais recente relatório de impacto/release de imprensa do iFood antes de publicar esse número no relatório final.
