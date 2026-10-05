import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { confirmar } from '@/components/base/Dialogos';
import { invokeWithAuth } from '@/lib/supabase';
import { ifoodShipping, type IfoodShippingConfig } from '@/lib/ifoodShipping';
import { chaveComplementoIfood, chaveItemIfood, custoDoComplemento, custoDoItem } from '@/lib/ifoodArea';
import { custosIfood, fetchOrders } from '../lib/useIfoodDados';
import { CaixaCopiar, Cartao, Colunas, Folha, Interruptor, Manchete, btn, Etiqueta, Nota, SecaoTitulo } from '@/pages/config-delivery/ui';
import { brl } from '@/components/kit';
import IfoodConfigModal from '@/pages/financeiro/components/conciliacao/IfoodConfigModal';
import IfoodEntregaConfigModal from '@/pages/gestor-entregas/components/IfoodEntregaConfigModal';
import { nomeLoja, type AbaProps } from '../lib/tipos';

// Conectar e ligar (protótipo docs/prototipos/ifood-proposta.html › Conectar e ligar). Junta numa tela o que hoje
// está em duas janelas: Conciliação › iFood (dinheiro, edge ifood-financial) e Gestor de Entregas › iFood Entrega
// (pedidos, entrega e loja, edge ifood-shipping). As duas janelas continuam acessíveis em "Mais opções".
// Modo homologação, app de teste e Client ID ficam só dentro delas.

interface FinMerchant { merchant_id: string; merchant_short: string | null; name: string | null; api_sync: boolean; authorized: boolean; last_sync_at: string | null; last_sync_error: string | null }
interface FinConfig { authorized: boolean; auto_sync: boolean; post_to_ledger: boolean; user_code?: string | null; verification_url?: string | null; merchants?: FinMerchant[] }

type Modo = 'read_only' | 'funnel' | 'operate';
type SituacaoLoja = 'ligada' | 'ligar' | 'autorizar' | 'outra';
/** O iFood exige dois apps: Pedidos (ERPOS PDV, chegam na hora) e Dinheiro (ERPOS, taxas e repasse no dia seguinte). Aqui parece uma conexão só. */
type Etapa = 'pedidos' | 'dinheiro';

const curto = (n: string) => { const i = n.indexOf(' - '); return i >= 0 ? n.slice(i + 3).trim() || n : n; };

/** Itens (e complementos com preço) vendidos nos últimos 30 dias que ainda não têm ficha ligada. */
async function contarSemFicha(tenantId: string): Promise<number | null> {
  try {
    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [pedidos, custos] = await Promise.all([fetchOrders(tenantId, desde, new Date().toISOString()), custosIfood(tenantId)]);
    const faltam = new Set<string>();
    for (const p of pedidos) {
      if (p.status === 'cancelled') continue;
      for (const it of p.itens) {
        if (!custoDoItem(custos.mapa, it.nome)) faltam.add(chaveItemIfood(it.nome));
        for (const c of it.complementos) if (c.preco > 0.005 && !custoDoComplemento(custos.mapa, c.nome, c.grupo)) faltam.add(chaveComplementoIfood(c.nome, c.grupo));
      }
    }
    return faltam.size;
  } catch {
    return null;
  }
}

export default function ConexaoAba({ tenantId, lojas, dados }: AbaProps) {
  const { user } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [cfg, setCfg] = useState<IfoodShippingConfig | null>(null);
  const [fin, setFin] = useState<FinConfig | null>(null);
  const [podeEditar, setPodeEditar] = useState(true);
  const [lojaLiberada, setLojaLiberada] = useState<boolean | null>(null); // módulo Loja do iFood responde?
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [modalDinheiro, setModalDinheiro] = useState(false);
  const [modalEntrega, setModalEntrega] = useState(false);

  // Folha "Autorizar <loja>": faz em sequência só o que falta (pedidos e dinheiro).
  const [autorizando, setAutorizando] = useState<{ id: string; nome: string; etapas: Etapa[] } | null>(null);
  const [codigo, setCodigo] = useState<{ etapa: Etapa; code: string; url: string | null } | null>(null);
  const [authCode, setAuthCode] = useState('');
  const [folhaBusy, setFolhaBusy] = useState('');
  const [folhaMsg, setFolhaMsg] = useState<{ tom: 'ok' | 'aviso' | 'erro'; t: string } | null>(null);

  const lerCfg = useCallback(async () => {
    const r = await ifoodShipping<{ config: IfoodShippingConfig | null; can_edit?: boolean }>('get_config', tenantId);
    if (!r.success) { setErroCarga(r.error || 'Não deu para ler a conexão agora.'); return null; }
    setErroCarga('');
    setCfg(r.config); setPodeEditar(r.can_edit !== false);
    return r.config;
  }, [tenantId]);

  const lerFin = useCallback(async () => {
    const r = await invokeWithAuth<{ config?: FinConfig | null }>('ifood-financial', { body: { action: 'get_config', tenant_id: tenantId } });
    setFin(r.data?.config ?? null);
  }, [tenantId]);

  const carregar = useCallback(async () => {
    const c = await lerCfg();
    await lerFin();
    // Loja e avaliações: o módulo Loja do iFood ainda pode estar esperando liberação. Só confere com uma loja autorizada.
    const m = (c?.merchants ?? []).find((x) => !x.outra_loja);
    if (m) {
      const ov = await ifoodShipping<{ status: unknown; interruptions: unknown; opening_hours: unknown }>('merchant_overview', tenantId, { merchant_id: m.id });
      setLojaLiberada(ov.success && (ov.status != null || ov.interruptions != null || ov.opening_hours != null));
    } else setLojaLiberada(null);
    setCarregando(false);
  }, [lerCfg, lerFin, tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  /** Chama o ifood-shipping; devolve a resposta ou null (e já avisa o erro). */
  const run = async (key: string, action: string, extra: Record<string, unknown>, sucesso?: string) => {
    setMsg(null); setBusy(key);
    const r = await ifoodShipping<Record<string, unknown>>(action, tenantId, extra);
    setBusy('');
    if (!r.success) { setMsg({ ok: false, t: r.error || 'Não deu certo.' }); return null; }
    // aviso = salvou, mas com ressalva (ex.: loja do iFood de outra loja do ERPOS não foi ligada).
    if (r.aviso) setMsg({ ok: false, t: String(r.aviso) });
    else if (sucesso) setMsg({ ok: true, t: sucesso });
    await lerCfg();
    return r;
  };

  // ── Lojas ──
  const lista = useMemo(() => {
    const ids = new Map<string, string>();
    for (const l of lojas) ids.set(l.id, l.nome);
    for (const m of cfg?.merchants ?? []) if (!ids.has(m.id)) ids.set(m.id, m.name);
    for (const m of fin?.merchants ?? []) if (!ids.has(m.merchant_id)) ids.set(m.merchant_id, m.name ?? m.merchant_id.slice(0, 8));
    return [...ids.entries()].map(([id, nome]) => {
      const m = cfg?.merchants.find((x) => x.id === id);
      const f = fin?.merchants?.find((x) => x.merchant_id === id);
      const nomeFinal = nomeLoja(lojas, id) !== 'Loja iFood' ? nomeLoja(lojas, id) : nome;
      const ligadaPedidos = !!cfg?.order_enabled && (cfg?.order_merchant_ids ?? []).includes(id);
      const situacao: SituacaoLoja = m?.outra_loja ? 'outra' : ligadaPedidos ? 'ligada' : m ? 'ligar' : 'autorizar';
      return { id, nome: nomeFinal, curto: curto(nomeFinal), short: f?.merchant_short ?? null, outra: m?.outra_loja ?? null, situacao, dinheiro: !!f && f.api_sync && f.authorized };
    });
  }, [lojas, cfg, fin]);

  const faltamPedidos = lista.filter((l) => l.situacao === 'ligar' || l.situacao === 'autorizar');
  const faltamDinheiro = lista.filter((l) => l.situacao !== 'outra' && !l.dinheiro);
  const lojasLigadas = lista.filter((l) => l.situacao === 'ligada' || l.dinheiro);
  const conectado = lojasLigadas.length;

  // ── Autorizar uma loja (passo a passo único: pedidos e dinheiro, só o que falta) ──
  const pendencias = (l: { situacao: SituacaoLoja; dinheiro: boolean }): Etapa[] => {
    if (l.situacao === 'outra') return [];
    const e: Etapa[] = [];
    if (l.situacao !== 'ligada') e.push('pedidos');
    if (!l.dinheiro) e.push('dinheiro');
    return e;
  };
  const abrirAutorizar = (l: { id: string; nome: string; situacao: SituacaoLoja; dinheiro: boolean }) => {
    setAutorizando({ id: l.id, nome: l.nome, etapas: pendencias(l) });
    setCodigo(null); setAuthCode(''); setFolhaMsg(null);
  };
  const feita = (e: Etapa, id: string) => {
    const l = lista.find((x) => x.id === id);
    return !!l && (e === 'pedidos' ? l.situacao === 'ligada' : l.dinheiro);
  };
  const etapaAtual: Etapa | null = autorizando ? autorizando.etapas.find((e) => !feita(e, autorizando.id)) ?? null : null;
  const lojaAutorizando = autorizando ? lista.find((l) => l.id === autorizando.id) ?? null : null;
  // Código que já estava gerado (e ainda vale) para a etapa de agora.
  const codigoDaEtapa: { etapa: Etapa; code: string; url: string | null } | null = etapaAtual && codigo?.etapa === etapaAtual ? codigo
    : etapaAtual === 'pedidos' && cfg?.user_code ? { etapa: 'pedidos', code: cfg.user_code, url: cfg.verification_url }
    : etapaAtual === 'dinheiro' && fin?.user_code ? { etapa: 'dinheiro', code: fin.user_code, url: fin.verification_url ?? null }
    : null;

  const gerarCodigo = async () => {
    if (!etapaAtual) return;
    setFolhaBusy('code'); setFolhaMsg(null);
    let code = '', url: string | null = null, erro = '';
    if (etapaAtual === 'pedidos') {
      const r = await ifoodShipping<{ user_code?: string; verification_url?: string | null }>('request_user_code', tenantId, {});
      if (r.success) { code = String(r.user_code); url = r.verification_url ?? null; } else erro = r.error || '';
    } else {
      const r = await invokeWithAuth<{ success?: boolean; error?: string; user_code?: string; verification_url?: string | null }>('ifood-financial', { body: { action: 'request_user_code', tenant_id: tenantId } });
      if (r.data?.success && r.data.user_code) { code = r.data.user_code; url = r.data.verification_url ?? null; } else erro = r.data?.error ?? r.error?.message ?? '';
    }
    setFolhaBusy('');
    if (!code) { setFolhaMsg({ tom: 'erro', t: erro || 'Não deu para gerar o código.' }); return; }
    setCodigo({ etapa: etapaAtual, code, url });
  };

  /** Fim de uma etapa: diz o que aconteceu e o que vem agora. */
  const depoisDaEtapa = (etapa: Etapa, nome: string, restantes: Etapa[]) => {
    const proxima = restantes.find((e) => e !== etapa);
    setFolhaMsg({ tom: 'ok', t: proxima
      ? `${etapa === 'pedidos' ? `Pedidos de ${curto(nome)} ligados.` : `Dinheiro de ${curto(nome)} ligado.`} Falta só ${proxima === 'dinheiro' ? 'o código do dinheiro' : 'o código dos pedidos'}.`
      : `Pronto! ${curto(nome)} está conectada: os pedidos entram no ERPOS e o dinheiro é buscado todo dia.` });
  };

  const jaColei = async () => {
    if (!autorizando || !etapaAtual) return;
    const etapa = etapaAtual;
    const alvo = autorizando;
    const restantes = alvo.etapas.filter((e) => !feita(e, alvo.id));
    setFolhaBusy('auth'); setFolhaMsg(null);

    if (etapa === 'dinheiro') {
      const r = await invokeWithAuth<{ success?: boolean; error?: string; merchants?: FinMerchant[]; authorized_now?: string[]; new_merchants?: string[] }>('ifood-financial', { body: { action: 'confirm_authorization', tenant_id: tenantId, authorization_code: authCode.trim() } });
      const err = r.data?.error ?? r.error?.message;
      if (err || !r.data?.success) { setFolhaBusy(''); setFolhaMsg({ tom: 'erro', t: err || 'O iFood não aceitou o código.' }); return; }
      setAuthCode(''); setCodigo(null);
      const d = r.data;
      const m = (d.merchants ?? []).find((x) => x.merchant_id === alvo.id);
      // Autorização que só trouxe lojas já conectadas: o código foi digitado com outra loja selecionada no portal.
      if (!m?.authorized) {
        await lerFin(); setFolhaBusy('');
        setFolhaMsg({ tom: 'aviso', t: d.new_merchants && d.new_merchants.length === 0
          ? `Essa autorização trouxe só loja(s) que já estavam conectadas (${(d.authorized_now ?? []).join(', ') || 'nenhuma'}). No Portal do Parceiro, troque para ${curto(alvo.nome)} (seletor de loja no topo), gere um código novo aqui e repita.`
          : `Essa autorização não trouxe ${curto(alvo.nome)}. No Portal do Parceiro, troque para essa loja (seletor de loja no topo), gere um código novo aqui e repita.` });
        return;
      }
      if (!m.api_sync) {
        const s = await invokeWithAuth<{ success?: boolean; error?: string }>('ifood-financial', { body: { action: 'set_merchant_api', tenant_id: tenantId, merchant_id: alvo.id, on: true } });
        const e2 = s.data?.error ?? s.error?.message;
        if (e2 || !s.data?.success) { await lerFin(); setFolhaBusy(''); setFolhaMsg({ tom: 'aviso', t: e2 || 'Autorizou, mas não deu para ligar a busca do dinheiro.' }); return; }
      }
      await lerFin(); setFolhaBusy('');
      depoisDaEtapa('dinheiro', alvo.nome, restantes);
      return;
    }

    // Pedidos (ifood-shipping): confirma, relê as lojas que a autorização enxerga e liga os pedidos da loja.
    const r = await ifoodShipping<{ merchants?: { id: string; name: string }[]; aviso?: string | null }>('confirm_authorization', tenantId, { authorization_code: authCode.trim() });
    if (!r.success) { setFolhaBusy(''); setFolhaMsg({ tom: 'erro', t: r.error || 'O iFood não aceitou o código.' }); return; }
    setAuthCode(''); setCodigo(null);
    const rf = await ifoodShipping<{ total?: number; aviso?: string | null }>('refresh_merchants', tenantId, {});
    const nova = await lerCfg();
    const achou = (nova?.merchants ?? []).find((m) => m.id === alvo.id);
    if (achou && !achou.outra_loja) {
      const ids = [...new Set([...(nova?.order_merchant_ids ?? []), achou.id])];
      const s = await ifoodShipping<{ aviso?: string | null }>('set_options', tenantId, { order_enabled: true, order_merchant_ids: ids });
      await lerCfg(); setFolhaBusy('');
      if (s.success && !s.aviso) depoisDaEtapa('pedidos', alvo.nome, restantes);
      else setFolhaMsg({ tom: 'aviso', t: s.aviso || s.error || 'Autorizou, mas não deu para ligar os pedidos. Tente de novo.' });
      return;
    }
    setFolhaBusy('');
    if (achou?.outra_loja) setFolhaMsg({ tom: 'aviso', t: `${curto(alvo.nome)} já é da loja "${achou.outra_loja}" no ERPOS e não pode ser ligada aqui.` });
    else if ((nova?.merchants ?? []).length > 0) setFolhaMsg({ tom: 'aviso', t: `Essa autorização não trouxe ${curto(alvo.nome)}. No Portal do Parceiro, troque para a loja que falta (seletor de loja no topo), gere um código novo aqui e repita.` });
    else setFolhaMsg({ tom: 'aviso', t: rf.aviso || r.aviso || 'O iFood aceitou, mas a loja ainda não apareceu. Pode levar alguns minutos para aparecer.' });
  };

  const atualizarLojas = async () => {
    setFolhaBusy('refresh'); setFolhaMsg(null);
    const rf = await ifoodShipping<{ total?: number; aviso?: string | null }>('refresh_merchants', tenantId, {});
    const nova = await lerCfg();
    setFolhaBusy('');
    if (!rf.success) { setFolhaMsg({ tom: 'erro', t: rf.error || 'Não deu para atualizar.' }); return; }
    const achou = (nova?.merchants ?? []).find((m) => m.id === autorizando?.id);
    setFolhaMsg(achou
      ? { tom: 'ok', t: `${curto(autorizando?.nome ?? 'A loja')} apareceu. Toque em "Ligar pedidos" para continuar.` }
      : { tom: 'aviso', t: rf.aviso || 'Ainda não apareceu. Loja recém-autorizada pode levar alguns minutos — espere um pouco e atualize de novo.' });
  };

  const ligarPedidos = async (id: string, nome: string) => {
    const ids = [...new Set([...(cfg?.order_merchant_ids ?? []), id])];
    await run('ligar' + id, 'set_options', { order_enabled: true, order_merchant_ids: ids }, `Pedidos de ${curto(nome)} ligados.`);
  };

  // ── O que fazer com os pedidos ──
  const escolherModo = async (modo: Modo) => {
    if (!cfg || cfg.order_mode === modo) return;
    if (modo === 'funnel') {
      setBusy('modo');
      const n = await contarSemFicha(tenantId);
      setBusy('');
      const ok = await confirmar({
        titulo: 'Entrar na cozinha do ERPOS?',
        mensagem: `A partir de agora os pedidos novos do iFood caem no Gestor de pedidos e na impressora da cozinha como qualquer delivery, baixam o estoque pela ficha, e "Pronto/Saiu" vai sozinho para o iFood. ${n == null ? '' : n === 0 ? 'Todos os itens vendidos já têm ficha. ' : `Faltam ${n} ${n === 1 ? 'item' : 'itens'} ligados à ficha (sem ficha não baixa o estoque desse item). `}A loja só abre no iFood depois de abrir o caixa no ERPOS.`,
        confirmarLabel: 'Entrar na cozinha',
      });
      if (!ok) return;
    }
    await run('modo', 'set_options', { order_mode: modo }, modo === 'funnel' ? 'Os pedidos do iFood entram no ERPOS a partir de agora.' : 'Modo dos pedidos salvo.');
  };

  const mostrarOperar = cfg?.order_mode === 'operate' || (user?.loja ?? '').trim().toLowerCase() === 'testes pdv';
  const emFunil = cfg?.order_mode === 'funnel';

  // ── Lançar no financeiro ──
  const mudarLedger = async (on: boolean) => {
    if (!on && !(await confirmar({
      titulo: 'Tirar o iFood do financeiro?',
      mensagem: 'Os lançamentos do iFood (vendas e taxas) são removidos da DRE, de Receitas e do Fluxo de Caixa. Os relatórios importados continuam.',
      confirmarLabel: 'Tirar', perigo: true,
    }))) return;
    setBusy('ledger'); setMsg(null);
    const r = await invokeWithAuth<{ success?: boolean; error?: string; ledger?: { rows: number; receita: number; taxas: number } }>('ifood-financial', { body: { action: 'set_options', tenant_id: tenantId, post_to_ledger: on } });
    setBusy('');
    const err = r.data?.error ?? r.error?.message;
    if (err || !r.data?.success) { setMsg({ ok: false, t: err || 'Não deu certo.' }); return; }
    setMsg({ ok: true, t: on ? `Lançado no financeiro: vendas ${brl(r.data.ledger?.receita ?? 0)} e taxas ${brl(r.data.ledger?.taxas ?? 0)} dos repasses já pagos. Os próximos entram sozinhos na data do repasse.` : 'Lançamentos do iFood removidos do financeiro.' });
    await lerFin();
  };

  if (carregando) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;

  const finLigadas = (fin?.merchants ?? []).filter((m) => m.api_sync && m.authorized);
  const nomeFin = (m: FinMerchant) => curto(nomeLoja(lojas, m.merchant_id) !== 'Loja iFood' ? nomeLoja(lojas, m.merchant_id) : m.name ?? m.merchant_id.slice(0, 8));
  const detalheDinheiro = lista.length === 0 ? 'Ainda não conectado.' : `${lista.filter((l) => l.situacao !== 'outra').map((l) => (l.dinheiro ? `${l.curto} ✓` : `${l.curto} falta autorizar`)).join(' · ')}${finLigadas.length ? (fin?.auto_sync !== false ? ' · busca todo dia às 7h' : ' · busca automática desligada') : ''}`;
  const detalhePedidos = lista.length === 0 ? 'Nenhuma loja do iFood encontrada.' : lista.map((l) => (
    l.situacao === 'ligada' ? `${l.curto} ✓` : l.situacao === 'outra' ? `${l.curto} é de outra loja` : `${l.curto} falta autorizar`
  )).join(' · ');
  const entregaLiberada = lojaLiberada === true;

  const faltaAlgo = [...new Map([...faltamPedidos, ...faltamDinheiro].map((l) => [l.id, l])).values()];
  const subtitulo = faltaAlgo.length
    ? `Falta autorizar ${faltaAlgo.map((l) => l.curto).join(' e ')} ${faltamPedidos.length ? 'para os pedidos e o dinheiro chegarem aqui' : 'para o dinheiro chegar aqui'}.`
    : 'Uma tela para ligar tudo.';

  return (
    <div className="space-y-4">
      <Manchete titulo={conectado > 0 ? `iFood conectado em ${conectado} ${conectado === 1 ? 'loja' : 'lojas'}` : 'iFood ainda não conectado'}>{subtitulo}</Manchete>

      {erroCarga && <p className="text-[12.5px] font-semibold rounded-xl border px-3 py-2 text-red-600 bg-red-50 border-red-100">{erroCarga}</p>}
      {msg && <p className={`text-[12.5px] font-semibold rounded-xl border px-3 py-2 ${msg.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-amber-900 bg-amber-50 border-amber-200'}`}>{msg.t}</p>}

      <Colunas>
        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Linha icone="ri-money-dollar-circle-line" titulo="Dinheiro (repasses e taxas)" detalhe={detalheDinheiro}
              direita={lista.length === 0
                ? <button className={btn('p', 'sm')} onClick={() => setModalDinheiro(true)}>Conectar</button>
                : faltamDinheiro.length === 0 ? <Selo tom="ligado" />
                : (
                  <div className="flex flex-col gap-1.5 items-end">
                    {podeEditar && faltamDinheiro.filter((l) => l.situacao === 'ligada').map((l) => (
                      <button key={l.id} disabled={!!busy} className={btn('p', 'sm')} onClick={() => abrirAutorizar(l)}>Autorizar {l.curto}</button>
                    ))}
                    {!faltamDinheiro.some((l) => l.situacao === 'ligada') && <Selo tom="falta" />}
                  </div>
                )} />
            <Linha icone="ri-file-list-3-line" titulo="Pedidos e itens" detalhe={detalhePedidos}
              direita={lista.length === 0 ? (podeEditar ? <button className={btn('p', 'sm')} onClick={() => setModalEntrega(true)}>Conectar</button> : <Selo tom="falta" />)
                : faltamPedidos.length === 0 ? <Selo tom="ligado" /> : (
                  <div className="flex flex-col gap-1.5 items-end">
                    {podeEditar && faltamPedidos.map((l) => l.situacao === 'ligar'
                      ? <button key={l.id} disabled={!!busy} className={btn('p', 'sm')} onClick={() => ligarPedidos(l.id, l.nome)}>{busy === 'ligar' + l.id ? '…' : `Ligar ${l.curto}`}</button>
                      : <button key={l.id} disabled={!!busy} className={btn('p', 'sm')} onClick={() => abrirAutorizar(l)}>Autorizar {l.curto}</button>)}
                    {!podeEditar && <Selo tom="falta" />}
                  </div>
                )} />
            <Linha icone="ri-store-3-line" titulo="Loja e avaliações"
              detalhe={lojaLiberada === null ? 'Falta autorizar uma loja nos pedidos.' : entregaLiberada ? 'Situação, pausas, horário e avaliações na aba Loja.' : 'Esperando o iFood liberar.'}
              direita={entregaLiberada ? <Selo tom="ligado" /> : <Selo tom={lojaLiberada === null ? 'falta' : 'aguardando'} />} />
            <Linha icone="ri-e-bike-2-line" titulo="Entregador iFood no seu delivery"
              detalhe={!entregaLiberada ? 'Esperando o iFood liberar.' : cfg?.shipping_enabled ? `Ligado${cfg.shipping_merchant_name ? ` · despacha pela ${curto(cfg.shipping_merchant_name)}` : ''}.` : 'Desligado. Para ligar, abra "Opções de entrega e avançado".'}
              direita={entregaLiberada && cfg?.shipping_enabled ? <Selo tom="ligado" /> : <Selo tom={entregaLiberada ? 'falta' : 'aguardando'} />} />
          </div>

          <div>
            <SecaoTitulo titulo="Lojas do iFood desta loja" />
            <div className="space-y-2">
              {lista.length === 0 && <Nota>Nenhuma loja do iFood encontrada ainda.</Nota>}
              {lista.map((l) => (
                <Linha key={l.id} icone="ri-store-2-line" titulo={l.nome} detalhe={`${l.short ? `${l.short} · ` : ''}${l.situacao === 'ligada' ? 'pedidos ligados' : l.situacao === 'outra' ? `é da loja ${l.outra} no ERPOS` : l.situacao === 'ligar' ? 'autorizada, falta ligar os pedidos' : 'pedidos ainda não autorizados'}`}
                  direita={l.situacao === 'ligada' ? <Selo tom="ligado" texto="ligada" /> : l.situacao === 'outra' ? <Etiqueta tom="zinc">de outra loja</Etiqueta> : <Etiqueta tom="amber">falta 1 passo</Etiqueta>} />
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <SecaoTitulo titulo="O que fazer com os pedidos do iFood?" />
            {cfg && cfg.order_enabled === false && (
              <Nota className="mb-2">Os pedidos do iFood ainda não estão ligados nesta loja. Autorize as lojas ao lado para começar.</Nota>
            )}
            <div className="space-y-2">
              <Modo ativo={cfg?.order_mode === 'read_only'} titulo="Só acompanhar (como está hoje)" disabled={!podeEditar || !!busy || !cfg} onClick={() => escolherModo('read_only')}>
                Os pedidos aparecem aqui com itens e sobra. A cozinha continua no tablet/Gestor do iFood. Nada baixa estoque.
              </Modo>
              <Modo ativo={emFunil} titulo="Entrar na cozinha do ERPOS" disabled={!podeEditar || !!busy || !cfg} onClick={() => escolherModo('funnel')}>
                O pedido cai no Gestor de pedidos e na impressora da cozinha como qualquer delivery, baixa o estoque pela ficha, e &ldquo;Pronto/Saiu&rdquo; vai sozinho para o iFood. Precisa dos itens ligados à ficha.
                <span className="block mt-1 text-[11.5px] text-zinc-400">Lembrete: a loja só abre no iFood depois de abrir o caixa no ERPOS.</span>
              </Modo>
              {mostrarOperar && (
                <Modo ativo={cfg?.order_mode === 'operate'} titulo="Operar à mão" disabled={!podeEditar || !!busy || !cfg} onClick={() => escolherModo('operate')}>
                  Botões de confirmar, preparo, pronto e despachar na tela Pedidos iFood. Só para teste na loja de teste.
                </Modo>
              )}
            </div>
          </div>

          <Cartao className="space-y-3">
            {emFunil && (
              <Chave titulo="Aceitar sozinho" texto="Sem ninguém tocar · recomendado. Desligado: alguém aperta “Aceitar” antes do prazo do iFood." ligado={cfg?.order_auto_confirm === true}
                disabled={!podeEditar || !!busy} onChange={(v) => run('auto', 'set_options', { order_auto_confirm: v }, v ? 'Pedidos do iFood aceitos sozinhos.' : 'Pedidos do iFood esperam o Aceitar.')} />
            )}
            {emFunil && typeof cfg?.order_emit_nfce === 'boolean' && (
              <Chave titulo="Emitir NFC-e" texto="A nota sai quando o pedido é concluído no iFood e está pago. Confirme com a contadora antes de ligar." ligado={cfg.order_emit_nfce}
                disabled={!podeEditar || !!busy} onChange={(v) => run('nfce', 'set_options', { order_emit_nfce: v }, v ? 'NFC-e dos pedidos do iFood ligada.' : 'NFC-e dos pedidos do iFood desligada.')} />
            )}
            <Chave titulo="Lançar no financeiro" texto="Venda e taxas de cada repasse na DRE, em Receitas e no Fluxo de Caixa." ligado={fin?.post_to_ledger === true}
              disabled={!podeEditar || !!busy || !fin} onChange={mudarLedger} />
            {!fin && <p className="text-[11.5px] text-zinc-400">Conecte o dinheiro do iFood para poder lançar no financeiro.</p>}
          </Cartao>

          <div>
            <SecaoTitulo titulo="Mais opções" />
            <div className="flex flex-wrap gap-2">
              <button className={btn('out', 'sm')} onClick={() => setModalDinheiro(true)}><i className="ri-upload-2-line" /> Importar arquivo e opções do dinheiro</button>
              <button className={btn('out', 'sm')} onClick={() => setModalEntrega(true)}><i className="ri-settings-3-line" /> Opções de entrega e avançado</button>
            </div>
          </div>
        </div>
      </Colunas>

      {/* Autorizar uma loja: pedidos e dinheiro em sequência, só o que falta */}
      <Folha aberta={!!autorizando} titulo={`Autorizar ${autorizando ? curto(autorizando.nome) : 'a loja'}`}
        subtitulo="Uns 2 minutos por passo." onFechar={() => { setAutorizando(null); void carregar(); }}
        rodape={<button className={btn('out') + ' flex-1'} onClick={() => { setAutorizando(null); void carregar(); }}>{autorizando && !etapaAtual ? 'Fechar' : 'Cancelar'}</button>}>
        {autorizando && (
          <div className="space-y-4 pb-2">
            <Nota>O iFood pede dois códigos: um para os pedidos (chegam na hora) e um para o dinheiro (taxas e repasse, no dia seguinte).</Nota>

            {autorizando.etapas.map((e, i) => {
              const titulo = `${autorizando.etapas.length > 1 ? `Passo ${i + 1} de ${autorizando.etapas.length} · ` : ''}${e === 'pedidos' ? 'Pedidos (chegam na hora)' : 'Dinheiro (taxas e repasse)'}`;
              if (feita(e, autorizando.id)) {
                return <p key={e} className="text-[13.5px] font-extrabold text-emerald-700 flex items-center gap-1.5"><i className="ri-checkbox-circle-fill text-lg" /> {titulo} · pronto</p>;
              }
              if (e !== etapaAtual) return <p key={e} className="text-[13.5px] font-extrabold text-zinc-400">{titulo} · depois</p>;
              const jaAutorizadaPedidos = e === 'pedidos' && lojaAutorizando?.situacao === 'ligar';
              return (
                <div key={e} className="space-y-3 border border-amber-200 bg-amber-50/40 rounded-2xl px-3.5 py-3">
                  <p className="text-[14px] font-extrabold text-zinc-900">{titulo}</p>
                  {jaAutorizadaPedidos ? (
                    <div className="space-y-2 text-[13px] text-zinc-700">
                      <p>Essa loja já está autorizada para os pedidos. Falta só ligar.</p>
                      <button className={btn('p')} disabled={!!busy} onClick={() => ligarPedidos(autorizando.id, autorizando.nome)}>{busy === 'ligar' + autorizando.id ? 'Ligando…' : 'Ligar pedidos'}</button>
                    </div>
                  ) : (
                    <>
                      <Passo n="a" titulo="Gerar o código">
                        {codigoDaEtapa ? (
                          <div className="space-y-2">
                            <p className="text-2xl font-black tracking-widest text-zinc-900">{codigoDaEtapa.code}</p>
                            <CaixaCopiar texto={codigoDaEtapa.code} rotulo="Copiar código" destaque />
                            <button className={btn('ghost', 'sm')} disabled={!!folhaBusy} onClick={gerarCodigo}>{folhaBusy === 'code' ? 'Gerando…' : 'Gerar outro código'}</button>
                          </div>
                        ) : (
                          <button className={btn('p')} disabled={!!folhaBusy} onClick={gerarCodigo}>{folhaBusy === 'code' ? 'Gerando…' : 'Gerar código'}</button>
                        )}
                      </Passo>
                      <Passo n="b" titulo="Colar no Portal do Parceiro">
                        <p>Abra o Portal do Parceiro com a loja <b>{curto(autorizando.nome)}</b> selecionada (seletor de loja no topo), vá em <b>Integrações › Ativar por código</b> e cole o código. O portal vai mostrar um código de autorização.</p>
                        {codigoDaEtapa?.url && <a href={codigoDaEtapa.url} target="_blank" rel="noopener noreferrer" className={btn('out', 'sm') + ' mt-2'}><i className="ri-external-link-line" /> Abrir o Portal do Parceiro</a>}
                      </Passo>
                      <Passo n="c" titulo="Colar o código de autorização aqui">
                        <input value={authCode} onChange={(ev) => setAuthCode(ev.target.value)} placeholder="Código de autorização que o portal mostrou"
                          className="w-full h-10 px-3 rounded-xl border border-zinc-200 focus:border-amber-400 outline-none text-[13px] font-mono bg-white" />
                        <button className={btn('p') + ' mt-2'} disabled={!!folhaBusy || !authCode.trim()} onClick={jaColei}>{folhaBusy === 'auth' ? 'Confirmando…' : 'Já colei'}</button>
                      </Passo>
                    </>
                  )}
                </div>
              );
            })}

            {folhaMsg && (
              <div className={`rounded-xl border px-3 py-2 text-[12.5px] font-semibold leading-snug ${folhaMsg.tom === 'ok' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : folhaMsg.tom === 'aviso' ? 'text-amber-900 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-100'}`}>
                {folhaMsg.t}
                {folhaMsg.tom === 'aviso' && etapaAtual === 'pedidos' && <button className={btn('out', 'sm') + ' mt-2 block'} disabled={!!folhaBusy} onClick={atualizarLojas}>{folhaBusy === 'refresh' ? 'Atualizando…' : 'Atualizar lojas'}</button>}
              </div>
            )}
            <Nota>O Portal do Parceiro pode trazer todas as lojas do seu login. As que já são de outra loja do ERPOS não são ligadas aqui. Loja recém-autorizada pode levar alguns minutos para aparecer.</Nota>
          </div>
        )}
      </Folha>

      {modalDinheiro && <IfoodConfigModal onClose={() => { setModalDinheiro(false); void carregar(); }} onImported={() => dados.recarregar()} />}
      {modalEntrega && <IfoodEntregaConfigModal tenantId={tenantId} onClose={() => { setModalEntrega(false); void carregar(); }} onChanged={() => { void lerCfg(); }} />}
    </div>
  );
}

function Selo({ tom, texto }: { tom: 'ligado' | 'aguardando' | 'falta'; texto?: string }) {
  return tom === 'ligado' ? <Etiqueta tom="green">{texto ?? 'ligado'}</Etiqueta>
    : tom === 'aguardando' ? <Etiqueta tom="zinc">aguardando</Etiqueta>
    : <Etiqueta tom="amber">falta</Etiqueta>;
}

function Linha({ icone, titulo, detalhe, direita }: { icone: string; titulo: string; detalhe?: string; direita?: ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-3 flex items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center flex-shrink-0"><i className={`${icone} text-lg`} /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-extrabold text-zinc-900 leading-snug">{titulo}</p>
        {detalhe && <p className="text-xs text-zinc-500 leading-snug mt-0.5">{detalhe}</p>}
      </div>
      {direita && <div className="flex-shrink-0">{direita}</div>}
    </div>
  );
}

function Modo({ ativo, titulo, children, onClick, disabled }: { ativo: boolean; titulo: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={ativo} disabled={disabled} onClick={onClick}
      className={`w-full text-left flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer disabled:cursor-not-allowed ${ativo ? 'border-amber-400 bg-amber-50/60' : 'border-zinc-200 bg-white hover:border-amber-300'}`}>
      <span className={`mt-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center flex-shrink-0 ${ativo ? 'border-amber-500' : 'border-zinc-300'}`}>
        {ativo && <span className="w-2 h-2 rounded-full bg-amber-500" />}
      </span>
      <span className="flex-1 min-w-0">
        <b className="block text-[13.5px] text-zinc-900">{titulo}</b>
        <span className="block text-xs text-zinc-600 leading-snug mt-0.5">{children}</span>
      </span>
    </button>
  );
}

function Chave({ titulo, texto, ligado, onChange, disabled }: { titulo: string; texto: string; ligado: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-zinc-900">{titulo}</p>
        <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{texto}</p>
      </div>
      <Interruptor ligado={ligado} onChange={onChange} rotulo={titulo} disabled={disabled} />
    </div>
  );
}

function Passo({ n, titulo, children }: { n: number | string; titulo: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
      <div className="flex-1 min-w-0 text-[13px] text-zinc-700 leading-snug">
        <p className="text-[13.5px] font-extrabold text-zinc-900 mb-1">{titulo}</p>
        {children}
      </div>
    </div>
  );
}
