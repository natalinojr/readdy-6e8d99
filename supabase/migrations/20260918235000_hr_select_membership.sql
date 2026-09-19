-- RH multi-loja (2026-09-18, aplicada pelo MCP): folha de agosto da El Patron Paranaguá sumia da tela
-- RH/Folha, do Relatório RH e da linha Pessoal da DRE para o dono — as policies de leitura de
-- hr_payroll dependiam de "user_tenants LIMIT 1" ou da loja do header. Mesmo padrão do fin_*
-- (20260912070000): leitura por membership real. O front sempre filtra por tenant_id.
drop policy if exists hr_payroll_select_membership on public.hr_payroll;
create policy hr_payroll_select_membership on public.hr_payroll for select to authenticated using (auth_is_member_of(tenant_id));
drop policy if exists hr_employees_select_membership on public.hr_employees;
create policy hr_employees_select_membership on public.hr_employees for select to authenticated using (auth_is_member_of(tenant_id));
-- BRECHA: "tenant_id = (SELECT hr_employees.tenant_id FROM users ...)" compara a coluna com ela mesma
-- (sempre verdadeiro), para TODOS os comandos e todos os papéis: qualquer usuário lia e alterava
-- funcionário (e salário) de qualquer loja. Gravação de RH é pela Edge Function (service role).
drop policy if exists hr_employees_tenant_isolation on public.hr_employees;
