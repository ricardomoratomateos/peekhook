import { c } from '../lib/tokens.js'
import { timeAgo, prettyPath } from '../lib/format.js'
import MethodChip from './MethodChip.jsx'

export default function RequestRow({ req, token, selected, isNew, compareSelected, onClick, onToggleCompare }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.(e)
        }
      }}
      className={`sb-reqrow${selected ? ' sb-reqrow-active' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px',
        borderRadius: '8px', background: selected ? c.accentBg : 'transparent',
        cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: c.mono,
        animation: isNew ? 'sbfade .3s ease' : 'none', transition: 'background .12s, color .12s',
      }}
      aria-pressed={selected}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleCompare?.(req)
        }}
        aria-label={compareSelected ? 'remove from compare' : 'add to compare'}
        aria-pressed={!!compareSelected}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '18px', height: '18px', padding: 0, flexShrink: 0,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: compareSelected ? c.accent : c.faint,
          transition: 'color .12s',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '16px', lineHeight: 1 }}>
          {compareSelected ? 'check_box' : 'check_box_outline_blank'}
        </span>
      </button>
      <MethodChip method={req.method} />
      <span style={{ flex: 1, fontSize: '12px', color: selected ? c.fg : c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {prettyPath(req.path, token)}
      </span>
      <span style={{ fontSize: '11px', color: c.faint, flexShrink: 0 }}>{timeAgo(req.createdAt)}</span>
    </div>
  )
}