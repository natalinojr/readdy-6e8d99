import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { useEstoque, type Insumo } from '@/contexts/EstoqueContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { perguntarAoAssistente } from '@/lib/assistenteFoco';
import { ASSISTENTE_OWNER_EMAIL } from '@/components/feature/AssistenteChat';
import { estaEsgotado, fmtQtd } from '@/lib/estoqueRegras';
import HistoricoComprasModal from '../HistoricoComprasModal';
import { useEstoqueTela } from '../../EstoqueTela';
import { btn, type ItemMenu } from '../ui/EstoqueUi';
import { regraDoInsumo, statusEstoque, unidadeDoBanco } from './InsumosUtils';

// Ações de um insumo que ficam no menu "⋯" da Lista (e podem ir no ⋯ da Ficha): aviso liga/desliga,
// entra na contagem, histórico de compras, marcar esgotado, editar, perguntar ao assistente e excluir.
// Editar usa a janela comum (editarInsumo); histórico, esgotado e excluir são janelas daqui, em `modais`.

// Um insumo em uma linha, para o assistente saber de qual o dono está falando (2026-09-16).
function focoDoInsumo(i: Insumo) {
  const un = unidadeDoBanco(i.unidade);
  return {
    tipo: 'insumo',
    id: i.id,
    titulo: `Insumo: ${i.nome} — ${fmtQtd(i.estoqueAtual, un)} em estoque (mínimo ${fmtQtd(i.estoqueMinimo, un)}), ${statusEstoque(i).label.toLowerCase()}`,
    dados: {
      nome: i.nome, categoria: i.categoria, unidade: i.unidade, estoque: i.estoqueAtual, minimo: i.estoqueMinimo,
      preco_unitario: i.precoUnitario, fornecedor: i.fornecedor ?? null, ultima_entrada: i.ultimaEntrada,
      ultima_compra: i.lastPurchasePrice ?? null, esgotado: estaEsgotado(regraDoInsumo(i)),
    },
  };
}

/**
 * O EstoqueContext não devolve o resultado de ligar/desligar aviso, tirar da contagem e marcar esgotado
 * (erro só vai para o console). Para nunca dizer "feito" sem ter sido, lê o insumo de volta do banco.
 */
async function lerNoBanco(tenantId: string, id: string) {
  const { data, error } = await supabase.rpc('fn_get_ingredients', { p_tenant_id: tenantId });
  if (error) return null;
  const r = ((data ?? []) as Array<Record<string, unknown>>).find((x) => x.id === id);
  if (!r) return null;
  return { acompanha: r.track_stock !== false, conta: r.count_inventory !== false, esgotado: r.is_depleted === true };
}

export function useAcoesInsumo(): {
  /** Itens do ⋯ de um insumo. `antes` entra no começo (ex.: "Ver histórico de preço" da tabela). */
  itensMenu: (i: Insumo, antes?: ItemMenu[]) => ItemMenu[];
  /** Janelas de confirmação e histórico de compras: renderizar uma vez na tela. */
  modais: ReactNode;
} {
  const { marcarInsumoEsgotado, setRastrearEstoque, setContaInventario, reloadInsumos } = useEstoque();
  const { user } = useAuth();
  const toast = useToast();
  const { editarInsumo, recarregarSituacao } = useEstoqueTela();
  const [confirmEsgotado, setConfirmEsgotado] = useState<Insumo | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<Insumo | null>(null);
  const [historicoModal, setHistoricoModal] = useState<Insumo | null>(null);
  const [salvandoEsgotado, setSalvandoEsgotado] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const tenantId = user?.tenantId;
  const dono = user?.email?.toLowerCase() === ASSISTENTE_OWNER_EMAIL;

  const alternarAviso = async (i: Insumo) => {
    if (!tenantId) return;
    const quer = i.rastrearEstoque === false; // hoje desligado → liga
    await setRastrearEstoque(i.id, quer);
    const r = await lerNoBanco(tenantId, i.id);
    void recarregarSituacao();
    if (!r) { toast.warning('Não consegui conferir a mudança', `Veja se ${i.nome} ficou como você queria.`); return; }
    if (r.acompanha !== quer) { toast.error('Não consegui mudar o aviso', `${i.nome} continua como estava. Tente de novo.`); return; }
    if (quer) toast.success(`${i.nome} voltou a ser acompanhado`);
    else toast.success(`${i.nome} ficou sem aviso`, 'O sistema não avisa nem bloqueia nada por causa dele.');
  };

  const alternarContagem = async (i: Insumo) => {
    if (!tenantId) return;
    const quer = i.contaInventario === false; // hoje fora → volta
    await setContaInventario(i.id, quer);
    const r = await lerNoBanco(tenantId, i.id);
    void recarregarSituacao();
    if (!r) { toast.warning('Não consegui conferir a mudança', `Veja se ${i.nome} ficou como você queria.`); return; }
    if (r.conta !== quer) { toast.error('Não consegui mudar a contagem', `${i.nome} continua como estava. Tente de novo.`); return; }
    if (quer) toast.success(`${i.nome} volta a entrar na contagem`);
    else toast.success(`${i.nome} saiu da contagem`, 'Não aparece mais no inventário.');
  };

  const confirmarEsgotado = async (i: Insumo) => {
    if (!tenantId) return;
    setSalvandoEsgotado(true);
    await marcarInsumoEsgotado(i.id, 'Estoque');
    const r = await lerNoBanco(tenantId, i.id);
    setSalvandoEsgotado(false);
    setConfirmEsgotado(null);
    void recarregarSituacao();
    if (!r) toast.warning('Não consegui conferir se ficou esgotado', 'Veja na lista.');
    else if (r.esgotado) toast.success(`${i.nome} marcado como esgotado`);
    else toast.error('Não marquei como esgotado', 'O servidor não aceitou. Tente de novo.');
  };

  const excluir = async (i: Insumo) => {
    if (!tenantId) return;
    setDeleteError(null);
    setDeleteLoading(true);
    try {
      const result = await invokeWithAuth('stock-write', {
        body: { action: 'delete_ingredient', tenant_id: tenantId, ingredient_id: i.id },
      });
      if (result.error) { setDeleteError(result.error.message); return; }
      await reloadInsumos();
      void recarregarSituacao();
      setConfirmExcluir(null);
      toast.success(`${i.nome} foi excluído`);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  const itensMenu = (i: Insumo, antes: ItemMenu[] = []): ItemMenu[] => {
    const acompanha = i.rastrearEstoque !== false;
    const conta = i.contaInventario !== false;
    return [
      ...antes,
      { rotulo: 'Histórico de compras', icone: 'ri-history-line', onClick: () => setHistoricoModal(i) },
      { rotulo: 'Editar insumo', icone: 'ri-edit-line', onClick: () => editarInsumo(i.id) },
      { rotulo: acompanha ? 'Parar de acompanhar' : 'Voltar a acompanhar', icone: acompanha ? 'ri-notification-off-line' : 'ri-notification-3-line', onClick: () => void alternarAviso(i) },
      { rotulo: conta ? 'Tirar da contagem' : 'Voltar à contagem', icone: conta ? 'ri-checkbox-blank-line' : 'ri-checkbox-line', onClick: () => void alternarContagem(i) },
      // Já zerado ou marcado: não há o que marcar (mesma regra de antes)
      { rotulo: 'Marcar como esgotado', icone: 'ri-forbid-2-line', onClick: () => setConfirmEsgotado(i), oculto: i.estoqueAtual <= 0 || i.esgotado },
      { rotulo: 'Perguntar ao assistente', icone: 'ri-robot-2-line', onClick: () => perguntarAoAssistente(focoDoInsumo(i), 'Sobre esse insumo: '), oculto: !dono },
      { rotulo: 'Excluir insumo', icone: 'ri-delete-bin-line', onClick: () => { setDeleteError(null); setConfirmExcluir(i); }, perigo: true },
    ];
  };

  const modais = (
    <>
      {confirmEsgotado && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                <i className="ri-forbid-2-line text-red-600 text-lg" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Marcar como esgotado?</p>
                <p className="text-xs text-zinc-500 mt-0.5">{confirmEsgotado.nome}</p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-4">O estoque será zerado e uma notificação será enviada para garçons e caixa.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmEsgotado(null)} disabled={salvandoEsgotado} className={`${btn('out')} flex-1`}>Cancelar</button>
              <button onClick={() => void confirmarEsgotado(confirmEsgotado)} disabled={salvandoEsgotado}
                className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold text-white bg-red-500 hover:bg-red-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap">
                {salvandoEsgotado ? <><i className="ri-loader-4-line animate-spin" /> Marcando...</> : 'Marcar esgotado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmExcluir && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Excluir insumo?</p>
                <p className="text-xs text-zinc-500 mt-0.5">{confirmExcluir.nome}</p>
              </div>
            </div>
            {deleteError && (
              <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-600 font-medium">{deleteError}</p>
              </div>
            )}
            <p className="text-xs text-zinc-500 mb-4">
              Esta ação não pode ser desfeita. O insumo será removido do sistema e das fichas técnicas vinculadas.
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setConfirmExcluir(null); setDeleteError(null); }} className={`${btn('out')} flex-1`}>Cancelar</button>
              <button onClick={() => void excluir(confirmExcluir)} disabled={deleteLoading}
                className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold text-white bg-red-500 hover:bg-red-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap">
                {deleteLoading ? <><i className="ri-loader-4-line animate-spin" /> Excluindo...</> : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historicoModal && <HistoricoComprasModal insumo={historicoModal} onClose={() => setHistoricoModal(null)} />}
    </>
  );

  return { itensMenu, modais };
}
