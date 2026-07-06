import { useMemo } from 'react'
import { c } from '../lib/tokens.js'
import { d } from '../styles.js'
import { methodTone, formatBody, prettyPath, timeAgo } from '../lib/format.js'
import { diffBodies, diffHeaders, diffChars } from '../lib/diff.js'
import MethodChip from './MethodChip.jsx'

export default function DiffPanel({ a, b, token, onBack, onClear }) {
  const aBodyText = formatBody(a.body, a.contentType) || ''
  const bBodyText = formatBody(b.body, b.contentType) || ''
  const bodyDiff = useMemo(() => diffBodies(aBodyText, bBodyText), [aBodyText, bBodyText])
  const headerDiff = useMemo(
    () => diffHeaders(a.headers, b.headers),
    [a.headers, b.headers]
  )

  return (
    <div style={d.panel}>
      <div style={d.header}>
        <div style={d.headerLeft}>
          <div style={d.eyebrow}>compare · 2 events</div>
          <div style={d.headlineRow}>
            <span style={{ ...d.methodLg, color: c.dim }}>A</span>
            <span style={{ ...d.pathLg, color: c.faint }}>vs</span>
            <span style={{ ...d.methodLg, color: c.dim }}>B</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button type="button" onClick={onClear} style={ghostBtnStyle} aria-label="clear compare">
            clear
          </button>
          <button type="button" onClick={onBack} style={backBtnStyle} aria-label="back to list">
            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>arrow_back</span>
            back
          </button>
        </div>
      </div>

      <div style={sidesWrap}>
        <SideHeader label="A" req={a} token={token} accent={aTone} />
        <SideHeader label="B" req={b} token={token} accent={bTone} />
      </div>

      <div style={d.scroll}>
        <section style={d.section}>
          <div style={d.sectionTitle}>headers</div>
          <HeaderDiffTable diff={headerDiff} />
        </section>

        <section style={{ ...d.section, flex: 1, display: 'flex', flexDirection: 'column', borderBottom: 'none' }}>
          <div style={d.sectionTitle}>body</div>
          {aBodyText || bBodyText
            ? <BodyDiff diff={bodyDiff} />
            : <span style={{ fontSize: '12px', color: c.faint }}>both bodies are empty</span>}
        </section>
      </div>
    </div>
  )
}

const aTone = '#ef4444'
const bTone = '#22c55e'

function SideHeader({ label, req, token, accent }) {
  const t = methodTone(req.method)
  return (
    <div style={{ ...sideCard, borderColor: accent }}>
      <div style={sideLabel}>
        <span style={{ ...sideLabelDot, background: accent }} />
        <span style={sideLabelText}>{label}</span>
        <MethodChip method={req.method} />
      </div>
      <div style={sidePath}>{prettyPath(req.path, token)}</div>
      <div style={sideMeta}>
        <span>{timeAgo(req.createdAt)}</span>
        <span style={{ color: t.color }}>{(req.method || '').toUpperCase()}</span>
      </div>
    </div>
  )
}

function HeaderDiffTable({ diff }) {
  const rows = useMemo(() => {
    const all = []
    for (const r of diff.removed) all.push({ key: r.key, kind: 'removed', a: r.value, b: undefined })
    for (const r of diff.added) all.push({ key: r.key, kind: 'added', a: undefined, b: r.value })
    for (const r of diff.changed) all.push({ key: r.key, kind: 'changed', a: r.a, b: r.b })
    for (const r of diff.unchanged) all.push({ key: r.key, kind: 'unchanged', a: r.value, b: r.value })
    all.sort((x, y) => x.key.localeCompare(y.key))
    return all
  }, [diff])

  if (rows.length === 0) {
    return <span style={{ fontSize: '12px', color: c.faint }}>no headers</span>
  }

  return (
    <div style={headerTableWrap}>
      <div style={headerTableHead}>
        <span style={{ width: '28%' }}>key</span>
        <span style={{ width: '36%' }}>A</span>
        <span style={{ width: '36%' }}>B</span>
      </div>
      {rows.map(row => (
        <HeaderRow key={row.key} row={row} />
      ))}
    </div>
  )
}

function HeaderRow({ row }) {
  const dim = row.kind === 'unchanged'
  const tone = row.kind === 'changed'
    ? { dot: '#eab308', bg: 'transparent', label: 'changed' }
    : row.kind === 'added'
    ? { dot: bTone, bg: 'transparent', label: 'added' }
    : row.kind === 'removed'
    ? { dot: aTone, bg: 'transparent', label: 'removed' }
    : { dot: 'transparent', bg: 'transparent', label: 'unchanged' }
  return (
    <div style={{ ...headerRow, opacity: dim ? 0.45 : 1 }}>
      <span style={headerKeyCell}>
        <span style={{ ...dot, background: tone.dot }} aria-hidden />
        <span style={headerKeyText}>{row.key}</span>
      </span>
      <span style={{ ...headerValCell, color: row.a == null ? c.faint : (dim ? c.dim : c.fg) }}>
        {row.a == null ? <span style={emptyVal}>—</span> : stringValue(row.a)}
      </span>
      <span style={{ ...headerValCell, color: row.b == null ? c.faint : (dim ? c.dim : c.fg) }}>
        {row.b == null ? <span style={emptyVal}>—</span> : stringValue(row.b)}
      </span>
    </div>
  )
}

function BodyDiff({ diff }) {
  const rows = useMemo(() => {
    const aPad = []
    const bPad = []
    let aLine = 1
    let bLine = 1
    for (const op of diff.ops) {
      if (op.type === 'common') {
        aPad.push({ kind: 'common', text: op.a, aLine: aLine++, bLine: bLine++ })
        bPad.push({ kind: 'common', text: op.b, aLine: aLine - 1, bLine: bLine - 1 })
      } else if (op.type === 'removed') {
        aPad.push({ kind: 'removed', text: op.a, aLine: aLine++ })
        bPad.push({ kind: 'blank' })
      } else {
        aPad.push({ kind: 'blank' })
        bPad.push({ kind: 'added', text: op.b, bLine: bLine++ })
      }
    }
    return { aPad, bPad }
  }, [diff])

  const totalRows = rows.aPad.length

  return (
    <div style={bodyGrid}>
      <BodyColumn rows={rows.aPad} totalRows={totalRows} side="a" />
      <BodyColumn rows={rows.bPad} totalRows={totalRows} side="b" />
    </div>
  )
}

function BodyColumn({ rows, side }) {
  return (
    <div style={bodyColWrap}>
      <div style={bodyColHead}>
        <span style={{ color: side === 'a' ? aTone : bTone }}>{side.toUpperCase()}</span>
      </div>
      <div style={bodyPre}>
        {rows.map((row, idx) => {
          if (row.kind === 'blank') {
            return <BodyLine key={idx} kind="blank" side={side} text="" aLine={null} bLine={null} />
          }
          if (row.kind === 'common') {
            return <BodyLine key={idx} kind="common" side={side} text={row.text} aLine={row.aLine} bLine={row.bLine} />
          }
          if (row.kind === 'removed') {
            return <BodyLine key={idx} kind="removed" side={side} text={row.text} aLine={row.aLine} bLine={null} />
          }
          return <BodyLine key={idx} kind="added" side={side} text={row.text} aLine={null} bLine={row.bLine} />
        })}
      </div>
    </div>
  )
}

function BodyLine({ kind, side, text, aLine, bLine }) {
  const isLeft = side === 'a'
  const lineNo = isLeft ? aLine : bLine
  const bg = kind === 'removed' && isLeft ? 'rgba(239,68,68,0.08)'
    : kind === 'added' && !isLeft ? 'rgba(34,197,94,0.08)'
    : 'transparent'
  const fg = kind === 'common' ? c.dim
    : kind === 'removed' ? aTone
    : kind === 'added' ? bTone
    : c.faint
  const prefix = kind === 'removed' ? '-' : kind === 'added' ? '+' : ' '
  let content = null
  if (kind === 'common' || kind === 'blank') {
    content = <span style={{ color: fg }}>{text || ' '}</span>
  } else if (kind === 'removed' && isLeft) {
    content = <CharDiff a={text} b={null} kind="removed" />
  } else if (kind === 'added' && !isLeft) {
    content = <CharDiff a={null} b={text} kind="added" />
  } else {
    content = <span style={{ color: fg }}>{text}</span>
  }
  return (
    <div style={{ ...bodyLine, background: bg }}>
      <span style={lineNoStyle}>{lineNo == null ? '' : lineNo}</span>
      <span style={{ ...prefixStyle, color: fg }}>{prefix}</span>
      <span style={lineText}>{content}</span>
    </div>
  )
}

function CharDiff({ a, b, kind }) {
  if (a != null && b != null) {
    const segs = diffChars(a, b)
    return (
      <>
        {segs.map((seg, i) => {
          if (seg.type === 'eq') {
            return <span key={i} style={{ color: c.dim }}>{seg.text}</span>
          }
          if (seg.type === 'del') {
            return <span key={i} style={charRemoved}>{seg.text}</span>
          }
          return <span key={i} style={charAdded}>{seg.text}</span>
        })}
      </>
    )
  }
  if (a != null) {
    return <span style={charRemoved}>{a}</span>
  }
  return <span style={charAdded}>{b}</span>
}

function stringValue(v) {
  if (Array.isArray(v)) return v.join(', ')
  if (v == null) return ''
  return String(v)
}

const sidesWrap = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px',
  padding: '16px 22px', borderBottom: `1px solid ${c.borderSoft}`, flexShrink: 0,
}

const sideCard = {
  display: 'flex', flexDirection: 'column', gap: '6px',
  padding: '10px 12px', border: `1px solid ${c.border}`,
  borderRadius: '6px', background: c.lowest, minWidth: 0,
}

const sideLabel = { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }
const sideLabelDot = { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 }
const sideLabelText = { fontFamily: c.mono, fontSize: '11px', color: c.faint, letterSpacing: '0.06em' }
const sidePath = {
  fontFamily: c.mono, fontSize: '12px', color: c.fg,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const sideMeta = {
  display: 'flex', justifyContent: 'space-between',
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
}

const ghostBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  background: 'transparent', border: `1px solid ${c.border}`,
  borderRadius: '4px', padding: '6px 10px',
  fontFamily: c.sans, fontSize: '12px', color: c.dim, cursor: 'pointer',
}
const backBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  background: c.accent, color: c.accentInk, border: 'none',
  borderRadius: '4px', padding: '6px 12px',
  fontFamily: c.sans, fontSize: '12px', fontWeight: 500, cursor: 'pointer',
}

const headerTableWrap = {
  display: 'flex', flexDirection: 'column',
  border: `1px solid ${c.border}`, borderRadius: '6px',
  background: c.lowest, overflow: 'hidden',
}
const headerTableHead = {
  display: 'flex', padding: '8px 12px',
  borderBottom: `1px solid ${c.border}`,
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
  letterSpacing: '0.12em', textTransform: 'uppercase',
  background: c.low,
}
const headerRow = {
  display: 'flex', padding: '6px 12px',
  borderTop: `1px solid ${c.borderSoft}`,
  fontFamily: c.mono, fontSize: '12px',
  alignItems: 'flex-start',
}
const headerKeyCell = {
  width: '28%', display: 'flex', alignItems: 'center', gap: '8px',
  paddingRight: '12px', color: c.dim,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const headerKeyText = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const headerValCell = {
  width: '36%', paddingRight: '12px',
  wordBreak: 'break-word',
}
const dot = {
  width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
  display: 'inline-block',
}
const emptyVal = { color: c.faint }

const bodyGrid = {
  display: 'grid', gridTemplateColumns: '1fr 1fr',
  gap: '8px', flex: 1, minHeight: 0,
}
const bodyColWrap = { display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }
const bodyColHead = {
  fontFamily: c.mono, fontSize: '10px', color: c.faint,
  letterSpacing: '0.16em', padding: '0 4px 4px',
}
const bodyPre = {
  background: c.lowest, border: `1px solid ${c.border}`, borderRadius: '6px',
  padding: '10px 0', fontSize: '12px', color: c.fg,
  fontFamily: c.mono, overflow: 'auto', flex: 1, minHeight: 0,
}
const bodyLine = {
  display: 'flex', alignItems: 'flex-start',
  padding: '1px 10px', gap: '8px',
  whiteSpace: 'pre',
}
const lineNoStyle = {
  width: '28px', textAlign: 'right', color: c.faint,
  fontSize: '11px', userSelect: 'none', flexShrink: 0,
}
const prefixStyle = {
  width: '12px', flexShrink: 0,
  fontFamily: c.mono, textAlign: 'center',
}
const lineText = { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }

const charRemoved = {
  background: 'rgba(239,68,68,0.18)',
  color: '#fca5a5',
  borderRadius: '2px',
}
const charAdded = {
  background: 'rgba(34,197,94,0.18)',
  color: '#86efac',
  borderRadius: '2px',
}