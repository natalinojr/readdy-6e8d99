#!/bin/bash
# Exporta as conversas de uma rodada para avaliação fora da API (Claude Code, subagentes Sonnet).
# uso: bash scripts/atendimento-treino/exportar.sh <prefixo> [pasta]  → <pasta>/<prefixo>_parte{1,2,3}.json
P=$1; D=${2:-"${TEMP:-/tmp}/atendimento-aval"}; mkdir -p "$D"
npx supabase db query --linked --project-ref mdghhjemzdmeuqpzuyzx "select r.sim, r.st, c.body->>'persona' persona, c.body - 'persona' - 'primeira' - 'id' condicoes_do_cenario, r.c->'equipe' equipe, r.c->'link' link, r.c->'conversa' conversa, r.c->>'error' erro from treino.resultado r join treino.cenarios c on c.id = r.sim where r.rodada ~ '^${P}[abc]$' order by r.sim" 2>&1 | grep -v Initialising > "$D/${P}_raw.json"
PYTHONIOENCODING=utf-8 python - "$D" "$P" <<'PY'
import json,sys,os
d,p=sys.argv[1],sys.argv[2]
rows=json.load(open(os.path.join(d,p+'_raw.json'),encoding='utf-8'))['rows']
ok=[r for r in rows if r['st']==200 and r['conversa']]
print(len(rows),'linhas',len(ok),'ok; erros:',[(r['sim'],(r['erro'] or '')[:60]) for r in rows if r not in ok])
n=(len(ok)+2)//3
for k in range(3): json.dump(ok[k*n:(k+1)*n],open(os.path.join(d,f'{p}_parte{k+1}.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=1)
PY
