import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useCardapio } from '@/contexts/CardapioContext';
import { inicioDosUltimos30Dias } from '../config';
import { useDeliveryTela } from '../DeliveryTela';
import QrCodeDelivery from '../QrCodeDelivery';
import {
  btn, brlInteiro, CaixaCopiar, Cartao, Colunas, Manchete, Nota, PaginaDelivery, SecaoTitulo, semAcento,
} from '../ui';

// Divulgar › Links e QR (protótipo docs/prototipos/delivery-proposta.html, T.links).
// 1) o link da loja + QR; 2) "um link para cada lugar" (utm_source) com os pedidos dos últimos 30 dias de
// cada origem; 3) link de um prato (só os que aparecem no delivery); 4) atalho do WhatsApp; 5) onde ficam
// os carrinhos abandonados (Clientes & Marketing).

/** Lugares onde a loja divulga o link. `aliases` = outras marcas que contam como o mesmo lugar. */
const LUGARES = [
  { chave: 'instagram', titulo: 'Bio do Instagram', icone: 'ri-instagram-line', tom: 'bg-violet-50 text-violet-600', aliases: ['ig'], qr: false },
  { chave: 'whatsapp', titulo: 'Status e grupos do WhatsApp', icone: 'ri-whatsapp-line', tom: 'bg-emerald-50 text-emerald-700', aliases: [] as string[], qr: false },
  { chave: 'google', titulo: 'Perfil no Google', icone: 'ri-google-line', tom: 'bg-blue-50 text-blue-600', aliases: [] as string[], qr: false },
  { chave: 'panfleto', titulo: 'Panfleto e QR do balcão', icone: 'ri-qr-code-line', tom: 'bg-amber-50 text-amber-700', aliases: [] as string[], qr: true },
];

/** Marca que o ERPOS ou outra ferramenta põe sozinha → nome que a pessoa entende. */
const NOMES_ORIGEM: Record<string, string> = {
  whatsapp_bot: 'Assistente do WhatsApp',
  meta: 'Anúncios da Meta',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  site: 'Site',
  bio: 'Link da bio',
};
const nomeOrigem = (k: string) => NOMES_ORIGEM[k] ?? k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Marca → lugar a que pertence (o próprio Instagram marca `ig`). */
const ALIAS: Record<string, string> = Object.fromEntries(LUGARES.flatMap((l) => l.aliases.map((a): [string, string] => [a, l.chave])));

interface Soma { pedidos: number; valor: number }
interface Origens { sem: Soma; por: Record<string, Soma> }
interface LinhaPedido { status: string | null; delivery_source: string | null; total_amount: number | string | null }

function somarOrigens(linhas: LinhaPedido[]): Origens {
  const out: Origens = { sem: { pedidos: 0, valor: 0 }, por: {} };
  for (const l of linhas) {
    const st = String(l.status ?? '').toLowerCase();
    // Cancelado não conta; "draft" é pedido esperando o Pix pelo app (ainda não é pedido de verdade).
    if (st.includes('cancel') || st === 'draft') continue;
    const bruta = String(l.delivery_source ?? '').trim().toLowerCase();
    const valor = Number(l.total_amount ?? 0) || 0;
    if (!bruta) { out.sem.pedidos += 1; out.sem.valor += valor; continue; }
    const chave = ALIAS[bruta] ?? bruta;
    const s = out.por[chave] ?? { pedidos: 0, valor: 0 };
    s.pedidos += 1; s.valor += valor;
    out.por[chave] = s;
  }
  return out;
}

/** Pedidos do delivery próprio dos últimos 30 dias (dia de hoje em Brasília + 29 antes). */
async function lerPedidos30d(tenantId: string): Promise<LinhaPedido[]> {
  const desde = inicioDosUltimos30Dias();
  const tudo: LinhaPedido[] = [];
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, delivery_source, total_amount')
      .eq('tenant_id', tenantId)
      .eq('origin_type', 'delivery')
      // Entrega lançada no caixa não grava a plataforma (nulo): conta como delivery próprio, sem origem.
      .or('delivery_platform.is.null,delivery_platform.in.(propria,retirada)')
      .eq('is_training', false)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as LinhaPedido[];
    tudo.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return tudo;
}

const comParametro = (url: string, nome: string, valor: string) => `${url}${url.includes('?') ? '&' : '?'}${nome}=${encodeURIComponent(valor)}`;
const slugTexto = (t: string) => semAcento(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Botão Copiar compacto (avisa "Copiado"). */
function BotaoCopiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  const copiar = () => {
    navigator.clipboard.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1600); }).catch(() => {});
  };
  return (
    <button type="button" onClick={copiar} className={btn('out', 'sm')}>
      <i className={ok ? 'ri-check-line text-emerald-600' : 'ri-file-copy-line'} />{ok ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export default function LinksAba() {
  const { tenantId, slug, linkDelivery, ehDono, irPara } = useDeliveryTela();
  const { itens, categorias, loading: cardapioCarregando, erroCarregamento } = useCardapio();

  // ── pedidos por origem (30 dias) ──
  const [origens, setOrigens] = useState<Origens | null>(null);
  const [carregandoOrigens, setCarregandoOrigens] = useState(true);
  const [erroOrigens, setErroOrigens] = useState('');
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setCarregandoOrigens(true); setErroOrigens(''); setOrigens(null);
    lerPedidos30d(tenantId)
      .then((l) => { if (vivo) setOrigens(somarOrigens(l)); })
      .catch((e) => { if (vivo) setErroOrigens(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setCarregandoOrigens(false); });
    return () => { vivo = false; };
  }, [tenantId, tentativa]);

  const conhecidas = useMemo(() => new Set(LUGARES.map((l) => l.chave)), []);
  const outras = useMemo(
    () => Object.entries(origens?.por ?? {}).filter(([k]) => !conhecidas.has(k)).sort((a, b) => b[1].pedidos - a[1].pedidos),
    [origens, conhecidas],
  );

  const [qrAberto, setQrAberto] = useState<string | null>(null);

  // ── divulgar um prato ──
  // Mesma regra do cardápio do cliente (delivery-write get_delivery_config): item ativo, categoria ativa e
  // delivery_config.ativo diferente de false. Item "só na casa" (delivery desligado) não entra.
  const categoriasAtivas = useMemo(() => new Map(categorias.filter((c) => c.ativo).map((c) => [c.id, c.nome])), [categorias]);
  const pratos = useMemo(
    () => itens
      .filter((i) => i.status === 'ativo' && i.delivery?.ativo !== false && categoriasAtivas.has(i.categoriaId))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [itens, categoriasAtivas],
  );
  const [busca, setBusca] = useState('');
  const [pratoId, setPratoId] = useState<string | null>(null);
  const escolhido = pratos.find((p) => p.id === pratoId) ?? null;
  const termo = semAcento(busca);
  const achados = useMemo(() => (termo ? pratos.filter((p) => semAcento(p.nome).includes(termo)) : []), [pratos, termo]);
  const foraDoDelivery = useMemo(() => {
    if (!termo || achados.length > 0) return null;
    return itens.find((i) => i.status === 'ativo' && semAcento(i.nome).includes(termo)) ?? null;
  }, [itens, termo, achados.length]);
  const LIMITE = 8;

  const linkPrato = escolhido ? `${linkDelivery}${linkDelivery.includes('?') ? '&' : '?'}item=${encodeURIComponent(escolhido.id)}` : '';

  const reTentar = useCallback(() => setTentativa((t) => t + 1), []);

  return (
    <PaginaDelivery>
      <Colunas>
        {/* ── Coluna 1: link da loja e um link para cada lugar ── */}
        <div className="space-y-4 min-w-0">
          <Manchete titulo="Seu link de pedidos">
            Compartilhe este link com seus clientes
            {slug ? <span className="text-amber-600 font-semibold"> — Loja: {slug}</span> : null}
          </Manchete>
          <div>
            <CaixaCopiar texto={linkDelivery} destaque />
            <QrCodeDelivery url={linkDelivery} nomeArquivo={`qrcode-delivery-${slug || 'loja'}`} titulo="QR Code do delivery" texto="Vitrine, embalagem, mesa e Instagram. Abre o cardápio da loja." />
          </div>

          <div>
            <SecaoTitulo titulo="Um link para cada lugar" />
            <p className="text-[13px] text-zinc-500 -mt-1 mb-3 leading-relaxed">
              Mesmo cardápio. Cada link conta os pedidos que vieram dele nos últimos 30 dias.
            </p>

            {erroOrigens && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-[13px] text-red-700">
                Não consegui contar os pedidos de cada link: {erroOrigens}
                <div className="mt-2"><button type="button" className={btn('out', 'sm')} onClick={reTentar}>Tentar de novo</button></div>
              </div>
            )}

            <div className="space-y-2">
              {LUGARES.map((l) => {
                const link = comParametro(linkDelivery, 'utm_source', l.chave);
                const s = origens?.por[l.chave];
                return (
                  <div key={l.chave} className="bg-white border border-zinc-200 rounded-2xl px-3.5 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${l.tom}`}><i className={`${l.icone} text-lg`} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-extrabold text-zinc-900 leading-snug">{l.titulo}</p>
                        <p className="text-xs text-zinc-500 mt-0.5 leading-snug">
                          {carregandoOrigens ? 'Contando os pedidos…'
                            : erroOrigens || !origens ? 'Sem a contagem agora'
                            : s && s.pedidos > 0
                              ? <><b className="text-emerald-700">{s.pedidos} {s.pedidos === 1 ? 'pedido' : 'pedidos'}</b> em 30 dias · {brlInteiro(s.valor)}</>
                              : 'Nenhum pedido em 30 dias'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {l.qr && (
                          <button type="button" onClick={() => setQrAberto((a) => (a === l.chave ? null : l.chave))}
                            aria-label="Mostrar o QR Code" title="QR Code" aria-pressed={qrAberto === l.chave}
                            className={`${btn('out', 'sm')} !px-2.5 ${qrAberto === l.chave ? '!bg-zinc-900 !text-white !border-zinc-900' : ''}`}>
                            <i className="ri-qr-code-line text-base" />
                          </button>
                        )}
                        <BotaoCopiar texto={link} />
                      </div>
                    </div>
                    {l.qr && qrAberto === l.chave && (
                      <QrCodeDelivery url={link} nomeArquivo={`qrcode-${l.chave}-${slug || 'loja'}`} titulo="QR do panfleto e do balcão" texto="Conta os pedidos que vieram do papel." />
                    )}
                  </div>
                );
              })}
            </div>

            {origens && (
              <div className="mt-3 bg-white border border-zinc-200 rounded-2xl px-4 py-3">
                <p className="text-[13px] text-zinc-800">
                  <b>Pedidos sem origem: {origens.sem.pedidos}</b>{' '}
                  <span className="text-zinc-500">(link sem marca e entrega lançada no caixa)</span>
                </p>
                {outras.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-zinc-100">
                    <p className="text-[11px] font-bold text-zinc-400 mb-1.5">Outras origens</p>
                    <ul className="space-y-1">
                      {outras.map(([k, s]) => (
                        <li key={k} className="flex items-baseline gap-2 text-[13px]">
                          <span className="flex-1 min-w-0 truncate font-semibold text-zinc-800">{nomeOrigem(k)}</span>
                          <span className="text-xs text-zinc-500 whitespace-nowrap">
                            {s.pedidos} {s.pedidos === 1 ? 'pedido' : 'pedidos'} · {brlInteiro(s.valor)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Coluna 2: prato, WhatsApp, carrinho abandonado ── */}
        <div className="space-y-4 min-w-0">
          <div>
            <SecaoTitulo titulo="Divulgar um prato" />
            <Cartao>
              <p className="text-[13px] text-zinc-600 leading-snug mb-2.5">
                Abre direto no prato, pronto para pôr na sacola. Só aparecem os pratos que estão no delivery.
              </p>

              {erroCarregamento ? (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-[13px] text-red-700">
                  Não consegui abrir o cardápio: {erroCarregamento}
                </div>
              ) : cardapioCarregando ? (
                <p className="text-xs text-zinc-400 flex items-center gap-1.5"><i className="ri-loader-4-line animate-spin" />Carregando o cardápio…</p>
              ) : (
                <>
                  <div className="relative">
                    <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
                      placeholder={`Buscar entre ${pratos.length} ${pratos.length === 1 ? 'prato' : 'pratos'} do delivery`}
                      aria-label="Buscar prato"
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 bg-white text-[13.5px] text-zinc-900 outline-none focus:border-amber-400"
                    />
                  </div>

                  {termo ? (
                    achados.length > 0 ? (
                      <div className="mt-2 border border-zinc-100 rounded-xl divide-y divide-zinc-100 overflow-hidden">
                        {achados.slice(0, LIMITE).map((p) => (
                          <button key={p.id} type="button" onClick={() => { setPratoId(p.id); setBusca(''); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-amber-50 cursor-pointer">
                            <span className="flex-1 min-w-0">
                              <span className="block text-[13.5px] font-bold text-zinc-900 truncate">{p.nome}</span>
                              <span className="block text-[11px] text-zinc-400 truncate">{categoriasAtivas.get(p.categoriaId)}</span>
                            </span>
                            <i className="ri-arrow-right-s-line text-zinc-300" />
                          </button>
                        ))}
                        {achados.length > LIMITE && (
                          <p className="px-3 py-2 text-[11px] text-zinc-400 bg-zinc-50">Mostrando {LIMITE} de {achados.length}. Escreva mais do nome para achar o seu.</p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500 leading-snug">
                        {foraDoDelivery
                          ? <>“{foraDoDelivery.nome}” está no cardápio, mas não aparece no delivery. Ligue o delivery nele em Cardápio para poder divulgar.</>
                          : 'Nenhum prato do delivery com esse nome.'}
                      </p>
                    )
                  ) : escolhido ? (
                    <div className="mt-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0"><i className="ri-restaurant-2-line" /></span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-extrabold text-zinc-900 truncate">{escolhido.nome}</p>
                          <p className="text-[11px] text-zinc-400 truncate">{categoriasAtivas.get(escolhido.categoriaId)}</p>
                        </div>
                        <button type="button" onClick={() => setPratoId(null)} className={btn('ghost', 'sm')}>Trocar</button>
                      </div>
                      <CaixaCopiar texto={linkPrato} />
                      <QrCodeDelivery url={linkPrato} nomeArquivo={`prato-${slug || 'loja'}-${slugTexto(escolhido.nome) || 'item'}`} titulo="QR Code do prato" texto="Abre direto no prato, pronto para pôr na sacola." />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-zinc-400">Digite o nome do prato para gerar o link e o QR Code dele.</p>
                  )}
                </>
              )}
            </Cartao>
          </div>

          {ehDono && (
            <Cartao>
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0"><i className="ri-whatsapp-line text-lg" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold text-zinc-900">Link do WhatsApp</p>
                  <p className="text-xs text-zinc-500 mt-0.5 leading-snug">Quem toca cai na conversa com o assistente. Fica em WhatsApp › Assistente.</p>
                </div>
                <button type="button" onClick={() => irPara('assistente')} className={btn('out', 'sm')}>Abrir</button>
              </div>
            </Cartao>
          )}

          <Cartao>
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0"><i className="ri-shopping-bag-3-line text-lg" /></span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-zinc-900">Quem montou a sacola e não pediu</p>
                <p className="text-xs text-zinc-500 mt-0.5 leading-snug">
                  Essas pessoas, e o cupom para elas, ficam em Clientes &amp; Marketing › Funil › Visitas sem pedido.
                </p>
              </div>
            </div>
            <div className="mt-2.5">
              <Link to="/clientes?aba=funil" className={btn('out', 'sm')}>
                Abrir Clientes &amp; Marketing<i className="ri-arrow-right-line" />
              </Link>
            </div>
          </Cartao>

          <Nota>Os pedidos de cada link vêm da marca <code>?utm_source=</code> que vai junto. Pedido do caixa lançado como entrega também cai em "sem origem".</Nota>
        </div>
      </Colunas>
    </PaginaDelivery>
  );
}
