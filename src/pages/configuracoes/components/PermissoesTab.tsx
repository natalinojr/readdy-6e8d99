import { useState, useEffect, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useToast } from '@/contexts/ToastContext';

type Papel = 'admin' | 'gerente' | 'caixa' | 'garcom' | 'cozinha';

interface Permissao {
  id: string;
  categoria: string;
  descricao: string;
}

const papeis: { id: Papel; label: string; cor: string }[] = [
  { id: 'admin', label: 'Admin', cor: 'text-red-600 bg-red-50' },
  { id: 'gerente', label: 'Gerente', cor: 'text-orange-600 bg-orange-50' },
  { id: 'caixa', label: 'Caixa', cor: 'text-amber-600 bg-amber-50' },
  { id: 'garcom', label: 'Garçom', cor: 'text-green-600 bg-green-50' },
  { id: 'cozinha', label: 'Cozinha', cor: 'text-sky-600 bg-sky-50' },
];

const permissoes: Permissao[] = [
  { id: 'pdv_abrir_caixa', categoria: 'Caixa', descricao: 'Abrir caixa' },
  { id: 'pdv_fechar_caixa', categoria: 'Caixa', descricao: 'Fechar caixa' },
  { id: 'pdv_sangria', categoria: 'Caixa', descricao: 'Realizar sangria / suprimento' },
  { id: 'pdv_desconto', categoria: 'Caixa', descricao: 'Aplicar desconto em pedidos' },
  { id: 'pdv_cancelar_pedido', categoria: 'Pedidos', descricao: 'Cancelar pedido completo' },
  { id: 'pdv_cancelar_item', categoria: 'Pedidos', descricao: 'Cancelar item de pedido' },
  { id: 'pdv_editar_item_pos_kds', categoria: 'Pedidos', descricao: 'Editar item após envio ao KDS' },
  { id: 'pdv_estornar_pagamento', categoria: 'Pedidos', descricao: 'Estornar pagamento' },
  { id: 'garcom_fechar_mesa', categoria: 'Mesas', descricao: 'Fechar mesa e cobrar' },
  { id: 'garcom_transferir_mesa', categoria: 'Mesas', descricao: 'Transferir pedido entre mesas' },
  { id: 'cardapio_editar', categoria: 'Cardápio', descricao: 'Editar itens do cardápio' },
  { id: 'cardapio_alterar_preco', categoria: 'Cardápio', descricao: 'Alterar preços' },
  { id: 'estoque_movimentar', categoria: 'Estoque', descricao: 'Registrar movimentação de estoque' },
  { id: 'estoque_inventario', categoria: 'Estoque', descricao: 'Realizar inventário' },
  { id: 'kds_acessar', categoria: 'Cozinha', descricao: 'Acessar KDS (Display de Cozinha)' },
  { id: 'gestor_pedidos_acessar', categoria: 'Cozinha', descricao: 'Acessar Gestor de Pedidos' },
  { id: 'gestor_pedidos_entregar', categoria: 'Cozinha', descricao: 'Marcar pedidos como entregues no Gestor' },
  { id: 'relatorio_financeiro', categoria: 'Relatórios', descricao: 'Ver relatórios financeiros' },
  { id: 'relatorio_estoque', categoria: 'Relatórios', descricao: 'Ver relatórios de estoque' },
  { id: 'clientes_ver', categoria: 'Clientes', descricao: 'Ver base de clientes (CRM)' },
  { id: 'usuarios_gerenciar', categoria: 'Usuários', descricao: 'Gerenciar usuários' },
  { id: 'configuracoes_editar', categoria: 'Configurações', descricao: 'Editar configurações do sistema' },
  { id: 'auditoria_ver', categoria: 'Auditoria', descricao: 'Ver log de auditoria' },
];

const defaultPermissoes: Record<Papel, string[]> = {
  admin: permissoes.map((p) => p.id),
  gerente: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_desconto',
    'pdv_cancelar_pedido', 'pdv_cancelar_item', 'pdv_estornar_pagamento',
    'garcom_fechar_mesa', 'garcom_transferir_mesa', 'cardapio_editar',
    'estoque_movimentar', 'estoque_inventario',
    'kds_acessar', 'gestor_pedidos_acessar', 'gestor_pedidos_entregar',
    'relatorio_financeiro', 'relatorio_estoque', 'clientes_ver', 'auditoria_ver',
  ],
  caixa: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_cancelar_item',
  ],
  garcom: [
    'garcom_fechar_mesa', 'garcom_transferir_mesa',
  ],
  cozinha: [
    'kds_acessar',
    'gestor_pedidos_acessar',
    'gestor_pedidos_entregar',
  ],
};

const categorias = [...new Set(permissoes.map((p) => p.categoria))];

export default function PermissoesTab() {
  const { user } = useAuth();
  const { recarregar: recarregarPermissoes } = usePermissoes();
  const { success: toastSuccess, error: toastError } = useToast();
  const [matrix, setMatrix] = useState<Record<Papel, string[]>>(defaultPermissoes);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState('');

  // Load permissions from DB
  const carregarPermissoes = useCallback(async () => {
    if (!user?.tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await invokeWithAuth<{ success: boolean; data?: { role: string; permission_key: string; allowed: boolean }[] }>('config-write', {
        body: { action: 'get_permissions', tenant_id: user.tenantId },
      });

      if (!error && data?.success && data.data && data.data.length > 0) {
        // Build matrix from DB data
        const newMatrix: Record<Papel, string[]> = { admin: permissoes.map(p => p.id), gerente: [], caixa: [], garcom: [], cozinha: [] };
        data.data.forEach((row) => {
          const papel = row.role as Papel;
          if (papel !== 'admin' && newMatrix[papel] !== undefined && row.allowed) {
            newMatrix[papel].push(row.permission_key);
          }
        });
        setMatrix(newMatrix);
      }
      // If no DB data, keep defaults
    } catch (e) {
      console.error('[PermissoesTab] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { carregarPermissoes(); }, [carregarPermissoes]);

  const toggle = (papel: Papel, permId: string) => {
    if (papel === 'admin') return;
    setMatrix((prev) => {
      const atual = prev[papel];
      const nova = atual.includes(permId)
        ? atual.filter((p) => p !== permId)
        : [...atual, permId];
      return { ...prev, [papel]: nova };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!user?.tenantId) return;
    setSaving(true);
    setErro('');

    // Build flat array of all permissions (excluding admin — always full)
    const permissionsPayload: { role: string; permission_key: string; allowed: boolean }[] = [];
    const papeisSalvar: Papel[] = ['gerente', 'caixa', 'garcom', 'cozinha'];
    for (const papel of papeisSalvar) {
      for (const perm of permissoes) {
        permissionsPayload.push({
          role: papel,
          permission_key: perm.id,
          allowed: matrix[papel].includes(perm.id),
        });
      }
    }

    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: {
        action: 'upsert_permissions',
        tenant_id: user.tenantId,
        permissions: permissionsPayload,
      },
    });

    setSaving(false);

    if (error || !data?.success) {
      const msg = error?.message || data?.error || 'Erro ao salvar permissões.';
      setErro(msg);
      toastError('Erro ao salvar permissões', msg);
      return;
    }

    // Força recarregamento imediato das permissões no contexto global
    recarregarPermissoes();

    setSaved(true);
    toastSuccess('Permissões salvas!', 'As permissões por papel foram atualizadas com sucesso.');
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Permissões por Papel</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Configure o que cada papel pode fazer no sistema. Admin sempre tem acesso total.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60 ${
            saved ? 'bg-emerald-500 text-white' : 'bg-amber-500 hover:bg-amber-600 text-white'
          }`}
        >
          <div className="w-4 h-4 flex items-center justify-center">
            {saving
              ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <i className={saved ? 'ri-check-line' : 'ri-save-line'} />
            }
          </div>
          {saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar Permissões'}
        </button>
      </div>

      {erro && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <i className="ri-alert-line text-red-500 text-sm" />
          <p className="text-xs font-semibold text-red-700">{erro}</p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
        {/* Header de papéis */}
        <div className="grid border-b border-zinc-100" style={{ gridTemplateColumns: '1fr repeat(5, 90px)' }}>
          <div className="px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Permissão</div>
          {papeis.map((p) => (
            <div key={p.id} className="py-3 flex flex-col items-center gap-1">
              <div className="w-8 h-8 flex items-center justify-center">
                <Shield size={14} className="text-zinc-400" />
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.cor}`}>{p.label}</span>
            </div>
          ))}
        </div>

        {/* Linhas por categoria */}
        {categorias.map((cat) => {
          const itens = permissoes.filter((p) => p.categoria === cat);
          return (
            <div key={cat}>
              <div className="bg-zinc-50 px-5 py-2 border-b border-zinc-100">
                <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">{cat}</span>
              </div>
              {itens.map((perm, idx) => (
                <div
                  key={perm.id}
                  className={`grid border-b border-zinc-50 hover:bg-zinc-50/60 transition-colors ${idx === itens.length - 1 ? 'border-zinc-100' : ''}`}
                  style={{ gridTemplateColumns: '1fr repeat(5, 90px)' }}
                >
                  <div className="px-5 py-3">
                    <span className="text-sm text-zinc-700">{perm.descricao}</span>
                  </div>
                  {papeis.map((papel) => {
                    const ativo = matrix[papel.id].includes(perm.id);
                    const isAdmin = papel.id === 'admin';
                    return (
                      <div key={papel.id} className="flex items-center justify-center py-3">
                        <button
                          onClick={() => toggle(papel.id, perm.id)}
                          disabled={isAdmin}
                          className={`w-5 h-5 rounded flex items-center justify-center transition-colors cursor-pointer ${
                            ativo
                              ? isAdmin
                                ? 'bg-red-500 text-white cursor-not-allowed'
                                : 'bg-amber-500 text-white hover:bg-amber-600'
                              : 'border-2 border-zinc-200 hover:border-zinc-300 bg-white'
                          }`}
                        >
                          {ativo && <i className="ri-check-line text-xs" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-400">
        Dica: Desativar uma permissão oculta ou bloqueia a funcionalidade para o papel. Usuários com papel Admin sempre têm acesso irrestrito.
      </p>
    </div>
  );
}
