import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
    const { tenant_id } = body;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ─── Estações de cozinha ───
    const { data: stations } = await supabase
      .from("kitchen_stations")
      .select("id, name, color, sort_order, sla_minutes, is_active")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Categorias ───
    const { data: categories } = await supabase
      .from("menu_categories")
      .select("id, name, station_id, sort_order, is_active")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Insumos (ingredients) ───
    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, name, unit, unit_price, min_stock, current_stock, is_depleted, category, supplier, price_source, last_purchase_price, last_purchase_date, purchase_unit, purchase_factor, supplier_id, dre_category_id, usage_type")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Itens (menu_items) ───
    const { data: items } = await supabase
      .from("menu_items")
      .select("id, category_id, name, description, price, photo_url, sla_minutes, is_active, skip_kds, sort_order, channels, delivery_config, is_featured")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Grupos de opções ───
    const { data: optionGroups } = await supabase
      .from("option_groups")
      .select("id, item_id, name, is_required, min_selections, max_selections, sort_order")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Opções ───
    const { data: options } = await supabase
      .from("options")
      .select("id, group_id, name, additional_price, is_active, sort_order, ingredient_id, production_recipe_id, consumption_quantity")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Observações pré-cadastradas por item ───
    const { data: presetObservations } = await supabase
      .from("item_preset_observations")
      .select("id, item_id, text")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Observações globais ───
    const { data: globalObservations } = await supabase
      .from("global_observations")
      .select("id, text, is_active, excluded_item_ids, excluded_category_ids")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Promoções por item ───
    const { data: promotions } = await supabase
      .from("item_promotions")
      .select("id, item_id, promotional_price, is_recurring, days_of_week, specific_date, is_active")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Ficha técnica (item_ingredients) ───
    const { data: itemIngredients } = await supabase
      .from("item_ingredients")
      .select("id, item_id, ingredient_id, quantity, unit")
      .eq("tenant_id", tenant_id);

    // ─── Partes de produção do item ───
    const { data: itemProductionParts } = await supabase
      .from("item_production_parts")
      .select("id, item_id, name, station_name, station_id, sla_minutes, sort_order")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Combos ───
    const { data: combos } = await supabase
      .from("combos")
      .select("id, name, description, photo_url, price, category_id, sla_minutes, is_active")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Itens dos combos ───
    const { data: comboItems } = await supabase
      .from("combo_items")
      .select("id, combo_id, item_id, name, quantity, price")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Ingredientes dos combos ───
    const { data: comboIngredients } = await supabase
      .from("combo_ingredients")
      .select("id, combo_id, ingredient_id, quantity, unit")
      .eq("tenant_id", tenant_id)
      .is("deleted_at", null);

    // ─── Templates de grupos de opções ───
    const { data: optionGroupTemplates } = await supabase
      .from("option_group_templates")
      .select("id, name, is_required, min_selections, max_selections, template_data")
      .eq("tenant_id", tenant_id);

    // ─── Fichas de produção ───
    const { data: productionRecipes } = await supabase
      .from("production_recipes")
      .select("id, name, unit, instructions, is_active, weight_per_unit, output_ingredient_id, default_batch_size, output_quantity, category, min_stock")
      .eq("tenant_id", tenant_id);

    // ─── Itens das fichas de produção ───
    const { data: productionRecipeItems } = await supabase
      .from("production_recipe_items")
      .select("id, recipe_id, ingredient_id, ingredient_name, quantity, unit, unit_cost")
      .in("recipe_id", productionRecipes?.map(r => r.id) ?? []);

    // ─── Passos das fichas de produção ───
    const { data: productionRecipeSteps } = await supabase
      .from("production_recipe_steps")
      .select("id, recipe_id, step_order, text")
      .in("recipe_id", productionRecipes?.map(r => r.id) ?? []);

    // ─── Categorias de ingredientes ───
    const { data: ingredientCategories } = await supabase
      .from("ingredient_categories")
      .select("id, name, created_at")
      .eq("tenant_id", tenant_id);

    const exportPayload = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      tenant_id,
      stations: stations ?? [],
      categories: categories ?? [],
      ingredients: ingredients ?? [],
      items: items ?? [],
      optionGroups: optionGroups ?? [],
      options: options ?? [],
      presetObservations: presetObservations ?? [],
      globalObservations: globalObservations ?? [],
      promotions: promotions ?? [],
      itemIngredients: itemIngredients ?? [],
      itemProductionParts: itemProductionParts ?? [],
      combos: combos ?? [],
      comboItems: comboItems ?? [],
      comboIngredients: comboIngredients ?? [],
      optionGroupTemplates: optionGroupTemplates ?? [],
      productionRecipes: productionRecipes ?? [],
      productionRecipeItems: productionRecipeItems ?? [],
      productionRecipeSteps: productionRecipeSteps ?? [],
      ingredientCategories: ingredientCategories ?? [],
    };

    return new Response(
      JSON.stringify({ success: true, data: exportPayload }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[export-menu-template] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
