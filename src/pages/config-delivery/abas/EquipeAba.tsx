import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getPublicUrl } from '@/lib/appUrl';
import { dateKeyBrasilia, somarDias, todayBrasilia } from '@/lib/dateUtils';
import { confirmar } from '@/components/base/Dialogos';
import { useToast } from '@/contexts/ToastContext';
import { useDeliveryTela, type Motoboy } from '../DeliveryTela';
import { chamarDelivery, inicioDosUltimos30Dias } from '../config';
import {
  btn, CaixaCopiar, CartaoAcao, Colunas, Etiqueta, fmtTelefone, Folha, haQuanto, Manchete, MenuMais, PaginaDelivery,
  SecaoTitulo, Vazio, waNumero,
} from '../ui';

// Delivery › Entregadores › Equipe: quem são, quando entraram, quantas entregas fizeram, bloquear/liberar/remover
// e as duas formas de chamar um entregador novo (código para o app ERPOS Entregas ou link do navegador).

const DIA = 86400000;
const iniciais = (nome: string) => {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
};

/** "hoje 20:31", "amanhã 20:31" ou "07/10 20:31" (sempre no horário de Brasília). */
function ateQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const dia = dateKeyBrasilia(d);
  const hoje = todayBrasilia();
  if (dia === hoje) return `hoje ${hora}`;
  if (dia === somarDias(hoje, 1)) return `amanhã ${hora}`;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${hora}`;
}

const msgSemAcerto = 'Este entregador tem entregas no acerto e não pode ser removido. Use Bloquear.';
const erroDeAcerto = (msg: string) => /foreign key|delivery_driver_ledger|delivery_driver_settlements/i.test(msg);

export default function EquipeAba() {
  const { tenantId, slug, nomeLoja, motoboys, motoboysCarregando, recarregarMotoboys } = useDeliveryTela();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mostrarParados, setMostrarParados] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [codigo, setCodigo] = useState<{ code: string; expires_at: string } | null>(null);
  const [codigoCopiado, setCodigoCopiado] = useState(false);

  // ── lista: quem entrou há pouco primeiro; quem não entra há mais de 30 dias fica recolhido ──
  const { ativos, parados, entraram7d } = useMemo(() => {
    const agora = Date.now();
    const quando = (m: Motoboy) => (m.last_login_at ? new Date(m.last_login_at).getTime() : 0);
    // "Entrou" = último login; quem nunca entrou conta desde que foi cadastrado.
    const referencia = (m: Motoboy) => new Date(m.last_login_at ?? m.created_at).getTime();
    const ordenados = motoboys.slice().sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      if (quando(a) !== quando(b)) return quando(b) - quando(a);
      return String(b.created_at).localeCompare(String(a.created_at));
    });
    const parado = (m: Motoboy) => agora - referencia(m) > 30 * DIA;
    return {
      ativos: ordenados.filter((m) => !parado(m)),
      parados: ordenados.filter(parado),
      entraram7d: motoboys.filter((m) => m.last_login_at && agora - new Date(m.last_login_at).getTime() <= 7 * DIA).length,
    };
  }, [motoboys]);

  // Abriu a aba: confere a lista de novo (a página só a lê uma vez, ao abrir o Delivery).
  useEffect(() => { void recarregarMotoboys(); }, [recarregarMotoboys]);

  // ── entregas do mês em que o motoboy não marcou nada (o tempo de entrega fica sem aparecer) ──
  const [semMarca, setSemMarca] = useState<{ sem: number; total: number } | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setSemMarca(null);
    const desde = inicioDosUltimos30Dias();
    const base = () => supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('origin_type', 'delivery').eq('is_training', false).eq('status', 'delivered')
      .or('delivery_platform.is.null,delivery_platform.eq.propria')
      .gte('created_at', desde);
    void (async () => {
      const [todas, semMarcar] = await Promise.all([base(), base().is('motoboy_status', null)]);
      if (!vivo) return;
      const erro = todas.error ?? semMarcar.error;
      if (erro) { toastRef.current.error('Não consegui contar as entregas do mês', erro.message); return; }
      setSemMarca({ sem: semMarcar.count ?? 0, total: todas.count ?? 0 });
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  // ── ações ──
  const alternar = async (m: Motoboy) => {
    setOcupado(m.id);
    try {
      await chamarDelivery('set_driver_active', { tenant_id: tenantId, driver_id: m.id, is_active: !m.is_active });
      await recarregarMotoboys();
    } catch (e) {
      toast.error(m.is_active ? 'Não bloqueou' : 'Não liberou', e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  };

  const remover = async (m: Motoboy) => {
    const ok = await confirmar({
      titulo: `Remover ${m.name}?`,
      mensagem: 'Ele deixa de aparecer aqui e perde o acesso. Quem já tem entrega no acerto não pode ser removido: nesse caso use Bloquear.',
      confirmarLabel: 'Remover', perigo: true,
    });
    if (!ok) return;
    setOcupado(m.id);
    try {
      await chamarDelivery('delete_driver', { tenant_id: tenantId, driver_id: m.id });
      await recarregarMotoboys();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (erroDeAcerto(msg)) toast.error('Não dá para remover', msgSemAcerto);
      else toast.error('Não removeu', msg);
    } finally {
      setOcupado(null);
    }
  };

  const gerarCodigo = async () => {
    setGerando(true);
    try {
      const d = await chamarDelivery<{ code: string; expires_at: string }>('gerar_codigo_motoboy', { tenant_id: tenantId });
      setCodigo({ code: d.code, expires_at: d.expires_at });
      setCodigoCopiado(false);
    } catch (e) {
      toast.error('Não gerou o código', e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };

  const copiarCodigo = () => {
    if (!codigo) return;
    navigator.clipboard.writeText(codigo.code)
      .then(() => { setCodigoCopiado(true); setTimeout(() => setCodigoCopiado(false), 1600); })
      .catch(() => toast.error('Não consegui copiar', 'Toque no código para selecionar e copie à mão.'));
  };

  const mandarWhats = () => {
    if (!codigo) return;
    const texto = `Código ${codigo.code} para entregar pela ${nomeLoja || 'nossa loja'} no app ERPOS Entregas.\n\n` +
      `Abra o app ERPOS Entregas, toque em Adicionar loja e digite o código. Vale uma vez, até ${ateQuando(codigo.expires_at)}.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };

  // ── uma linha da lista ──
  const linha = (m: Motoboy) => {
    const entrou = m.last_login_at ? `Entrou ${haQuanto(m.last_login_at)}` : 'Ainda não entrou';
    const n = m.entregas_30d;
    return (
      <li key={m.id} className="flex items-center gap-2.5 px-3.5 py-3">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-[13px] font-extrabold ${m.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
          {iniciais(m.name)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-bold text-zinc-900 leading-tight flex items-center gap-1.5 min-w-0">
            <span className="truncate">{m.name}</span>
            {!m.is_active && <Etiqueta tom="red">bloqueado</Etiqueta>}
          </p>
          <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-snug">{entrou} · {n} {n === 1 ? 'entrega' : 'entregas'} no mês</p>
          {m.phone && <p className="text-[11px] text-zinc-400 leading-snug">{fmtTelefone(m.phone)}</p>}
        </div>
        <button type="button" onClick={() => void alternar(m)} disabled={ocupado === m.id}
          className={btn(m.is_active ? 'out' : 'p', 'sm')}>
          {ocupado === m.id && <i className="ri-loader-4-line animate-spin" />}{m.is_active ? 'Bloquear' : 'Liberar'}
        </button>
        <MenuMais rotulo={`Mais ações de ${m.name}`} itens={[
          { rotulo: 'Chamar no WhatsApp', icone: 'ri-whatsapp-line', oculto: !m.phone,
            onClick: () => window.open(`https://wa.me/${waNumero(m.phone)}`, '_blank', 'noopener') },
          { rotulo: 'Remover', icone: 'ri-delete-bin-line', perigo: true, onClick: () => void remover(m) },
        ]} />
      </li>
    );
  };

  const total = motoboys.length;
  const carregandoPrimeira = motoboysCarregando && total === 0;
  const linkNavegador = slug ? getPublicUrl('/entregas/' + slug) : '';

  return (
    <PaginaDelivery>
      <Colunas>
        <div>
          <Manchete titulo="Seus entregadores">
            {total > 0 && (
              <>
                {total} {total === 1 ? 'cadastrado' : 'cadastrados'} · {entraram7d} {entraram7d === 1 ? 'entrou' : 'entraram'} nos últimos 7 dias.{' '}
                Quem está bloqueado não vê pedido nenhum.
              </>
            )}
          </Manchete>

          <div className="mt-3">
            <div className="flex justify-end mb-1.5">
              <button type="button" onClick={() => void recarregarMotoboys()} disabled={motoboysCarregando} className={btn('ghost', 'sm')}>
                <i className={`ri-refresh-line ${motoboysCarregando ? 'animate-spin' : ''}`} />Atualizar
              </button>
            </div>
            {carregandoPrimeira ? (
              <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-6 text-center text-sm text-zinc-500">
                <i className="ri-loader-4-line animate-spin mr-1" />Carregando os entregadores…
              </div>
            ) : total === 0 ? (
              <Vazio icone="ri-e-bike-2-line" titulo="Nenhum entregador ainda"
                acao={<button type="button" onClick={() => void gerarCodigo()} disabled={gerando} className={btn('p', 'sm')}>
                  <i className={gerando ? 'ri-loader-4-line animate-spin' : 'ri-key-2-line'} />Gerar código
                </button>}>
                Gere um código para o app ERPOS Entregas ou mande o link do navegador. Quando ele entrar, aparece aqui.
              </Vazio>
            ) : (
              <ul className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
                {ativos.map(linha)}
                {parados.length > 0 && !mostrarParados && (
                  <li className="flex items-center gap-2 px-3.5 py-3">
                    <p className="flex-1 min-w-0 text-[12.5px] text-zinc-500">
                      + {parados.length} {parados.length === 1 ? 'que não entra' : 'que não entram'} há mais de 1 mês
                    </p>
                    <button type="button" onClick={() => setMostrarParados(true)} className={btn('ghost', 'sm')}>Ver</button>
                  </li>
                )}
                {parados.length > 0 && mostrarParados && (
                  <>
                    <li className="flex items-center gap-2 px-3.5 py-2.5 bg-zinc-50">
                      <p className="flex-1 min-w-0 text-[12.5px] font-bold text-zinc-500">Não entram há mais de 1 mês</p>
                      <button type="button" onClick={() => setMostrarParados(false)} className={btn('ghost', 'sm')}>Esconder</button>
                    </li>
                    {parados.map(linha)}
                  </>
                )}
              </ul>
            )}
          </div>
          {total > 0 && (
            <p className="text-[11px] text-zinc-400 mt-2 px-0.5 leading-snug">
              Remover fica no ⋯. Quem já tem entrega no acerto não pode ser removido (para não perder o histórico): use Bloquear.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <SecaoTitulo titulo="Chamar um entregador novo" />

          <CartaoAcao tom="prop" icone="ri-install-line"
            titulo="App ERPOS Entregas"
            direita={<Etiqueta tom="green">melhor</Etiqueta>}
            acoes={
              <button type="button" onClick={() => void gerarCodigo()} disabled={gerando} className={btn('p', 'sm')}>
                <i className={gerando ? 'ri-loader-4-line animate-spin' : 'ri-key-2-line'} />Gerar código
              </button>
            }>
            Mostra a rota e manda a localização. Ele digita o código em &quot;Adicionar loja&quot;. Vale uma vez, por 24 h.
          </CartaoAcao>

          <CartaoAcao tom="neutro" icone="ri-global-line" titulo="Pelo navegador do celular">
            Sem instalar nada: ele entra com nome e celular.
            {linkNavegador && <div className="mt-2"><CaixaCopiar texto={linkNavegador} /></div>}
          </CartaoAcao>

          {semMarca && semMarca.sem > 0 && (
            <CartaoAcao tom="alerta" icone="ri-touch-line"
              titulo={`${semMarca.sem} de ${semMarca.total} ${semMarca.total === 1 ? 'entrega' : 'entregas'} sem o motoboy marcar`}>
              A partir de agora, quando o caixa marca o pedido como saiu para entrega, o motoboy já fica em Coletou e só toca Entreguei.
              Assim o tempo de entrega passa a aparecer.
            </CartaoAcao>
          )}
        </div>
      </Colunas>

      <Folha aberta={!!codigo} titulo="Código para o app" subtitulo='O entregador digita em "Adicionar loja"'
        onFechar={() => setCodigo(null)}
        rodape={
          <>
            <button type="button" onClick={copiarCodigo} className={`${btn('out')} flex-1`}>
              <i className={codigoCopiado ? 'ri-check-line' : 'ri-file-copy-line'} />{codigoCopiado ? 'Copiado' : 'Copiar'}
            </button>
            <button type="button" onClick={mandarWhats} className={`${btn('wa')} flex-1`}>
              <i className="ri-whatsapp-line" />Mandar no WhatsApp
            </button>
          </>
        }>
        {codigo && (
          <div className="text-center py-5">
            <p className="text-[34px] sm:text-[38px] font-extrabold tracking-[.14em] tabular-nums text-zinc-900 select-all break-all">{codigo.code}</p>
            <p className="text-xs text-zinc-500 mt-2">Vale uma vez, até {ateQuando(codigo.expires_at)}</p>
          </div>
        )}
      </Folha>
    </PaginaDelivery>
  );
}
