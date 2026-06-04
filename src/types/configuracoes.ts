export type VisaoCozinha = 'kds' | 'gestor' | 'ambos';

export interface ConfigOperacao {
  taxaServico: number;
  taxaServicoAtiva: boolean;
  gorjetaSugerida: number;
  gorjetaAtiva: boolean;
  tempoPadraoPreparo: number;
  senhaDescontoPerfil: 'gerente' | 'admin';
  modoCancelamento: 'livre' | 'senha_gerente' | 'proibido';
  impressaoAutomatica: boolean;
  impressaoKDS: boolean;
  impressaoViasCozinhaAtiva: boolean;
  autoatendimentoIdentificacao: 'nome' | 'senha' | 'comanda' | 'senha_balcao' | 'nenhum';
  autoatendimentoPagamento: 'hora' | 'entrega' | 'ambos';
  mensagemBoasVindas: string;
  mensagemRetorno: string;
  modoTreinoPadrao: boolean;
  horarioFechamentoCozinha: string;
  visaoCozinha: VisaoCozinha;
  timerVerdeMax: number;
  timerAmbarMax: number;
}

export type PDVTerminalId = 'caixa' | 'garcom' | 'kds' | 'autoatendimento' | 'mesa_qr' | 'delivery';

export interface PDVTerminal {
  id: PDVTerminalId;
  label: string;
  desc: string;
  icon: string;
  obrigatorio: boolean;
  ativo: boolean;
}

export interface OrigemPedido {
  id: string;
  label: string;
  icon: string;
  cor: string;
  ativo: boolean;
  descricao: string;
  bloqueiaEdicao?: boolean;
}