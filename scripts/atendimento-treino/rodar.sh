#!/bin/bash
# Dispara os 60 cenários em 3 levas de 20 (limite de tokens/min da API) e espera as respostas.
# uso: bash scripts/atendimento-treino/rodar.sh <prefixo> ['{"avaliar": false}']   → rodadas <prefixo>a/b/c
P=$1; EXTRA=${2:-'{"avaliar": false}'}
Q() { npx supabase db query --linked --project-ref mdghhjemzdmeuqpzuyzx "$1" 2>&1 | grep -v Initialising; }
for L in "a 01 20" "b 21 40" "c 41 60"; do set -- $L
  Q "select treino.rodar('${P}$1', (select array_agg(id) from treino.cenarios where id between 's$2' and 's$3'), '${EXTRA}'::jsonb)" | grep -o '"rodar": [0-9]*'
  sleep 150
done
for i in $(seq 1 20); do
  n=$(Q "select count(*) filter (where st is not null) n from treino.resultado where rodada ~ '^${P}[abc]\$'" | grep -o '"n": [0-9]*' | grep -o '[0-9]*$')
  [ "$n" = "60" ] && break; sleep 20
done
echo "prontas=$n"
