import { c } from '../lib/tokens.js'

export default function KVTable({ rows }) {
  if (!rows || rows.length === 0) return <span style={{ fontSize: '12px', color: c.faint }}>none</span>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: `1px solid ${c.borderSoft}` }}>
            <td style={{ padding: '5px 0', color: c.faint, width: '38%', verticalAlign: 'top', paddingRight: '12px', whiteSpace: 'nowrap', fontFamily: c.mono }}>{k}</td>
            <td style={{ padding: '5px 0', color: c.dim, wordBreak: 'break-all', fontFamily: c.mono }}>{Array.isArray(v) ? v.join(', ') : String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
