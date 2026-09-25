export type PerfilUsuario = 'admin' | 'gerente' | 'caixa' | 'garcom' | 'cozinha' | 'gestor_entregas' | 'tarefas' | 'totem' | 'financeiro' | 'supervisao' | 'contabilidade';

export const perfilConfig: Record<PerfilUsuario, { label: string; cor: string; bg: string; desc: string }> = {
  admin:           { label: 'Administrador',       cor: 'text-red-600',    bg: 'bg-red-50',    desc: 'Acesso total ao sistema' },
  gerente:         { label: 'Gerente',             cor: 'text-violet-600', bg: 'bg-violet-50', desc: 'Gestão da loja e relatórios' },
  supervisao:      { label: 'Supervisão',          cor: 'text-fuchsia-600', bg: 'bg-fuchsia-50', desc: 'Supervisiona o turno: caixa, autoriza cancelamento/desconto e vê relatórios do dia' },
  caixa:           { label: 'Caixa',               cor: 'text-amber-600',  bg: 'bg-amber-50',  desc: 'PDV e operação de caixa' },
  garcom:          { label: 'Garçom',              cor: 'text-emerald-600',bg: 'bg-emerald-50',desc: 'PDV garçom e mesas' },
  cozinha:         { label: 'Cozinha',             cor: 'text-sky-600',    bg: 'bg-sky-50',    desc: 'KDS e produção' },
  gestor_entregas: { label: 'Gestor de Entregas',  cor: 'text-orange-600', bg: 'bg-orange-50', desc: 'Acompanha as entregas — só o módulo Gestor de Entregas' },
  tarefas:         { label: 'Tarefas',             cor: 'text-indigo-600', bg: 'bg-indigo-50', desc: 'Acesso restrito — só o módulo de Tarefas' },
  totem:           { label: 'Totem',               cor: 'text-orange-600', bg: 'bg-orange-50', desc: 'Autoatendimento — login por matrícula + PIN' },
  financeiro:      { label: 'Financeiro',          cor: 'text-teal-600',   bg: 'bg-teal-50',   desc: 'Vê e opera só o módulo Financeiro' },
  contabilidade:   { label: 'Contabilidade',       cor: 'text-cyan-700',   bg: 'bg-cyan-50',   desc: 'Contador(a): vê DRE, contas, notas e folha; importa a folha e envia as guias (DAS, INSS, FGTS). Não paga nada' },
};
