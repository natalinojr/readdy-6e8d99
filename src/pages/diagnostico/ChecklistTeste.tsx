import { useState, useCallback } from 'react';

interface CheckItem {
  id: string;
  texto: string;
  dica?: string;
  status: 'pendente' | 'ok' | 'problema' | 'ignorado';
}

interface CheckSection {
  id: string;
  titulo: string;
  icon: string;
  cor: string;
  corBg: string;
  itens: CheckItem[];
}

const SECOES_INICIAIS: CheckSection[] = [
  {
    id: 'pdv',
    titulo: 'PDV Caixa',
    icon: 'ri-safe-2-line',
    cor: 'text-amber-600',
    corBg: 'bg-amber-50 border-amber-200',
    itens: [
      { id: 'pdv-1', texto: 'Iniciar sessão funciona corretamente', dica: 'Clique em "Iniciar Sessão" e verifique se a sessão é criada com número e horário', status: 'pendente' },
      { id: 'pdv-2', texto: 'Abertura de caixa registra fundo inicial', dica: 'Após iniciar sessão, abra o caixa com um valor de fundo (ex: R$ 100) e confirme', status: 'pendente' },
      { id: 'pdv-3', texto: 'Cardápio carrega itens e categorias', dica: 'Verifique se os itens aparecem na grade e se as categorias filtram corretamente', status: 'pendente' },
      { id: 'pdv-4', texto: 'Busca de itens funciona', dica: 'Digite o nome de um item na busca e verifique se filtra corretamente', status: 'pendente' },
      { id: 'pdv-5', texto: 'Adicionar item ao carrinho funciona', dica: 'Clique em um item simples (sem opções obrigatórias) e verifique se vai pro carrinho', status: 'pendente' },
      { id: 'pdv-6', texto: 'Item com opções obrigatórias abre modal de opções', dica: 'Clique em um item com complementos obrigatórios e verifique se o modal abre', status: 'pendente' },
      { id: 'pdv-7', texto: 'Destino do pedido funciona (mesa, nome, senha, hora)', dica: 'Teste cada tipo de destino antes de finalizar um pedido', status: 'pendente' },
      { id: 'pdv-8', texto: 'Pagamento finaliza pedido corretamente', dica: 'Finalize um pedido com dinheiro, cartão e PIX — verifique se o comprovante aparece', status: 'pendente' },
      { id: 'pdv-9', texto: 'Pedido aparece na aba "Pedidos" após finalizar', dica: 'Após pagar, vá na aba Pedidos e verifique se o pedido aparece com status correto', status: 'pendente' },
      { id: 'pdv-10', texto: 'Sangria registra e aparece no histórico', dica: 'Clique em Sangria, informe valor e motivo, confirme e verifique o histórico', status: 'pendente' },
      { id: 'pdv-11', texto: 'Suprimento registra e aparece no histórico', dica: 'Clique em Suprimento, informe valor e motivo, confirme e verifique o histórico', status: 'pendente' },
      { id: 'pdv-12', texto: 'Cancelamento de pedido funciona e registra na auditoria', dica: 'Cancele um pedido e verifique se aparece na aba Auditoria com motivo', status: 'pendente' },
      { id: 'pdv-13', texto: 'Desconto aplicado registra na auditoria', dica: 'Aplique um desconto em um pedido e verifique se aparece na auditoria', status: 'pendente' },
      { id: 'pdv-14', texto: 'Fechamento de caixa mostra resumo correto', dica: 'Feche o caixa e verifique se o valor esperado bate com as vendas realizadas', status: 'pendente' },
      { id: 'pdv-15', texto: 'Fechamento de sessão registra na auditoria', dica: 'Feche a sessão e verifique se aparece na aba Auditoria', status: 'pendente' },
      { id: 'pdv-16', texto: 'Atalhos de teclado funcionam (F2, F3, F4, Espaço)', dica: 'Teste os atalhos: F2 = pagamento, F3 = destino, F4 = limpar carrinho, Espaço = busca', status: 'pendente' },
      { id: 'pdv-17', texto: 'Painel de Mesas mostra mesas abertas', dica: 'Clique na aba Mesas no PDV e verifique se as mesas abertas aparecem', status: 'pendente' },
      { id: 'pdv-18', texto: 'Painel de Pedidos Recentes mostra pedidos do KDS', dica: 'Clique na aba Pedidos no PDV e verifique se os pedidos em preparo aparecem', status: 'pendente' },
    ],
  },
  {
    id: 'pedidos',
    titulo: 'Aba Pedidos',
    icon: 'ri-file-list-3-line',
    cor: 'text-sky-600',
    corBg: 'bg-sky-50 border-sky-200',
    itens: [
      { id: 'ped-1', texto: 'Pedidos do dia aparecem na lista', dica: 'Verifique se os pedidos feitos hoje aparecem com status, valor e origem corretos', status: 'pendente' },
      { id: 'ped-2', texto: 'Métricas (total, ticket médio, em aberto) estão corretas', dica: 'Compare os valores das métricas com os pedidos listados', status: 'pendente' },
      { id: 'ped-3', texto: 'Filtro por status funciona (aberto, pronto, entregue, cancelado)', dica: 'Teste cada filtro de status e verifique se a lista filtra corretamente', status: 'pendente' },
      { id: 'ped-4', texto: 'Filtro por origem funciona (caixa, garçom, mesa, delivery)', dica: 'Teste cada filtro de origem', status: 'pendente' },
      { id: 'ped-5', texto: 'Busca por número, nome ou item funciona', dica: 'Busque por número do pedido, nome do cliente e nome de um item', status: 'pendente' },
      { id: 'ped-6', texto: 'Detalhe do pedido abre com informações completas', dica: 'Clique em um pedido e verifique se mostra itens, pagamentos, SLA e status de cada item', status: 'pendente' },
      { id: 'ped-7', texto: 'Filtro por período funciona (hoje, ontem, 7 dias, mês)', dica: 'Teste os presets de período e verifique se os pedidos mudam', status: 'pendente' },
      { id: 'ped-8', texto: 'Modo Sessão filtra pedidos da sessão atual', dica: 'Alterne para modo Sessão e verifique se mostra apenas pedidos da sessão ativa', status: 'pendente' },
      { id: 'ped-9', texto: 'Exportar CSV gera arquivo correto', dica: 'Clique em Exportar CSV (resumo e detalhado) e verifique se o arquivo abre corretamente', status: 'pendente' },
      { id: 'ped-10', texto: 'Pedidos pagos mostram badge "Pago" corretamente', dica: 'Verifique se pedidos com pagamento registrado mostram o status de pagamento', status: 'pendente' },
    ],
  },
  {
    id: 'relatorios',
    titulo: 'Relatórios',
    icon: 'ri-bar-chart-2-line',
    cor: 'text-emerald-600',
    corBg: 'bg-emerald-50 border-emerald-200',
    itens: [
      { id: 'rel-1', texto: 'Visão Geral carrega métricas do dia', dica: 'Verifique faturamento, ticket médio, pedidos e comparativo com dia anterior', status: 'pendente' },
      { id: 'rel-2', texto: 'Calendário de Faturamento mostra dias com vendas', dica: 'Verifique se os dias com pedidos aparecem com valores no calendário', status: 'pendente' },
      { id: 'rel-3', texto: 'Produtos & Ranking mostra itens mais vendidos', dica: 'Verifique se o ranking de produtos está correto com quantidades e valores', status: 'pendente' },
      { id: 'rel-4', texto: 'CMV & Margem calcula corretamente', dica: 'Verifique se o CMV está sendo calculado com base nas fichas técnicas', status: 'pendente' },
      { id: 'rel-5', texto: 'SLA da Cozinha mostra tempos de preparo', dica: 'Verifique se os tempos médios de preparo por estação estão sendo registrados', status: 'pendente' },
      { id: 'rel-6', texto: 'Relatório de Caixa mostra abertura, fechamento e movimentos', dica: 'Verifique se sangrias, suprimentos e totais de venda aparecem no relatório de caixa', status: 'pendente' },
      { id: 'rel-7', texto: 'Cancelamentos mostra histórico com motivos', dica: 'Verifique se os cancelamentos aparecem com operador, valor e motivo', status: 'pendente' },
      { id: 'rel-8', texto: 'Origem dos Pedidos mostra distribuição por canal', dica: 'Verifique se o gráfico de origem (caixa, garçom, mesa, delivery) está correto', status: 'pendente' },
      { id: 'rel-9', texto: 'Filtro de período funciona em todas as abas', dica: 'Mude o período no header e verifique se todas as abas atualizam', status: 'pendente' },
    ],
  },
  {
    id: 'financeiro',
    titulo: 'Financeiro',
    icon: 'ri-money-dollar-circle-line',
    cor: 'text-orange-600',
    corBg: 'bg-orange-50 border-orange-200',
    itens: [
      { id: 'fin-1', texto: 'Visão Geral mostra saldo e movimentos recentes', dica: 'Verifique receitas, despesas e saldo do período', status: 'pendente' },
      { id: 'fin-2', texto: 'Receitas registra e lista corretamente', dica: 'Adicione uma receita manual e verifique se aparece na lista', status: 'pendente' },
      { id: 'fin-3', texto: 'Despesas registra e lista corretamente', dica: 'Adicione uma despesa e verifique se aparece com categoria e valor corretos', status: 'pendente' },
      { id: 'fin-4', texto: 'Fluxo de Caixa mostra entradas e saídas', dica: 'Verifique se o gráfico de fluxo de caixa está sendo alimentado pelas vendas', status: 'pendente' },
      { id: 'fin-5', texto: 'Contas a Pagar lista e permite marcar como pago', dica: 'Adicione uma conta a pagar e marque como paga — verifique se sai da lista de pendentes', status: 'pendente' },
      { id: 'fin-6', texto: 'Compras registra entrada de estoque', dica: 'Registre uma compra e verifique se o estoque do insumo é atualizado', status: 'pendente' },
      { id: 'fin-7', texto: 'DRE gera relatório com receitas e despesas', dica: 'Verifique se o DRE está calculando corretamente as categorias de receita e despesa', status: 'pendente' },
      { id: 'fin-8', texto: 'RH / Folha lista funcionários e calcula folha', dica: 'Verifique se os funcionários aparecem e se o cálculo de folha está correto', status: 'pendente' },
      { id: 'fin-9', texto: 'Bancos e Contas mostra saldos corretos', dica: 'Verifique se as contas bancárias estão listadas com saldos atualizados', status: 'pendente' },
      { id: 'fin-10', texto: 'Contas Vencidas alerta corretamente', dica: 'Verifique se contas com vencimento passado aparecem no painel de vencidas', status: 'pendente' },
    ],
  },
  {
    id: 'cardapio',
    titulo: 'Cardápio',
    icon: 'ri-restaurant-2-line',
    cor: 'text-rose-600',
    corBg: 'bg-rose-50 border-rose-200',
    itens: [
      { id: 'car-1', texto: 'Criar novo item funciona com imagem e preço', dica: 'Crie um item novo com nome, categoria, preço e imagem — verifique se salva corretamente', status: 'pendente' },
      { id: 'car-2', texto: 'Editar item atualiza no PDV em tempo real', dica: 'Edite o preço de um item e verifique se o PDV mostra o novo preço', status: 'pendente' },
      { id: 'car-3', texto: 'Ativar/desativar item funciona', dica: 'Desative um item e verifique se some do PDV; reative e verifique se volta', status: 'pendente' },
      { id: 'car-4', texto: 'Grupos de opções e complementos funcionam', dica: 'Adicione um grupo de opções obrigatório e teste no PDV', status: 'pendente' },
      { id: 'car-5', texto: 'Promoção de item funciona com preço promocional', dica: 'Ative uma promoção em um item e verifique se o PDV mostra o preço promocional', status: 'pendente' },
      { id: 'car-6', texto: 'Categorias criam e reordenam corretamente', dica: 'Crie uma categoria nova e verifique se aparece no PDV na ordem correta', status: 'pendente' },
      { id: 'car-7', texto: 'Combos funcionam com itens e preço especial', dica: 'Crie um combo e teste no PDV — verifique se o preço do combo é aplicado', status: 'pendente' },
      { id: 'car-8', texto: 'Ficha técnica vincula insumos ao item', dica: 'Adicione insumos na ficha técnica de um item e verifique se o CMV é calculado', status: 'pendente' },
      { id: 'car-9', texto: 'Observações globais aparecem no modal de opções', dica: 'Ative uma observação global e verifique se aparece ao adicionar qualquer item no PDV', status: 'pendente' },
    ],
  },
  {
    id: 'usuarios',
    titulo: 'Usuários',
    icon: 'ri-user-settings-line',
    cor: 'text-violet-600',
    corBg: 'bg-violet-50 border-violet-200',
    itens: [
      { id: 'usr-1', texto: 'Criar novo usuário funciona com matrícula gerada', dica: 'Crie um usuário novo e verifique se a matrícula é gerada automaticamente', status: 'pendente' },
      { id: 'usr-2', texto: 'Editar dados do usuário salva corretamente', dica: 'Edite o nome ou perfil de um usuário e verifique se salva', status: 'pendente' },
      { id: 'usr-3', texto: 'Ativar/desativar usuário funciona', dica: 'Desative um usuário e tente fazer login com ele — deve ser bloqueado', status: 'pendente' },
      { id: 'usr-4', texto: 'Redefinir senha funciona', dica: 'Redefina a senha de um usuário e faça login com a nova senha', status: 'pendente' },
      { id: 'usr-5', texto: 'PIN de operador funciona no KDS', dica: 'Defina um PIN para um operador e use no KDS para se identificar', status: 'pendente' },
      { id: 'usr-6', texto: 'Filtros por perfil e status funcionam', dica: 'Filtre por Admin, Gerente, Operador, etc. e verifique se a lista filtra corretamente', status: 'pendente' },
      { id: 'usr-7', texto: 'Exportar CSV de usuários funciona', dica: 'Clique em Exportar CSV e verifique se o arquivo contém todos os usuários', status: 'pendente' },
      { id: 'usr-8', texto: 'Excluir usuário remove do sistema', dica: 'Exclua um usuário de teste e verifique se some da lista', status: 'pendente' },
    ],
  },
  {
    id: 'configuracoes',
    titulo: 'Configurações',
    icon: 'ri-settings-3-line',
    cor: 'text-zinc-600',
    corBg: 'bg-zinc-50 border-zinc-200',
    itens: [
      { id: 'cfg-1', texto: 'Dados da Loja salva nome, endereço e CNPJ', dica: 'Edite os dados da loja e verifique se salva e aparece no comprovante', status: 'pendente' },
      { id: 'cfg-2', texto: 'Mesas & QR Codes cria e configura mesas', dica: 'Crie uma mesa nova e verifique se aparece no mapa do salão', status: 'pendente' },
      { id: 'cfg-3', texto: 'Estações de cozinha estão configuradas corretamente', dica: 'Verifique se as estações têm itens vinculados e se o KDS recebe os pedidos', status: 'pendente' },
      { id: 'cfg-4', texto: 'Métodos de pagamento estão ativos', dica: 'Verifique se Dinheiro, Cartão e PIX estão habilitados e aparecem no PDV', status: 'pendente' },
      { id: 'cfg-5', texto: 'Impressoras configuradas e testadas', dica: 'Teste a impressão de um comprovante e de um ticket de cozinha', status: 'pendente' },
      { id: 'cfg-6', texto: 'Configurações de operação (taxa de serviço, gorjeta) funcionam', dica: 'Ative a taxa de serviço e verifique se aparece no pagamento do PDV', status: 'pendente' },
      { id: 'cfg-7', texto: 'Permissões por perfil estão corretas', dica: 'Verifique se operadores não conseguem acessar módulos restritos (financeiro, auditoria)', status: 'pendente' },
    ],
  },
  {
    id: 'auditoria',
    titulo: 'Auditoria',
    icon: 'ri-shield-check-line',
    cor: 'text-teal-600',
    corBg: 'bg-teal-50 border-teal-200',
    itens: [
      { id: 'aud-1', texto: 'Abertura de caixa aparece na auditoria', dica: 'Abra o caixa e verifique se o evento "Abertura de caixa" aparece na aba Auditoria', status: 'pendente' },
      { id: 'aud-2', texto: 'Fechamento de caixa aparece na auditoria', dica: 'Feche o caixa e verifique se o evento aparece com valor contado e diferença', status: 'pendente' },
      { id: 'aud-3', texto: 'Sangria e suprimento aparecem na auditoria', dica: 'Faça uma sangria e um suprimento e verifique se ambos aparecem na auditoria', status: 'pendente' },
      { id: 'aud-4', texto: 'Cancelamento de pedido aparece na auditoria', dica: 'Cancele um pedido e verifique se aparece com severidade "Crítico"', status: 'pendente' },
      { id: 'aud-5', texto: 'Desconto aplicado aparece na auditoria', dica: 'Aplique um desconto e verifique se aparece na auditoria com valor', status: 'pendente' },
      { id: 'aud-6', texto: 'Emissão de voucher aparece na auditoria', dica: 'Emita um voucher e verifique se aparece na auditoria com código e valor', status: 'pendente' },
      { id: 'aud-7', texto: 'Filtros de auditoria funcionam (tipo, severidade, usuário, data)', dica: 'Teste cada filtro e verifique se a lista filtra corretamente', status: 'pendente' },
      { id: 'aud-8', texto: 'Painel de Alertas detecta eventos suspeitos', dica: 'Clique em "Alertas" e verifique se cancelamentos e sangrias altas aparecem', status: 'pendente' },
      { id: 'aud-9', texto: 'Exportar PDF de auditoria funciona', dica: 'Clique em PDF e verifique se o relatório abre com resumo executivo', status: 'pendente' },
      { id: 'aud-10', texto: 'Notificações críticas aparecem na Central de Notificações', dica: 'Faça um cancelamento de alto valor e verifique se aparece na Central de Notificações', status: 'pendente' },
    ],
  },
];

const STATUS_CONFIG = {
  pendente: { label: 'Pendente', icon: 'ri-checkbox-blank-circle-line', cls: 'text-zinc-400', bg: 'bg-zinc-100' },
  ok: { label: 'OK', icon: 'ri-checkbox-circle-fill', cls: 'text-emerald-600', bg: 'bg-emerald-100' },
  problema: { label: 'Problema', icon: 'ri-close-circle-fill', cls: 'text-red-500', bg: 'bg-red-100' },
  ignorado: { label: 'Ignorado', icon: 'ri-indeterminate-circle-fill', cls: 'text-zinc-400', bg: 'bg-zinc-100' },
};

export default function ChecklistTeste() {
  const [secoes, setSecoes] = useState<CheckSection[]>(SECOES_INICIAIS);
  const [secaoAberta, setSecaoAberta] = useState<string>('pdv');
  const [dicaAberta, setDicaAberta] = useState<string | null>(null);
  const [mostrarApenas, setMostrarApenas] = useState<'todos' | 'pendente' | 'problema'>('todos');

  const atualizarStatus = useCallback((secaoId: string, itemId: string, novoStatus: CheckItem['status']) => {
    setSecoes((prev) =>
      prev.map((s) =>
        s.id !== secaoId
          ? s
          : {
              ...s,
              itens: s.itens.map((i) =>
                i.id !== itemId ? i : { ...i, status: novoStatus }
              ),
            }
      )
    );
  }, []);

  const marcarTodosSecao = (secaoId: string, status: CheckItem['status']) => {
    setSecoes((prev) =>
      prev.map((s) =>
        s.id !== secaoId ? s : { ...s, itens: s.itens.map((i) => ({ ...i, status })) }
      )
    );
  };

  const resetarTudo = () => {
    setSecoes(SECOES_INICIAIS);
  };

  // Estatísticas globais
  const todosItens = secoes.flatMap((s) => s.itens);
  const totalItens = todosItens.length;
  const totalOk = todosItens.filter((i) => i.status === 'ok').length;
  const totalProblema = todosItens.filter((i) => i.status === 'problema').length;
  const totalPendente = todosItens.filter((i) => i.status === 'pendente').length;
  const progresso = Math.round((totalOk / totalItens) * 100);

  return (
    <div className="flex flex-col h-full bg-zinc-50">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 bg-white border-b border-zinc-100 flex-shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-task-line text-amber-600 text-lg" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Checklist de Testes</h1>
              <p className="text-xs text-zinc-400">Siga o checklist para validar cada módulo do sistema</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Filtro rápido */}
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              {([['todos', 'Todos'], ['pendente', 'Pendentes'], ['problema', 'Problemas']] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setMostrarApenas(v)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    mostrarApenas === v ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <button
              onClick={resetarTudo}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 bg-white text-zinc-500 text-xs font-semibold rounded-lg hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-refresh-line" /> Resetar tudo
            </button>
          </div>
        </div>

        {/* Barra de progresso */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                <i className="ri-checkbox-circle-fill" /> {totalOk} OK
              </span>
              {totalProblema > 0 && (
                <span className="flex items-center gap-1.5 text-red-500 font-semibold">
                  <i className="ri-close-circle-fill" /> {totalProblema} problema{totalProblema !== 1 ? 's' : ''}
                </span>
              )}
              <span className="text-zinc-400">{totalPendente} pendente{totalPendente !== 1 ? 's' : ''}</span>
            </div>
            <span className="text-sm font-black text-zinc-700">{progresso}%</span>
          </div>
          <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${progresso}%` }}
            />
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
        {secoes.map((secao) => {
          const itensVisiveis = secao.itens.filter((i) => {
            if (mostrarApenas === 'pendente') return i.status === 'pendente';
            if (mostrarApenas === 'problema') return i.status === 'problema';
            return true;
          });

          const okCount = secao.itens.filter((i) => i.status === 'ok').length;
          const problemaCount = secao.itens.filter((i) => i.status === 'problema').length;
          const totalSecao = secao.itens.length;
          const progressoSecao = Math.round((okCount / totalSecao) * 100);
          const aberta = secaoAberta === secao.id;

          if (mostrarApenas !== 'todos' && itensVisiveis.length === 0) return null;

          return (
            <div key={secao.id} className="bg-white border border-zinc-100 rounded-2xl overflow-hidden">
              {/* Header da seção */}
              <button
                onClick={() => setSecaoAberta(aberta ? '' : secao.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-50 transition-colors cursor-pointer text-left"
              >
                <div className={`w-8 h-8 flex items-center justify-center rounded-xl border ${secao.corBg} flex-shrink-0`}>
                  <i className={`${secao.icon} ${secao.cor} text-sm`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-zinc-800">{secao.titulo}</span>
                    {problemaCount > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">
                        {problemaCount} problema{problemaCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    {okCount === totalSecao && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded-full">
                        Completo!
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1 bg-zinc-100 rounded-full overflow-hidden max-w-[120px]">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${progressoSecao}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-zinc-400 font-medium">{okCount}/{totalSecao}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {aberta && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); marcarTodosSecao(secao.id, 'ok'); }}
                        className="text-[10px] font-semibold px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 cursor-pointer whitespace-nowrap transition-colors"
                      >
                        Marcar todos OK
                      </button>
                    </div>
                  )}
                  {aberta ? <i className="ri-arrow-up-s-line text-zinc-400 text-sm" /> : <i className="ri-arrow-down-s-line text-zinc-400 text-sm" />}
                </div>
              </button>

              {/* Itens */}
              {aberta && (
                <div className="border-t border-zinc-50 divide-y divide-zinc-50">
                  {itensVisiveis.map((item) => {
                    const cfg = STATUS_CONFIG[item.status];
                    const dicaVisivel = dicaAberta === item.id;
                    return (
                      <div key={item.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          {/* Número */}
                          <span className="text-[10px] font-mono text-zinc-300 mt-0.5 w-5 flex-shrink-0 text-right">
                            {item.id.split('-')[1]}
                          </span>

                          {/* Texto */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium leading-snug ${item.status === 'ok' ? 'text-zinc-400 line-through' : item.status === 'ignorado' ? 'text-zinc-300 line-through' : 'text-zinc-700'}`}>
                              {item.texto}
                            </p>
                            {item.dica && (
                              <button
                                onClick={() => setDicaAberta(dicaVisivel ? null : item.id)}
                                className="flex items-center gap-1 mt-1 text-[11px] text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"
                              >
                                <i className={`ri-${dicaVisivel ? 'eye-off' : 'lightbulb'}-line text-xs`} />
                                {dicaVisivel ? 'Ocultar dica' : 'Ver dica'}
                              </button>
                            )}
                            {dicaVisivel && item.dica && (
                              <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                                <p className="text-xs text-amber-700 leading-relaxed">{item.dica}</p>
                              </div>
                            )}
                          </div>

                          {/* Botões de status */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => atualizarStatus(secao.id, item.id, 'ok')}
                              title="Marcar como OK"
                              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                                item.status === 'ok'
                                  ? 'bg-emerald-100 text-emerald-600'
                                  : 'bg-zinc-50 text-zinc-300 hover:bg-emerald-50 hover:text-emerald-500'
                              }`}
                            >
                              <i className="ri-check-line text-sm" />
                            </button>
                            <button
                              onClick={() => atualizarStatus(secao.id, item.id, 'problema')}
                              title="Marcar como problema"
                              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                                item.status === 'problema'
                                  ? 'bg-red-100 text-red-500'
                                  : 'bg-zinc-50 text-zinc-300 hover:bg-red-50 hover:text-red-400'
                              }`}
                            >
                              <i className="ri-close-line text-sm" />
                            </button>
                            <button
                              onClick={() => atualizarStatus(secao.id, item.id, item.status === 'ignorado' ? 'pendente' : 'ignorado')}
                              title="Ignorar / Pular"
                              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                                item.status === 'ignorado'
                                  ? 'bg-zinc-200 text-zinc-500'
                                  : 'bg-zinc-50 text-zinc-300 hover:bg-zinc-100 hover:text-zinc-400'
                              }`}
                            >
                              <i className="ri-subtract-line text-sm" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {itensVisiveis.length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-zinc-400">
                      Nenhum item {mostrarApenas === 'pendente' ? 'pendente' : 'com problema'} nesta seção
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Resumo final */}
        {progresso === 100 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <div className="w-14 h-14 flex items-center justify-center bg-emerald-100 rounded-2xl mx-auto mb-3">
              <i className="ri-trophy-line text-emerald-600 text-2xl" />
            </div>
            <h3 className="text-base font-black text-emerald-800 mb-1">Checklist completo!</h3>
            <p className="text-sm text-emerald-600">Todos os {totalItens} itens foram verificados. Sistema validado!</p>
          </div>
        )}

        {totalProblema > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
                <i className="ri-error-warning-line text-red-500 text-sm" />
              </div>
              <div>
                <p className="text-sm font-bold text-red-800">
                  {totalProblema} problema{totalProblema !== 1 ? 's' : ''} encontrado{totalProblema !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-red-600">Revise os itens marcados como problema antes de usar em produção</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {secoes.flatMap((s) =>
                s.itens
                  .filter((i) => i.status === 'problema')
                  .map((i) => (
                    <div key={i.id} className="flex items-start gap-2 px-3 py-2 bg-white rounded-lg border border-red-100">
                      <i className="ri-close-circle-fill text-red-400 text-xs mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-red-400 uppercase">{s.titulo}</span>
                        <p className="text-xs text-red-700 font-medium">{i.texto}</p>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
