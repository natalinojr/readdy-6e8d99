import { useState, useEffect, useCallback } from 'react';
import { Shield } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes, mesclarComPadrao, DEFAULT_PERMISSOES } from '@/hooks/usePermissoes';
import { FIN_ABAS, FIN_KEYS, REL_ABAS, REL_KEYS, CFG_ABAS, CFG_KEYS_GERENTE, CFG_MAQUININHA_KEY } from '@/constants/permissoesAbas';
import { GESTAO_TELAS, GESTAO_KEYS } from '@/constants/permissoesGestao';
import { useToast } from '@/contexts/ToastContext';

type Papel = 'admin' | 'gerente' | 'supervisao' | 'caixa' | 'garcom' | 'cozinha' | 'financeiro' | 'contabilidade';

interface Permissao {
  id: string;
  categoria: string;
  descricao: string;
  /** Financeiro: a página e as edges são só Admin/Gerente — nos outros papéis a caixa fica travada. */
  somenteGerente?: boolean;
  /** Só o Admin pode ter: quem edita a matriz de permissões se dá qualquer outra. */
  somenteAdmin?: boolean;
}

const papeis: { id: Papel; label: string; cor: string }[] = [
  { id: 'admin', label: 'Admin', cor: 'text-red-600 bg-red-50' },
  { id: 'gerente', label: 'Gerente', cor: 'text-orange-600 bg-orange-50' },
  { id: 'supervisao', label: 'Supervisão', cor: 'text-fuchsia-600 bg-fuchsia-50' },
  { id: 'caixa', label: 'Caixa', cor: 'text-amber-600 bg-amber-50' },
  { id: 'garcom', label: 'Garçom', cor: 'text-green-600 bg-green-50' },
  { id: 'cozinha', label: 'Cozinha', cor: 'text-sky-600 bg-sky-50' },
  // Contador(a): só as abas do Financeiro valem (o papel é preso a /financeiro).
  { id: 'contabilidade', label: 'Contabilidade', cor: 'text-cyan-700 bg-cyan-50' },
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
  // Qualquer papel pode ter (dono, 2026-09-22): abre só a tela Receber mercadoria (/receber),
  // sem dar a página de Estoque — é o que o Caixa da loja precisa para receber fornecedor.
  { id: 'estoque_receber', categoria: 'Estoque', descricao: 'Receber mercadoria (tela do celular da loja)' },
  // Módulo Recebimentos e pagamentos (2026-09-24): qualquer papel pode pedir; o pedido só vira
  // conta a pagar quando quem tem "Aprovar" aprova (padrão: só o Admin).
  { id: 'pag_reembolso', categoria: 'Pedidos de pagamento', descricao: 'Pedir reembolso (gastou do próprio bolso)' },
  { id: 'pag_freelancer', categoria: 'Pedidos de pagamento', descricao: 'Pedir pagamento de freelancer' },
  { id: 'pag_fornecedor', categoria: 'Pedidos de pagamento', descricao: 'Pedir pagamento de fornecedor sem nota' },
  { id: 'pag_aprovar', categoria: 'Pedidos de pagamento', descricao: 'Aprovar pedidos de pagamento (vira conta a pagar)', somenteGerente: true },
  { id: 'kds_acessar', categoria: 'Cozinha', descricao: 'Acessar KDS (Display de Cozinha)' },
  { id: 'gestor_pedidos_acessar', categoria: 'Cozinha', descricao: 'Acessar Gestor de Pedidos' },
  { id: 'gestor_pedidos_entregar', categoria: 'Cozinha', descricao: 'Marcar pedidos como entregues no Gestor' },
  { id: 'relatorio_estoque', categoria: 'Estoque', descricao: 'Ver relatórios de estoque' },
  ...GESTAO_TELAS.map((t) => ({ id: t.key, categoria: 'Gestão', descricao: `Tela ${t.label}` })),
  ...FIN_ABAS.map((a) => ({ id: a.key, categoria: 'Financeiro', descricao: `Aba ${a.label}`, somenteGerente: true })),
  ...REL_ABAS.map((a) => ({ id: a.key, categoria: 'Relatórios', descricao: `Aba ${a.label}` })),
  { id: 'relatorio_financeiro', categoria: 'Marketing', descricao: 'Acessar Tráfego Pago' },
  { id: 'clientes_ver', categoria: 'Clientes', descricao: 'Ver base de clientes (CRM)' },
  { id: 'usuarios_gerenciar', categoria: 'Usuários', descricao: 'Gerenciar usuários' },
  { id: 'configuracoes_editar', categoria: 'Configurações', descricao: 'Abrir a tela de Configurações' },
  // Aba a aba: sem `configuracoes_editar` nada disso aparece (a tela nem abre).
  // Qualquer papel pode receber (pedido do dono, 2026-09-21) — só a matriz de
  // Permissões continua sendo do Admin: quem a tem se dá qualquer outra permissão.
  ...CFG_ABAS.map((a) => ({
    id: a.key,
    categoria: 'Configurações',
    descricao: `Aba ${a.label}`,
    somenteAdmin: a.key === 'cfg_permissoes',
  })),
  // Fora das abas e sem trava de papel: dá acesso direto à configuração da
  // maquininha, sem abrir o resto de Estações & Pagamentos.
  { id: CFG_MAQUININHA_KEY, categoria: 'Configurações', descricao: 'Maquininha do balcão (Mercado Pago Point)' },
  { id: 'auditoria_ver', categoria: 'Auditoria', descricao: 'Ver log de auditoria' },
];

const defaultPermissoes: Record<Papel, string[]> = {
  admin: permissoes.map((p) => p.id),
  gerente: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_desconto',
    'pdv_cancelar_pedido', 'pdv_cancelar_item', 'pdv_estornar_pagamento',
    'garcom_fechar_mesa', 'garcom_transferir_mesa', 'cardapio_editar',
    'estoque_movimentar', 'estoque_inventario', 'estoque_receber',
    'pag_reembolso', 'pag_freelancer', 'pag_fornecedor',
    'kds_acessar', 'gestor_pedidos_acessar', 'gestor_pedidos_entregar',
    'relatorio_financeiro', 'relatorio_estoque', 'clientes_ver', 'auditoria_ver',
    // Sem `configuracoes_editar`: as abas só valem se o dono abrir a tela para o Gerente.
    ...FIN_KEYS, ...REL_KEYS, ...CFG_KEYS_GERENTE, CFG_MAQUININHA_KEY, ...GESTAO_KEYS,
  ],
  supervisao: [...DEFAULT_PERMISSOES.supervisao],
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
  financeiro: [...FIN_KEYS],
  contabilidade: [...DEFAULT_PERMISSOES.contabilidade],
};

const categorias = [...new Set(permissoes.map((p) => p.categoria))];

const papeisToDbRole: Record<Papel, string> = {
  admin: 'admin',
  gerente: 'manager',
  supervisao: 'supervisor',
  caixa: 'cashier',
  garcom: 'waiter',
  cozinha: 'kitchen',
  financeiro: 'financeiro',
  contabilidade: 'accountant',
};

const dbRoleToPapel: Record<string, Papel> = {
  admin: 'admin',
  manager: 'gerente',
  supervisor: 'supervisao',
  cashier: 'caixa',
  waiter: 'garcom',
  kitchen: 'cozinha',
  financeiro: 'financeiro',
  accountant: 'contabilidade',
};

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
        // Padrão do papel + o que foi salvo por cima: permissão nova (nunca salva) fica no padrão.
        const linhas = (p: Papel) => data.data!.filter((row) => dbRoleToPapel[row.role] === p);
        const newMatrix: Record<Papel, string[]> = {
          admin: permissoes.map(p => p.id),
          gerente: mesclarComPadrao(defaultPermissoes.gerente, linhas('gerente')),
          supervisao: mesclarComPadrao(defaultPermissoes.supervisao, linhas('supervisao')),
          caixa: mesclarComPadrao(defaultPermissoes.caixa, linhas('caixa')),
          garcom: mesclarComPadrao(defaultPermissoes.garcom, linhas('garcom')),
          cozinha: mesclarComPadrao(defaultPermissoes.cozinha, linhas('cozinha')),
          financeiro: mesclarComPadrao(defaultPermissoes.financeiro, linhas('financeiro')),
          contabilidade: mesclarComPadrao(defaultPermissoes.contabilidade, linhas('contabilidade')),
        };
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

  const travado = (papel: Papel, perm: Permissao) => {
    if (perm.somenteAdmin) return papel !== 'admin';
    // Contabilidade só entra no Financeiro; e mesmo lá o servidor só a deixa ler e mandar folha/guias.
    if (papel === 'contabilidade') return perm.categoria !== 'Financeiro';
    return !!perm.somenteGerente && papel !== 'admin' && papel !== 'gerente';
  };

  const toggle = (papel: Papel, permId: string) => {
    if (papel === 'admin') return;
    const perm = permissoes.find((p) => p.id === permId);
    if (perm && travado(papel, perm)) return;
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
    const papeisSalvar: Papel[] = ['gerente', 'supervisao', 'caixa', 'garcom', 'cozinha', 'contabilidade'];
    for (const papel of papeisSalvar) {
      for (const perm of permissoes) {
        permissionsPayload.push({
          role: papeisToDbRole[papel],
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
        <div className="grid border-b border-zinc-100" style={{ gridTemplateColumns: `1fr repeat(${papeis.length}, 90px)` }}>
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
                {cat === 'Financeiro' && (
                  <span className="ml-2 text-[11px] text-zinc-400 normal-case">— só Admin e Gerente acessam o Financeiro</span>
                )}
                {cat === 'Gestão' && (
                  <span className="ml-2 text-[11px] text-zinc-400 normal-case">— liberar qualquer uma já faz o módulo Gestão aparecer para o papel</span>
                )}
              </div>
              {itens.map((perm, idx) => (
                <div
                  key={perm.id}
                  className={`grid border-b border-zinc-50 hover:bg-zinc-50/60 transition-colors ${idx === itens.length - 1 ? 'border-zinc-100' : ''}`}
                  style={{ gridTemplateColumns: `1fr repeat(${papeis.length}, 90px)` }}
                >
                  <div className="px-5 py-3">
                    <span className="text-sm text-zinc-700">{perm.descricao}</span>
                  </div>
                  {papeis.map((papel) => {
                    const ativo = matrix[papel.id].includes(perm.id);
                    const isAdmin = papel.id === 'admin';
                    if (travado(papel.id, perm)) {
                      return (
                        <div key={papel.id} className="flex items-center justify-center py-3" title="Financeiro é só para Admin e Gerente">
                          <span className="text-zinc-300 text-sm">—</span>
                        </div>
                      );
                    }
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
