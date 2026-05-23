/**
 * BUG 3.9 FIX — useUserPreferences
 * Persiste preferências do usuário na tabela user_preferences.
 * Chave principal usada: "kds_default_station" para estação padrão do operador de cozinha.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface UserPreferences {
  kds_default_station?: string;
  [key: string]: string | undefined;
}

interface UseUserPreferencesResult {
  preferences: UserPreferences;
  loading: boolean;
  setPreference: (key: string, value: string) => Promise<void>;
  getPreference: (key: string) => string | undefined;
}

export function useUserPreferences(): UseUserPreferencesResult {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id || !user?.tenantId) {
      setLoading(false);
      return;
    }

    // Load preferences from DB
    supabase
      .from('user_preferences')
      .select('preference_key, preference_value')
      .eq('user_id', user.id)
      .eq('tenant_id', user.tenantId)
      .then(({ data }) => {
        if (data) {
          const prefs: UserPreferences = {};
          data.forEach((row) => {
            if (row.preference_value != null) {
              prefs[row.preference_key] = row.preference_value;
            }
          });
          setPreferences(prefs);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user?.id, user?.tenantId]);

  const setPreference = useCallback(
    async (key: string, value: string) => {
      if (!user?.id || !user?.tenantId) return;

      // Optimistic update
      setPreferences((prev) => ({ ...prev, [key]: value }));

      await supabase
        .from('user_preferences')
        .upsert(
          {
            user_id: user.id,
            tenant_id: user.tenantId,
            preference_key: key,
            preference_value: value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,tenant_id,preference_key' },
        );
    },
    [user?.id, user?.tenantId],
  );

  const getPreference = useCallback(
    (key: string): string | undefined => preferences[key],
    [preferences],
  );

  return { preferences, loading, setPreference, getPreference };
}
