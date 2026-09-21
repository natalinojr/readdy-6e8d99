import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import messages from './local/index';

// Idiomas que o produto sabe falar com o CLIENTE (delivery, mesa-qr, totem).
// O ERP por dentro segue só em português.
export const IDIOMAS_SUPORTADOS = ['pt-BR', 'en', 'es'] as const;
export type Idioma = (typeof IDIOMAS_SUPORTADOS)[number];

export const IDIOMA_PADRAO: Idioma = 'pt-BR';

// Onde fica a escolha do cliente. Mesma chave usada pelo seletor de idioma do
// cardápio, para que recarregar a página não volte tudo pro português.
export const CHAVE_IDIOMA = 'erpos_idioma';

export const NOME_IDIOMA: Record<Idioma, string> = {
  'pt-BR': 'Português',
  en: 'English',
  es: 'Español',
};

// 'en-US' → 'en'; 'pt' → 'pt-BR'; desconhecido → null.
export function normalizarIdioma(bruto: string | null | undefined): Idioma | null {
  const s = String(bruto ?? '').trim();
  if (!s) return null;
  if ((IDIOMAS_SUPORTADOS as readonly string[]).includes(s)) return s as Idioma;
  const base = s.split('-')[0].toLowerCase();
  if (base === 'pt') return 'pt-BR';
  if (base === 'en') return 'en';
  if (base === 'es') return 'es';
  return null;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Antes estava fixo em 'en' (andaime do Readdy). Como não existia nenhuma
    // tradução carregada, ninguém percebeu — o app sempre mostrou o texto
    // escrito no código, que é português. Agora o padrão é português de fato e
    // o cliente estrangeiro troca pelo seletor do cardápio.
    fallbackLng: IDIOMA_PADRAO,
    supportedLngs: IDIOMAS_SUPORTADOS as unknown as string[],
    nonExplicitSupportedLngs: true,
    debug: false,
    resources: messages,
    detection: {
      // A escolha explícita do cliente ganha do idioma do aparelho.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: CHAVE_IDIOMA,
      caches: [],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
