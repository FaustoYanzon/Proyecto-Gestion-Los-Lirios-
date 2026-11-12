// Machine icon: tractor (lucide Tractor), carro (cart/trailer) and implemento
// (plow). Lucide has no fitting cart or plow, so those two are drawn with
// react-native-svg (already a dependency of lucide-react-native) on the same
// 24px grid, round caps/joins and ICON_STROKE as the rest of lib/icons.ts.
import Svg, { Circle, Path } from 'react-native-svg'
import { ICONS, ICON_STROKE } from '../lib/icons'
import type { IconoMaquina } from '../lib/maquinaria'

interface Props {
  // Optional/nullable so entries cached before the backend sent `icono` still render.
  icono?: IconoMaquina | null
  size?: number
  color?: string
  strokeWidth?: number
}

export function MaquinaIcon({ icono, size = 20, color = '#1f1a17', strokeWidth = ICON_STROKE }: Props) {
  if (icono === 'carro') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {/* body, drawbar and two wheels */}
        <Path d="M3 6h13v8H3z" />
        <Path d="M16 11h5" />
        <Circle cx={7} cy={17.5} r={2.5} />
        <Circle cx={13} cy={17.5} r={2.5} />
      </Svg>
    )
  }
  if (icono === 'implemento') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {/* hitch beam, standard and triangular share */}
        <Path d="M3 5h13" />
        <Path d="M8 5v9" />
        <Path d="M8 14l6 6H3z" />
        <Path d="M16 5l4 3" />
      </Svg>
    )
  }
  const Tractor = ICONS.tractor
  return <Tractor size={size} color={color} strokeWidth={strokeWidth} />
}

export default MaquinaIcon
