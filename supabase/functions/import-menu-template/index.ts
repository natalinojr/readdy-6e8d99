import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function generateUUID() {
  return crypto.randomUUID();
}

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { tenant_id, data, include, skipDuplicates, renamedItems } = body;
    const includeGroups: string[] = include ?? Object.keys(data).filter((k) => Array.isArray(data[k]) && (data[k] as unknown[]).length > 0);
    const shouldImport = (key: string) => includeGroups.includes(key);
    const skipDup = !!skipDuplicates;
    const renames: Record<string, Record<string, string>> = renamedItems ?? {};

    if (!tenant_id || !data) {
      return new Response(
        JSON.stringify({ error: "tenant_id e data são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const now = new Date().toISOString();

    // ─── Buscar nomes existentes para skip duplicates ───
    const existingNames: Record<string, string[]> = {};
    if (skipDup) {
      const [catsRes, itemsRes, combosRes, ingRes, prodRes] = await Promise.all([
        supabase.from("menu_categories").select("name").eq("tenant_id", tenant_id),
        supabase.from("menu_items").select("name").eq("tenant_id", tenant_id),
        supabase.from("combos").select("name").eq("tenant_id", tenant_id),
        supabase.from("ingredients").select("name").eq("tenant_id", tenant_id),
        supabase.from("production_recipes").select("name").eq("tenant_id", tenant_id),
      ]);
      existingNames.categorias = (catsRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []);
      existingNames.itens = (itemsRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []);
      existingNames.combos = (combosRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []);
      existingNames.insumos = (ingRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []);
      existingNames.producoes = (prodRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []);
    }

    const isDuplicate = (type: string, name: string) => {
      if (!skipDup) return false;
      return existingNames[type]?.includes(name.toLowerCase().trim()) ?? false;
    };

    const getRenamed = (type: string, name: string) => {
      return renames[type]?.[name] || name;
    };

    // ─── Mapas de UUIDs (oldId → newId) ───
    const stationMap: Record<string, string> = {};
    const categoryMap: Record<string, string> = {};
    const ingredientMap: Record<string, string> = {};
    const itemMap: Record<string, string> = {};
    const comboMap: Record<string, string> = {};
    const optionGroupMap: Record<string, string> = {};
    const recipeMap: Record<string, string> = {};
    const templateMap: Record<string, string> = {};
    const globalObsMap: Record<string, string> = {};

    const results = {
      stations: 0,
      categories: 0,
      ingredients: 0,
      items: 0,
      optionGroups: 0,
      options: 0,
      presetObservations: 0,
      globalObservations: 0,
      promotions: 0,
      itemIngredients: 0,
      itemProductionParts: 0,
      combos: 0,
      comboItems: 0,
      comboIngredients: 0,
      optionGroupTemplates: 0,
      productionRecipes: 0,
      productionRecipeItems: 0,
      productionRecipeSteps: 0,
      ingredientCategories: 0,
    };

    // ─── 1. Estações de cozinha ───
    if (shouldImport('stations') && data.stations?.length > 0) {
      const rows = data.stations.map((s: Record<string, unknown>) => {
        const newId = generateUUID();
        stationMap[s.id as string] = newId;
        return {
          id: newId,
          tenant_id,
          name: s.name,
          color: s.color,
          sort_order: s.sort_order,
          sla_minutes: s.sla_minutes,
          is_active: s.is_active ?? true,
          created_at: now,
          updated_at: now,
        };
      });
      const { error } = await supabase.from("kitchen_stations").insert(rows);
      if (error) console.error("[import] stations error:", error.message);
      else results.stations = rows.length;
    }

    // ─── 2. Categorias de ingredientes ───
    if (shouldImport('ingredientCategories') && data.ingredientCategories?.length > 0) {
      const rows = data.ingredientCategories.map((c: Record<string, unknown>) => ({
        id: generateUUID(),
        tenant_id,
        name: c.name,
        created_at: now,
      }));
      const { error } = await supabase.from("ingredient_categories").insert(rows);
      if (error) console.error("[import] ingredientCategories error:", error.message);
      else results.ingredientCategories = rows.length;
    }

    // ─── 3. Categorias do cardápio ───
    if (shouldImport('categories') && data.categories?.length > 0) {
      const rows = data.categories
        .filter((c: Record<string, unknown>) => !isDuplicate('categorias', c.name as string))
        .map((c: Record<string, unknown>) => {
          const newId = generateUUID();
          categoryMap[c.id as string] = newId;
          return {
            id: newId,
            tenant_id,
            name: getRenamed('categorias', c.name as string),
            station_id: c.station_id ? stationMap[c.station_id as string] ?? null : null,
            sort_order: c.sort_order ?? 0,
            is_active: c.is_active ?? true,
            created_at: now,
            updated_at: now,
          };
        });
      if (rows.length > 0) {
        const { error } = await supabase.from("menu_categories").insert(rows);
        if (error) console.error("[import] categories error:", error.message);
        else results.categories = rows.length;
      }
    }

    // ─── 4. Insumos (ingredients) ───
    if (shouldImport('ingredients') && data.ingredients?.length > 0) {
      const rows = data.ingredients
        .filter((i: Record<string, unknown>) => !isDuplicate('insumos', i.name as string))
        .map((i: Record<string, unknown>) => {
          const newId = generateUUID();
          ingredientMap[i.id as string] = newId;
          return {
            id: newId,
            tenant_id,
            name: getRenamed('insumos', i.name as string),
            unit: i.unit,
            unit_price: i.unit_price ?? 0,
            min_stock: i.min_stock ?? 0,
            current_stock: i.current_stock ?? 0,
            is_depleted: i.is_depleted ?? false,
            category: i.category ?? null,
            supplier: i.supplier ?? null,
            price_source: i.price_source ?? null,
            last_purchase_price: i.last_purchase_price ?? null,
            last_purchase_date: i.last_purchase_date ?? null,
            purchase_unit: i.purchase_unit ?? null,
            purchase_factor: i.purchase_factor ?? 1,
            supplier_id: i.supplier_id ?? null,
            dre_category_id: i.dre_category_id ?? null,
            usage_type: i.usage_type ?? 'final',
            created_at: now,
            updated_at: now,
          };
        });
      if (rows.length > 0) {
        const { error } = await supabase.from("ingredients").insert(rows);
        if (error) console.error("[import] ingredients error:", error.message);
        else results.ingredients = rows.length;
      }
    }

    // ─── 5. Fichas de produção (production_recipes) ───
    if (shouldImport('productionRecipes') && data.productionRecipes?.length > 0) {
      const rows = data.productionRecipes
        .filter((r: Record<string, unknown>) => !isDuplicate('producoes', r.name as string))
        .map((r: Record<string, unknown>) => {
          const newId = generateUUID();
          recipeMap[r.id as string] = newId;
          return {
            id: newId,
            tenant_id,
            name: getRenamed('producoes', r.name as string),
            unit: r.unit,
            instructions: r.instructions ?? null,
            is_active: r.is_active ?? true,
            weight_per_unit: r.weight_per_unit ?? null,
            output_ingredient_id: r.output_ingredient_id ? ingredientMap[r.output_ingredient_id as string] ?? null : null,
            default_batch_size: r.default_batch_size ?? null,
            output_quantity: r.output_quantity ?? 1,
            category: r.category ?? null,
            min_stock: r.min_stock ?? null,
            created_at: now,
            updated_at: now,
          };
        });
      if (rows.length > 0) {
        const { error } = await supabase.from("production_recipes").insert(rows);
        if (error) console.error("[import] productionRecipes error:", error.message);
        else results.productionRecipes = rows.length;
      }
    }

    // ─── 6. Itens das fichas de produção ───
    if (shouldImport('productionRecipeItems') && data.productionRecipeItems?.length > 0) {
      const rows = data.productionRecipeItems
        .filter((r: Record<string, unknown>) => recipeMap[r.recipe_id as string])
        .map((r: Record<string, unknown>) => ({
          id: generateUUID(),
          recipe_id: recipeMap[r.recipe_id as string],
          ingredient_id: r.ingredient_id ? ingredientMap[r.ingredient_id as string] ?? null : null,
          ingredient_name: r.ingredient_name,
          quantity: r.quantity ?? 0,
          unit: r.unit ?? 'unit',
          unit_cost: r.unit_cost ?? null,
          created_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("production_recipe_items").insert(rows);
        if (error) console.error("[import] productionRecipeItems error:", error.message);
        else results.productionRecipeItems = rows.length;
      }
    }

    // ─── 7. Passos das fichas de produção ───
    if (shouldImport('productionRecipeSteps') && data.productionRecipeSteps?.length > 0) {
      const rows = data.productionRecipeSteps
        .filter((r: Record<string, unknown>) => recipeMap[r.recipe_id as string])
        .map((r: Record<string, unknown>) => ({
          id: generateUUID(),
          recipe_id: recipeMap[r.recipe_id as string],
          step_order: r.step_order ?? 0,
          text: r.text,
          created_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("production_recipe_steps").insert(rows);
        if (error) console.error("[import] productionRecipeSteps error:", error.message);
        else results.productionRecipeSteps = rows.length;
      }
    }

    // ─── 8. Itens do cardápio (menu_items) ───
    if (shouldImport('items') && data.items?.length > 0) {
      const rows = data.items
        .filter((i: Record<string, unknown>) => !isDuplicate('itens', i.name as string))
        .map((i: Record<string, unknown>) => {
          const newId = generateUUID();
          itemMap[i.id as string] = newId;
          return {
            id: newId,
            tenant_id,
            category_id: i.category_id ? categoryMap[i.category_id as string] ?? null : null,
            name: getRenamed('itens', i.name as string),
            description: i.description ?? null,
            price: i.price ?? 0,
            photo_url: i.photo_url ?? null,
            sla_minutes: i.sla_minutes ?? null,
            is_active: i.is_active ?? true,
            skip_kds: i.skip_kds ?? null,
            sort_order: i.sort_order ?? null,
            channels: i.channels ?? null,
            delivery_config: i.delivery_config ?? null,
            is_featured: i.is_featured ?? false,
            created_at: now,
            updated_at: now,
          };
        });
      if (rows.length > 0) {
        const { error } = await supabase.from("menu_items").insert(rows);
        if (error) console.error("[import] items error:", error.message);
        else results.items = rows.length;
      }
    }

    // ─── 9. Grupos de opções ───
    if (shouldImport('optionGroups') && data.optionGroups?.length > 0) {
      const rows = data.optionGroups
        .filter((g: Record<string, unknown>) => itemMap[g.item_id as string])
        .map((g: Record<string, unknown>) => {
          const newId = generateUUID();
          optionGroupMap[g.id as string] = newId;
          return {
            id: newId,
            item_id: itemMap[g.item_id as string],
            tenant_id,
            name: g.name,
            is_required: g.is_required ?? false,
            min_selections: g.min_selections ?? 0,
            max_selections: g.max_selections ?? 1,
            sort_order: g.sort_order ?? 0,
            created_at: now,
            updated_at: now,
          };
        });
      if (rows.length > 0) {
        const { error } = await supabase.from("option_groups").insert(rows);
        if (error) console.error("[import] optionGroups error:", error.message);
        else results.optionGroups = rows.length;
      }
    }

    // ─── 10. Opções ───
    if (shouldImport('options') && data.options?.length > 0) {
      const rows = data.options
        .filter((o: Record<string, unknown>) => optionGroupMap[o.group_id as string])
        .map((o: Record<string, unknown>) => ({
          id: generateUUID(),
          group_id: optionGroupMap[o.group_id as string],
          tenant_id,
          name: o.name,
          additional_price: o.additional_price ?? 0,
          is_active: o.is_active ?? true,
          sort_order: o.sort_order ?? 0,
          ingredient_id: o.ingredient_id ? ingredientMap[o.ingredient_id as string] ?? null : null,
          production_recipe_id: o.production_recipe_id ? recipeMap[o.production_recipe_id as string] ?? null : null,
          consumption_quantity: o.consumption_quantity ?? null,
          created_at: now,
          updated_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("options").insert(rows);
        if (error) console.error("[import] options error:", error.message);
        else results.options = rows.length;
      }
    }

    // ─── 11. Observações pré-cadastradas por item ───
    if (shouldImport('presetObservations') && data.presetObservations?.length > 0) {
      const rows = data.presetObservations
        .filter((o: Record<string, unknown>) => itemMap[o.item_id as string])
        .map((o: Record<string, unknown>) => ({
          id: generateUUID(),
          item_id: itemMap[o.item_id as string],
          tenant_id,
          text: o.text,
          created_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("item_preset_observations").insert(rows);
        if (error) console.error("[import] presetObservations error:", error.message);
        else results.presetObservations = rows.length;
      }
    }

    // ─── 12. Observações globais ───
    if (shouldImport('globalObservations') && data.globalObservations?.length > 0) {
      const rows = data.globalObservations.map((o: Record<string, unknown>) => {
        const newId = generateUUID();
        globalObsMap[o.id as string] = newId;
        return {
          id: newId,
          tenant_id,
          text: o.text,
          is_active: o.is_active ?? true,
          excluded_item_ids: (o.excluded_item_ids ?? []).map((id: string) => itemMap[id] ?? id),
          excluded_category_ids: (o.excluded_category_ids ?? []).map((id: string) => categoryMap[id] ?? id),
          created_at: now,
          updated_at: now,
        };
      });
      const { error } = await supabase.from("global_observations").insert(rows);
      if (error) console.error("[import] globalObservations error:", error.message);
      else results.globalObservations = rows.length;
    }

    // ─── 13. Promoções por item ───
    if (shouldImport('promotions') && data.promotions?.length > 0) {
      const rows = data.promotions
        .filter((p: Record<string, unknown>) => itemMap[p.item_id as string])
        .map((p: Record<string, unknown>) => ({
          id: generateUUID(),
          item_id: itemMap[p.item_id as string],
          tenant_id,
          promotional_price: p.promotional_price ?? 0,
          is_recurring: p.is_recurring ?? false,
          days_of_week: p.days_of_week ?? [],
          specific_date: p.specific_date ?? null,
          is_active: p.is_active ?? true,
          created_at: now,
          updated_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("item_promotions").insert(rows);
        if (error) console.error("[import] promotions error:", error.message);
        else results.promotions = rows.length;
      }
    }

    // ─── 14. Ficha técnica (item_ingredients) ───
    if (shouldImport('itemIngredients') && data.itemIngredients?.length > 0) {
      const rows = data.itemIngredients
        .filter((f: Record<string, unknown>) => itemMap[f.item_id as string] && ingredientMap[f.ingredient_id as string])
        .map((f: Record<string, unknown>) => ({
          id: generateUUID(),
          tenant_id,
          item_id: itemMap[f.item_id as string],
          ingredient_id: ingredientMap[f.ingredient_id as string],
          quantity: f.quantity ?? 0,
          unit: f.unit ?? 'unit',
          created_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("item_ingredients").insert(rows);
        if (error) console.error("[import] itemIngredients error:", error.message);
        else results.itemIngredients = rows.length;
      }
    }

    // ─── 15. Partes de produção do item ───
    if (shouldImport('itemProductionParts') && data.itemProductionParts?.length > 0) {
      const rows = data.itemProductionParts
        .filter((p: Record<string, unknown>) => itemMap[p.item_id as string])
        .map((p: Record<string, unknown>) => ({
          id: generateUUID(),
          tenant_id,
          item_id: itemMap[p.item_id as string],
          name: p.name,
          station_name: p.station_name ?? null,
          station_id: p.station_id ? stationMap[p.station_id as string] ?? null : null,
          sla_minutes: p.sla_minutes ?? 10,
          sort_order: p.sort_order ?? 0,
          created_at: now,
          updated_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("item_production_parts").insert(rows);
        if (error) console.error("[import] itemProductionParts error:", error.message);
        else results.itemProductionParts = rows.length;
      }
    }

    // ─── 16. Combos ───
    if (shouldImport('combos') && data.combos?.length > 0) {
      const rows = data.combos
        .filter((c: Record<string, unknown>) => !isDuplicate('combos', c.name as string))
        .map((c: Record<string, unknown>) => {
          const newId = generateUUID();
          comboMap[c.id as string] = newId;
          return {
            id: newId,
            tenant_id,
            name: getRenamed('combos', c.name as string),
            description: c.description ?? null,
            photo_url: c.photo_url ?? null,
            price: c.price ?? 0,
            category_id: c.category_id ? categoryMap[c.category_id as string] ?? null : null,
            sla_minutes: c.sla_minutes ?? null,
            is_active: c.is_active ?? true,
            created_at: now,
            updated_at: now,
          };
        });
      if (rows.length > 0) {
        const { error } = await supabase.from("combos").insert(rows);
        if (error) console.error("[import] combos error:", error.message);
        else results.combos = rows.length;
      }
    }

    // ─── 17. Itens dos combos ───
    if (shouldImport('comboItems') && data.comboItems?.length > 0) {
      const rows = data.comboItems
        .filter((c: Record<string, unknown>) => comboMap[c.combo_id as string])
        .map((c: Record<string, unknown>) => ({
          id: generateUUID(),
          combo_id: comboMap[c.combo_id as string],
          tenant_id,
          item_id: c.item_id ? itemMap[c.item_id as string] ?? null : null,
          name: c.name ?? null,
          quantity: c.quantity ?? 1,
          price: c.price ?? null,
          created_at: now,
          updated_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("combo_items").insert(rows);
        if (error) console.error("[import] comboItems error:", error.message);
        else results.comboItems = rows.length;
      }
    }

    // ─── 18. Ingredientes dos combos ───
    if (shouldImport('comboIngredients') && data.comboIngredients?.length > 0) {
      const rows = data.comboIngredients
        .filter((c: Record<string, unknown>) => comboMap[c.combo_id as string])
        .map((c: Record<string, unknown>) => ({
          id: generateUUID(),
          combo_id: comboMap[c.combo_id as string],
          tenant_id,
          ingredient_id: ingredientMap[c.ingredient_id as string] ?? null,
          quantity: c.quantity ?? 0,
          unit: c.unit ?? 'unit',
          created_at: now,
          updated_at: now,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("combo_ingredients").insert(rows);
        if (error) console.error("[import] comboIngredients error:", error.message);
        else results.comboIngredients = rows.length;
      }
    }

    // ─── 19. Templates de grupos de opções ───
    if (shouldImport('optionGroupTemplates') && data.optionGroupTemplates?.length > 0) {
      const rows = data.optionGroupTemplates.map((t: Record<string, unknown>) => {
        const newId = generateUUID();
        templateMap[t.id as string] = newId;
        // Atualiza ingredient_id e production_recipe_id dentro do template_data
        const templateData = (t.template_data as Array<Record<string, unknown>>)?.map((td) => ({
          ...td,
          ingredientId: td.ingredientId ? ingredientMap[td.ingredientId as string] ?? null : null,
          productionRecipeId: td.productionRecipeId ? recipeMap[td.productionRecipeId as string] ?? null : null,
        })) ?? [];
        return {
          id: newId,
          tenant_id,
          name: t.name,
          is_required: t.is_required ?? false,
          min_selections: t.min_selections ?? 0,
          max_selections: t.max_selections ?? 1,
          template_data: templateData,
          created_at: now,
          updated_at: now,
        };
      });
      const { error } = await supabase.from("option_group_templates").insert(rows);
      if (error) console.error("[import] optionGroupTemplates error:", error.message);
      else results.optionGroupTemplates = rows.length;
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[import-menu-template] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
