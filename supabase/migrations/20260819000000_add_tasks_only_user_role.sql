-- Novo papel de usuário restrito só ao módulo de Tarefas (mesma ideia do
-- delivery_manager, que já é restrito só ao Gestor de Entregas).
-- Aplicado direto via mcp__supabase__apply_migration (db push falha neste
-- repo — ver feedback_migracoes_sem_mcp na memória). Este arquivo é o
-- registro/fonte de verdade do que já está no ar.
alter type user_role add value if not exists 'tasks_only';
