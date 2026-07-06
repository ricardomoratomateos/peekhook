import { c } from '../lib/tokens.js'

const STATUS_MAP = {
  connecting: { label: 'connecting', color: c.faint, dot: c.faint, pulse: true },
  live:       { label: 'live',       color: c.dim,   dot: c.accent, pulse: true },
  polling:    { label: 'polling',    color: c.faint, dot: c.faint, pulse: false },
  error:      { label: 'offline',    color: c.faint, dot: c.faint, pulse: false },
}

export default function LiveBadge({ status }) {
  const { label, color, dot, pulse } = STATUS_MAP[status] || STATUS_MAP.connecting
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontFamily: c.mono, fontSize: '11px', color, letterSpacing: '0.12em' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot, flexShrink: 0, animation: pulse ? 'sbpulse 2s ease infinite' : 'none' }} />
      {label}
    </span>
  )
}
