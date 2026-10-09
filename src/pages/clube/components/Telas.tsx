// As 4 abas do app do clube: Início, Prêmios, Avisos e Eu.
import { useMemo, useState, type ReactNode } from 'react';
import { rotuloPremio } from '@/lib/fidelidade';
import type { ClubeDados, ClubeProgramaPublico } from '@/lib/clubePublico';
import { precoNoClube, type AvisoClube, type EstadoAparelho, type IndicacaoPublica, type LojaDoClube } from '@/lib/clubeApp';
import { Roleta } from './Extras';
import { Botao, Chave, Icone, Linha, Lista, Secao, brl, dataBR, pts, quando } from './ui';

/** Prêmio pronto para o cliente: foto, preço final e se já dá para trocar. */
export interface PremioVisto {
  id: string; alvo: { recompensa_id?: string; beneficio_id?: string };
  nome: string; foto: string | null; preco: number | null; sai: number | null;
  custo: number; pronto: boolean; falta: number; bloqueio: string | null; motivo?: string; ate?: string | null;
}

export function premiosDoCliente(dados: ClubeDados, programa: ClubeProgramaPublico): PremioVisto[] {
  const r = dados.resumo;
  const meta = (id: string) => programa.recompensas.find((x) => x.id === id);
  const ganhos: PremioVisto[] = r.beneficios.map((b) => {
    const m = b.reward && (b.reward as { recompensa_id?: string }).recompensa_id ? meta(String((b.reward as { recompensa_id?: string }).recompensa_id)) : undefined;
    return {
      // Com o preço do cardápio, o "sai por" já diz o desconto: fica só o nome do item.
      id: `b:${b.id}`, alvo: { beneficio_id: b.id }, nome: m?.preco != null ? b.reward.nome : rotuloPremio(b.reward), foto: m?.foto ?? null,
      preco: m?.preco ?? null, sai: m ? precoNoClube(b.reward, m.preco) : null, custo: 0, pronto: true, falta: 0,
      bloqueio: null, motivo: b.reward.motivo ?? 'Presente', ate: b.expires_at,
    };
  });
  const trocas: PremioVisto[] = r.recompensas.map((w) => {
    const m = meta(w.id);
    return {
      id: `r:${w.id}`, alvo: { recompensa_id: w.id }, nome: m?.preco != null ? w.nome : rotuloPremio(w), foto: m?.foto ?? null,
      preco: m?.preco ?? null, sai: m ? precoNoClube(w, m.preco) : null, custo: w.custo_pontos,
      pronto: w.nivel_ok && w.falta <= 0, falta: Math.max(0, w.falta),
      bloqueio: !w.nivel_ok && w.nivel_minimo ? `A partir do nível ${w.nivel_minimo}` : null,
    };
  });
  return [...ganhos, ...trocas];
}

function PrecoLinha({ p }: { p: PremioVisto }) {
  if (p.sai == null) return null;
  return (
    <p className="text-[12.5px] font-bold text-emerald-700 mt-0.5 whitespace-nowrap">
      {p.sai === 0 ? 'Grátis' : `Sai por ${brl(p.sai)}`}
      {p.preco != null && p.sai !== p.preco && <s className="ml-1.5 text-[11.5px] font-semibold text-zinc-400">{brl(p.preco)}</s>}
    </p>
  );
}

function Foto({ src, className }: { src: string | null; className: string }) {
  return src
    ? <div className={`${className} bg-center bg-cover`} style={{ backgroundImage: `url(${src})` }} />
    : <div className={`${className} flex items-center justify-center text-3xl`} style={{ background: 'var(--brand-suave)' }}>🎁</div>;
}

// ── Cartão do clube ─────────────────────────────────────────────────────────
export function Cartao({ dados, loja }: { dados: ClubeDados; loja: LojaDoClube }) {
  const r = dados.resumo;
  const progresso = useMemo(() => {
    if (!r.proximo) return 100;
    const base = r.nivel?.min_compras ?? 0;
    return Math.min(100, Math.max(4, ((r.compras_janela - base) / Math.max(1, r.proximo.min_compras - base)) * 100));
  }, [r]);
  return (
    <div className="mx-4 rounded-[24px] p-[18px] text-white relative overflow-hidden shadow-[0_14px_34px_rgba(0,0,0,.22)]"
      style={{ background: 'radial-gradient(120% 90% at 100% 0%, var(--brand3) 0%, var(--brand) 45%, var(--brand2) 100%)' }}>
      <div className="absolute -right-10 -bottom-16 w-48 h-48 rounded-full bg-white/[.06]" />
      <div className="relative flex items-center justify-between gap-3">
        {loja.logo
          ? <div className="w-11 h-11 rounded-xl bg-center bg-cover border-2 border-white/25" style={{ backgroundImage: `url(${loja.logo})` }} />
          : <span className="text-sm font-extrabold opacity-90">{loja.nome}</span>}
        {r.nivel && <span className="text-[12.5px] font-extrabold rounded-full px-3 py-1 bg-white/15 border border-white/20">{r.nivel.emoji} {r.nivel.nome}{r.nivel.multiplicador > 1 ? ` · ${r.nivel.multiplicador.toLocaleString('pt-BR')}× pontos` : ''}</span>}
      </div>
      <p className="relative mt-4 text-[13px] opacity-85">Olá, {r.primeiro_nome}</p>
      <div className="relative flex items-baseline gap-2">
        <b className="text-[52px] font-extrabold leading-[1.05] tracking-tight tabular-nums" style={{ color: 'var(--acc)' }}>{pts(r.saldo)}</b>
        <span className="text-sm font-bold opacity-90">pontos</span>
      </div>
      {r.proximo && (
        <>
          <div className="relative h-2 rounded-full bg-white/20 overflow-hidden mt-3.5"><div className="h-full rounded-full" style={{ width: `${progresso}%`, background: 'var(--acc)' }} /></div>
          <div className="relative flex justify-between text-xs mt-1.5 opacity-90">
            <span>{r.compras_janela} de {r.proximo.min_compras} compra{r.proximo.min_compras === 1 ? '' : 's'}</span>
            <span>{(r.faltam_compras ?? 0) > 0 ? <>{r.faltam_compras === 1 ? 'Falta' : 'Faltam'} <b>{r.faltam_compras}</b> para {r.proximo.emoji} {r.proximo.nome}</> : <>Na próxima: {r.proximo.emoji} {r.proximo.nome}</>}</span>
          </div>
        </>
      )}
      {r.vence_30d > 0 && (
        <p className="relative mt-3 text-xs bg-black/20 rounded-xl px-2.5 py-2 flex items-center gap-1.5">
          <i className="ri-time-fill" style={{ color: 'var(--acc)' }} />{pts(r.vence_30d)} pontos vencem nos próximos 30 dias — troque antes!
        </p>
      )}
    </div>
  );
}

// ── Início ──────────────────────────────────────────────────────────────────
export function Inicio({ dados, loja, programa, token, indicacao, onVerPremios, onUsar, onRecarregar, onBloqueado, onIndicar, onExtrato, extra }: {
  dados: ClubeDados; loja: LojaDoClube; programa: ClubeProgramaPublico; token: string; indicacao: IndicacaoPublica | null;
  onVerPremios: () => void; onUsar: (p: PremioVisto) => void; onRecarregar: () => void; onBloqueado: () => void;
  onIndicar: () => void; onExtrato: () => void; extra?: ReactNode;
}) {
  const todos = premiosDoCliente(dados, programa);
  const prontos = todos.filter((p) => p.pronto);
  const quase = todos.filter((p) => !p.pronto && !p.bloqueio).sort((a, b) => a.falta - b.falta).slice(0, 2);
  const r = dados.resumo;
  return (
    <>
      <Cartao dados={dados} loja={loja} />
      {extra}
      {r.giros > 0 && programa.roleta && programa.roleta.fatias.length >= 2 && (
        <Roleta fatias={programa.roleta.fatias} giros={r.giros} token={token} onFim={onRecarregar} onBloqueado={onBloqueado} />
      )}
      {prontos.length > 0 && (
        <Secao titulo="Você já pode usar" acao={<button onClick={onVerPremios} className="text-[12.5px] font-bold cursor-pointer" style={{ color: 'var(--brand)' }}>Ver todos</button>}>
          <div className="flex gap-2.5 overflow-x-auto px-4 pb-1 snap-x [scrollbar-width:none]">
            {prontos.map((p) => (
              <button key={p.id} onClick={() => onUsar(p)} className="snap-start shrink-0 w-[148px] text-left bg-white border border-[#EFE7DD] rounded-[18px] overflow-hidden cursor-pointer">
                <div className="relative">
                  <Foto src={p.foto} className="h-24 w-full" />
                  <span className="absolute left-2 top-2 rounded-full bg-emerald-700 text-white text-[10.5px] font-extrabold px-2 py-0.5">{p.custo ? `${pts(p.custo)} pts` : 'Presente'}</span>
                </div>
                <div className="p-2.5">
                  <p className="text-[13px] font-extrabold leading-tight line-clamp-2 min-h-[32px]">{p.nome}</p>
                  <PrecoLinha p={p} />
                </div>
              </button>
            ))}
          </div>
        </Secao>
      )}
      {quase.length > 0 && (
        <Secao titulo="Quase lá">
          <Lista className="mx-4">
            {quase.map((p) => (
              <Linha key={p.id} onClick={onVerPremios}
                icone={<Foto src={p.foto} className="w-[38px] h-[38px] rounded-xl shrink-0" />}
                titulo={p.nome} sub={`Faltam ${pts(p.falta)} pontos`}
                direita={<span className="text-[13.5px] font-extrabold whitespace-nowrap" style={{ color: 'var(--brand)' }}>{pts(p.custo)}</span>} />
            ))}
          </Lista>
        </Secao>
      )}
      {indicacao && (
        <button onClick={onIndicar} className="mx-4 mt-6 w-[calc(100%-2rem)] text-left rounded-[20px] p-4 flex items-center gap-3 cursor-pointer border" style={{ background: 'var(--brand-suave)', borderColor: 'var(--brand-suave)' }}>
          <span className="text-3xl">🎁</span>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-[15px] text-zinc-900">Indique e ganhe {indicacao.premio}</p>
            <p className="text-[12.5px] text-zinc-600 leading-snug">Quando seu amigo entrar no clube pelo seu link e fizer a 1ª compra.</p>
          </div>
          <i className="ri-share-forward-line text-2xl" style={{ color: 'var(--brand)' }} />
        </button>
      )}
      <Secao titulo="Últimos movimentos" acao={dados.extrato.length > 4 ? <button onClick={onExtrato} className="text-[12.5px] font-bold cursor-pointer" style={{ color: 'var(--brand)' }}>Extrato</button> : undefined}>
        <Extrato linhas={dados.extrato.slice(0, 4)} />
      </Secao>
    </>
  );
}

export function Extrato({ linhas }: { linhas: ClubeDados['extrato'] }) {
  if (linhas.length === 0) return <p className="mx-4 text-sm text-zinc-500 bg-white border border-[#EFE7DD] rounded-[18px] p-4">Ainda sem movimentos.</p>;
  return (
    <Lista className="mx-4">
      {linhas.map((e, i) => {
        const saida = ['redeemed', 'manual_sub', 'expired'].includes(e.tipo);
        return (
          <Linha key={i}
            icone={<Icone fundo={saida ? '#FFF4E0' : '#ECFDF3'}>{saida ? '🎁' : e.tipo === 'earned' ? '🧾' : '⭐'}</Icone>}
            titulo={<span className="line-clamp-1">{e.texto}{e.reservado ? ' (reservado)' : ''}</span>}
            sub={`${dataBR(e.data)}${!saida && e.vence ? ` · vence ${dataBR(e.vence)}` : ''}`}
            direita={<span className={`text-[13.5px] font-extrabold tabular-nums whitespace-nowrap ${saida ? 'text-rose-600' : 'text-emerald-700'}`}>{saida ? '−' : '+'}{pts(e.pontos)}</span>} />
        );
      })}
    </Lista>
  );
}

// ── Prêmios ─────────────────────────────────────────────────────────────────
export function Premios({ dados, programa, onUsar }: { dados: ClubeDados; programa: ClubeProgramaPublico; onUsar: (p: PremioVisto) => void }) {
  const todos = premiosDoCliente(dados, programa);
  const prontos = todos.filter((p) => p.pronto);
  const [aba, setAba] = useState<'posso' | 'todos'>(prontos.length ? 'posso' : 'todos');
  const lista = aba === 'posso' ? prontos : todos;
  return (
    <>
      <div className="flex gap-2 px-4 mb-3.5">
        {([['posso', `Posso usar · ${prontos.length}`], ['todos', `Todos · ${todos.length}`]] as const).map(([id, rot]) => (
          <button key={id} onClick={() => setAba(id)} className={`h-9 rounded-full px-3.5 text-[13px] font-bold border cursor-pointer ${aba === id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-[#EFE7DD]'}`}>{rot}</button>
        ))}
      </div>
      {lista.length === 0 && <p className="mx-4 text-sm text-zinc-500 bg-white border border-[#EFE7DD] rounded-[18px] p-4">Ainda não dá para trocar. Cada compra soma pontos!</p>}
      <div className="space-y-2.5 px-4">
        {lista.map((p) => (
          <div key={p.id} className={`flex gap-3 items-center p-3 bg-white border border-[#EFE7DD] rounded-[18px] ${p.pronto ? '' : 'opacity-90'}`}>
            <Foto src={p.foto} className="w-[76px] h-[76px] rounded-[14px] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-extrabold leading-tight">{p.nome}</p>
              <PrecoLinha p={p} />
              {p.pronto
                ? <p className="text-[11.5px] font-bold text-zinc-400 mt-1">{p.custo ? `${pts(p.custo)} pontos` : `${p.motivo}${p.ate ? ` · até ${dataBR(p.ate)}` : ''}`}</p>
                : p.bloqueio
                  ? <p className="text-[11.5px] font-bold text-zinc-400 mt-1">{p.bloqueio}</p>
                  : <>
                    <div className="h-1.5 rounded-full bg-[#F1EBE3] overflow-hidden mt-1.5"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (dados.resumo.saldo / Math.max(1, p.custo)) * 100)}%`, background: 'var(--brand)' }} /></div>
                    <p className="text-[11.5px] font-bold text-zinc-400 mt-1">Faltam {pts(p.falta)} de {pts(p.custo)} pontos</p>
                  </>}
            </div>
            {p.pronto && <button onClick={() => onUsar(p)} className="h-[38px] px-3.5 rounded-xl text-white text-[13px] font-extrabold cursor-pointer shrink-0" style={{ background: 'var(--brand)' }}>Usar</button>}
          </div>
        ))}
      </div>
    </>
  );
}

// ── Avisos ──────────────────────────────────────────────────────────────────
const EMOJI_AVISO: Record<string, string> = { aparelho_novo: '📱', indicacao: '🎉', pontos: '⭐', premio: '🎁', promocao: '🔥', nivel: '🏆', vencendo: '⏳', aniversario: '🎂' };
export function Avisos({ avisos, onAbrir, podeAtivar, onAtivar }: { avisos: AvisoClube[] | null; onAbrir: (a: AvisoClube) => void; podeAtivar: boolean; onAtivar: () => void }) {
  return (
    <>
      {podeAtivar && (
        <div className="mx-4 mb-4 rounded-[18px] p-4 bg-white border border-[#EFE7DD] flex items-center gap-3">
          <i className="ri-notification-badge-line text-2xl" style={{ color: 'var(--brand)' }} />
          <p className="flex-1 text-[13px] text-zinc-600 leading-snug">Ligue as notificações para saber na hora quando ganhar pontos.</p>
          <button onClick={onAtivar} className="h-9 px-3 rounded-xl text-white text-[13px] font-extrabold cursor-pointer" style={{ background: 'var(--brand)' }}>Ligar</button>
        </div>
      )}
      {avisos === null && <p className="text-center text-sm text-zinc-400 py-8">Carregando…</p>}
      {avisos && avisos.length === 0 && <p className="mx-4 text-sm text-zinc-500 bg-white border border-[#EFE7DD] rounded-[18px] p-4">Nenhum aviso por enquanto. Quando a loja mandar algo, fica guardado aqui.</p>}
      {avisos && avisos.length > 0 && (
        <Lista className="mx-4">
          {avisos.map((a) => (
            <Linha key={a.id} onClick={a.url ? () => onAbrir(a) : undefined}
              icone={<Icone fundo={a.lido_em ? '#F4EFE7' : 'var(--brand-suave)'}>{EMOJI_AVISO[a.tipo] ?? '🔔'}</Icone>}
              titulo={<>{a.titulo}{!a.lido_em && <span className="inline-block w-2 h-2 rounded-full ml-1.5 align-middle" style={{ background: 'var(--brand3)' }} />}</>}
              sub={<>{a.corpo}{a.corpo ? ' · ' : ''}{quando(a.created_at)}</>} />
          ))}
        </Lista>
      )}
      <p className="text-[12.5px] text-zinc-400 text-center leading-relaxed mx-6 mt-4">Tudo que a loja manda fica guardado aqui, mesmo que você não tenha visto a notificação.</p>
    </>
  );
}

// ── Eu ──────────────────────────────────────────────────────────────────────
export function Eu({ dados, estado, instalado, pushOk, onInstalar, onDigital, onSeguranca, onAparelhos, onPrefs, onAtivarAvisos, onComoFunciona, onSobre, onSair, contato, onSalvarContato }: {
  dados: ClubeDados; estado: EstadoAparelho | null; instalado: boolean; pushOk: boolean;
  onInstalar: (() => void) | null; onDigital: (() => void) | null;
  onSeguranca: (campo: 'digital_abrir' | 'digital_premio', valor: boolean) => void;
  onAparelhos: () => void; onPrefs: (campo: 'avisos_pontos' | 'avisos_promocoes', valor: boolean) => void;
  onAtivarAvisos: (() => void) | null; onComoFunciona: () => void; onSobre: () => void; onSair: () => void;
  contato: string | null; onSalvarContato: (() => void) | null;
}) {
  const r = dados.resumo;
  const ap = estado?.aparelho;
  return (
    <>
      <div className="flex items-center gap-3.5 mx-4 mb-1">
        <div className="w-[58px] h-[58px] rounded-[18px] flex items-center justify-center text-2xl font-extrabold" style={{ background: 'var(--brand)', color: 'var(--acc)' }}>{(r.primeiro_nome || '?')[0]}</div>
        <div>
          <p className="text-lg font-extrabold">{r.primeiro_nome}</p>
          <p className="text-[12.5px] font-semibold text-zinc-400">{r.nivel ? `${r.nivel.emoji} ${r.nivel.nome}` : 'Membro do clube'} · {pts(r.saldo)} pontos</p>
        </div>
      </div>

      {onInstalar && !instalado && (
        <button onClick={onInstalar} className="mx-4 mt-4 w-[calc(100%-2rem)] rounded-[18px] p-3.5 flex items-center gap-3 text-left text-white cursor-pointer" style={{ background: 'var(--brand)' }}>
          <i className="ri-smartphone-line text-2xl" />
          <span className="flex-1 text-[13.5px] font-bold leading-snug">Instale o app no celular: abre com 1 toque e avisa quando ganhar prêmio.</span>
          <i className="ri-arrow-right-s-line text-xl" />
        </button>
      )}

      <Secao titulo="Segurança">
        <Lista className="mx-4">
          {ap?.tem_digital ? (
            <>
              <Linha icone={<Icone fundo="var(--brand-suave)"><i className="ri-fingerprint-line" style={{ color: 'var(--brand)' }} /></Icone>}
                titulo="Pedir a digital para abrir" sub="Ao abrir o app depois de alguns minutos fora"
                direita={<Chave ligada={!!ap.digital_abrir} rotulo="Pedir a digital para abrir" onChange={(v) => onSeguranca('digital_abrir', v)} />} />
              <Linha icone={<Icone fundo="var(--brand-suave)"><i className="ri-gift-line" style={{ color: 'var(--brand)' }} /></Icone>}
                titulo="Pedir a digital para usar prêmio" sub="Ninguém usa seus pontos pelo seu celular"
                direita={<Chave ligada={!!ap.digital_premio} rotulo="Pedir a digital para usar prêmio" onChange={(v) => onSeguranca('digital_premio', v)} />} />
            </>
          ) : onDigital ? (
            <Linha onClick={onDigital} icone={<Icone fundo="var(--brand-suave)"><i className="ri-fingerprint-line" style={{ color: 'var(--brand)' }} /></Icone>}
              titulo="Entrar com a digital" sub="Digital, rosto ou a senha do celular" />
          ) : null}
          <Linha onClick={onAparelhos} icone={<Icone><i className="ri-device-line text-slate-600" /></Icone>}
            titulo="Aparelhos conectados" sub="Ver e desconectar" />
        </Lista>
      </Secao>

      <Secao titulo="Notificações">
        <Lista className="mx-4">
          {onAtivarAvisos && !pushOk && (
            <Linha onClick={onAtivarAvisos} icone={<Icone fundo="var(--brand-suave)"><i className="ri-notification-3-line" style={{ color: 'var(--brand)' }} /></Icone>}
              titulo="Ligar notificações neste celular" sub="Pontos, prêmios e aparelho novo" />
          )}
          <Linha titulo="Meus pontos e prêmios" sub="Ganhou, liberou, vai vencer"
            direita={<Chave ligada={estado?.prefs.avisos_pontos ?? true} rotulo="Meus pontos e prêmios" onChange={(v) => onPrefs('avisos_pontos', v)} />} />
          <Linha titulo="Promoções da loja" sub="Pode desligar quando quiser"
            direita={<Chave ligada={estado?.prefs.avisos_promocoes ?? false} rotulo="Promoções da loja" onChange={(v) => onPrefs('avisos_promocoes', v)} />} />
        </Lista>
        <p className="mx-6 mt-2 text-[11.5px] text-zinc-400">Aviso de aparelho novo sempre chega — é para a sua segurança.</p>
      </Secao>

      {(contato || onSalvarContato) && (
      <Secao titulo="Contato">
        <Lista className="mx-4">
          {contato && <Linha onClick={() => window.open(`https://wa.me/${contato}`, '_blank', 'noopener')} titulo="Falar com a loja" sub="Trocar celular, dúvidas, sair do clube" direita={<i className="ri-whatsapp-line text-lg text-emerald-600" />} />}
          {onSalvarContato && <Linha onClick={onSalvarContato} titulo="Salvar a loja nos contatos" sub="Para receber ofertas no WhatsApp" direita={<i className="ri-contacts-book-line text-lg text-zinc-400" />} />}
        </Lista>
      </Secao>
      )}

      <Secao titulo="Ajuda">
        <Lista className="mx-4">
          <Linha onClick={onComoFunciona} titulo="Como funciona o clube" />
          <Linha onClick={onSobre} titulo="Sobre o app" />
        </Lista>
      </Secao>
      <div className="px-4 mt-5"><Botao tipo="branco" onClick={onSair} className="!h-[46px] !text-sm text-zinc-600"><i className="ri-logout-box-r-line" />Sair deste celular</Botao></div>
    </>
  );
}
