import { useState } from 'react';

interface Modulo {
  id: string;
  titulo: string;
  icon: string;
  cor: string;
  descricao: string;
  funcionalidades: {
    nome: string;
    descricao: string;
    perfis: string[];
  }[];
  dicas?: string[];
}

const MODULOS: Modulo[] = [
  {
    id: 'dashboard',
    titulo: 'Dashboard',
    icon: 'ri-dashboard-3-line',
    cor: 'text-amber-600 bg-amber-50 border-amber-100',
    descricao: 'Painel central com visão em tempo real de toda a operação.',
    funcionalidades: [
      { nome: 'Métricas em tempo real', descricao: 'Faturamento do dia, ticket médio, total de pedidos e mesas ocupadas atualizando ao vivo.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Gráfico de vendas', descricao: 'Evolução das vendas por hora do dia com comparativo do dia anterior.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Status dos pedidos', descricao: 'Contagem por status: aguardando, em preparo, prontos e entregues.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Alertas de estoque', descricao: 'Lista de insumos abaixo do estoque mínimo com acesso rápido.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Visão geral das mesas', descricao: 'Grid com status de cada mesa (livre, ocupada, aguardando) e tempo de ocupação.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Últimos pedidos', descricao: 'Feed dos pedidos mais recentes com nome do cliente, valor e canal de origem.', perfis: ['Admin', 'Gerente'] },
    ],
  },
  {
    id: 'pdv-caixa',
    titulo: 'PDV Caixa',
    icon: 'ri-shopping-cart-line',
    cor: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    descricao: 'Terminal de ponto de venda para operadores de caixa. Gerencia sessões, pedidos, pagamentos e sangrias.',
    funcionalidades: [
      { nome: 'Sessão de caixa', descricao: 'Abertura e fechamento com valor inicial. Relatório automático de sangrias, suprimentos e totais por forma de pagamento.', perfis: ['Caixa', 'Gerente', 'Admin'] },
      { nome: 'Criação de pedidos', descricao: 'Selecione itens do cardápio por categoria. Pedido para mesa, delivery ou consumo no local (avulso).', perfis: ['Caixa'] },
      { nome: 'Painel de mesas', descricao: 'Visualização e abertura de mesas diretamente pelo caixa, com status em tempo real.', perfis: ['Caixa'] },
      { nome: 'Pagamento multiformas', descricao: 'Divida o pagamento entre dinheiro, cartão, PIX e mais. Cálculo automático de troco.', perfis: ['Caixa'] },
      { nome: 'Desconto com autorização', descricao: 'Aplicar desconto requer senha do gerente. Tudo registrado no log de auditoria.', perfis: ['Caixa', 'Gerente'] },
      { nome: 'Estorno', descricao: 'Cancelar um pagamento já processado com motivo obrigatório. Registrado na auditoria.', perfis: ['Gerente', 'Admin'] },
      { nome: 'Sangria e suprimento', descricao: 'Retirada e entrada de dinheiro no caixa com registro de motivo e responsável.', perfis: ['Caixa', 'Gerente'] },
      { nome: 'Painel KDS (cozinha)', descricao: 'Visualização dos pedidos em preparo diretamente no caixa, sem precisar ir até a cozinha.', perfis: ['Caixa'] },
    ],
    dicas: ['Abra sempre a sessão de caixa antes de criar pedidos.', 'O fechamento de caixa gera um relatório completo para conferência.'],
  },
  {
    id: 'pdv-garcom',
    titulo: 'PDV Garçom',
    icon: 'ri-user-voice-line',
    cor: 'text-sky-600 bg-sky-50 border-sky-100',
    descricao: 'Interface mobile-first para garçons abrirem e gerenciarem pedidos em mesas.',
    funcionalidades: [
      { nome: 'Grid de mesas', descricao: 'Visualização rápida de todas as mesas com status, número de comensais e tempo de ocupação.', perfis: ['Garçom'] },
      { nome: 'Abrir mesa', descricao: 'Identificação de clientes (nome ou senha), número de pessoas e atribuição de mesa.', perfis: ['Garçom'] },
      { nome: 'Adicionar itens', descricao: 'Navegar pelo cardápio, adicionar observações, selecionar opções obrigatórias e enviar para o KDS.', perfis: ['Garçom'] },
      { nome: 'Editar pedido', descricao: 'Remover ou alterar itens de pedidos que ainda não foram confirmados pela cozinha.', perfis: ['Garçom'] },
      { nome: 'Transferir mesa', descricao: 'Mover um pedido aberto de uma mesa para outra em caso de realocação do cliente.', perfis: ['Garçom'] },
      { nome: 'Fechar conta', descricao: 'Encerrar o atendimento de uma mesa e enviar para pagamento no caixa.', perfis: ['Garçom'] },
      { nome: 'Chamados dos clientes', descricao: 'Lista de solicitações enviadas pelo QR Code das mesas (chamar garçom, pedir conta).', perfis: ['Garçom'] },
      { nome: 'Status da cozinha', descricao: 'Ver quais pedidos estão em preparo, prontos e o tempo de espera de cada mesa.', perfis: ['Garçom'] },
    ],
  },
  {
    id: 'kds',
    titulo: 'KDS — Kitchen Display System',
    icon: 'ri-monitor-line',
    cor: 'text-orange-600 bg-orange-50 border-orange-100',
    descricao: 'Display da cozinha. Mostra pedidos em tempo real separados por estação de preparo.',
    funcionalidades: [
      { nome: 'Colunas por status', descricao: 'Pedidos organizados em: Pendente → Em Preparo → Pronto. Arraste ou use botões para avançar.', perfis: ['Cozinha', 'KDS'] },
      { nome: 'Filtro por estação', descricao: 'Cada estação (Grelha, Frituras, etc.) pode visualizar apenas seus próprios pedidos.', perfis: ['Cozinha'] },
      { nome: 'Temporizador', descricao: 'Cada card mostra o tempo desde a entrada. Fica vermelho quando ultrapassa o SLA do item.', perfis: ['Cozinha'] },
      { nome: 'Ficha técnica no KDS', descricao: 'Acesso rápido à ficha técnica de cada item diretamente no card do pedido.', perfis: ['Cozinha'] },
      { nome: 'Registrar perda', descricao: 'Informar que um item foi descartado. Atualiza o estoque automaticamente.', perfis: ['Cozinha', 'Gerente'] },
      { nome: 'Som de novo pedido', descricao: 'Alerta sonoro quando chega um novo item na estação. Configurável por dispositivo.', perfis: ['Cozinha'] },
      { nome: 'Login por operador', descricao: 'Cada KDS pede a identificação do operador por matrícula ao ligar.', perfis: ['Cozinha'] },
    ],
    dicas: ['Deixe o KDS em modo tela cheia (F11) nos monitores da cozinha.'],
  },
  {
    id: 'cardapio',
    titulo: 'Cardápio',
    icon: 'ri-book-2-line',
    cor: 'text-rose-600 bg-rose-50 border-rose-100',
    descricao: 'Gerencie toda a estrutura de categorias, itens, combos e observações globais.',
    funcionalidades: [
      { nome: 'Categorias', descricao: 'Crie e organize categorias vinculadas a estações de cozinha. Defina a ordem de exibição no cardápio.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Itens', descricao: 'Nome, descrição, preço, foto, SLA de preparo, status ativo/inativo e código interno.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Grupos de opções', descricao: 'Opções obrigatórias ou opcionais (ex: Ponto da carne, Adicionais). Controle de mínimo e máximo.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Promoções', descricao: 'Preço promocional por dias da semana ou data específica. Ativação e desativação individual.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Ficha técnica', descricao: 'Relacione insumos do estoque com gramagem por item para cálculo automático de CMV.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Combos', descricao: 'Monte combos com itens do cardápio e defina preço de conjunto.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Observações globais', descricao: 'Lista padrão de observações que aparecem disponíveis para todos os itens.', perfis: ['Admin', 'Gerente'] },
    ],
  },
  {
    id: 'mesas',
    titulo: 'Mesas & Salão',
    icon: 'ri-layout-grid-line',
    cor: 'text-teal-600 bg-teal-50 border-teal-100',
    descricao: 'Mapa visual do salão com status em tempo real de cada mesa.',
    funcionalidades: [
      { nome: 'Mapa do salão', descricao: 'Visualização gráfica de todas as mesas por setor com status: livre, ocupada, aguardando pagamento.', perfis: ['Gerente', 'Admin'] },
      { nome: 'Detalhes da mesa', descricao: 'Clique em qualquer mesa para ver pedidos ativos, total da conta e tempo de ocupação.', perfis: ['Gerente', 'Admin'] },
      { nome: 'Juntar mesas', descricao: 'Unir duas ou mais mesas para grupos grandes. Os pedidos são consolidados.', perfis: ['Gerente', 'Admin', 'Garçom'] },
      { nome: 'Nova mesa rápida', descricao: 'Adicionar uma mesa temporária ao mapa sem precisar ir às configurações.', perfis: ['Gerente', 'Admin'] },
    ],
  },
  {
    id: 'estoque',
    titulo: 'Estoque',
    icon: 'ri-archive-line',
    cor: 'text-violet-600 bg-violet-50 border-violet-100',
    descricao: 'Controle completo de insumos, movimentações, inventário e CMV.',
    funcionalidades: [
      { nome: 'Insumos', descricao: 'Cadastro com unidade, estoque atual, mínimo e custo. Alertas automáticos de criticidade.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Movimentações', descricao: 'Histórico de entradas (NF), baixas automáticas por pedido, perdas e transferências entre estações.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Inventário', descricao: 'Processo guiado de contagem física com divergências destacadas antes da confirmação.', perfis: ['Admin', 'Gerente'] },
      { nome: 'CMV (Custo de Mercadoria Vendida)', descricao: 'Calculado automaticamente a partir das fichas técnicas. Exibição por item e por período.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Transferência entre estações', descricao: 'Mover insumos de uma estação para outra com registro de responsável.', perfis: ['Admin', 'Gerente'] },
    ],
  },
  {
    id: 'clientes',
    titulo: 'Clientes',
    icon: 'ri-heart-line',
    cor: 'text-pink-600 bg-pink-50 border-pink-100',
    descricao: 'CRM básico com histórico de visitas, preferências e perfil de consumo.',
    funcionalidades: [
      { nome: 'Perfil do cliente', descricao: 'Nome, contato, data da primeira e última visita, ticket médio e total de visitas.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Histórico de pedidos', descricao: 'Todos os pedidos anteriores com itens, valores e data.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Itens favoritos', descricao: 'Itens mais pedidos pelo cliente calculados automaticamente.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Segmentação', descricao: 'Filtros por frequência, ticket médio, período e canal de acesso (mesa, autoatendimento, caixa).', perfis: ['Admin', 'Gerente'] },
    ],
  },
  {
    id: 'relatorios',
    titulo: 'Relatórios',
    icon: 'ri-bar-chart-2-line',
    cor: 'text-indigo-600 bg-indigo-50 border-indigo-100',
    descricao: 'Análises de vendas, produtos, caixa, cancelamentos, SLA e origem dos pedidos.',
    funcionalidades: [
      { nome: 'Visão Geral', descricao: 'Faturamento bruto, líquido, cancelamentos e variação em relação ao período anterior.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Produtos', descricao: 'Ranking de itens mais vendidos por quantidade e faturamento. CMV e margem.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Caixa', descricao: 'Detalhamento de sessões abertas e fechadas com totais por forma de pagamento.', perfis: ['Admin', 'Gerente'] },
      { nome: 'SLA da Cozinha', descricao: 'Tempo médio de preparo por item e por estação. Pedidos fora do SLA.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Cancelamentos', descricao: 'Relatório de cancelamentos por motivo, valor e operador responsável.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Origem dos pedidos', descricao: 'Volume e faturamento por canal: PDV Caixa, Garçom, Autoatendimento, Mesa do cliente.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Clientes', descricao: 'Novos clientes, recorrentes, churn e ticket médio por período.', perfis: ['Admin', 'Gerente'] },
    ],
  },
  {
    id: 'autoatendimento',
    titulo: 'Autoatendimento (Kiosk)',
    icon: 'ri-tablet-line',
    cor: 'text-cyan-600 bg-cyan-50 border-cyan-100',
    descricao: 'Terminal de autoatendimento para clientes fazerem pedidos sem depender de garçom ou caixa.',
    funcionalidades: [
      { nome: 'Tela de boas-vindas', descricao: 'Mensagem personalizada para primeiro acesso ou retorno de clientes já cadastrados.', perfis: ['Clientes'] },
      { nome: 'Cardápio visual', descricao: 'Navegação por categorias com fotos, descrições e opções de cada item.', perfis: ['Clientes'] },
      { nome: 'Destino do pedido', descricao: 'Cliente escolhe entre comer no local, retirar no balcão ou delivery (conforme configuração).', perfis: ['Clientes'] },
      { nome: 'Identificação', descricao: 'Por nome digitado ou senha gerada. Configurável em Configurações → Operação.', perfis: ['Clientes'] },
      { nome: 'Pagamento na tela', descricao: 'QR Code PIX via Stone com confirmação automática. Opção de pagar na entrega.', perfis: ['Clientes'] },
    ],
    dicas: ['Configure em Configurações → Operação → Autoatendimento para ativar/desativar e escolher o fluxo.'],
  },
  {
    id: 'mesa-cliente',
    titulo: 'Mesa do Cliente (QR Code)',
    icon: 'ri-qr-code-line',
    cor: 'text-lime-700 bg-lime-50 border-lime-100',
    descricao: 'Cliente escaneia o QR da mesa e abre o cardápio interativo no celular para fazer pedidos.',
    funcionalidades: [
      { nome: 'Cardápio no celular', descricao: 'Navegação completa com fotos, opções e observações, otimizada para mobile.', perfis: ['Clientes'] },
      { nome: 'Identificação na mesa', descricao: 'Cliente informa nome e número de pessoas ao entrar. Associa ao pedido da mesa.', perfis: ['Clientes'] },
      { nome: 'Carrinho e pedido', descricao: 'Adiciona itens ao carrinho e confirma o envio direto para o KDS.', perfis: ['Clientes'] },
      { nome: 'Chamar garçom', descricao: 'Botão para solicitar atendimento. O chamado aparece no PDV Garçom.', perfis: ['Clientes'] },
      { nome: 'Pedir a conta', descricao: 'Solicitar a conta pelo celular sem precisar chamar o garçom.', perfis: ['Clientes'] },
      { nome: 'Pagamento PIX na mesa', descricao: 'Pagar diretamente pelo celular com QR Code PIX via Stone.', perfis: ['Clientes'] },
    ],
    dicas: ['Imprima os QR Codes em Configurações → Mesas → Imprimir todos os QR.'],
  },
  {
    id: 'usuarios',
    titulo: 'Usuários',
    icon: 'ri-group-line',
    cor: 'text-zinc-600 bg-zinc-50 border-zinc-100',
    descricao: 'Cadastro de todos os operadores do sistema com perfis, matrícula e link de convite.',
    funcionalidades: [
      { nome: 'Criação de usuário', descricao: 'Nome, e-mail, matrícula, senha e perfil de acesso. Dados para credencial de login.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Link de convite', descricao: 'Ao criar o usuário, gera um link único. O operador acessa pelo link e entra direto no setor certo.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Perfis de acesso', descricao: 'Admin, Gerente, Caixa, Garçom e Cozinha. Cada um acessa apenas as áreas permitidas.', perfis: ['Admin'] },
      { nome: 'Modo treino', descricao: 'Ativa o modo treino para um usuário específico. Pedidos e ações não afetam dados reais.', perfis: ['Admin', 'Gerente'] },
    ],
  },
  {
    id: 'configuracoes',
    titulo: 'Configurações',
    icon: 'ri-settings-3-line',
    cor: 'text-slate-600 bg-slate-50 border-slate-100',
    descricao: 'Central de configuração do sistema. Acessível apenas por Admin.',
    funcionalidades: [
      { nome: 'Dados da loja', descricao: 'Nome, CNPJ, endereço, telefone e logo do estabelecimento.', perfis: ['Admin'] },
      { nome: 'Mesas & QR Codes', descricao: 'Adicionar, editar, remover mesas. Gerar e imprimir QR Codes individuais ou em lote.', perfis: ['Admin'] },
      { nome: 'Estações da cozinha', descricao: 'Criar e editar estações com nome, cor e horário mínimo de funcionamento.', perfis: ['Admin'] },
      { nome: 'Formas de pagamento', descricao: 'Ativar/desativar e configurar taxas por forma de pagamento.', perfis: ['Admin'] },
      { nome: 'Taxa de serviço e gorjeta', descricao: 'Percentual de serviço adicionado automaticamente aos pedidos. Pode ser desativado.', perfis: ['Admin'] },
      { nome: 'Operação', descricao: 'Impressão automática, autoatendimento, cronômetro de mesas, mensagens de boas-vindas e retorno.', perfis: ['Admin'] },
      { nome: 'Permissões por perfil', descricao: 'Customizar quais ações cada perfil pode realizar (ex: garçom pode aplicar desconto?).', perfis: ['Admin'] },
      { nome: 'Credenciais Stone (PIX)', descricao: 'Configurar chaves de API para o gateway de pagamento PIX via Stone.', perfis: ['Admin'] },
      { nome: 'Modo treino por usuário', descricao: 'Ativar ou desativar o modo treino para cada operador individualmente.', perfis: ['Admin', 'Gerente'] },
    ],
  },
  {
    id: 'auditoria',
    titulo: 'Log de Auditoria',
    icon: 'ri-shield-check-line',
    cor: 'text-red-600 bg-red-50 border-red-100',
    descricao: 'Registro imutável de todas as ações relevantes. Quem fez o quê, quando e o que mudou.',
    funcionalidades: [
      { nome: 'Eventos registrados', descricao: 'Abertura/fechamento de caixa, descontos, estornos, edições no KDS, mudanças de preço, permissões e estoque.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Filtros avançados', descricao: 'Por tipo de evento, usuário, período (hoje, ontem, semana, mês ou personalizado).', perfis: ['Admin', 'Gerente'] },
      { nome: 'Exportar CSV', descricao: 'Baixe todos os registros filtrados em CSV para análise externa ou auditoria contábil.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Detalhe do evento', descricao: 'Clique em qualquer registro para ver o antes e o depois, quem autorizou e o motivo.', perfis: ['Admin', 'Gerente'] },
    ],
    dicas: ['Apenas Admin e Gerente têm acesso ao Log de Auditoria.'],
  },
  {
    id: 'modo-treino',
    titulo: 'Modo Treino',
    icon: 'ri-graduation-cap-line',
    cor: 'text-amber-700 bg-amber-50 border-amber-100',
    descricao: 'Ambiente isolado para treinar novos operadores sem afetar nenhum dado real.',
    funcionalidades: [
      { nome: 'Ativação por usuário', descricao: 'Admin ou Gerente ativa o modo treino para um usuário específico em Configurações ou na página de Usuários.', perfis: ['Admin', 'Gerente'] },
      { nome: 'Identificação visual', descricao: 'Banner laranja no topo, borda âmbar na tela inteira e marca d\'água TREINO. Impossível confundir.', perfis: ['Todos'] },
      { nome: 'Dados isolados', descricao: 'Pedidos, pagamentos e movimentações feitas em modo treino não aparecem nos relatórios nem no estoque.', perfis: ['Todos'] },
      { nome: 'Funcionalidades completas', descricao: 'O operador em treino pode usar todas as funcionalidades normalmente, inclusive KDS, caixa e cardápio.', perfis: ['Todos'] },
    ],
  },
  {
    id: 'onboarding',
    titulo: 'Configuração Inicial (Onboarding)',
    icon: 'ri-rocket-line',
    cor: 'text-fuchsia-600 bg-fuchsia-50 border-fuchsia-100',
    descricao: 'Wizard guiado para configurar o sistema do zero em 7 etapas.',
    funcionalidades: [
      { nome: 'Conta do admin', descricao: 'Nome, e-mail, matrícula e senha do administrador principal.', perfis: ['Admin'] },
      { nome: 'Dados do estabelecimento', descricao: 'Tipo de negócio, nome, CNPJ, telefone e endereço.', perfis: ['Admin'] },
      { nome: 'Estações de cozinha', descricao: 'Criar as estações iniciais (obrigatório ao menos uma para criar categorias no cardápio).', perfis: ['Admin'] },
      { nome: 'Categorias do cardápio', descricao: 'Criar as primeiras categorias vinculadas às estações. Itens podem ser adicionados depois.', perfis: ['Admin'] },
      { nome: 'Configuração de mesas', descricao: 'Se tem salão ou só balcão/delivery. Quantidade de mesas e setores.', perfis: ['Admin'] },
      { nome: 'Formas de pagamento', descricao: 'Quais formas de pagamento o estabelecimento aceita.', perfis: ['Admin'] },
    ],
    dicas: ['Para entrar pela primeira vez, acesse /login e clique em "Configurar nova loja".', 'Para adicionar operadores, crie os usuários e envie o link de convite.'],
  },
];

const PERFIL_LEVELS = ['Todos', 'Admin', 'Gerente', 'Caixa', 'Garçom', 'Cozinha', 'Clientes'];

export default function AjudaPage() {
  const [moduloAberto, setModuloAberto] = useState<string | null>('pdv-caixa');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroPerfil, setFiltroPerfil] = useState('Todos');

  const modulosFiltrados = MODULOS.filter((m) => {
    const textoMatch =
      filtroTexto === '' ||
      m.titulo.toLowerCase().includes(filtroTexto.toLowerCase()) ||
      m.descricao.toLowerCase().includes(filtroTexto.toLowerCase()) ||
      m.funcionalidades.some(
        (f) =>
          f.nome.toLowerCase().includes(filtroTexto.toLowerCase()) ||
          f.descricao.toLowerCase().includes(filtroTexto.toLowerCase())
      );
    const perfilMatch =
      filtroPerfil === 'Todos' ||
      m.funcionalidades.some((f) => f.perfis.includes(filtroPerfil));
    return textoMatch && perfilMatch;
  });

  const totalFuncionalidades = MODULOS.reduce((sum, m) => sum + m.funcionalidades.length, 0);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-zinc-100 bg-zinc-50/50 overflow-y-auto py-4 px-3">
        <div className="px-2 mb-4">
          <h2 className="text-xs font-black text-zinc-800 uppercase tracking-widest mb-0.5">Tutorial do Sistema</h2>
          <p className="text-[10px] text-zinc-400">{MODULOS.length} módulos · {totalFuncionalidades} funcionalidades</p>
        </div>
        {MODULOS.map((m) => (
          <button
            key={m.id}
            onClick={() => setModuloAberto(m.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left cursor-pointer transition-all mb-0.5 ${
              moduloAberto === m.id ? 'bg-white border border-zinc-100 text-zinc-900' : 'text-zinc-500 hover:bg-white hover:text-zinc-700'
            }`}
          >
            <i className={`${m.icon} text-base flex-shrink-0 ${moduloAberto === m.id ? 'text-amber-600' : 'text-zinc-400'}`} />
            <span className="text-xs font-semibold truncate">{m.titulo}</span>
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                placeholder="Buscar funcionalidade..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              {PERFIL_LEVELS.map((p) => (
                <button
                  key={p}
                  onClick={() => setFiltroPerfil(p)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded cursor-pointer transition-colors whitespace-nowrap ${
                    filtroPerfil === p ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Se há filtro de texto, mostrar todos os módulos filtrados */}
          {filtroTexto !== '' || filtroPerfil !== 'Todos' ? (
            <div className="space-y-4">
              <p className="text-xs text-zinc-500">
                {modulosFiltrados.length} módulo{modulosFiltrados.length !== 1 ? 's' : ''} encontrado{modulosFiltrados.length !== 1 ? 's' : ''}
                {filtroTexto && ` para "${filtroTexto}"`}
                {filtroPerfil !== 'Todos' && ` para perfil ${filtroPerfil}`}
              </p>
              {modulosFiltrados.map((m) => (
                <ModuloCard key={m.id} modulo={m} filtroTexto={filtroTexto} filtroPerfil={filtroPerfil} />
              ))}
              {modulosFiltrados.length === 0 && (
                <div className="text-center py-16">
                  <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-2xl mx-auto mb-3">
                    <i className="ri-search-line text-zinc-400 text-xl" />
                  </div>
                  <p className="text-sm text-zinc-500">Nenhum resultado encontrado</p>
                  <button
                    onClick={() => { setFiltroTexto(''); setFiltroPerfil('Todos'); }}
                    className="mt-2 text-xs text-amber-600 font-semibold cursor-pointer"
                  >
                    Limpar filtros
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Sem filtro: mostrar módulo selecionado no sidebar
            moduloAberto ? (
              <ModuloCard
                modulo={MODULOS.find((m) => m.id === moduloAberto)!}
                filtroTexto=""
                filtroPerfil="Todos"
                expandido
              />
            ) : (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                {MODULOS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setModuloAberto(m.id)}
                    className={`p-5 text-left border rounded-2xl hover:border-amber-200 cursor-pointer transition-all group ${m.cor.includes('bg-') ? '' : 'border-zinc-100'}`}
                  >
                    <div className={`w-10 h-10 flex items-center justify-center rounded-xl mb-3 ${m.cor.split(' ')[1]} ${m.cor.split(' ')[2]}`}>
                      <i className={`${m.icon} text-lg ${m.cor.split(' ')[0]}`} />
                    </div>
                    <h3 className="text-sm font-bold text-zinc-900 mb-1 group-hover:text-amber-700 transition-colors">{m.titulo}</h3>
                    <p className="text-xs text-zinc-400 line-clamp-2">{m.descricao}</p>
                    <p className="text-[10px] text-zinc-300 mt-2">{m.funcionalidades.length} funcionalidades</p>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ModuloCard({
  modulo,
  filtroTexto,
  filtroPerfil,
  expandido = false,
}: {
  modulo: Modulo;
  filtroTexto: string;
  filtroPerfil: string;
  expandido?: boolean;
}) {
  const [aberto, setAberto] = useState(expandido);

  const funcsFiltradas = modulo.funcionalidades.filter((f) => {
    const textoMatch =
      filtroTexto === '' ||
      f.nome.toLowerCase().includes(filtroTexto.toLowerCase()) ||
      f.descricao.toLowerCase().includes(filtroTexto.toLowerCase());
    const perfilMatch = filtroPerfil === 'Todos' || f.perfis.includes(filtroPerfil);
    return textoMatch && perfilMatch;
  });

  const [icone, ...resto] = modulo.cor.split(' ');
  const bgBorder = resto.join(' ');

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-4 p-5 cursor-pointer hover:bg-zinc-50/50 transition-colors text-left"
      >
        <div className={`w-11 h-11 flex items-center justify-center rounded-xl flex-shrink-0 ${bgBorder}`}>
          <i className={`${modulo.icon} text-xl ${icone}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-zinc-900">{modulo.titulo}</h3>
          <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{modulo.descricao}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full whitespace-nowrap">
            {funcsFiltradas.length} func.
          </span>
          <i className={`ri-arrow-${aberto ? 'up' : 'down'}-s-line text-zinc-400 text-lg`} />
        </div>
      </button>

      {aberto && (
        <div className="px-5 pb-5 border-t border-zinc-100 pt-4">
          <div className="space-y-3">
            {funcsFiltradas.map((f) => (
              <div key={f.nome} className="flex gap-3">
                <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-checkbox-circle-fill text-emerald-500 text-base" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-zinc-800">{f.nome}</span>
                    <div className="flex gap-1 flex-wrap">
                      {f.perfis.map((p) => (
                        <span key={p} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 whitespace-nowrap">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{f.descricao}</p>
                </div>
              </div>
            ))}
          </div>

          {modulo.dicas && modulo.dicas.length > 0 && (
            <div className="mt-4 p-3.5 bg-amber-50 border border-amber-100 rounded-xl">
              <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5 mb-2">
                <i className="ri-lightbulb-flash-line text-amber-600" />
                Dicas
              </p>
              <ul className="space-y-1">
                {modulo.dicas.map((d, i) => (
                  <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
