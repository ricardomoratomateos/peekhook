import { c } from '../lib/tokens.js'
import { timeAgo, prettyPath } from '../lib/format.js'
import MethodChip from './MethodChip.jsx'

export default function RequestRow({ req, token, selected, isNew, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`sb-reqrow${selected ? ' sb-reqrow-active' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px',
        borderRadius: '8px', background: selected ? c.accentBg : 'transparent',
        border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: c.mono,
        animation: isNew ? 'sbfade .3s ease' : 'none', transition: 'background .12s, color .12s',
      }}
      aria-pressed={selected}
    >
      <span className="material-symbols-outlined sb-reqicon" style={{ fontSize: '18px', color: selected ? c.accent : c.faint, flexShrink: 0, transition: 'color .12s' }}>bolt</span>
      <MethodChip method={req.method} />
      <span style={{ flex: 1, fontSize: '12px', color: selected ? c.fg : c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {prettyPath(req.path, token)}
      </span>
      <span style={{ fontSize: '11px', color: c.faint, flexShrink: 0 }}>{timeAgo(req.createdAt)}</span>
    </button>
  )
}
