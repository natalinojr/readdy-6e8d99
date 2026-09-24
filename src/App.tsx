import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './router';
import { AppProviders } from './providers/AppProviders';
import ToastContainer from './components/base/ToastContainer';
import { Suspense } from 'react';
import { useWakeLock } from './hooks/useWakeLock';
import { reportError } from './lib/errorReporter';
import { ehErroCarregarTela, tentarRecarregarTela } from './lib/recargaTela';

// ─── Fallback de crash de render ────────────────────────────────────────────
function ErroAplicacao({ error }: { error?: Error }) {
  const naoCarregou = ehErroCarregarTela(error);
  if (naoCarregou) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-6 bg-amber-50 rounded-full">
            <i className="ri-wifi-off-line text-3xl text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold text-neutral-800 mb-2">Não consegui carregar esta tela</h2>
          <p className="text-sm text-neutral-500 mb-6">
            Pode ser a internet oscilando ou uma versão nova do sistema que acabou de sair. Confira a conexão e toque em recarregar.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-neutral-900 text-white text-sm rounded-md hover:bg-neutral-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 flex items-center justify-center mx-auto mb-6 bg-red-50 rounded-full">
          <i className="ri-error-warning-line text-3xl text-red-500" />
        </div>
        <h2 className="text-xl font-semibold text-neutral-800 mb-2">
          Algo deu errado
        </h2>
        <p className="text-sm text-neutral-500 mb-6">
          Ocorreu um erro inesperado na aplicação. Recarregue a página para continuar.
          Se o problema persistir, entre em contato com o suporte.
        </p>
        {error && (
          <details className="mb-4 text-left bg-red-50 border border-red-200 rounded-md p-3">
            <summary className="text-xs text-red-600 font-semibold cursor-pointer">Detalhes do erro</summary>
            <pre className="text-[10px] text-red-500 mt-2 overflow-auto max-h-32 whitespace-pre-wrap">{error.message}</pre>
          </details>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 bg-neutral-900 text-white text-sm rounded-md hover:bg-neutral-700 transition-colors cursor-pointer whitespace-nowrap"
        >
          Recarregar página
        </button>
      </div>
    </div>
  );
}

// ─── ErrorBoundary ───────────────────────────────────────────────────────────
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Arquivo da tela não baixou (rede ruim ou deploy novo): recarrega sozinho antes de mostrar erro.
    if (tentarRecarregarTela(error)) return;
    console.error('[ErrorBoundary] Crash de render capturado:', error.message, error.stack, info.componentStack);
    reportError(error, { fn: 'ErrorBoundary', context: { componentStack: (info.componentStack ?? '').slice(0, 1500) } });
    this.setState({ error });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback(this.state.error ?? new Error('Erro desconhecido'));
    }
    return this.props.children;
  }
}

// ─── App ─────────────────────────────────────────────────────────────────────
function App() {
  // Mantém a tela do dispositivo ligada enquanto o sistema estiver aberto
  // (essencial em tablets, que apagam a tela por inatividade). A própria
  // Screen Wake Lock API só age quando a aba está visível e é liberada ao sair.
  useWakeLock();

  return (
    <ErrorBoundary fallback={(err) => <ErroAplicacao error={err} />}>
      <AppProviders>
        <BrowserRouter basename={__BASE_PATH__}>
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-white">
              <div className="text-center">
                <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5 bg-amber-50 rounded-2xl border border-amber-100">
                  <i className="ri-loader-4-line text-2xl text-amber-500 animate-spin" />
                </div>
                <p className="text-sm font-bold text-zinc-800">Carregando...</p>
              </div>
            </div>
          }>
            <AppRoutes />
          </Suspense>
          <ToastContainer />
        </BrowserRouter>
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;