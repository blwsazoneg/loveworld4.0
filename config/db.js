import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const connectionConfig = {
  // Use the Render DATABASE_URL in production
  connectionString: process.env.DATABASE_URL,
  // Production needs SSL, but the Render URL includes this.
  // For local, we turn it off.
  ssl: isProduction ? { rejectUnauthorized: false } : false,
};

// If not in production, use the local .env variables
if (!isProduction) {
  connectionConfig.user = process.env.DB_USER;
  connectionConfig.host = process.env.DB_HOST;
  connectionConfig.database = process.env.DB_DATABASE;
  connectionConfig.password = process.env.DB_PASSWORD;
  connectionConfig.port = process.env.DB_PORT;
  // We don't need the connectionString if we specify these
  delete connectionConfig.connectionString;
}

const pool = new pg.Pool(connectionConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export default pool;