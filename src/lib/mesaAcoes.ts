// Juntar mesas e mover/transferir mesa hoje só mudam a tela (estado local do MesasContext): não existe
// ação no table-write, então o próximo recarregamento desfaz tudo. Até o dono decidir implementar de
// verdade, as duas ações ficam desligadas na tela (o código continua lá). Para religar: true.
export const JUNTAR_MOVER_MESA_DISPONIVEL = false;

export const AVISO_JUNTAR_MOVER_MESA = 'Juntar e mover mesa ainda não gravam no sistema — em breve.';
