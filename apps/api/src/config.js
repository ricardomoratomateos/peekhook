export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/peekhook',
  ingestUrl: process.env.INGEST_URL || 'http://localhost:3000',
  isProd: process.env.NODE_ENV === 'production',
  /**
   * Trust proxy headers (`X-Forwarded-For`, `X-Real-IP`) for the
   * captured `req.ip`. Defaults to true in production (where the
   * documented deploy puts nginx / Fly.io load-balancer in front of
   * the API) and false in development (where the user hits :3000
   * directly via Vite's `/api` proxy, and reading those headers as
   * ground truth would let an attacker spoof their IP on the
   * inspector). Override with `TRUST_PROXY=1` / `=true` / `=false`.
   */
  trustProxy:
    process.env.TRUST_PROXY === 'true'
    || process.env.TRUST_PROXY === '1'
    || (process.env.TRUST_PROXY === undefined && process.env.NODE_ENV === 'production'),
}
