export type PerfilUsuario = 'admin' | 'gerente' | 'caixa' | 'garcom' | 'cozinha' | 'totem';

export const perfilConfig: Record<PerfilUsuario, { label: string; cor: string; bg: string; desc: string }> = {
  admin:    { label: 'Administrador', cor: 'text-red-600',    bg: 'bg-red-50',    desc: 'Acesso total ao sistema' },
  gerente:  { label: 'Gerente',       cor: 'text-violet-600', bg: 'bg-violet-50', desc: 'Gestão da loja e relatórios' },
  caixa:    { label: 'Caixa',         cor: 'text-amber-600',  bg: 'bg-amber-50',  desc: 'PDV e operação de caixa' },
  garcom:   { label: 'Garçom',        cor: 'text-emerald-600',bg: 'bg-emerald-50',desc: 'PDV garçom e mesas' },
  cozinha:  { label: 'Cozinha',       cor: 'text-sky-600',    bg: 'bg-sky-50',    desc: 'KDS e produção' },
  totem:    { label: 'Totem',         cor: 'text-orange-600', bg: 'bg-orange-50', desc: 'Autoatendimento — login por matrícula + PIN' },
};
