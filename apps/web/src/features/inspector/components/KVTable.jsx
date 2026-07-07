import { useEffect, useRef, useState } from 'react'
import { c } from '../lib/tokens.js'

function rowValue(v) {
  return Array.isArray(v) ? v.join(', ') : String(v)
}

export default function KVTable({ rows, copyable = true }) {
  if (!rows || rows.length === 0) return <span style={{ fontSize: '12px', color: c.faint }}>none</span>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: `1px solid ${c.borderSoft}` }}>
            <td style={{ padding: '5px 0', color: c.faint, width: '38%', verticalAlign: 'top', paddingRight: '12px', whiteSpace: 'nowrap', fontFamily: c.mono }}>{k}</td>
            <td style={{ padding: '5px 0', color: c.dim, wordBreak: 'break-all', fontFamily: c.mono }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                <span style={{ flex: 1, minWidth: 0 }}>{rowValue(v)}</span>
                {copyable && <CopyValue value={rowValue(v)} />}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CopyValue({ value }) {
  const [done, setDone] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  async function handleClick() {
    if (!value) return
    try { await navigator.clipboard.writeText(value) } catch (_) {}
    setDone(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none',
        color: done ? c.accent : c.faint, padding: '0 4px',
        cursor: 'pointer', flexShrink: 0, lineHeight: 1,
      }}
      aria-label={done ? 'copied' : `copy ${value}`}
      title={done ? 'copied' : 'copy'}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '12px', lineHeight: 1 }}>
        {done ? 'check' : 'content_copy'}
      </span>
    </button>
  )
}