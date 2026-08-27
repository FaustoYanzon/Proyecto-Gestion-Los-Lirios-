'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import BuzonModal from '@/components/BuzonModal'
import { useAuthStore } from '@/store/authStore'
import { uploadMyAvatar, updateMyBirthday } from '@/lib/api/usuarios'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err   = 'mt-1 text-xs text-red-600'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function PerfilModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  const [birthDay, setBirthDay] = useState<string>(user?.birth_day ? String(user.birth_day) : '')
  const [birthMonth, setBirthMonth] = useState<string>(user?.birth_month ? String(user.birth_month) : '')
  const [birthYear, setBirthYear] = useState<string>(user?.birth_year ? String(user.birth_year) : '')
  const [savingBirthday, setSavingBirthday] = useState(false)
  const [birthdayError, setBirthdayError] = useState<string | null>(null)
  const [birthdaySaved, setBirthdaySaved] = useState(false)

  if (!user) return null

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-elegir el mismo archivo después de un error
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarError('Formato no soportado — usá JPEG, PNG o WEBP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('La imagen supera el tamaño máximo de 5 MB.')
      return
    }
    setAvatarError(null)
    setUploadingAvatar(true)
    try {
      const updated = await uploadMyAvatar(file)
      setUser(updated)
    } catch {
      setAvatarError('No se pudo subir la foto. Probá de nuevo.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleSaveBirthday() {
    setBirthdayError(null)
    setBirthdaySaved(false)
    const day = birthDay ? Number(birthDay) : null
    const month = birthMonth ? Number(birthMonth) : null
    if ((day === null) !== (month === null)) {
      setBirthdayError('Completá día y mes juntos (o dejá los dos vacíos).')
      return
    }
    setSavingBirthday(true)
    try {
      const updated = await updateMyBirthday({
        birth_day: day,
        birth_month: month,
        birth_year: birthYear ? Number(birthYear) : null,
      })
      setUser(updated)
      setBirthdaySaved(true)
    } catch {
      setBirthdayError('No se pudo guardar. Probá de nuevo.')
    } finally {
      setSavingBirthday(false)
    }
  }

  return (
    <BuzonModal title="Mi perfil" onClose={onClose}>
      <div className="max-w-md mx-auto space-y-6 px-2 py-2">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-xl font-extrabold overflow-hidden"
              style={{ backgroundColor: '#c89a3a', color: '#7a1f2c' }}
            >
              {user.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                getInitials(user.full_name)
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Cambiar foto"
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white border border-gray-300 flex items-center justify-center shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              {uploadingAvatar ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} className="text-gray-600" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900">{user.full_name}</p>
            <p className="text-xs text-gray-500">{user.username}</p>
          </div>
          {avatarError && <p className={err}>{avatarError}</p>}
        </div>

        {/* Cumpleaños */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Fecha de cumpleaños</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={label}>Día</label>
              <select className={field} value={birthDay} onChange={(e) => setBirthDay(e.target.value)}>
                <option value="">—</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Mes</label>
              <select className={field} value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)}>
                <option value="">—</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Año (opcional)</label>
              <input
                type="number"
                className={field}
                placeholder="AAAA"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                min={1900}
                max={2026}
              />
            </div>
          </div>
          {birthdayError && <p className={err}>{birthdayError}</p>}
          {birthdaySaved && <p className="mt-1 text-xs text-green-700">Guardado.</p>}
          <button
            type="button"
            onClick={handleSaveBirthday}
            disabled={savingBirthday}
            className="mt-3 w-full rounded-md bg-[#7a1f2c] text-white text-sm font-semibold py-2 hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {savingBirthday ? 'Guardando…' : 'Guardar cumpleaños'}
          </button>
        </div>
      </div>
    </BuzonModal>
  )
}
