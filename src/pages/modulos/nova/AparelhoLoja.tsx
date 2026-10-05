// Cara 1 da página de Módulos nova: "O que este aparelho faz?" — para o login da loja (computador do caixa,
// tablet da cozinha, celular do balcão). Só os terminais que o login abre, cada um com o estado de agora,
// e "Abrir sempre este neste aparelho" (localStorage 'erpos-aparelho-fixo'; quem leva direto é a entrada,
// src/pages/hoje/InicioPorPerfil.tsx — aqui, chegando por um "voltar", só mostra a faixa e o Soltar).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useKDS } from '@/contexts/KDSContext';
import { useMesas } from '@/contexts/MesasContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { useUsuarios } from '@/hooks/useUsuarios';
import { invokeWithAuth } from '@/lib/supabase';
import { TELAS, telaVisivel } from '@/constants/telas';
import { loginCompartilhado } from '@/pages/hoje/rotina/loginCompartilhado';
import { Bolinha, useEstadoLoja } from '@/components/feature/casca/partes';
import { btn, Vazio } from '@/components/kit';
import {
  destinoAparelhoFixo, gravarAparelhoFixo, lerAparelhoFixo, resumoFila, soltarAparelhoFixo,
  type AparelhoFixo, type TerminalAparelho,
} from '@/lib/modulosCara';
import { useTerminaisDoAparelho } from './useModulosNova';
import { Estado, LinkRota, Topo } from './partes';

const ICONE: Record<string, string> = {
  'pdv-caixa': 'ri-shopping-cart-2-line',
  'pdv-garcom': 'ri-user-star-line',
  'pdv-delivery': 'ri-phone-line',
  'gestor-pedidos': 'ri-fire-line',
  'gestor-entregas': 'ri-e-bike-2-line',
  kds: 'ri-tv-2-line',
  autoatendimento: 'ri-tablet-line',
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Relógio de 30 s para o "atrasado" andar sozinho com a página aberta. */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

// ── Estado de cada terminal (só leituras que o app já tem na memória, mais 1 chamada no Caixa) ──

/** Pedidos do tablet em dinheiro esperando o caixa receber (a mesma lista do PDV Caixa, lida 1 vez). */
function EsperandoPagar() {
  const { user } = useAuth();
  const { sessao } = useSessao();
  const [n, setN] = useState(0);
  const tenantId = user?.tenantId;
  const sessionId = sessao?.id;
  useEffect(() => {
    if (!tenantId || !sessionId) { setN(0); return; }
    let vivo = true;
    invokeWithAuth<{ data: unknown[] }>('order-write', {
      body: { action: 'list_held_orders', tenant_id: tenantId, session_id: sessionId },
    }).then(({ data, error }) => { if (vivo && !error) setN((data?.data ?? []).length); })
      .catch(() => { /* sem o número, o cartão continua */ });
    return () => { vivo = false; };
  }, [tenantId, sessionId]);
  if (n <= 0) return null;
  return <Estado tom="a">{plural(n, 'esperando para pagar', 'esperando para pagar')}</Estado>;
}

function EstadoCaixa() {
  const { estado, sessao } = useSessao();
  const { settings } = useSystemSettings();
  const tablet = settings.pdv_config?.autoatendimento ?? true;
  if (estado === 'sem_sessao') return <Estado>Loja fechada</Estado>;
  return (
    <>
      <Estado tom="g">{sessao?.iniciadaEm ? `Loja aberta desde ${sessao.iniciadaEm}` : 'Loja aberta'}</Estado>
      {estado === 'sessao_aberta' && <Estado tom="a">Caixa fechado</Estado>}
      {tablet && <EsperandoPagar />}
    </>
  );
}

function EstadoCozinha() {
  const { estado } = useSessao();
  const { pedidos } = useKDS();
  const agora = useAgora();
  const r = useMemo(() => resumoFila(pedidos, agora), [pedidos, agora]);
  if (estado === 'sem_sessao') return <Estado>Loja fechada</Estado>;
  if (r.fila === 0) return <Estado tom="g">Fila vazia</Estado>;
  return (
    <>
      <Estado>{plural(r.fila, 'na fila', 'na fila')}</Estado>
      {r.atrasados > 0 && <Estado tom="r">{plural(r.atrasados, 'atrasado', 'atrasados')}</Estado>}
    </>
  );
}

function EstadoEntregas() {
  const { estado } = useSessao();
  const { pedidos } = useKDS();
  const agora = useAgora();
  const r = useMemo(() => resumoFila(pedidos, agora), [pedidos, agora]);
  if (estado === 'sem_sessao') return <Estado>Loja fechada</Estado>;
  if (r.saindo === 0 && r.prontasParaSair === 0) return <Estado>Nenhuma entrega saindo</Estado>;
  return (
    <>
      {r.saindo > 0 && <Estado tom="b">{plural(r.saindo, 'na rua agora', 'na rua agora')}</Estado>}
      {r.prontasParaSair > 0 && <Estado tom="a">{plural(r.prontasParaSair, 'pronta para sair', 'prontas para sair')}</Estado>}
    </>
  );
}

function EstadoDeliveryTelefone() {
  const { estado } = useSessao();
  const { pedidos } = useKDS();
  const agora = useAgora();
  const r = useMemo(() => resumoFila(pedidos, agora), [pedidos, agora]);
  if (estado === 'sem_sessao') return <Estado>Loja fechada</Estado>;
  if (r.entregasAndando === 0) return null;
  return <Estado tom="b">{plural(r.entregasAndando, 'entrega andando', 'entregas andando')}</Estado>;
}

function EstadoGarcom() {
  const { estado } = useSessao();
  const { mesas } = useMesas();
  if (estado === 'sem_sessao') return <Estado>Loja fechada</Estado>;
  const ocupadas = mesas.filter((m) => m.status === 'ocupada').length;
  if (mesas.length === 0) return null;
  return ocupadas > 0 ? <Estado tom="b">{plural(ocupadas, 'mesa ocupada', 'mesas ocupadas')}</Estado> : <Estado>Salão vazio</Estado>;
}

/** Totens funcionando — a mesma conta do topo antigo ("Totens 2/2"). A lista de usuários só abre para quem
 *  gerencia usuários (fn_get_users_list); para os demais o cartão fica sem esse número. */
function TotensOnline() {
  const { usuarios, loading, error } = useUsuarios();
  if (loading || error) return null;
  const totens = usuarios.filter((u) => u.perfil === 'totem' && u.ativo !== false);
  if (totens.length === 0) return null;
  const on = totens.filter((u) => u.kioskOnline).length;
  if (on === 0) return <Estado tom="r">Nenhum totem ligado (0/{totens.length})</Estado>;
  return <Estado tom={on === totens.length ? 'g' : 'a'}>Totens {on}/{totens.length} funcionando</Estado>;
}

function EstadoTotem() {
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const podeLer = user?.perfil === 'admin' || hasPermissao('usuarios_gerenciar');
  return podeLer ? <TotensOnline /> : null;
}

function EstadoDoTerminal({ id }: { id: string }) {
  switch (id) {
    case 'pdv-caixa': return <EstadoCaixa />;
    case 'pdv-garcom': return <EstadoGarcom />;
    case 'pdv-delivery': return <EstadoDeliveryTelefone />;
    case 'gestor-pedidos':
    case 'kds': return <EstadoCozinha />;
    case 'gestor-entregas': return <EstadoEntregas />;
    case 'autoatendimento': return <EstadoTotem />;
    default: return null;
  }
}

// ── Cartão do terminal ──────────────────────────────────────────────────────────

function CartaoTerminal({ t, fixo, onFixar }: { t: TerminalAparelho; fixo: boolean; onFixar: () => void }) {
  const icone = ICONE[t.id] ?? 'ri-apps-line';
  const cabeca = (
    <div className="flex items-center gap-2.5">
      <span className="w-11 h-11 rounded-[14px] bg-[#FFF4E0] text-[#C2700A] flex items-center justify-center flex-shrink-0">
        <i className={`${icone} text-[22px]`} />
      </span>
      <span className="min-w-0">
        <b className="block text-[17px] font-extrabold leading-tight">{t.rotulo}</b>
        <small className="block text-[12px] text-[#9A9086] font-semibold">{t.sub}</small>
      </span>
    </div>
  );
  if (t.desligado) {
    return (
      <div className="bg-white border border-[#EEE6DA] rounded-[22px] p-4 flex flex-col gap-2 min-h-[150px] opacity-55"
        title="A Visão da cozinha desta loja usa a outra tela. Liga em Configurações › Operação.">
        {cabeca}
        <div className="flex flex-wrap gap-1.5"><Estado>Desligado nesta loja</Estado></div>
      </div>
    );
  }
  return (
    <div className={`relative bg-white rounded-[22px] flex flex-col min-h-[150px] ${fixo ? 'border-2 border-amber-500 ring-4 ring-amber-100' : 'border border-[#EEE6DA] hover:border-[#F6DDB0]'}`}>
      <LinkRota rota={t.rota} className="flex-1 flex flex-col gap-2 p-4 pb-2 cursor-pointer text-left">
        {cabeca}
        <div className="flex flex-wrap gap-1.5"><EstadoDoTerminal id={t.id} /></div>
      </LinkRota>
      <button type="button" onClick={onFixar} aria-pressed={fixo}
        className="flex items-center gap-2 text-[12.5px] font-bold text-[#5B5248] px-4 pb-3.5 pt-1 text-left cursor-pointer min-h-[40px]">
        <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${fixo ? 'bg-amber-500 border-amber-500 text-zinc-900' : 'border-zinc-300 bg-white'}`}>
          {fixo && <i className="ri-check-line text-[14px]" />}
        </span>
        Abrir sempre este neste aparelho
      </button>
    </div>
  );
}

export default function AparelhoLoja() {
  const { user, logout, canSwitchTenant, switchTenant } = useAuth();
  const { hasPermissao } = usePermissoes();
  const { hasModule } = useModuleAccess();
  const navigate = useNavigate();
  const loja = useEstadoLoja();
  const { terminais, pronto } = useTerminaisDoAparelho();
  const [fixo, setFixo] = useState<AparelhoFixo | null>(() => lerAparelhoFixo());

  const rotaFixa = destinoAparelhoFixo(fixo, user?.tenantId, terminais);
  const terminalFixo = terminais.find((t) => t.rota === rotaFixa) ?? null;

  const alternarFixo = (t: TerminalAparelho) => {
    if (!user?.tenantId) return;
    if (rotaFixa === t.rota) { soltarAparelhoFixo(); setFixo(null); return; }
    const novo = { tenantId: user.tenantId, rota: t.rota };
    gravarAparelhoFixo(novo);
    setFixo(novo);
  };
  const soltar = () => { soltarAparelhoFixo(); setFixo(null); };

  const ctx = { email: user?.email, perfil: user?.perfil, pode: hasPermissao, modulo: hasModule };
  const veTela = (id: string) => { const t = TELAS.find((x) => x.id === id); return !!t && telaVisivel(t, ctx); };
  const compartilhado = loginCompartilhado(user?.email);
  const nome = user?.nome ?? '';

  const sair = () => { logout(); navigate('/login'); };
  const trocarLoja = () => { switchTenant(); navigate('/selecionar-loja'); };

  return (
    <>
      <Topo
        titulo={user?.loja || 'ERPOS'}
        linha={<><Bolinha aberta={loja.aberta} /><span className="truncate">{loja.aberta ? 'Loja aberta' : 'Loja fechada'} · {nome}{compartilhado ? ' (login da loja)' : ''}</span></>}
        direita={<button type="button" onClick={sair} className={btn('out', 'sm')}><i className="ri-logout-box-r-line" />Sair</button>}
      />
      <div className="px-4 md:px-8 pb-10 max-w-6xl mx-auto">
        <h1 className="text-[22px] md:text-[26px] font-black leading-tight mt-3">O que este aparelho faz?</h1>
        <p className="text-[13px] text-[#5B5248] mt-1">Só aparece o que {nome || 'este login'} pode abrir. Cada botão já diz como está agora.</p>

        {terminalFixo && (
          <div className="bg-[#1F1A14] text-white rounded-2xl px-3.5 py-3 flex items-center gap-2.5 mt-3">
            <i className="ri-pushpin-2-fill text-[20px] text-amber-400 flex-shrink-0" />
            <b className="flex-1 min-w-0 text-[13.5px] leading-snug">
              Este aparelho abre direto no {terminalFixo.rotulo}
              <span className="block text-[11.5px] text-[#CFC7BC] font-medium">Ao entrar, ele vai direto para lá. Para voltar a escolher, solte.</span>
            </b>
            <button type="button" onClick={soltar}
              className="border border-[#4a4238] rounded-[10px] px-3 py-1.5 text-[12.5px] font-bold cursor-pointer hover:bg-white/10 flex-shrink-0">
              Soltar
            </button>
          </div>
        )}

        {!pronto ? (
          <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : terminais.length === 0 ? (
          <div className="mt-4">
            <Vazio icone="ri-apps-line" titulo="Nenhum terminal liberado para este login">
              Os terminais (Caixa, Garçom, cozinha…) dependem do cargo e do que a loja liga em Configurações.
            </Vazio>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-3">
            {terminais.map((t) => (
              <CartaoTerminal key={t.id} t={t} fixo={rotaFixa === t.rota} onFixar={() => alternarFixo(t)} />
            ))}
          </div>
        )}

        <div className="flex gap-2 flex-wrap mt-4">
          {veTela('hoje') && <LinkRota rota="/hoje" className={btn('out')}><i className="ri-sun-line" />Hoje</LinkRota>}
          {veTela('receber') && <LinkRota rota="/receber" className={btn('out')}><i className="ri-truck-line" />Chegou mercadoria</LinkRota>}
          {canSwitchTenant && <button type="button" onClick={trocarLoja} className={btn('out')}><i className="ri-store-2-line" />Trocar de loja</button>}
        </div>
      </div>
    </>
  );
}
