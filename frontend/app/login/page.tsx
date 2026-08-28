'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { login, getRememberedUsername, setRememberedUsername } from '@/lib/auth'
import { useAuthStore } from '@/store/authStore'
import FormError from '@/components/ui/FormError'

const schema = z.object({
  username:   z.string().min(1, { message: 'Ingrese su usuario' }),
  password:   z.string().min(1, { message: 'Ingrese su contraseña' }),
  recordarme: z.boolean().optional(),
})
type LoginFormData = z.infer<typeof schema>

export default function LoginPage() {
  const router    = useRouter()
  const setUser   = useAuthStore((s) => s.setUser)
  const [showPwd, setShowPwd] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } =
    useForm<LoginFormData>({
      resolver: zodResolver(schema),
      defaultValues: { username: '', recordarme: false },
    })

  // Leído después de montar (no en el render inicial) para no desincronizar
  // el HTML del servidor con el del cliente — localStorage no existe en SSR.
  useEffect(() => {
    const remembered = getRememberedUsername()
    if (remembered) {
      setValue('username', remembered)
      setValue('recordarme', true)
    }
  }, [setValue])

  async function onSubmit(data: LoginFormData) {
    setError(null)
    try {
      const user = await login(data.username, data.password)
      setRememberedUsername(data.recordarme ? data.username : null)
      setUser(user)
      router.push('/dashboard')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setError(status === 401 ? 'Usuario o contraseña incorrectos' : 'Error al iniciar sesión. Intente nuevamente.')
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Panel izquierdo — crema, marca ── */}
      <div
        className="hidden md:flex flex-col justify-center w-[46%] max-w-[620px] flex-shrink-0 px-14"
        style={{ backgroundColor: '#faf6ec', borderTop: '3px solid #7a1f2c' }}
      >
        <div>
          <img src="/logo.svg" alt="" style={{ height: 72 }} className="w-auto mb-6" />

          <p
            className="text-xl font-bold text-[#1f1a17]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Los Lirios SA
          </p>

          <p
            className="text-[22px] leading-[30px] font-semibold text-[#1f1a17] mt-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Gestión integral de la finca
          </p>
          <p className="text-sm text-[#5a544c] mt-2">
            Producción, riego, finanzas y campaña en un solo lugar.
          </p>

          <div className="w-7 h-0.5 mt-6" style={{ backgroundColor: '#c89a3a' }} />

          <p className="text-[11px] font-bold uppercase tracking-widest text-[#a09584] mt-6">
            Los Lirios SA · Desde 1991
          </p>
        </div>
      </div>

      {/* ── Panel derecho — blanco, formulario ── */}
      <div className="flex-1 flex items-center px-14 py-12 bg-white">
        <div className="w-full max-w-sm">
          {/* logo mobile */}
          <div className="md:hidden mb-8 flex items-center gap-3">
            <img src="/logo-reducido.svg" alt="" className="h-10 w-auto" />
            <span className="text-xl font-bold text-[#1f1a17]" style={{ fontFamily: 'var(--font-display)' }}>
              Los Lirios SA
            </span>
          </div>

          <div className="mb-8">
            <h1
              className="text-2xl font-bold text-[#1f1a17]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Bienvenido
            </h1>
            <p className="text-sm text-[#5a544c] mt-1">Ingrese su cuenta para continuar</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Usuario */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[#5a544c] mb-1.5">
                Usuario
              </label>
              <input
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                placeholder="nombre.apellido"
                className="w-full rounded-[10px] border border-[#e2dbcc] px-3.5 py-2.5 text-sm
                           text-[#1f1a17] placeholder:text-[#a09584] hover:border-[#a09584]
                           focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-[#7a1f2c]
                           transition-colors bg-white"
                {...register('username')}
              />
              {errors.username && <p className="mt-1.5 text-xs text-[#a3293a]">{errors.username.message}</p>}
            </div>

            {/* Contraseña */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[#5a544c] mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-[10px] border border-[#e2dbcc] px-3.5 py-2.5 pr-10 text-sm
                             text-[#1f1a17] placeholder:text-[#a09584] hover:border-[#a09584]
                             focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-[#7a1f2c]
                             transition-colors bg-white"
                  {...register('password')}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a09584] hover:text-[#5a544c] transition-colors"
                  onClick={() => setShowPwd((v) => !v)}
                >
                  {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p className="mt-1.5 text-xs text-[#a3293a]">{errors.password.message}</p>}
            </div>

            {/* Recordarme + olvide */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-[#e2dbcc] accent-[#7a1f2c] cursor-pointer"
                  {...register('recordarme')}
                />
                <span className="text-sm text-[#5a544c]">Recordarme</span>
              </label>
              <button type="button" className="text-sm text-[#7a1f2c] hover:underline">
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {error && <FormError description={error} />}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 rounded-[10px]
                         bg-[#7a1f2c] hover:bg-[#5a1320] disabled:opacity-60
                         text-white font-medium py-2.5 text-sm transition-colors"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {isSubmitting ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
