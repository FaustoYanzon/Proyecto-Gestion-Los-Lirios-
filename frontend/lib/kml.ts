export interface KMLFeature {
  name: string
  type: 'parral' | 'potrero' | 'pasero' | 'cabezal' | 'finca' | 'pipeline'
  geometry: 'polygon' | 'line'
  coords: [number, number][] // [lat, lng] for Leaflet
}

function parseCoords(text: string): [number, number][] {
  return text.trim().split(/\s+/).filter(Boolean).map(c => {
    const parts = c.split(',')
    return [parseFloat(parts[1]), parseFloat(parts[0])] as [number, number]
  })
}

function inferType(name: string): KMLFeature['type'] {
  const n = name.toLowerCase()
  if (n === 'finca') return 'finca'
  if (n.startsWith('parral')) return 'parral'
  if (n.startsWith('potrero')) return 'potrero'
  if (n.startsWith('pasero')) return 'pasero'
  if (n.startsWith('cabezal')) return 'cabezal'
  return 'pipeline'
}

export async function loadFincaKML(): Promise<KMLFeature[]> {
  const resp = await fetch('/los-lirios.kml')
  const text = await resp.text()
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const features: KMLFeature[] = []

  doc.querySelectorAll('Placemark').forEach(pm => {
    const name = pm.querySelector('name')?.textContent?.trim() ?? ''
    if (!name || name === 'Marcador sin título') return
    const type = inferType(name)
    const polyEl = pm.querySelector('Polygon coordinates')
    const lineEl = pm.querySelector('LineString coordinates')
    if (polyEl) {
      features.push({ name, type, geometry: 'polygon', coords: parseCoords(polyEl.textContent ?? '') })
    } else if (lineEl) {
      features.push({ name, type, geometry: 'line', coords: parseCoords(lineEl.textContent ?? '') })
    }
  })

  return features
}
