import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { GrupoOpcoes, OpcaoItem } from '@/types/cardapio';

export interface TemplateOptionData {
  nome: string;
  precoAdicional: number;
  descricao?: string;
  ingredientId?: string | null;
  productionRecipeId?: string | null;
  consumptionQuantity?: number;
  consumptionUnit?: string;
  source?: 'ingredient' | 'production';
}

export interface OptionGroupTemplate {
  id: string;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  templateData: TemplateOptionData[];
  createdAt?: string;
}

export function useOptionGroupTemplates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<OptionGroupTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await invokeWithAuth<{
        id: string;
        name: string;
        is_required: boolean;
        min_selections: number;
        max_selections: number;
        template_data: TemplateOptionData[];
        created_at: string;
      }[]>('menu-write', {
        body: {
          action: 'fetch_templates',
          payload: {},
          active_tenant_id: user.tenantId,
        },
      });

      if (error) {
        console.error('[useOptionGroupTemplates] fetch error:', error.message);
        return;
      }

      const raw = data as unknown;
      const list = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).data)
          ? (raw as Record<string, unknown>).data
          : [];

      const mapped: OptionGroupTemplate[] = (list as {
        id: string;
        name: string;
        is_required: boolean;
        min_selections: number;
        max_selections: number;
        template_data: TemplateOptionData[];
        created_at: string;
      }[]).map((row) => ({
        id: row.id,
        name: row.name,
        isRequired: row.is_required ?? false,
        minSelections: row.min_selections ?? 0,
        maxSelections: row.max_selections ?? 1,
        templateData: (row.template_data ?? []) as TemplateOptionData[],
        createdAt: row.created_at,
      }));

      setTemplates(mapped);
    } catch (err) {
      console.error('[useOptionGroupTemplates] fetch exception:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const saveTemplate = useCallback(async (name: string, grupo: GrupoOpcoes): Promise<boolean> => {
    if (!user?.tenantId || !name.trim()) return false;
    setSaving(true);
    try {
      const templateData: TemplateOptionData[] = grupo.opcoes.map((o) => ({
        nome: o.nome,
        precoAdicional: o.precoAdicional,
        descricao: o.descricao,
        ingredientId: o.ingredientId ?? null,
        productionRecipeId: o.productionRecipeId ?? null,
        consumptionQuantity: o.consumptionQuantity,
        consumptionUnit: o.consumptionUnit,
        source: o.source,
      }));

      const { data, error } = await invokeWithAuth<{ id: string }>('menu-write', {
        body: {
          action: 'save_template',
          payload: {
            name: name.trim(),
            is_required: grupo.obrigatorio,
            min_selections: grupo.minSelecao,
            max_selections: grupo.maxSelecao,
            template_data: templateData,
          },
          active_tenant_id: user.tenantId,
        },
      });

      if (error) {
        console.error('[useOptionGroupTemplates] save error:', error.message);
        return false;
      }

      if (data?.id) {
        await fetchTemplates();
      }
      return true;
    } catch (err) {
      console.error('[useOptionGroupTemplates] save exception:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [user?.tenantId, fetchTemplates]);

  const updateTemplate = useCallback(async (id: string, name: string, grupo: GrupoOpcoes): Promise<boolean> => {
    if (!user?.tenantId || !name.trim()) return false;
    setSaving(true);
    try {
      const templateData: TemplateOptionData[] = grupo.opcoes.map((o) => ({
        nome: o.nome,
        precoAdicional: o.precoAdicional,
        descricao: o.descricao,
        ingredientId: o.ingredientId ?? null,
        productionRecipeId: o.productionRecipeId ?? null,
        consumptionQuantity: o.consumptionQuantity,
        consumptionUnit: o.consumptionUnit,
        source: o.source,
      }));

      const { error } = await invokeWithAuth('menu-write', {
        body: {
          action: 'update_template',
          payload: {
            id,
            name: name.trim(),
            is_required: grupo.obrigatorio,
            min_selections: grupo.minSelecao,
            max_selections: grupo.maxSelecao,
            template_data: templateData,
          },
          active_tenant_id: user.tenantId,
        },
      });

      if (error) {
        console.error('[useOptionGroupTemplates] update error:', error.message);
        return false;
      }

      await fetchTemplates();
      return true;
    } catch (err) {
      console.error('[useOptionGroupTemplates] update exception:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [user?.tenantId, fetchTemplates]);

  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    if (!user?.tenantId) return false;
    setSaving(true);
    try {
      const { error } = await invokeWithAuth('menu-write', {
        body: {
          action: 'delete_template',
          payload: { id },
          active_tenant_id: user.tenantId,
        },
      });

      if (error) {
        console.error('[useOptionGroupTemplates] delete error:', error.message);
        return false;
      }

      setTemplates((prev) => prev.filter((t) => t.id !== id));
      return true;
    } catch (err) {
      console.error('[useOptionGroupTemplates] delete exception:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [user?.tenantId]);

  const applyTemplate = useCallback((template: OptionGroupTemplate): GrupoOpcoes => {
    const opcoes: OpcaoItem[] = template.templateData.map((td) => ({
      id: `opc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      nome: td.nome,
      precoAdicional: td.precoAdicional,
      ativo: true,
      descricao: td.descricao,
      ingredientId: td.ingredientId ?? null,
      productionRecipeId: td.productionRecipeId ?? null,
      consumptionQuantity: td.consumptionQuantity,
      consumptionUnit: td.consumptionUnit,
      source: td.source,
    }));

    return {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      nome: template.name,
      obrigatorio: template.isRequired,
      minSelecao: template.minSelections,
      maxSelecao: template.maxSelections,
      ordem: 1,
      opcoes,
    };
  }, []);

  return {
    templates,
    loading,
    saving,
    fetchTemplates,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    applyTemplate,
  };
}