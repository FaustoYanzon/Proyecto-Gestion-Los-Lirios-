import { Cloud, CloudRain, CloudFog, CloudLightning, Sun, CloudSun } from 'lucide-react'

// WMO weather code → short Spanish description
// Ref: https://open-meteo.com/en/docs#weathervariables
export function wmoDescription(code: number): string {
  if (code === 0) return 'Despejado'
  if (code <= 2) return 'Parcialmente nublado'
  if (code === 3) return 'Nublado'
  if (code <= 49) return 'Niebla'
  if (code <= 59) return 'Llovizna'
  if (code <= 69) return 'Lluvia'
  if (code <= 79) return 'Nieve'
  if (code <= 84) return 'Chaparrón'
  if (code <= 99) return 'Tormenta'
  return 'Variable'
}

export function wmoIcon(code: number) {
  if (code === 0) return Sun
  if (code <= 2) return CloudSun
  if (code === 3) return Cloud
  if (code <= 49) return CloudFog
  if (code <= 69 || code === 80 || code === 81 || code === 82) return CloudRain
  if (code <= 99) return CloudLightning
  return Cloud
}

// Grados → punto cardinal abreviado (N/NE/E/SE/S/SO/O/NO)
export function windDirectionLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
  return dirs[Math.round(deg / 45) % 8]
}

export function uvLevel(uv: number): { label: string; color: string } {
  if (uv < 3) return { label: 'Bajo', color: '#3f5c3a' }
  if (uv < 6) return { label: 'Moderado', color: '#b8860b' }
  if (uv < 8) return { label: 'Alto', color: '#c96a1f' }
  if (uv < 11) return { label: 'Muy alto', color: '#a3293a' }
  return { label: 'Extremo', color: '#7a1f2c' }
}
