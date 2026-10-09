// Partes do clube que já existiam na página (como funciona, roleta, salvar contato),
// agora com as cores da loja.
import { useEffect, useRef, useState } from 'react';
import RoletaSvg, { rotacaoParaFatia } from '@/components/fidelidade/RoletaSvg';
import type { ClubeProgramaPublico } from '@/lib/clubePublico';
import { clubeApp } from '@/lib/clubeApp';
import { brl, pts } from './ui';

export function ComoFunciona({ p }: { p: ClubeProgramaPublico }) {
  return (
    <div className="space-y-3">
      {p.pontos && (
        <section className="bg-white rounded-2xl border border-[#EFE7DD] p-4">
          <h3 className="font-extrabold text-zinc-900 mb-2">⭐ Como ganhar pontos</h3>
          <ul className="text-sm text-zinc-600 space-y-1.5">
            <li>Cada <b>R$ 1</b> em pedido pago vale <b>{p.pontos.pontos_por_real} ponto{p.pontos.pontos_por_real === 1 ? '' : 's'}</b>{p.niveis.some((n) => n.multiplicador > 1) ? ' — e mais nos níveis altos' : ''}.</li>
            <li>Vale no {[p.pontos.canais.salao && 'salão (mesa)', p.pontos.canais.balcao && 'balcão', p.pontos.canais.totem && 'tablet de autoatendimento', p.pontos.canais.delivery && 'delivery próprio'].filter(Boolean).join(', ')}. É só se identificar com o CPF.</li>
            {p.pontos.pedido_minimo > 0 && <li>Pedidos a partir de {brl(p.pontos.pedido_minimo)}.</li>}
            {p.pontos.bonus_cadastro > 0 && <li>🎉 <b>{pts(p.pontos.bonus_cadastro)} pontos</b> ao entrar no clube.</li>}
            {p.pontos.bonus_aniversario > 0 && <li>🎂 <b>{pts(p.pontos.bonus_aniversario)} pontos</b> no mês do seu aniversário.</li>}
            {p.pontos.validade_meses > 0 && <li>Os pontos valem {p.pontos.validade_meses} meses.</li>}
          </ul>
        </section>
      )}
      {p.niveis.length > 0 && (
        <section className="bg-white rounded-2xl border border-[#EFE7DD] p-4">
          <h3 className="font-extrabold text-zinc-900 mb-1">🏆 Níveis</h3>
          <p className="text-xs text-zinc-500 mb-3">Pelo número de compras {p.janela_dias > 0 ? `nos últimos ${p.janela_dias >= 365 ? '12 meses' : `${p.janela_dias} dias`}` : 'desde sempre'}.</p>
          <div className="space-y-2">
            {p.niveis.map((n) => (
              <div key={n.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: `${n.cor}14` }}>
                <span className="text-2xl">{n.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold" style={{ color: n.cor }}>{n.nome} <span className="text-xs font-normal text-zinc-500">· {n.min_compras}+ compras{n.multiplicador > 1 ? ` · ${n.multiplicador}× pontos` : ''}</span></p>
                  {n.beneficios && <p className="text-xs text-zinc-600">{n.beneficios}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {p.roleta && (
        <section className="bg-white rounded-2xl border border-[#EFE7DD] p-4">
          <h3 className="font-extrabold text-zinc-900 mb-2">🎡 Roleta de prêmios</h3>
          <p className="text-sm text-zinc-600">
            Ganhe giros {[p.roleta.a_cada_compras > 0 && `a cada ${p.roleta.a_cada_compras} compras`, p.roleta.pedido_acima_de > 0 && `em pedidos acima de ${brl(p.roleta.pedido_acima_de)}`, p.roleta.ao_subir_nivel && 'ao subir de nível', p.roleta.aniversario && 'no seu aniversário'].filter(Boolean).join(', ')}.
            {p.roleta.premios.length > 0 && <> Pode sair: {p.roleta.premios.join(', ')}.</>}
          </p>
        </section>
      )}
    </div>
  );
}

export function Roleta({ fatias, giros, token, onFim, onBloqueado }: {
  fatias: { id: string; nome: string; cor: string; peso: number }[]; giros: number; token: string;
  onFim: () => void; onBloqueado: () => void;
}) {
  const [rot, setRot] = useState(0);
  const [girando, setGirando] = useState(false);
  const [premio, setPremio] = useState<{ nome: string; tipo: string } | null>(null);
  const [erro, setErro] = useState('');
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const girar = async () => {
    if (girando) return;
    setGirando(true); setPremio(null); setErro('');
    setRot((r) => r + 720);
    const r = await clubeApp<{ giro?: { indice: number; premio: { nome: string; tipo: string } } }>({ action: 'girar', token });
    if (!vivo.current) return;
    if (r._status === 423) { setGirando(false); onBloqueado(); return; }
    if (r.error || !r.giro || r.giro.indice < 0) { setErro(r.message || 'Não consegui girar.'); setGirando(false); return; }
    setRot((x) => rotacaoParaFatia(fatias, r.giro!.indice, x, 6));
    setTimeout(() => { if (!vivo.current) return; setGirando(false); setPremio(r.giro!.premio); onFim(); }, 3300);
  };
  return (
    <section className="mx-4 mt-4 rounded-[22px] p-4 text-white text-center" style={{ background: 'linear-gradient(135deg, var(--brand2), var(--brand))' }}>
      <h3 className="font-extrabold text-xl">🎡 Você tem {giros} giro{giros > 1 ? 's' : ''}!</h3>
      <div className="my-3"><RoletaSvg premios={fatias} rotacao={rot} tamanho="w-60 h-60" seta="border-t-white" /></div>
      {premio && <p className="font-extrabold text-lg mb-2">{premio.tipo === 'nada' ? `${premio.nome} 😅` : `🎉 ${premio.nome}!`}</p>}
      {erro && <p className="font-semibold mb-2">{erro}</p>}
      <button onClick={() => { void girar(); }} disabled={girando} className="px-8 py-3 rounded-xl bg-white font-extrabold text-lg cursor-pointer disabled:opacity-60" style={{ color: 'var(--brand)' }}>
        {girando ? 'Girando…' : 'GIRAR'}
      </button>
    </section>
  );
}

// Salvar a loja nos contatos (.vcf): com o número salvo, as mensagens da loja no WhatsApp
// chegam com o nome dela. iPhone abre "Novo contato"; Android baixa o cartão.
export function salvarContato(contato: { nome: string; whatsapp: string }, programaNome: string) {
  const esc = (t: string) => t.replace(/[\\,;]/g, (m) => `\\${m}`);
  const vcf = [
    'BEGIN:VCARD', 'VERSION:3.0',
    `FN:${esc(contato.nome)}`, `ORG:${esc(contato.nome)}`,
    `TEL;TYPE=CELL;waid=${contato.whatsapp}:+${contato.whatsapp}`,
    `URL:${window.location.origin}${window.location.pathname}`,
    `NOTE:${esc(programaNome)}`,
    'END:VCARD', '',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([vcf], { type: 'text/vcard;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${contato.nome.normalize('NFD').replace(/[^\w ]/g, '').trim() || 'loja'}.vcf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
