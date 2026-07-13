import type { RouteObject } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import { lazy } from 'react';
// Eager: shell + primeira pintura. O resto é lazy para não inchar o bundle inicial
// (o catálogo do cliente e o painel do motoboy não precisam carregar o ERP inteiro).
import Login from '../pages/login/page';
import AppLayout from '../components/feature/AppLayout';
import PullToRefresh from '@/components/feature/PullToRefresh';
import MobileKeyboardAssist from '@/components/feature/MobileKeyboardAssist';

// ── Páginas carregadas sob demanda (code-splitting por rota) ──────────────────
const NotFound = lazy(() => import('../pages/NotFound'));
const Dashboard = lazy(() => import('../pages/dashboard/page'));
const CardapioPage = lazy(() => import('../pages/cardapio/page'));
const PDVDeliveryPage = lazy(() => import('../pages/pdv/delivery/page'));
const PDVCaixaPage = lazy(() => import('../pages/pdv/caixa/page'));
const KDSPage = lazy(() => import('../pages/kds/page'));
const GestorPedidosPage = lazy(() => import('../pages/gestor-pedidos/page'));
const GestorEntregasPage = lazy(() => import('../pages/gestor-entregas/page'));
const GarcomPage = lazy(() => import('../pages/pdv/garcom/page'));
const MesasPage = lazy(() => import('../pages/mesas/page'));
const RelatoriosPage = lazy(() => import('../pages/relatorios/page'));
const EstoquePage = lazy(() => import('../pages/estoque/page'));
const MesaClientePage = lazy(() => import('../pages/mesa/page'));
const AutoatendimentoPage = lazy(() => import('../pages/autoatendimento/page'));
const TotemPage = lazy(() => import('../pages/totem/page'));
const ConfiguracoesPage = lazy(() => import('../pages/configuracoes/page'));
const ConfigDeliveryPage = lazy(() => import('../pages/config-delivery/page'));
const UsuariosPage = lazy(() => import('../pages/usuarios/page'));
const AuditoriaPage = lazy(() => import('../pages/auditoria/page'));
const ClientesPage = lazy(() => import('../pages/clientes/page'));
const PaginaEmConstrucao = lazy(() => import('../pages/common/PaginaEmConstrucao'));
const OnboardingPage = lazy(() => import('../pages/onboarding/page'));
const InvitePage = lazy(() => import('../pages/invite/page'));
const PerfilPage = lazy(() => import('../pages/perfil/page'));
const AjudaPage = lazy(() => import('../pages/ajuda/page'));
const PedidosPage = lazy(() => import('../pages/pedidos/page'));
const AprovacoesPage = lazy(() => import('../pages/aprovacoes/page'));
const ModulosPage = lazy(() => import('../pages/modulos/page'));
const SupabaseDebugPage = lazy(() => import('@/pages/supabase-debug/page'));
const FinanceiroPage = lazy(() => import('@/pages/financeiro/page'));
const PromocoesPage = lazy(() => import('@/pages/promocoes/page'));
const VouchersPage = lazy(() => import('@/pages/vouchers/page'));
const DiagnosticoPage = lazy(() => import('@/pages/diagnostico/page'));
const ImprimirQRCodesPage = lazy(() => import('@/pages/imprimir-qrcodes/page'));
const SimulacaoPedidos = lazy(() => import('@/pages/diagnostico/SimulacaoPedidos'));
const QADashboard = lazy(() => import('@/pages/diagnostico/QADashboard'));
const ChecklistTeste = lazy(() => import('@/pages/diagnostico/ChecklistTeste'));
const AdminMasterPage = lazy(() => import('@/pages/admin-master/page'));
const SelecionarLojaPage = lazy(() => import('@/pages/selecionar-loja/page'));
const TrafegoPagoPage = lazy(() => import('@/pages/trafego-pago/page'));
const PrivacidadePage = lazy(() => import('@/pages/privacidade/page'));

const MesaQRPage = lazy(() => import('../pages/mesa-qr/page'));
const VoucherLinkPage = lazy(() => import('../pages/voucher-link/page'));
const DeliveryPage = lazy(() => import('../pages/delivery/page'));
const MotoboyPage = lazy(() => import('../pages/motoboy/page'));
const MotoboyListaPage = lazy(() => import('../pages/motoboy-lista/page'));

const routes: RouteObject[] = [
  { path: '/login', element: <Login /> },
  { path: '/privacidade', element: <PrivacidadePage /> },
  { path: '/mesa/:mesaId', element: <MesaClientePage /> },
  { path: '/voucher/:token', element: <VoucherLinkPage /> },
  { path: '/mesa-qr/:qr_token/:session_token', element: <PullToRefresh><MobileKeyboardAssist /><MesaQRPage /></PullToRefresh> },
  { path: '/mesa-qr/:qr_token', element: <PullToRefresh><MobileKeyboardAssist /><MesaQRPage /></PullToRefresh> },
  { path: '/pedido/:qr_token/:session_token', element: <PullToRefresh><MobileKeyboardAssist /><MesaQRPage /></PullToRefresh> },
  { path: '/pedido/:qr_token', element: <PullToRefresh><MobileKeyboardAssist /><MesaQRPage /></PullToRefresh> },
  { path: '/delivery', element: <PullToRefresh><MobileKeyboardAssist /><DeliveryPage /></PullToRefresh> },
  { path: '/:storeSlug-delivery', element: <PullToRefresh><MobileKeyboardAssist /><DeliveryPage /></PullToRefresh> },
  { path: '/motoboy/:order_id', element: <PullToRefresh><MobileKeyboardAssist /><MotoboyPage /></PullToRefresh> },
  { path: '/entregas/:storeSlug', element: <PullToRefresh><MobileKeyboardAssist /><MotoboyListaPage /></PullToRefresh> },
  { path: '/autoatendimento', element: <AutoatendimentoPage /> },
  { path: '/totem/:token', element: <TotemPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/modulos" replace /> },
      { path: 'modulos', element: <ModulosPage /> },
      { path: 'onboarding', element: <OnboardingPage /> },
      { path: 'invite', element: <InvitePage /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'cardapio', element: <CardapioPage /> },
      { path: 'pdv/caixa', element: <PDVCaixaPage /> },
      { path: 'pdv/garcom', element: <GarcomPage /> },
      { path: 'pdv/delivery', element: <PDVDeliveryPage /> },
      { path: 'kds', element: <KDSPage /> },
      { path: 'gestor-pedidos', element: <GestorPedidosPage /> },
      { path: 'gestor-entregas', element: <GestorEntregasPage /> },
      { path: 'mesas', element: <MesasPage /> },
      { path: 'relatorios', element: <RelatoriosPage /> },
      { path: 'pedidos', element: <PedidosPage /> },
      { path: 'trafego-pago', element: <TrafegoPagoPage /> },
      { path: 'estoque', element: <EstoquePage /> },
      { path: 'aprovacoes', element: <AprovacoesPage /> },
      { path: 'configuracoes', element: <ConfiguracoesPage /> },
      { path: 'config-delivery', element: <ConfigDeliveryPage /> },
      { path: 'usuarios', element: <UsuariosPage /> },
      { path: 'clientes', element: <ClientesPage /> },
      { path: 'auditoria', element: <AuditoriaPage /> },
      { path: 'perfil', element: <PerfilPage /> },
      { path: 'ajuda', element: <AjudaPage /> },
      { path: 'financeiro', element: <FinanceiroPage /> },
      { path: 'promocoes', element: <PromocoesPage /> },
      { path: 'vouchers', element: <VouchersPage /> },
      { path: 'diagnostico', element: <DiagnosticoPage /> },
      { path: 'diagnostico/simulacao', element: <SimulacaoPedidos /> },
      { path: 'diagnostico/qa', element: <QADashboard /> },
      { path: 'diagnostico/checklist', element: <ChecklistTeste /> },
      { path: 'imprimir-qrcodes', element: <ImprimirQRCodesPage /> },
      { path: 'admin-master', element: <AdminMasterPage /> },
      { path: '*', element: <PaginaEmConstrucao /> },
    ],
  },
  { path: '/selecionar-loja', element: <SelecionarLojaPage /> },
  { path: '/supabase-debug', element: <SupabaseDebugPage /> },
  { path: '*', element: <NotFound /> },
];

export default routes;
