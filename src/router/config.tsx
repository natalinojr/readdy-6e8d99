import type { RouteObject } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import NotFound from '../pages/NotFound';
import Login from '../pages/login/page';
import AppLayout from '../components/feature/AppLayout';
import Dashboard from '../pages/dashboard/page';
import CardapioPage from '../pages/cardapio/page';
import PDVDeliveryPage from '../pages/pdv/delivery/page';
import PDVCaixaPage from '../pages/pdv/caixa/page';
import KDSPage from '../pages/kds/page';
import GestorPedidosPage from '../pages/gestor-pedidos/page';
import GestorEntregasPage from '../pages/gestor-entregas/page';
import GarcomPage from '../pages/pdv/garcom/page';
import MesasPage from '../pages/mesas/page';
import RelatoriosPage from '../pages/relatorios/page';
import EstoquePage from '../pages/estoque/page';
import MesaClientePage from '../pages/mesa/page';
import AutoatendimentoPage from '../pages/autoatendimento/page';
import TotemPage from '../pages/totem/page';
import ConfiguracoesPage from '../pages/configuracoes/page';
import ConfigDeliveryPage from '../pages/config-delivery/page';
import UsuariosPage from '../pages/usuarios/page';
import AuditoriaPage from '../pages/auditoria/page';
import ClientesPage from '../pages/clientes/page';
import PaginaEmConstrucao from '../pages/common/PaginaEmConstrucao';
import OnboardingPage from '../pages/onboarding/page';
import InvitePage from '../pages/invite/page';
import PerfilPage from '../pages/perfil/page';
import AjudaPage from '../pages/ajuda/page';
import PedidosPage from '../pages/pedidos/page';
import AprovacoesPage from '../pages/aprovacoes/page';
import ModulosPage from '../pages/modulos/page';
import SupabaseDebugPage from '@/pages/supabase-debug/page';
import FinanceiroPage from '@/pages/financeiro/page';
import PromocoesPage from '@/pages/promocoes/page';
import VouchersPage from '@/pages/vouchers/page';
import DiagnosticoPage from '@/pages/diagnostico/page';
import ImprimirQRCodesPage from '@/pages/imprimir-qrcodes/page';
import SimulacaoPedidos from '@/pages/diagnostico/SimulacaoPedidos';
import QADashboard from '@/pages/diagnostico/QADashboard';
import ChecklistTeste from '@/pages/diagnostico/ChecklistTeste';
import AdminMasterPage from '@/pages/admin-master/page';
import SelecionarLojaPage from '@/pages/selecionar-loja/page';
import TrafegoPagoPage from '@/pages/trafego-pago/page';
import PrivacidadePage from '@/pages/privacidade/page';
import { lazy } from 'react';
import PullToRefresh from '@/components/feature/PullToRefresh';
import MobileKeyboardAssist from '@/components/feature/MobileKeyboardAssist';

const MesaQRPage = lazy(() => import('../pages/mesa-qr/page'));
const DeliveryPage = lazy(() => import('../pages/delivery/page'));
const MotoboyPage = lazy(() => import('../pages/motoboy/page'));
const MotoboyListaPage = lazy(() => import('../pages/motoboy-lista/page'));

const routes: RouteObject[] = [
  { path: '/login', element: <Login /> },
  { path: '/privacidade', element: <PrivacidadePage /> },
  { path: '/mesa/:mesaId', element: <MesaClientePage /> },
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