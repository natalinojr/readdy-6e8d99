# Plano — Tráfego Pago com agentes + Estúdio de Criação (artes)

> Status: **planejamento** (2026-09-27). Nada implementado ainda. Confirmar sempre no código antes de executar cada fase.
> Pedido do dono: rever o uso do Opus no tráfego pago; ter agentes que tocam o tráfego pago sozinhos (mexer nas campanhas, revisar, pensar conteúdo, acompanhar resultados); e um agente de **criação de arte** a partir dos critérios da marca, usando as fotos do cardápio. A criação de arte é um **módulo separado**, que o tráfego pago aciona quando precisa e que também serve para outras telas (ex.: fotos/artes do cardápio).

---

## 1. Onde estamos hoje (confirmado no código)

| Peça | O que faz | IA |
|---|---|---|
| `supabase/functions/meta-ads-insights` | Lê tudo da Meta (campanhas, conjuntos, anúncios, quebras, criativos, comentários) + cruza com pedidos do ERPOS | nenhuma |
| `supabase/functions/meta-connect` | OAuth, conta, links públicos, prévia do anúncio | nenhuma |
| `supabase/functions/meta-ads-agent` | "Gestor de tráfego": cron diário 08h30 BRT + botão "Rodar agora". Regras determinísticas (stop-loss, fadiga, escalar/desescalar ±20%, tetos) → IA revisa, escreve resumo e texto de campanha nova → guardrails → modo `sugerir` ou `autonomo` | **`claude-opus-5`** (linha 36), ~35k tokens de entrada, ≈ R$ 1,30/rodada |
| `src/pages/trafego-pago/page.tsx` + `components/Agente.tsx` | Aba com toggle **Painel × Agente IA** | — |
| Tabelas | `meta_agent_settings` (1 por loja), `meta_agent_runs`, `meta_agent_actions` | — |

Observações:
- **Só o `meta-ads-agent` usa Opus** no tráfego pago. O assistente (`assistente-brain`) já está em Sonnet 5. Então o ajuste de modelo é pontual.
- A ação `rotate_creative` (fadiga de criativo) hoje só **registra "para o dono providenciar"**. Falta quem produza o criativo novo. É aí que o Estúdio entra.
- `create_campaign` usa a `photo_url` crua de um item do cardápio, sem arte, sem marca.
- O "contexto da loja" (tom de voz, diferenciais) é um campo de texto livre (`meta_agent_settings.store_context`), preso ao tráfego pago. Isso deve virar o **Kit da Marca**, compartilhado.
- Permissões da Meta: o token atual pode estar só com `ads_read`. Para o agente **criar/alterar** anúncio precisa de `ads_management`, `pages_show_list`, `pages_manage_ads`. Para **publicar post orgânico** e ler resultado de post: `pages_manage_posts`, `pages_read_engagement`, `instagram_content_publish`, `instagram_manage_insights`. O app Meta está em modo Desenvolvimento e, para uso em lojas de terceiros, vai precisar de **App Review**. Isso bloqueia partes do plano e depende do dono.

---

## 2. Revisão de modelo (fazer primeiro: barato e rápido)

Regra do projeto: o modelo mais barato que faça bem, **medindo antes/depois**.

| Tarefa | Hoje | Proposta |
|---|---|---|
| Rodada diária do gestor (revisar candidatas + resumo) | Opus 5 | **Sonnet 5**. As regras determinísticas já fazem o trabalho pesado; a IA revisa e escreve. |
| Redação de campanha nova (`create_campaign`) | Opus 5 (mesma chamada) | Sonnet 5 |
| Revisão estratégica **semanal** (1×/semana/loja, olha 30 dias e muda rumo) | não existe | **Opus 5**: é aqui que um erro custa dinheiro |
| Checagens frequentes (a cada 3h) | não existe | **sem IA**, só regras. Haiku 4.5 só para escrever o alerta quando houver algo |
| Resumos, legendas curtas, classificação de foto | — | Haiku 4.5 |

Como medir sem arriscar:
1. Deixar o `MODEL` configurável por loja/ambiente (constante → setting com default).
2. **Modo sombra por 1–2 semanas:** a rodada real continua como está; em paralelo roda a versão Sonnet, grava o resultado em `meta_agent_runs` com `trigger='sombra'`, e **não executa nada**.
3. Comparar: mesmas ações? mesma nota de saúde (±10)? resumo com erro factual? custo (`usage`)?
4. Se bater, trocar. Também dá para enxugar o payload (hoje ~35k tokens: mandar só 30d agregado, cortar quebras sem sinal) e reduzir o custo em qualquer modelo.

---

## 3. Arquitetura proposta

Dois módulos separados que conversam por uma **fila de pedidos de arte**:

```
┌──────────────────────── TRÁFEGO PAGO (/trafego-pago) ─────────────────────────┐
│  Monitor (regras, 3/3h) ──► Gestor de Verba (diário) ──► Revisor ──► Meta API   │
│        │                         │   ▲                                           │
│        ▼                         ▼   │                                           │
│  Analista de Resultados ◄── Estrategista de Conteúdo (semanal)                   │
│                                  │ "preciso de 3 artes do burrito, story+feed"   │
└──────────────────────────────────┼───────────────────────────────────────────────┘
                                   ▼  creative_requests (fila)
┌──────────────────────── ESTÚDIO DE CRIAÇÃO (/estudio) ─────────────────────────┐
│  Kit da Marca (questionário) + Biblioteca (fotos do cardápio, logo, referências)│
│  Diretor de Arte (IA escolhe foto/modelo/texto) → Renderizador (sem IA) → Revisor│
│  Clientes do Estúdio: Tráfego Pago, Cardápio/Delivery, Promoções, Instagram…    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Princípio: **IA decide e escreve; código calcula, desenha e executa.** Nenhum agente fala direto com a Meta ou gasta dinheiro sem passar pelos guardrails em código e pelo Revisor.

### 3.1 Agentes do Tráfego Pago

| # | Agente | Quando roda | O que faz | Modelo | Pode agir sozinho? |
|---|---|---|---|---|---|
| 1 | **Monitor** | a cada 3h (horário comercial) | Só regras: gasto disparado, anúncio reprovado pela Meta, conta travada, teto mensal, CPR explodindo no dia. Gera alerta e, se grave, pausa (trava de segurança). | nenhum (Haiku só pra escrever o alerta) | Sim, só **pausar** por segurança |
| 2 | **Gestor de Verba** (o `meta-ads-agent` atual) | diário 08h30 | Pausar/reativar, orçamento ±20%, criar campanha, pedir criativo novo quando há fadiga. | Sonnet 5 | Conforme o nível de autonomia (seção 5) |
| 3 | **Estrategista de Conteúdo** | semanal (seg 07h) | Monta a **pauta da semana**: quais pratos empurrar (mais vendidos, **margem/CMV**, estoque sobrando, dia da semana, datas), ofertas, formatos. Gera pedidos de arte ao Estúdio e rascunhos de campanha. Faz a revisão estratégica de 30 dias. | Opus 5 (1×/semana) | Não: gera pauta para aprovar (ou aprovação automática no nível 3) |
| 4 | **Revisor** | antes de qualquer execução/publicação | Confere: política da Meta (álcool 18+, sem promessa enganosa), preço do anúncio = preço do cardápio, orçamento dentro do teto, raio × área de entrega, texto dentro do limite, arte aprovada pelo Estúdio. Bloqueia ou devolve com motivo. | código + Haiku 4.5 (visão, para a arte) | É o portão: nada passa sem ele |
| 5 | **Analista de Resultados** | diário (depois do Gestor) + relatório semanal | Liga cada arte/anúncio ao resultado (CTR, custo por resultado, pedidos no ERPOS via `utm`), aprende **o que vence** (prato, modelo de arte, texto, horário) e devolve isso ao Estrategista e ao Estúdio. Relatório semanal para o dono. | Haiku 4.5 (resumo) + código (números) | Só escreve (relatório/aprendizados) |

"Rodar sozinho" = os 5 juntos, com o nível de autonomia que o dono escolher.

### 3.1b Inteligência da loja: estratégia a partir dos dados do próprio ERPOS

Hoje o agente só olha os pedidos de **delivery** dos últimos 30 dias (`erposContext`). O sistema tem muito mais que isso, e a estratégia deve nascer desses dados, não só dos números da Meta. Quem faz isso é o **Estrategista** (agente 3), alimentado por uma camada de **fatos calculados em código** (SQL/RPC). A IA não soma nada, só interpreta; segue o `DIRETRIZES-ANALISE-IA.md` (triangulação, hierarquia de fontes).

**Fontes (todas já existem no banco):**

| Canal / dado | Onde está | O que ensina para marketing |
|---|---|---|
| Balcão / caixa | `orders.origin_type = 'cashier'` | O que o cliente da rua pede; horários de pico presencial |
| Mesa / salão | `origin_type = 'table'` | Ticket e mix de quem consome no local |
| Autoatendimento (totem/QR) | `origin_type = 'self_service'` | Itens que vendem sem garçom sugerir; adicionais aceitos |
| Delivery próprio | `origin_type = 'delivery'`, `delivery_platform = 'propria'`, `delivery_source` (utm) | Canal que o anúncio quer fazer crescer; pedidos vindos da Meta |
| iFood | `delivery_platform = 'ifood'` | Demanda que existe mas paga comissão → **migrar para o canal próprio** |
| Retirada | `delivery_platform = 'retirada'` | Clientes próximos, candidatos a raio pequeno |
| Itens e combos | `order_items`, `menu_items` | Mais vendidos, combos, itens com foto |
| **Margem (CMV)** | `fn_get_cmv_report`, fichas técnicas | Empurrar o que **dá lucro**, não só o que vende |
| Estoque | `fn_get_stock_critical_alerts`, `ingredient_batches` (validade) | Não anunciar item que vai faltar; **promover o que está sobrando/perto de vencer** |
| Clientes | aba Clientes & Marketing, vouchers, promoções | Recorrência, clientes sumidos, bairros, aniversariantes |
| Área de entrega | `delivery_config` (pin, faixas de km), `orders.delivery_distance_km` | Raio real dos anúncios; bairros fortes e fracos |

**Estratégias que dá para tirar disso (exemplos):**
- **Migrar iFood → delivery próprio:** prato forte no iFood e fraco no próprio → anúncio no raio com oferta "peça direto e pague menos" (a diferença da comissão paga a oferta).
- **Prato campeão no salão/balcão, desconhecido no delivery** → vira anúncio do delivery.
- **Horário vazio:** hora/dia com cozinha ociosa em todos os canais → campanha só nesse horário (`active_hours`) ou combo do horário.
- **Margem × volume:** item de alta margem e venda baixa → teste de anúncio; item de margem ruim que vende muito → não precisa de verba.
- **Estoque:** insumo sobrando ou perto da validade → prato que usa esse insumo entra na pauta da semana; insumo em falta → pausa anúncio do prato.
- **Clientes sumidos / bairro fraco:** público personalizado e voucher de volta (liga com Promoções/Vouchers).
- **Upsell do autoatendimento:** adicional que o totem vende bem → sugerir combo no delivery e no cardápio.
- **Sazonalidade:** dia da semana, datas (jogo, feriado, dia dos namorados) cruzado com o histórico de vendas.

**Estratégia não executa sozinha: passa por aprovação.**
- O Estrategista gera **propostas de estratégia** (`marketing_strategies`): título, dado que justifica (números e fonte), o que fazer (anúncio, arte, promoção, ajuste de cardápio), custo previsto, meta de resultado e prazo de avaliação.
- Cada proposta vai para uma **fila de aprovação** e só vira ação (pedido de arte, campanha, promoção) depois do "aprovar".
- **Quem aprova é configurável por loja:** nova permissão `marketing_aprovar_estrategia` em Configurações › Permissões, que o dono atribui a quem quiser (dono, gerente, responsável de marketing). Reaproveitar a tela **Aprovações** (`/aprovacoes`, permissão `gestao_aprovacoes`) como caixa de entrada, com um tipo novo "Estratégia de marketing", em vez de criar outra fila.
- Aprovar, recusar (com motivo, que a IA usa para aprender) ou **editar e aprovar**.
- **Tudo isso é configurado pelo administrador da loja** (decisão do dono, 2026-09-27), numa tela "Regras de aprovação" (Configurações ou aba Agentes): quem aprova estratégias, quem aprova artes, quem aprova ações de verba, e **faixas de valor** (ex.: até R$ A/mês qualquer aprovador; acima disso só admin; acima de R$ B, dois aprovadores). Nenhum valor fixo no código: o padrão de fábrica é "só o admin aprova tudo" até o admin mudar. Gravado em `marketing_approval_rules` (1 por loja, escrita só admin).
- Aviso de proposta nova pelo sino/WhatsApp do assistente, e aprovação também pelo assistente (já existe o padrão `AprovarSugestoesTrafego`).
- Depois do prazo, o **Analista de Resultados** avalia se a estratégia bateu a meta e fecha o ciclo ("funcionou / não funcionou / por quê").

### 3.2 Estúdio de Criação (módulo separado)

Tela própria (`/estudio`, menu Marketing), **não** dentro do Tráfego Pago. Serve qualquer parte do sistema que precise de imagem.

**a) Kit da Marca (questionário, 1 por loja).** Perguntado uma vez, editável depois. A IA pode **pré-preencher** (lendo o logo e posts antigos do Instagram com Haiku visão) e o dono só confirma.
- Logo (versões clara/escura), cores (primária, secundária, fundo, destaque), fontes (lista do Google Fonts)
- Tom de voz: descontraído / familiar / premium / jovem; usa emoji? gírias?
- Público principal, diferenciais, bordões, CTA preferido ("Peça pelo WhatsApp")
- Mostrar preço na arte? Selo/moldura fixa? Posição do logo
- Palavras obrigatórias / proibidas; o que nunca fazer (ex.: apelo a excesso de álcool)
- Estilo de foto (fundo escuro, rústico, clean) e 3–5 **artes de referência** que o dono gosta
- Migra o `store_context` atual do `meta_agent_settings` para cá (o tráfego passa a ler do Kit)

**b) Biblioteca.** Fotos do cardápio (`menu_items.photo_url`, já existentes), logo, fotos extras enviadas, referências. Haiku visão dá uma **nota de qualidade** a cada foto (nitidez, luz, enquadramento) → o sistema sabe quais pratos têm foto boa para anúncio e **avisa quais precisam de foto nova**.

**b2) Banco de imagens do usuário (link externo).** A loja pode **ligar o acervo que já tem** em vez de subir foto por foto:
- **Qualquer nuvem por link (decisão do dono):** colar o link da pasta compartilhada; o sistema detecta o provedor.
- **OneDrive/SharePoint:** reaproveitar a conexão que já existe (Edge `ms-graph`, tabela `ms_graph_connections`, ação `browse`). O dono escolhe uma pasta; o Estúdio lê dela.
- **Google Drive / Dropbox:** mesmo padrão (OAuth por loja, token só na Edge), numa fase seguinte.
- **Instagram/Facebook da própria loja:** puxar os posts antigos como referência de estilo (usa a conexão Meta existente + `instagram_basic`).
- **Link público** (pasta compartilhada, Pinterest, site): cadastro manual das URLs.

Como funciona: sincronização periódica (ex.: 1×/dia) que **indexa** as imagens em `studio_assets` (origem, id externo, miniatura, nota de qualidade, tags geradas por Haiku visão: "prato", "ambiente", "equipe", "logo", "referência de estilo", e qual item do cardápio parece ser). Não copia o acervo inteiro: guarda só miniatura + referência, e baixa a imagem em resolução cheia na hora de montar a arte. O dono marca cada pasta como **"fotos para usar na arte"** ou **"só referência de estilo"**, porque são usos diferentes: foto entra na peça, referência só orienta o Diretor de Arte. Direitos de uso: o dono confirma que as imagens são dele (checkbox ao ligar a pasta).

**c) Diretor de Arte (IA) + Renderizador (código).**
- A IA **não desenha pixel**: escolhe foto, modelo de layout, texto (título, preço, CTA) e variações, sempre dentro do Kit.
- O desenho é feito por **modelos (templates) em código**: HTML/SVG → PNG no servidor (satori + resvg na Edge Function). Resultado fiel à marca, previsível e barato (sem custo por imagem).
- Formatos: feed 1:1 e 4:5, story/reels 9:16, capa de cardápio/delivery, banner de promoção, foto de item padronizada (fundo/moldura da marca).
- **Fase opcional:** IA geradora de imagem de outro fornecedor (Claude não gera imagem) para **fundo/cenário, remover fundo e melhorar luz**. Regra: **nunca alterar o prato em si** (propaganda enganosa). Precisa de decisão do dono e chave de API.

**d) Revisão da arte.** Checagem em código (contraste do texto, tamanho da fonte, % de texto na imagem, logo presente, preço = cardápio) + Haiku visão ("a arte está legível? o prato aparece bem?"). Reprovou → volta ao Diretor de Arte com o motivo (até 2 voltas) → senão fica para o dono.

**e) Quem usa o Estúdio.**
- **Tráfego Pago:** `rotate_creative` e `create_campaign` viram *pedido de arte* → Estúdio entrega 2–3 variações → Revisor → sobe como criativo novo (teste A/B no mesmo conjunto).
- **Cardápio/Delivery:** "padronizar foto do item", "gerar capa do cardápio", "arte do combo do dia".
- **Promoções/Vouchers e WhatsApp** (arte da promoção para enviar), no futuro. (Post orgânico no Instagram fica fora: decisão do dono, 2026-09-27.)

Contrato entre módulos: uma Edge Function `estudio` com `request_creative {tenant_id, origem, objetivo, item_ids?, formatos[], texto_sugerido?, prazo}` → grava em `creative_requests` → processa → devolve `creative_ids`. O Tráfego Pago só conhece essa interface.

---

## 4. Dados (tabelas novas, rascunho)

Todas com RLS padrão do projeto: select por membership da loja, escrita só `service_role` + GRANTs explícitos.

- `brand_kit` (1/loja): cores, fontes, tom, regras, CTA, flags, `logo_path`, referências.
- `studio_assets`: fotos/logos/referências (bucket privado `estudio`), `menu_item_id?`, nota de qualidade, `source` (`upload|cardapio|onedrive|gdrive|dropbox|instagram|url`), `external_id`, `uso` (`arte|referencia`), tags.
- `studio_sources`: bancos de imagem ligados pela loja (tipo, pasta/URL, conexão usada, uso, última sincronização).
- `studio_templates`: modelos de layout (código + parâmetros), por formato.
- `creative_requests`: fila (origem `trafego|cardapio|manual|…`, pedido, status, quem pediu).
- `creatives`: peça gerada (formato, template, item, textos, `image_path`, status `rascunho → em_revisao → aprovada → publicada | reprovada`, notas do revisor, `meta_creative_id`/`ad_id`/`post_id`).
- `creative_results`: métricas diárias por peça (vindas do insights + pedidos ERPOS).
- `marketing_plan`: pauta semanal do Estrategista (itens, datas, status).
- `marketing_approval_rules` (1/loja, só admin escreve): aprovadores por tipo (estratégia, arte, verba, campanha nova) e faixas de valor.
- `marketing_strategies`: propostas de estratégia (evidência com números e fonte, ação proposta, custo, meta, prazo), status `proposta → aprovada | recusada | editada → em_execucao → avaliada`, quem aprovou, motivo da recusa, resultado final.
- Views/RPCs de fatos por canal (`fn_mkt_fatos_canais`: vendas por canal × hora × dia × item, margem, estoque, clientes), calculadas em SQL: a IA recebe o resumo pronto.
- `agent_runs` genérico **ou** coluna `agent` em `meta_agent_runs` para registrar cada agente com `model`, `usage` e **custo**, e mostrar "quanto a IA custou este mês" na tela.

---

## 5. Níveis de autonomia (o dono escolhe por loja)

| Nível | Nome | O que roda sozinho |
|---|---|---|
| 0 | Só relatório | Nada executa; tudo é sugestão |
| 1 | Protege | Pausar o que queima dinheiro + tetos (hoje ≈ "autônomo" sem criar) |
| 2 | Otimiza | + ajustar orçamento ±20% + **trocar criativo em fadiga** usando arte já aprovada pelo dono |
| 3 | Piloto automático | + criar campanha e subir arte nova do Estúdio, dentro de teto mensal e pauta aprovada |

Travas que valem em qualquer nível (código, não IA): teto diário/mensal, ±20% a cada 72h, não mexer em conjunto em aprendizado, só ids existentes, preço da arte = preço do cardápio, 18+ para álcool. Tudo registrado com motivo e botão de desfazer quando possível.

---

## 6. Telas

**Tráfego Pago** (`/trafego-pago`): abas `Painel` · `Agentes` (status de cada agente, última rodada, custo de IA do mês, nível de autonomia) · `Aprovações` (fila única: ações de verba, campanhas, pauta) · `Pauta` (calendário da semana) · `Resultados` (o que venceu: prato, arte, texto, horário).

**Estúdio** (`/estudio`): `Marca` (questionário/kit) · `Biblioteca` (fotos + nota de qualidade + "pratos sem foto boa" + **Ligar banco de imagens**) · `Criar` (manual: escolhe item + formato → variações) · `Pedidos` (fila vinda do tráfego/cardápio) · `Galeria` (aprovar, baixar, usar no cardápio, mandar para anúncio).

Integração no cardápio: botão "Gerar arte/foto padronizada" no item, que abre o Estúdio já com o item.

---

## 7. Fases (ordem sugerida)

| Fase | Entrega | Depende de |
|---|---|---|
| **F0** | Modelo configurável + **modo sombra Sonnet × Opus** no `meta-ads-agent`; custo por rodada na tela; enxugar payload | nada |
| **F1** | **Kit da Marca** (questionário + pré-preenchimento por IA) + Biblioteca com nota das fotos do cardápio + **ligar pasta do OneDrive** (reusa `ms-graph`) | nada |
| **F1b** | Google Drive / Dropbox / posts do Instagram como banco de imagens | F1 |
| **F2** | **Estúdio v1**: 4–6 modelos de arte (feed, story, item padronizado, promoção), Diretor de Arte (Sonnet), renderização no servidor, galeria com aprovar/baixar | F1 |
| **F3** | Ligar Tráfego → Estúdio: `rotate_creative`/`create_campaign` geram pedido de arte; **Revisor** antes de subir; subir criativo novo no conjunto | F2 + permissões `ads_management`/`pages_manage_ads` |
| **F4** | **Monitor** 3/3h + **Analista de Resultados** (arte ↔ resultado ↔ pedidos ERPOS) + relatório semanal | F3 |
| **F5a** | **Inteligência da loja**: fatos por canal (balcão, mesa, autoatendimento, delivery próprio, iFood, retirada) + margem + estoque + clientes; relatório semanal "oportunidades" só para leitura | nada (pode vir antes, em paralelo à F1) |
| **F5b** | **Estrategista** semanal gerando propostas + fila de aprovação (permissão `marketing_aprovar_estrategia`, tela Aprovações) + avaliação da estratégia depois do prazo + níveis de autonomia 0–3 | F5a + F4 |
| **F6** (opcional) | IA de imagem (opção escolhida pelo dono entre B, C e D) | decisão do dono |

Cada fase: testar na loja **Testes PDV** e, para a Meta, com uma conta de anúncios de teste antes de ligar em loja real.

---

## 8. Decisões que são do dono

1. **Autonomia inicial:** explicado ao dono em 2026-09-27; aguardando escolha do nível (recomendado: nível 1).
2. ~~Teto de gasto com IA~~ **Decidido (2026-09-27):** item de configuração por loja, definido pelos usuários da loja (quem tem acesso ao Tráfego Pago). Ao atingir o teto no mês, os agentes param e avisam; as travas em código (Monitor sem IA) continuam.
3. ~~Opus semanal~~ **Decidido (2026-09-27):** sim, Opus só na revisão estratégica semanal.
4. **Imagem gerada por IA externa:** opções apresentadas ao dono em 2026-09-27 (A: sem IA de imagem; B: editar a foto real; C: foto real + cenário gerado; D: imagem 100% gerada, nunca como foto de prato). Aguardando escolha.
5. ~~Publicação orgânica~~ **Decidido (2026-09-27):** não entra. Só anúncios pagos.
6. ~~App Review~~ **Decidido (2026-09-27):** a conexão e as permissões de cada loja ficam com os usuários da loja que têm acesso ao Tráfego Pago. Observação: o App Review em si é feito **uma vez** no app Meta do ERPOS (dono do app), não por loja; depois de aprovado, cada loja só conecta.
7. ~~Banco de imagens~~ **Decidido (2026-09-27):** qualquer nuvem, por link. O Estúdio aceita um link de pasta compartilhada (Google Drive, OneDrive, Dropbox, iCloud, Mega, etc.), detecta o provedor e usa o leitor dele; pasta privada que o link não abre pede login (OAuth) daquele provedor.
8. ~~Aprovação de estratégias~~ **Decidido (2026-09-27):** o administrador de cada loja configura quem aprova e as faixas de valor; padrão = só admin.
9. ~~iFood × próprio~~ **Decidido (2026-09-27):** o delivery próprio é independente do iFood; pode ter qualquer preço. Oferta "mais barato no próprio" está liberada.
10. ~~Quem aprova artes~~ **Decidido (2026-09-27):** entra nas regras de aprovação configuradas pelo admin.

---

## 9. Riscos e pegadinhas conhecidas

- Token/permissões Meta: sem `ads_management` + `pages_manage_ads` o agente não cria nem troca criativo (ver `AI_SYSTEM_MAP.md`, 2026-09-16).
- `whatsapp_phone_number` precisa estar vinculado à Página (WABA), senão a Meta recusa o conjunto.
- Pin da loja × área dos anúncios (caso Vila Leste/El Patrón: 17–21 km do pin). Conferir antes de dar autonomia de criar.
- Foto ruim do cardápio → arte ruim. A nota de qualidade da Biblioteca precisa vir antes de automatizar.
- Structured output não aceita `minimum/maximum` em integer: clamp sempre no código.
- Cada push em `main` publica em produção: fases grandes em branch, validar antes.
