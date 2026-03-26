import { useLanguageStore } from '../store/languageStore'
import { translations, TranslationKey } from './translations'
import { ptBR } from 'date-fns/locale'

export function useT() {
  const lang = useLanguageStore(s => s.lang)
  const t = (key: TranslationKey): string => translations[lang][key] ?? translations.en[key]
  const dateLocale = lang === 'pt' ? { locale: ptBR } : {}
  return { t, lang, dateLocale }
}
