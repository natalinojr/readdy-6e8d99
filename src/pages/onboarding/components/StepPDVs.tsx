import { useState } from 'react';

export type PDVId = 'caixa' | 'garcom' | 'kds' | 'autoatendimento' | 'mesa_qr' | 'delivery';

export interface PDVConfig {
  id: PDVId;
  ativo: boolean;
}

export interface PDVsData {
  pdvs: PDVConfig[];
}

interface PDVOption {
  id: PDVId;
  label: string;
  desc: string;
  icon: string;
  obrigatorio: boolean;
  detalhes: string[];
  cor: string;
}

const PDV_OPTIONS: PDVOption[] = [
  {
    id: 'caixa',
    label: 'PDV Caixa',
    desc: 'Terminal principal de vendas',
    icon: 'ri-store-line',
    obrigatorio: true,
    cor: 'amber',
    detalhes: [
      'Lançamento de pedidos avulsos e por mesa',
      'Abertura e fechamento de caixa',
      'Controle de pagamentos e sangrias',
      'Impressão de cupons e comprovantes',
    ],
  },
  {
    id: 'garcom',
    label: 'PDV Garçom',
    desc: 'Tablet/celular para garçons no salão',
    icon: 'ri-user-star-line',
    obrigatorio: false,
    cor: 'emerald',
    detalhes: [
      'Anotar pedidos diretamente na mesa',
      'Visualizar chamados e status dos pedidos',
      'Transferir mesas e fechar contas',
      'Opção de app mobile para os garçons',
    ],
  },
  {
    id: 'kds',
    label: 'KDS — Cozinha',
    desc: 'Display digital de pedidos na cozinha',
    icon: 'ri-tv-2-line',
    obrigatorio: false,
    cor: 'orange',
    detalhes: [
      'Exibe pedidos em tempo real por estação',
      'Controle de status (aguardando / preparo / pronto)',
      'SLA e cronômetro por pedido',
      'Registro de produção e perdas',
    ],
  },
  {
    id: 'delivery',
    label: 'PDV Delivery',
    desc: 'Receber e gerenciar pedidos de entrega',
    icon: 'ri-e-bike-2-line',
    obrigatorio: false,
    cor: 'teal',
    detalhes: [
      'Cadastro de cliente com endereço de entrega',
      'Taxa de entrega configurável por pedido',
      'Acompanhamento de status do pedido',
      'Integração com cardápio delivery separado',
    ],
  },
  {
    id: 'autoatendimento',
    label: 'Autoatendimento (Kiosk)',
    desc: 'Totem de pedido sem atendente',
    icon: 'ri-tablet-line',
    obrigatorio: false,
    cor: 'sky',
    detalhes: [
      'Cliente faz o pedido direto no totem',
      'Identifica pelo nome ou senha numérica',
      'Pagamento antes da retirada',
      'Ideal para filas e pico de movimento',
    ],
  },
  {
    id: 'mesa_qr',
    label: 'Cardápio por QR Code',
    desc: 'Cliente pede da própria mesa via QR',
    icon: 'ri-qr-code-line',
    obrigatorio: false,
    cor: 'violet',
    detalhes: [
      'Cliente escaneia o QR Code da mesa',
      'Pedido vai direto para a cozinha',
      'Sem precisar chamar o garçom',
      'Funciona junto com PDV Garçom ou independente',
    ],
  },
];

const COR_STYLE: Record<string, { selected: string; icon: string; badge: string; detail: string }> = {
  amber:   { selected: 'border-amber-400 bg-amber-50',     icon: 'bg-amber-500',     badge: 'bg-amber-100 text-amber-700',     detail: 'text-amber-700 bg-amber-50' },
  emerald: { selected: 'border-emerald-400 bg-emerald-50', icon: 'bg-emerald-500',   badge: 'bg-emerald-100 text-emerald-700', detail: 'text-emerald-700 bg-emerald-50' },
  orange:  { selected: 'border-orange-400 bg-orange-50',   icon: 'bg-orange-500',    badge: 'bg-orange-100 text-orange-700',   detail: 'text-orange-700 bg-orange-50' },
  teal:    { selected: 'border-teal-400 bg-teal-50',       icon: 'bg-teal-500',      badge: 'bg-teal-100 text-teal-700',       detail: 'text-teal-700 bg-teal-50' },
  sky:     { selected: 'border-sky-400 bg-sky-50',         icon: 'bg-sky-500',       badge: 'bg-sky-100 text-sky-700',         detail: 'text-sky-700 bg-sky-50' },
  violet:  { selected: 'border-violet-400 bg-violet-50',   icon: 'bg-violet-500',    badge: 'bg-violet-100 text-violet-700',   detail: 'text-violet-700 bg-violet-50' },
};

interface StepPDVsProps {
  data: PDVsData;
  temSalao: boolean;
  onNext: (data: PDVsData) => void;
  onBack: () => void;
}

export default function StepPDVs({ data, temSalao, onNext, onBack }: StepPDVsProps) {
  const initialPdvs: PDVConfig[] = PDV_OPTIONS.map((opt) => {
    const existing = data.pdvs.find((p) => p.id === opt.id);
    if (existing) return existing;
    if (opt.id === 'caixa') return { id: opt.id, ativo: true };
    if (opt.id === 'garcom') return { id: opt.id, ativo: temSalao };
    if (opt.id === 'kds') return { id: opt.id, ativo: true };
    if (opt.id === 'mesa_qr') return { id: opt.id, ativo: temSalao };
    if (opt.id === 'delivery') return { id: opt.id, ativo: false };
    return { id: opt.id, ativo: false };
  });

  const [pdvs, setPdvs] = useState<PDVConfig[]>(initialPdvs);
  const [expandido, setExpandido] = useState<PDVId | null>(null);

  const toggle = (id: PDVId) => {
    if (id === 'caixa') return; // não pode desativar
    setPdvs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ativo: !p.ativo } : p))
    );
  };

  const isAtivo = (id: PDVId) => pdvs.find((p) => p.id === id)?.ativo ?? false;

  const handleNext = () => {
    onNext({ pdvs });
  };

  const ativosCount = pdvs.filter((p) => p.ativo).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Terminais e PDVs</h2>
        <p className="text-sm text-zinc-500">
          Quais terminais sua operação vai usar? O <strong>PDV Caixa</strong> é sempre incluído. Os demais são opcionais.
        </p>
      </div>

      <div className="space-y-2.5">
        {PDV_OPTIONS.map((opt) => {
          const ativo = isAtivo(opt.id);
          const cor = COR_STYLE[opt.cor];
          const aberto = expandido === opt.id;

          return (
            <div
              key={opt.id}
              className={`rounded-xl border-2 transition-all overflow-hidden ${
                ativo ? cor.selected : 'border-zinc-100 bg-zinc-50'
              }`}
            >
              <div className="flex items-center gap-3 p-3.5">
                {/* Ícone */}
                <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 transition-colors ${ativo ? cor.icon : 'bg-zinc-200'}`}>
                  <i className={`${opt.icon} text-base ${ativo ? 'text-white' : 'text-zinc-400'}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-bold ${ativo ? 'text-zinc-900' : 'text-zinc-500'}`}>{opt.label}</p>
                    {opt.obrigatorio && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-zinc-200 text-zinc-600 uppercase tracking-wide whitespace-nowrap">
                        Obrigatório
                      </span>
                    )}
                    {ativo && !opt.obrigatorio && (
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap ${cor.badge}`}>
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 truncate">{opt.desc}</p>
                </div>

                {/* Controles */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Expandir/colapsar detalhes */}
                  <button
                    onClick={() => setExpandido(aberto ? null : opt.id)}
                    className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 cursor-pointer transition-colors"
                  >
                    <i className={`ri-${aberto ? 'arrow-up-s-line' : 'arrow-down-s-line'} text-sm`} />
                  </button>

                  {/* Toggle */}
                  {opt.obrigatorio ? (
                    <div className="flex items-center gap-1.5">
                      <div className="relative w-11 h-6 rounded-full bg-amber-500 flex-shrink-0">
                        <div className="absolute top-1 left-6 w-4 h-4 bg-white rounded-full shadow" />
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => toggle(opt.id)}
                      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${ativo ? 'bg-amber-500' : 'bg-zinc-200'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${ativo ? 'left-6' : 'left-1'}`} />
                    </button>
                  )}
                </div>
              </div>

              {/* Detalhes expandidos */}
              {aberto && (
                <div className={`px-3.5 pb-3.5 pt-0`}>
                  <div className={`rounded-lg p-3 ${cor.detail}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wide mb-2 opacity-70">
                      O que este terminal oferece:
                    </p>
                    <ul className="space-y-1">
                      {opt.detalhes.map((d, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs font-medium">
                          <i className="ri-check-line text-sm flex-shrink-0 mt-px" />
                          {d}
                        </li>
                      ))}
                    </ul>
                    {opt.id === 'mesa_qr' && !temSalao && (
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold opacity-80">
                        <i className="ri-information-line text-sm" />
                        Requer que o estabelecimento tenha mesas configuradas.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-100 rounded-xl">
        <i className="ri-information-line text-zinc-400 text-sm flex-shrink-0" />
        <p className="text-xs text-zinc-500">
          <strong>{ativosCount} {ativosCount === 1 ? 'terminal selecionado' : 'terminais selecionados'}</strong>.{' '}
          Você pode ativar ou desativar qualquer terminal depois em <strong>Configurações → Operação</strong>.
        </p>
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
          Voltar
        </button>
        <button onClick={handleNext} className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap">
          Finalizar configuração
        </button>
      </div>
    </div>
  );
}
