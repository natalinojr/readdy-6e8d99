import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChefHat } from 'lucide-react';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { useAppMode } from '@/contexts/AppModeContext';
import { useAuth } from '@/contexts/AuthContext';
import StepBoasVindas from './components/StepBoasVindas';
import StepLoja from './components/StepLoja';
import type { LojaData } from './components/StepLoja';
import StepEstacao from './components/StepEstacao';
import type { EstacaoData } from './components/StepEstacao';
import StepCardapio from './components/StepCardapio';
import type { CardapioData } from './components/StepCardapio';
import StepMesas from './components/StepMesas';
import type { MesasData } from './components/StepMesas';
import StepPagamentos from './components/StepPagamentos';
import type { PagamentosData, FormaPagamento } from './components/StepPagamentos';
import StepPDVs from './components/StepPDVs';
import type { PDVsData } from './components/StepPDVs';
import StepConcluido from './components/StepConcluido';

interface OnboardingState {
  step: number;
  loja: LojaData;
  estacoes: EstacaoData;
  cardapio: CardapioData;
  mesas: MesasData;
  pagamentos: PagamentosData;
  pdvs: PDVsData;
}

const STORAGE_KEY = 'erpos_onboarding_state';

type InviteStatus = 'checking' | 'valid' | 'invalid' | 'used' | 'missing';

const DEFAULT_STATE: OnboardingState = {
  step: 0,
  loja: { nomeLoja: '', tipoNegocio: 'restaurante', tipoOutro: '' },
  estacoes: { estacoes: [] },
  cardapio: { categorias: [], itens: [] },
  mesas: { temSalao: true, quantidadeMesas: 10, setores: [] },
  pagamentos: { formas: ['dinheiro', 'pix', 'credito', 'debito'] as FormaPagamento[] },
  pdvs: { pdvs: [] },
};

// Steps sem o passo de conta — o usuário já existe
const STEPS = [
  { label: 'Bem-vindo', icon: 'ri-home-smile-line' },
  { label: 'Estabelecimento', icon: 'ri-store-line' },
  { label: 'Cozinha', icon: 'ri-fire-line' },
  { label: 'Cardápio', icon: 'ri-menu-line' },
  { label: 'Mesas', icon: 'ri-layout-grid-line' },
  { label: 'Pagamentos', icon: 'ri-bank-card-line' },
  { label: 'Terminais PDV', icon: 'ri-computer-line' },
  { label: 'Concluído', icon: 'ri-checkbox-circle-line' },
];

function loadSavedState(): OnboardingState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingState;
    if (typeof parsed.step !== 'number') return null;
    if (parsed.step < 0 || parsed.step >= STEPS.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveState(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setMode: setAppMode } = useAppMode();
  const { user: loggedUser } = useAuth();
  const [sessionUserName, setSessionUserName] = useState('');
  const [sessionUserEmail, setSessionUserEmail] = useState('');

  // Busca nome/email direto da sessão do Supabase (necessário quando user=null em hasNoTenants)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (!u) return;
      const nome =
        u.user_metadata?.name ??
        u.user_metadata?.nome ??
        u.user_metadata?.full_name ??
        '';
      setSessionUserName(nome);
      setSessionUserEmail(u.email ?? '');
    });
  }, []);

  const inviteCode = searchParams.get('invite') ?? '';
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>(inviteCode ? 'checking' : 'missing');

  // Valida o invite code usando a sessão ativa (ou anon key como fallback)
  useEffect(() => {
    if (!inviteCode) {
      setInviteStatus('missing');
      return;
    }
    (async () => {
      try {
        const SUPABASE_ANON_KEY = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;
        // Tenta usar o token da sessão autenticada; se não existir, usa anon key
        const { data: sessionData } = await supabase.auth.getSession();
        const authToken = sessionData.session?.access_token ?? SUPABASE_ANON_KEY;
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/fn_validate_invite_code`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ p_code: inviteCode }),
          }
        );
        if (!res.ok) {
          console.warn('[onboarding] fn_validate_invite_code status:', res.status, await res.text());
          setInviteStatus('invalid');
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await res.json() as any;
        if (result?.status === 'valid') { setInviteStatus('valid'); return; }
        if (result?.status === 'used') { setInviteStatus('used'); return; }
        setInviteStatus('invalid');
      } catch {
        // Em caso de erro de rede, deixa passar para não bloquear o usuário
        setInviteStatus('invalid');
      }
    })();
  }, [inviteCode]);

  const saved = loadSavedState();
  const initial = saved ?? DEFAULT_STATE;

  const [step, setStep] = useState(initial.step);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [state, setState] = useState<OnboardingState>({
    step: initial.step,
    loja: initial.loja,
    estacoes: initial.estacoes,
    cardapio: initial.cardapio,
    mesas: initial.mesas,
    pagamentos: initial.pagamentos,
    pdvs: initial.pdvs,
  });

  useEffect(() => {
    saveState({ ...state, step });
  }, [state, step]);

  const updateStep = useCallback((nextStep: number) => {
    setStep(nextStep);
  }, []);

  const handleConcluir = async () => {
    setSaving(true);
    setSaveError('');

    try {
      const SUPABASE_ANON_KEY = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;

      // Pega a sessão do usuário já logado
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? SUPABASE_ANON_KEY;
      const currentUser = sessionData.session?.user;

      const payload: Record<string, unknown> = {
        // Usa o usuário já autenticado — sem criar conta nova
        existingUserId: currentUser?.id,
        email: currentUser?.email,
        nome: currentUser?.user_metadata?.name ?? currentUser?.user_metadata?.nome ?? currentUser?.user_metadata?.full_name ?? loggedUser?.nome ?? sessionUserName ?? '',
        nomeLoja: state.loja.nomeLoja,
        // Envia o JWT para que a edge function use nas inserções
        userAccessToken: token,
        tipoNegocio: state.loja.tipoNegocio,
        estacoes: state.estacoes.estacoes,
        categorias: state.cardapio.categorias,
        itens: state.cardapio.itens,
        mesas: state.mesas,
        pagamentos: state.pagamentos.formas,
        pdvs: state.pdvs.pdvs,
        inviteCode: inviteCode || undefined,
      };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/setup-tenant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        // Usuário já possui loja — redireciona em vez de mostrar erro
        if (data.already_exists === true) {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.setItem('erpos_onboarding_done', 'true');
          setAppMode('modulos');
          navigate('/modulos', { replace: true });
          return;
        }
        setSaveError(data.error ?? 'Erro ao configurar o sistema. Tente novamente.');
        setSaving(false);
        return;
      }

      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem('erpos_onboarding_done', 'true');
      localStorage.setItem('erpos_loja_nome', state.loja.nomeLoja);
      setAppMode('modulos');
      navigate('/modulos', { replace: true });
    } catch (err) {
      setSaveError(`Erro inesperado: ${String(err)}`);
      setSaving(false);
    }
  };

  const progressPct = step === 0 ? 0 : Math.round((step / (STEPS.length - 1)) * 100);

  // ── Telas de bloqueio ──────────────────────────────────────────────────────

  if (inviteStatus === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Verificando código de convite...</p>
        </div>
      </div>
    );
  }

  if (inviteStatus === 'missing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-6">
        <div className="max-w-sm w-full text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-800 rounded-2xl mx-auto mb-5">
            <i className="ri-lock-line text-3xl text-zinc-500" />
          </div>
          <h1 className="text-white font-black text-xl mb-2">Acesso restrito</h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Esta página só pode ser acessada com um código de convite válido.
            Entre em contato com o administrador para receber seu código.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="mt-6 w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold rounded-xl cursor-pointer text-sm"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    );
  }

  if (inviteStatus === 'used') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-6">
        <div className="max-w-sm w-full text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-emerald-900/40 rounded-2xl mx-auto mb-5">
            <i className="ri-store-2-line text-3xl text-emerald-500" />
          </div>
          <h1 className="text-white font-black text-xl mb-2">Loja já criada!</h1>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">
            Este código de convite já foi utilizado para criar uma loja.
            Cada código só pode ser usado uma vez.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-xl cursor-pointer text-sm"
          >
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  if (inviteStatus === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-6">
        <div className="max-w-sm w-full text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-red-900/40 rounded-2xl mx-auto mb-5">
            <i className="ri-error-warning-line text-3xl text-red-500" />
          </div>
          <h1 className="text-white font-black text-xl mb-2">Código inválido</h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Este código de convite não existe ou expirou.
            Solicite um novo código ao administrador.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="mt-6 w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold rounded-xl cursor-pointer text-sm"
          >
            Voltar ao login
          </button>
        </div>
      </div>
    );
  }

  // ── Layout principal ───────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex font-sans">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-80 xl:w-96 bg-zinc-950 flex-col p-8">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl">
            <ChefHat size={18} className="text-zinc-950" />
          </div>
          <span className="text-white font-bold text-base tracking-wide">ERPOS V2</span>
        </div>

        <div className="mb-8">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3 font-semibold">Configuração inicial</p>
          <div className="space-y-1">
            {STEPS.map((s, i) => (
              <div
                key={s.label}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${i === step ? 'bg-amber-500/20' : ''}`}
              >
                <div
                  className={`w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 ${
                    i < step ? 'bg-emerald-500' : i === step ? 'bg-amber-500' : 'bg-zinc-800'
                  }`}
                >
                  {i < step ? (
                    <i className="ri-check-line text-white text-xs" />
                  ) : (
                    <i className={`${s.icon} text-xs ${i === step ? 'text-zinc-950' : 'text-zinc-500'}`} />
                  )}
                </div>
                <span
                  className={`text-sm font-semibold ${
                    i === step ? 'text-amber-400' : i < step ? 'text-emerald-400' : 'text-zinc-500'
                  }`}
                >
                  {s.label}
                </span>
                {i === 2 && (
                  <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 whitespace-nowrap">
                    Essencial
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Dicas contextuais */}
        <div className="mt-auto space-y-4">
          {step === 2 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <p className="text-xs text-amber-300 font-semibold mb-1">
                <i className="ri-lightbulb-line mr-1" />
                Por que as estações importam?
              </p>
              <p className="text-xs text-amber-200/70">
                Cada categoria do cardápio precisa de uma estação. O KDS separa os pedidos por estação para a equipe.
              </p>
            </div>
          )}
          {step === 3 && (
            <div className="p-3 bg-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-400 font-semibold mb-1">
                <i className="ri-information-line mr-1" />
                Dica sobre o cardápio
              </p>
              <p className="text-xs text-zinc-500">
                Aqui você cria as categorias vinculadas às estações. Adicione itens completos agora ou depois em <strong className="text-zinc-400">Cardápio</strong>.
              </p>
            </div>
          )}
          {step === 4 && (
            <div className="p-3 bg-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-400 font-semibold mb-1">
                <i className="ri-information-line mr-1" />
                Setores de mesas
              </p>
              <p className="text-xs text-zinc-500">
                Cada setor gera QR Codes separados. Você pode adicionar Varanda, VIP, Deck e muito mais.
              </p>
            </div>
          )}
          {step === 6 && (
            <div className="p-3 bg-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-400 font-semibold mb-1">
                <i className="ri-computer-line mr-1" />
                Terminais PDV
              </p>
              <p className="text-xs text-zinc-500">
                Ative somente o que você realmente vai usar. Menos terminais = menos complexidade no dia a dia.
              </p>
            </div>
          )}
          <div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500">{progressPct}% concluído</p>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-white px-6 py-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          {/* Mobile header */}
          <div className="flex items-center gap-3 mb-6 lg:hidden">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-500 rounded-lg">
              <ChefHat size={16} className="text-zinc-950" />
            </div>
            <span className="text-zinc-900 font-bold text-base">ERPOS V2</span>
            <div className="ml-auto text-xs text-zinc-400 font-semibold">{progressPct}%</div>
          </div>

          {/* Steps — sem o passo de conta */}
          {step === 0 && <StepBoasVindas onNext={() => updateStep(1)} />}

          {step === 1 && (
            <StepLoja
              data={state.loja}
              onNext={(data) => { setState((s) => ({ ...s, loja: data })); updateStep(2); }}
              onBack={() => updateStep(0)}
            />
          )}

          {step === 2 && (
            <StepEstacao
              data={state.estacoes}
              onNext={(data) => { setState((s) => ({ ...s, estacoes: data })); updateStep(3); }}
              onBack={() => updateStep(1)}
            />
          )}

          {step === 3 && (
            <StepCardapio
              data={state.cardapio}
              estacoes={state.estacoes.estacoes}
              tipoNegocio={state.loja.tipoNegocio}
              onNext={(data) => { setState((s) => ({ ...s, cardapio: data })); updateStep(4); }}
              onBack={() => updateStep(2)}
            />
          )}

          {step === 4 && (
            <StepMesas
              data={state.mesas}
              onNext={(data) => { setState((s) => ({ ...s, mesas: data })); updateStep(5); }}
              onBack={() => updateStep(3)}
            />
          )}

          {step === 5 && (
            <StepPagamentos
              data={state.pagamentos}
              onNext={(data) => { setState((s) => ({ ...s, pagamentos: data })); updateStep(6); }}
              onBack={() => updateStep(4)}
            />
          )}

          {step === 6 && (
            <StepPDVs
              data={state.pdvs}
              temSalao={state.mesas.temSalao}
              onNext={(data) => { setState((s) => ({ ...s, pdvs: data })); updateStep(7); }}
              onBack={() => updateStep(5)}
            />
          )}

          {step === 7 && (
            <StepConcluido
              nomeLoja={state.loja.nomeLoja}
              tipoNegocio={state.loja.tipoNegocio}
              tipoOutro={state.loja.tipoOutro}
              nomeAdmin={loggedUser?.nome || sessionUserName || sessionUserEmail || 'Administrador'}
              estacoes={state.estacoes.estacoes}
              categorias={state.cardapio.categorias}
              itens={state.cardapio.itens}
              mesas={state.mesas}
              formas={state.pagamentos.formas}
              pdvs={state.pdvs.pdvs}
              saving={saving}
              saveError={saveError}
              onEntrar={handleConcluir}
              onBack={() => updateStep(6)}
            />
          )}
        </div>
      </div>
    </div>
  );
}