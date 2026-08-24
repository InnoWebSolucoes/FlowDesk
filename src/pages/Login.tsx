import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useT } from '../i18n/useT'
import { useLanguageStore } from '../store/languageStore'

export function Login() {
  const navigate = useNavigate()
  const login = useAuthStore(s => s.login)
  const requestPasswordReset = useAuthStore(s => s.requestPasswordReset)
  const { toggle, lang } = useLanguageStore()
  const { t } = useT()

  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('flowdesk:rememberedEmail') ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  // Prefills the email next time. The session itself always persists, so this
  // is a convenience, not what keeps you signed in.
  const [remember, setRemember] = useState(() => {
    try {
      return !!localStorage.getItem('flowdesk:rememberedEmail')
    } catch {
      return false
    }
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) {
      setError(t('login_errorEmpty'))
      return
    }
    setLoading(true)
    const normalizedEmail = email.toLowerCase().trim()
    const { success } = await login(normalizedEmail, password)
    setLoading(false)
    if (success) {
      try {
        if (remember) localStorage.setItem('flowdesk:rememberedEmail', normalizedEmail)
        else localStorage.removeItem('flowdesk:rememberedEmail')
      } catch {
        // Blocked storage just means the email isn't prefilled next time.
      }
      const user = useAuthStore.getState().currentUser
      if (user?.role === 'admin') navigate('/admin/projects')
      else navigate('/employee/tasks')
    } else {
      setError(t('login_errorInvalid'))
    }
  }

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email) {
      setError(t('login_errorEmpty'))
      return
    }
    setLoading(true)
    await requestPasswordReset(email.toLowerCase().trim())
    setLoading(false)
    // Always show the same confirmation, regardless of whether the email exists,
    // so the form can't be used to enumerate registered accounts.
    setResetSent(true)
  }

  const switchToForgot = () => {
    setMode('forgot')
    setError('')
    setResetSent(false)
  }

  const switchToLogin = () => {
    setMode('login')
    setError('')
    setResetSent(false)
    setPassword('')
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-3 shadow-lg">
            <span className="text-white font-bold text-2xl">F</span>
          </div>
          <h1 className="text-text-main font-bold text-2xl">Flow Desk</h1>
          <p className="text-text-muted text-sm mt-1">{t('login_subtitle')}</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-2xl border border-border p-6 shadow-sm">
          {mode === 'login' ? (
            <>
              <h2 className="text-text-main font-semibold text-base mb-5">{t('login_heading')}</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-text-main text-sm font-medium mb-1.5">{t('login_email')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('login_emailPlaceholder')}
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-text-main text-sm font-medium">{t('login_password')}</label>
                    <button
                      type="button"
                      onClick={switchToForgot}
                      className="text-xs text-primary hover:text-primary-dark transition-colors"
                    >
                      {t('login_forgotPassword')}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-muted transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="remember"
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                    className="w-4 h-4 accent-primary rounded"
                  />
                  <label htmlFor="remember" className="text-text-muted text-sm cursor-pointer">
                    {t('login_remember')}
                  </label>
                </div>

                {error && (
                  <div className="flex items-center gap-2 bg-danger-bg border border-danger/20 rounded-lg px-3 py-2.5 text-danger text-sm">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {t('login_submitting')}
                    </span>
                  ) : (
                    t('login_submit')
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-text-main font-semibold text-base mb-1.5">{t('login_forgotHeading')}</h2>

              {resetSent ? (
                <>
                  <p className="text-text-muted text-sm mb-5">{t('login_resetSent')}</p>
                  <button
                    type="button"
                    onClick={switchToLogin}
                    className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                  >
                    {t('login_backToSignIn')}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-text-muted text-sm mb-5">{t('login_forgotSubtitle')}</p>
                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    <div>
                      <label className="block text-text-main text-sm font-medium mb-1.5">{t('login_email')}</label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder={t('login_emailPlaceholder')}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                        autoComplete="email"
                        autoFocus
                      />
                    </div>

                    {error && (
                      <div className="flex items-center gap-2 bg-danger-bg border border-danger/20 rounded-lg px-3 py-2.5 text-danger text-sm">
                        <AlertCircle size={14} className="flex-shrink-0" />
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          {t('login_submitting')}
                        </span>
                      ) : (
                        t('login_sendResetLink')
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={switchToLogin}
                      className="w-full text-text-muted hover:text-text-main text-sm transition-colors"
                    >
                      {t('login_backToSignIn')}
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </div>

        {/* Language toggle */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={toggle}
            className="text-xs text-text-subtle hover:text-text-muted transition-colors flex items-center gap-1.5"
          >
            {lang === 'en' ? '🇧🇷 Português' : '🇬🇧 English'}
          </button>
        </div>
      </div>
    </div>
  )
}
