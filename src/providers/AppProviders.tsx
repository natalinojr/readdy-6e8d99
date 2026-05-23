import type { ReactNode, FC } from 'react';
import { ToastProvider } from '@/contexts/ToastContext';
import { AppModeProvider } from '@/contexts/AppModeContext';
import { KioskAuthProvider } from '@/contexts/KioskAuthContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { SystemSettingsProvider } from '@/contexts/SystemSettingsContext';
import { SessaoProvider } from '@/contexts/SessaoContext';
import { NotificacoesProvider } from '@/contexts/NotificacoesContext';
import { AuditoriaProvider } from '@/contexts/AuditoriaContext';
import { CardapioProvider } from '@/contexts/CardapioContext';
import { EstoqueProvider } from '@/contexts/EstoqueContext';
import { MesasProvider } from '@/contexts/MesasContext';
import { KDSProvider } from '@/contexts/KDSContext';
import { ImpressorasProvider } from '@/contexts/ImpressorasContext';
import { ProducaoProvider } from '@/contexts/ProducaoContext';
import { ModoTreinoProvider } from '@/contexts/ModoTreinoContext';
import { MesaEdicaoProvider } from '@/contexts/MesaEdicaoContext';
import { AprovacoesProvider } from '@/contexts/AprovacoesContext';
import { ModoFaturamentoProvider } from '@/contexts/ModoFaturamentoContext';
import { PermissoesProvider } from '@/contexts/PermissoesContext';
import { OfflineProvider } from '@/contexts/OfflineContext';
import { VirtualKeyboardProvider } from '@/contexts/VirtualKeyboardContext';
import VirtualKeyboardOverlay from '@/components/feature/VirtualKeyboardOverlay';

// ── Compose helper ────────────────────────────────────────────────────────────
// Reduces an array of Providers into a single nested wrapper component,
// avoiding the deeply-indented "Provider Hell" in App.tsx.

type ProviderFC = FC<{ children: ReactNode }>;

function composeProviders(...providers: ProviderFC[]): ProviderFC {
  return providers.reduce<ProviderFC>(
    (Accumulated, Current) =>
      function ComposedProvider({ children }: { children: ReactNode }) {
        return (
          <Accumulated>
            <Current>{children}</Current>
          </Accumulated>
        );
      },
  );
}

// ── Provider groups ───────────────────────────────────────────────────────────

/**
 * CoreProviders — must be outermost; no dependencies on other contexts.
 * Order matters: Toast → AppMode → KioskAuth → Auth → SystemSettings
 */
const CoreProviders = composeProviders(
  ToastProvider,
  AppModeProvider,
  KioskAuthProvider,
  AuthProvider,
  SystemSettingsProvider,
);

/**
 * SessionProviders — depend on Auth being available.
 * Sessao must come before Auditoria and Notificacoes.
 */
const SessionProviders = composeProviders(
  SessaoProvider,
  NotificacoesProvider,
  AuditoriaProvider,
);

/**
 * DataProviders — depend on Auth + Sessao.
 * These fetch data from Supabase and expose it app-wide.
 */
const DataProviders = composeProviders(
  EstoqueProvider,
  ProducaoProvider,
  CardapioProvider,
  ImpressorasProvider,
  KDSProvider,
  MesasProvider,
);

/**
 * FeatureProviders — UI/interaction state that depends on data being loaded.
 */
const FeatureProviders = composeProviders(
  ModoTreinoProvider,
  MesaEdicaoProvider,
  AprovacoesProvider,
  ModoFaturamentoProvider,
  PermissoesProvider,
  OfflineProvider,
);

// ── Root export ───────────────────────────────────────────────────────────────

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <CoreProviders>
      <SessionProviders>
        <DataProviders>
          <FeatureProviders>
            <VirtualKeyboardProvider>
              {children}
              <VirtualKeyboardOverlay />
            </VirtualKeyboardProvider>
          </FeatureProviders>
        </DataProviders>
      </SessionProviders>
    </CoreProviders>
  );
}
