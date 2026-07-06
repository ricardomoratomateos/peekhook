import { c } from '../lib/tokens.js'
import { buildTestCurl } from '../lib/format.js'
import { d } from '../styles.js'

export default function EmptyState({ inboxUrl, onCopy }) {
  const curl = buildTestCurl(inboxUrl)
  return (
    <div style={d.emptyWrap}>
      <div style={d.emptyContent}>
        <p style={d.emptyTitle}>waiting for requests…</p>
        <p style={d.emptySub}>send any http request to your inbox url and it appears here instantly.</p>
        <div style={d.curlBlock}>
          <div style={d.curlHead}>
            <span style={d.curlLabel}>example</span>
            <button
              type="button"
              onClick={onCopy}
              className="sb-copytest"
              style={d.curlCopyBtn}
              aria-label="copy example request"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>content_copy</span>
              <span>copy</span>
            </button>
          </div>
          <pre style={d.curlCode}>{curl}</pre>
        </div>
        <div style={d.tips}>
          {[
            'any method works — get, post, put, delete, patch…',
            'all headers and body are captured',
            'json bodies are pretty-printed automatically',
          ].map(tip => <div key={tip} style={d.tip}>{tip}</div>)}
        </div>
      </div>
    </div>
  )
}
