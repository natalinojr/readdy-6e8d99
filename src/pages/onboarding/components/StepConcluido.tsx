import type { EstacaoOnboarding } from './StepEstacao';
import type { CategoriaOnboarding, ItemOnboarding } from './StepCardapio';
import type { MesasData } from './StepMesas';
import type { FormaPagamento } from './StepPagamentos';
import type { PDVConfig } from './StepPDVs';

const FORMAS_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  credito: 'Cartão Crédito',
  debito: 'Cartão Débito',
  vr: 'Vale Refeição',
  va: 'Vale Alimentação',
};

const TIPOS_LABEL: Record<string, string> = {
  restaurante: 'Restaurante',
  lanchonete: 'Lanchonete',
  pizzaria: 'Pizzaria',
  bar: 'Bar / Pub',
  cafe: 'Café',
  hamburgueria: 'Hamburgueria',
  foodpark: 'Food Park',
  darkKitchen: 'Dark Kitchen',
  sorveteria: 'Sorveteria',
  acai: 'Açaí & Smoothies',
  padaria: 'Padaria',
  churrascaria: 'Churrascaria',
  sushi: 'Culinária Japonesa',
  outro: 'Outro',
};

const PDV_LABELS: Record<string, string> = {
  caixa: 'PDV Caixa',
  garcom: 'PDV Garçom',
  kds: 'KDS — Cozinha',
  autoatendimento: 'Autoatendimento (Kiosk)',
  mesa_qr: 'Cardápio por QR Code',
};

const PDV_ICONS: Record<string, string> = {
  caixa: 'ri-store-line',
  garcom: 'ri-user-star-line',
  kds: 'ri-computer-line',
  autoatendimento: 'ri-tablet-line',
  mesa_qr: 'ri-qr-code-line',
};

interface StepConcluidoProps {
  nomeLoja: string;
  tipoNegocio: string;
  tipoOutro: string;
  nomeAdmin: string;
  estacoes: EstacaoOnboarding[];
  categorias: CategoriaOnboarding[];
  itens: ItemOnboarding[];
  mesas: MesasData;
  formas: FormaPagamento[];
  pdvs: PDVConfig[];
  saving?: boolean;
  saveError?: string;
  onEntrar: () => void;
  onBack: () => void;
}

const COR_CLASSES: Record<string, { bg: string; icon: string; dot: string }> = {
  amber:   { bg: 'bg-amber-50 border-amber-100',   icon: 'text-amber-600 bg-amber-100',   dot: 'bg-amber-400' },
  emerald: { bg: 'bg-emerald-50 border-emerald-100', icon: 'text-emerald-600 bg-emerald-100', dot: 'bg-emerald-400' },
  orange:  { bg: 'bg-orange-50 border-orange-100',  icon: 'text-orange-600 bg-orange-100',  dot: 'bg-orange-400' },
  sky:     { bg: 'bg-sky-50 border-sky-100',        icon: 'text-sky-600 bg-sky-100',        dot: 'bg-sky-400' },
  violet:  { bg: 'bg-violet-50 border-violet-100',  icon: 'text-violet-600 bg-violet-100',  dot: 'bg-violet-400' },
  rose:    { bg: 'bg-rose-50 border-rose-100',      icon: 'text-rose-600 bg-rose-100',      dot: 'bg-rose-400' },
  indigo:  { bg: 'bg-indigo-50 border-indigo-100',  icon: 'text-indigo-600 bg-indigo-100',  dot: 'bg-indigo-400' },
};

export default function StepConcluido({
  nomeLoja, tipoNegocio, tipoOutro, nomeAdmin,
  estacoes, categorias, itens, mesas, formas, pdvs,
  saving = false, saveError = '',
  onEntrar, onBack,
}: StepConcluidoProps) {
  const tipoLabel = tipoNegocio === 'outro' && tipoOutro ? tipoOutro : (TIPOS_LABEL[tipoNegocio] ?? tipoNegocio);
  const totalMesas = mesas.temSalao
    ? mesas.quantidadeMesas + mesas.setores.reduce((acc, s) => acc + s.quantidadeMesas, 0)
    : 0;
  const totalSetores = mesas.temSalao ? 1 + mesas.setores.length : 0;
  const pdvsAtivos = pdvs.filter((p) => p.ativo);

  const blocosResumo = [
    {
      icon: 'ri-store-line',
      titulo: 'Estabelecimento',
      cor: 'amber',
      items: [
        { label: 'Nome', valor: nomeLoja },
        { label: 'Tipo', valor: tipoLabel },
      ],
    },
    {
      icon: 'ri-user-star-line',
      titulo: 'Conta do administrador',
      cor: 'emerald',
      items: [{ label: 'Nome', valor: nomeAdmin }],
    },
    {
      icon: 'ri-fire-line',
      titulo: `Estações da cozinha (${estacoes.length})`,
      cor: 'orange',
      items: estacoes.map((e) => ({ label: e.nome, valor: null as string | null, cor: e.cor as string | undefined })),
    },
    {
      icon: 'ri-menu-line',
      titulo: `Cardápio — ${categorias.length} categoria${categorias.length !== 1 ? 's' : ''}`,
      cor: 'sky',
      items: [
        ...categorias.map((c) => ({
          label: c.nome,
          valor: `${itens.filter((i) => i.categoriaId === c.id).length} item(ns)`,
          cor: undefined as string | undefined,
        })),
        ...(itens.length > 0 ? [{ label: 'Total de itens criados', valor: String(itens.length), cor: undefined as string | undefined }] : []),
      ],
    },
    {
      icon: 'ri-layout-grid-line',
      titulo: 'Mesas e setores',
      cor: 'violet',
      items: mesas.temSalao
        ? [
            { label: 'Salão principal', valor: `${mesas.quantidadeMesas} mesa${mesas.quantidadeMesas !== 1 ? 's' : ''}`, cor: undefined as string | undefined },
            ...mesas.setores.map((s) => ({ label: s.nome, valor: `${s.quantidadeMesas} mesa${s.quantidadeMesas !== 1 ? 's' : ''}`, cor: undefined as string | undefined })),
            { label: 'Total', valor: `${totalMesas} mesas em ${totalSetores} setor${totalSetores !== 1 ? 'es' : ''}`, cor: undefined as string | undefined },
          ]
        : [{ label: 'Modo operação', valor: 'Balcão / Delivery (sem mesas)', cor: undefined as string | undefined }],
    },
    {
      icon: 'ri-bank-card-line',
      titulo: `Formas de pagamento (${formas.length})`,
      cor: 'rose',
      items: formas.map((f) => ({ label: FORMAS_LABEL[f] ?? f, valor: null as string | null, cor: undefined as string | undefined })),
    },
    {
      icon: 'ri-computer-line',
      titulo: `Terminais PDV (${pdvsAtivos.length} ativo${pdvsAtivos.length !== 1 ? 's' : ''})`,
      cor: 'indigo',
      items: pdvsAtivos.map((p) => ({
        label: PDV_LABELS[p.id] ?? p.id,
        valor: null as string | null,
        cor: undefined as string | undefined,
        icon: PDV_ICONS[p.id],
      })),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col items-center text-center">
        <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-3xl mb-4">
          <i className="ri-checkbox-circle-line text-emerald-600 text-3xl" />
        </div>
        <h2 className="text-2xl font-black text-zinc-900 mb-1">Tudo pronto!</h2>
        <p className="text-sm text-zinc-500 max-w-sm">
          Seu estabelecimento está configurado e pronto para <strong>começar</strong>.
        </p>
      </div>

      {/* Resumo completo */}
      <div className="space-y-3">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Resumo da configuração</p>
        {blocosResumo.map((bloco) => {
          const cores = COR_CLASSES[bloco.cor];
          return (
            <div key={bloco.titulo} className={`rounded-xl border p-4 ${cores.bg}`}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ${cores.icon}`}>
                  <i className={`${bloco.icon} text-sm`} />
                </div>
                <p className="text-xs font-bold text-zinc-700">{bloco.titulo}</p>
              </div>
              <div className="space-y-1.5">
                {bloco.items.map((it, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {it.cor ? (
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: it.cor }} />
                      ) : (
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cores.dot}`} />
                      )}
                      <span className="text-xs text-zinc-600">{it.label}</span>
                    </div>
                    {it.valor !== null && it.valor !== undefined && (
                      <span className="text-xs font-semibold text-zinc-800">{it.valor}</span>
                    )}
                  </div>
                ))}
                {bloco.items.length === 0 && (
                  <p className="text-xs text-zinc-400 italic">Nenhum item configurado</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Próximos passos */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: 'ri-menu-2-line', text: 'Complete o cardápio' },
          { icon: 'ri-group-line', text: 'Adicione operadores' },
          { icon: 'ri-qr-code-line', text: 'Imprima os QR Codes' },
        ].map((tip) => (
          <div key={tip.text} className="flex flex-col items-center gap-1.5 p-3 bg-zinc-50 rounded-xl text-center border border-zinc-100">
            <i className={`${tip.icon} text-zinc-400 text-lg`} />
            <p className="text-[10px] text-zinc-500 font-medium leading-tight">{tip.text}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={saving}
          className="px-5 py-3.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 disabled:opacity-40 cursor-pointer transition-colors whitespace-nowrap"
        >
          <i className="ri-arrow-left-line mr-1.5" />
          Voltar
        </button>
        <button
          onClick={onEntrar}
          disabled={saving}
          className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold py-3.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap text-sm flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0" />
              Configurando sua loja...
            </>
          ) : (
            'Entrar no sistema'
          )}
        </button>
      </div>

      {saveError && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <i className="ri-error-warning-line text-red-500 flex-shrink-0 text-sm mt-px" />
          <p className="text-xs text-red-600">{saveError}</p>
        </div>
      )}
    </div>
  );
}
