export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/peekhook',
  ingestUrl: process.env.INGEST_URL || 'http://localhost:3000',
  isProd: process.env.NODE_ENV === 'production',
}
