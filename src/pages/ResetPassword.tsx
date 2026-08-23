import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabaseClient'
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useT } from '../i18n/useT'

export function ResetPassword() {
  const navigate = useNavigate()
  const updatePassword = useAuthStore(s => s.updatePassword)
  const { t } = useT()

  const [sessionReady, setSessionReady] = useState(false)
  const [invalidLink, setInvalidLink] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Supabase's reset-password email link logs the user into a recovery
    // session automatically; we just need to wait for that session to land.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true)
      else setInvalidLink(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setSessionReady(true)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!password || !confirmPassword) {
      setError(t('login_errorEmpty'))
      return
    }
    if (password.length < 6) {
      setError(t('reset_errorTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('reset_errorMismatch'))
      return
    }
    setLoading(true)
    const { success, error: updateError } = await updatePassword(password)
    setLoading(false)
    if (success) {
      setDone(true)
    } else {
      setError(updateError || t('reset_errorGeneric'))
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-3 shadow-lg">
            <span className="text-white font-bold text-2xl">F</span>
          </div>
          <h1 className="text-text-main font-bold text-2xl">Flow Desk</h1>
        </div>

        <div className="bg-surface rounded-2xl border border-border p-6 shadow-sm">
          {invalidLink ? (
            <>
              <h2 className="text-text-main font-semibold text-base mb-1.5">{t('reset_invalidHeading')}</h2>
              <p className="text-text-muted text-sm mb-5">{t('reset_invalidSubtitle')}</p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {t('login_backToSignIn')}
              </button>
            </>
          ) : done ? (
            <>
              <div className="flex items-center gap-2 text-success mb-1.5">
                <CheckCircle2 size={18} />
                <h2 className="text-text-main font-semibold text-base">{t('reset_successHeading')}</h2>
              </div>
              <p className="text-text-muted text-sm mb-5">{t('reset_successSubtitle')}</p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {t('login_backToSignIn')}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-text-main font-semibold text-base mb-5">{t('reset_heading')}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-text-main text-sm font-medium mb-1.5">{t('reset_newPassword')}</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                      autoComplete="new-password"
                      disabled={!sessionReady}
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

                <div>
                  <label className="block text-text-main text-sm font-medium mb-1.5">{t('reset_confirmPassword')}</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm text-text-main bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                    autoComplete="new-password"
                    disabled={!sessionReady}
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
                  disabled={loading || !sessionReady}
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
                    t('reset_submit')
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
