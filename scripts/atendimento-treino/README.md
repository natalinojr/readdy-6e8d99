# Treino do atendente de WhatsApp da loja (`atendimento-loja`)

Como medir e melhorar o atendente sem gastar à toa. Usado de v4 a v13 (2026-09-26/27); resultado e
pegadinhas no `AI_SYSTEM_MAP.md` (parágrafo "Atendimento de clientes da loja pelo WhatsApp").

## Peças

| Arquivo | Para quê |
|---|---|
| `cenarios.json` | 60 clientes simulados (persona + primeira mensagem + condições: `aberto`, `sem_estoque`, `bot`, `pedidos`) |
| `treino.sql` | cria o rascunho `treino` no banco (tabelas, `treino.rodar`, `treino.resultado`) |
| `carregar-cenarios.mjs` | gera o INSERT dos cenários |
| `rodar.sh` | dispara os 60 em 3 levas de 20 e espera |
| `exportar.sh` | tira as conversas de uma rodada em 3 arquivos para avaliar |
| `criterio.md` | critério do avaliador (o mesmo que o avaliador da API usava) |
| `replay.mjs` | roda `travas.ts` sobre as respostas gravadas — mede cada trava sem API |

Testes permanentes das travas: `src/test/edge/atendimentoTravas.test.ts` (cada caso veio de uma conversa real).

## Passo a passo

```bash
npx supabase db query --linked --project-ref mdghhjemzdmeuqpzuyzx -f scripts/atendimento-treino/treino.sql
node scripts/atendimento-treino/carregar-cenarios.mjs > "$TEMP/c.sql"
npx supabase db query --linked --project-ref mdghhjemzdmeuqpzuyzx -f "$TEMP/c.sql"
bash scripts/atendimento-treino/rodar.sh r1                      # atendente + cliente simulado pela API
bash scripts/atendimento-treino/exportar.sh r1                   # → $TEMP/atendimento-aval/r1_parte{1,2,3}.json
```

1. **Fatos para o avaliador:** `select treino.rodar('fatos', array['s01'], '{"so_fatos": true}')` e salvar
   `c->>'fatos'` de `treino.resultado` em `fatos.txt` na mesma pasta (instruções + cardápio com ids).
2. **Avaliar no Claude Code** (sem API): 3 subagentes Sonnet, um por parte, lendo `criterio.md` + `fatos.txt`
   e gravando `r1_nota{1,2,3}.json`. As condições do cenário vão junto na exportação — sem elas o avaliador
   acusa de invenção o que é certo (loja fechada, item esgotado, cupom).
3. **Mudou uma trava?** Antes de gastar API: `esbuild supabase/functions/atendimento-loja/travas.ts --bundle
   --platform=node --format=esm --outfile=$TEMP/atendimento-aval/travas.mjs`, `menu.json` (delivery-write ›
   get_delivery_config) e `todas.json` na pasta, e `node scripts/atendimento-treino/replay.mjs '^r1'`.
4. **Comparar modelo/esforço:** `rodar.sh r2 '{"avaliar": false, "modelo": "claude-sonnet-5-5", "effort": "low"}'` (`MODELOS_SIM` no index.ts; `effort` = low/medium/high).
5. **No fim:** `drop schema treino cascade;` (é rascunho; `net._http_response` some sozinho em ~6 h).

Custo de referência (2026-09-27): ~US$ 0,02 (Haiku) a ~0,05 (Sonnet) por conversa de 6 turnos, com o cliente
simulado; 60 cenários ≈ US$ 1,40–3,00. O avaliador pela API (`avaliar` padrão) dobra isso — prefira o passo 2.
