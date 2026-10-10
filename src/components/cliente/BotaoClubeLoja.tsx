// Atalho para o clube de vantagens no topo das telas do cliente (QR da mesa / universal e
// delivery). Só aparece quando a loja tem o clube ativo. Abre /clube/<loja> em outra aba,
// para não perder a sacola nem a senha. Quem já tem o cartão do clube neste aparelho vê
// "Meus pontos"; quem não tem vê o convite (com o bônus de entrada, se houver).
import { useEffect, useState } from 'react';
import { clubeChamar, clubeTokenSalvo, type ClubeProgramaPublico } from '@/lib/clubePublico';

interface ClubeLoja { slug: string; programa: ClubeProgramaPublico }

const cache = new Map<string, Promise<ClubeLoja | null>>();
function buscar(tenantId: string): Promise<ClubeLoja | null> {
  let p = cache.get(tenantId);
  if (!p) {
    p = clubeChamar<{ ativo: boolean; loja?: { slug?: string | null }; programa: ClubeProgramaPublico | null }>({ action: 'programa', tenant_id: tenantId })
      .then(function (r) {
        if (r.error || !r.ativo || !r.programa || !r.loja || !r.loja.slug) return null;
        return { slug: r.loja.slug, programa: r.programa };
      });
    cache.set(tenantId, p);
  }
  return p;
}

export default function BotaoClubeLoja(props: { tenantId: string | null | undefined }) {
  const tenantId = props.tenantId;
  const [clube, setClube] = useState<ClubeLoja | null>(null);
  useEffect(function () {
    if (!tenantId) return;
    let vivo = true;
    buscar(tenantId).then(function (c) { if (vivo) setClube(c); });
    return function () { vivo = false; };
  }, [tenantId]);

  if (!clube || !tenantId) return null;
  const socio = !!clubeTokenSalvo(tenantId);
  const bonus = clube.programa.pontos ? clube.programa.pontos.bonus_cadastro : 0;
  const titulo = socio ? 'Meus pontos no clube' : (clube.programa.nome || 'Clube de vantagens');
  const texto = socio
    ? 'Veja seus pontos e troque por prêmios'
    : (bonus > 0 ? 'Entre e ganhe ' + bonus + ' pontos' : 'Junte pontos e troque por prêmios');

  return (
    <a
      href={'/clube/' + clube.slug}
      target="_blank"
      rel="noopener"
      className="mx-5 mt-2.5 w-[calc(100%-2.5rem)] flex items-center gap-3 bg-white border border-stone-200/70 rounded-[18px] px-3.5 py-3 text-left no-underline hover:bg-stone-50 transition-colors"
    >
      <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
        <i className="ri-vip-crown-2-line text-lg" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold text-stone-900 truncate">{titulo}</span>
        <span className="block text-[13px] text-stone-600 mt-0.5 truncate">{texto}</span>
      </span>
      <i className="ri-arrow-right-s-line text-xl text-stone-400 shrink-0" />
    </a>
  );
}
