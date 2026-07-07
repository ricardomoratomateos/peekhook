import { useEffect, useRef, useState } from 'react'
import { c } from '../lib/tokens.js'

export function useCopy() {
  const [state, setState] = useState('idle')
  const timer = useRef(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  async function copy(getText) {
    const value = typeof getText === 'function' ? getText() : getText
    if (!value) return
    try { await navigator.clipboard.writeText(value) } catch (_) {}
    setState('done')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1500)
  }
  return [state, copy]
}

export function CopyIconButton({ getText, label = 'copy', copiedLabel = 'copied', className, style }) {
  const [state, copy] = useCopy()
  const isDone = state === 'done'
  const ariaLabel = isDone ? copiedLabel : label
  return (
    <button
      type="button"
      onClick={() => copy(getText)}
      className={className}
      style={{ ...iconBtnStyle, ...(isDone ? doneStyle : {}), ...style }}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className="material-symbols-outlined" style={{ fontSize: '12px', lineHeight: 1 }}>
        {isDone ? 'check' : 'content_copy'}
      </span>
    </button>
  )
}

const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none',
  color: c.faint, padding: '2px 4px', borderRadius: '3px',
  cursor: 'pointer', flexShrink: 0,
  transition: 'color 0.12s, background 0.12s',
}

const doneStyle = { color: c.accent }