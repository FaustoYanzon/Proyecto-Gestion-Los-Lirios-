import api from '@/lib/api'

export interface PronosticoExtendidoResponse {
  daily: {
    time: string[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_sum: number[]
    precipitation_probability_max: number[]
    relative_humidity_2m_mean: number[]
    wind_speed_10m_max: number[]
    wind_direction_10m_dominant: number[]
    weather_code: number[]
    et0_fao_evapotranspiration: number[]
    uv_index_max: number[]
  }
  _cached?: boolean
  _fetched_at?: string
}

export async function getPronosticoExtendido(finca: string): Promise<PronosticoExtendidoResponse> {
  const { data } = await api.get('/clima/pronostico-extendido', { params: { finca } })
  return data
}
