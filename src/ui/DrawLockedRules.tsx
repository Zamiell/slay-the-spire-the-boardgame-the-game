import coordinates from './card-draw-strikes.json'
import './styles/draw-locked-rules.css'

const scans: Readonly<Record<string, { size: number[]; lines: number[][] }>> = coordinates

/** Match the scan's image fitting and mark its lettering without replacing any pixels. */
export function DrawLockedRules({ src, contain = false }: { src: string; contain?: boolean }) {
  const key = src.split('/').at(-1)!.replace(/\.webp$/, '')
  const scan = scans[key]
  if (!scan) throw new Error(`Missing drawing-instruction coordinates for ${key}`)
  return <svg className="card__draw-locked-rules" aria-hidden="true"
    viewBox={`0 0 ${scan.size.join(' ')}`}
    preserveAspectRatio={`xMidYMid ${contain ? 'meet' : 'slice'}`}
    strokeWidth={scan.size[0]! * 0.006}>
    {scan.lines.map(([left, y, right], index) =>
      <line key={index} x1={left} y1={y} x2={right} y2={y} />)}
  </svg>
}
