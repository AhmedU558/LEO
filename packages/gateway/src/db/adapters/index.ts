/**
 * Database Adapters
 *
 * PostgreSQL is the only supported database
 */

export * from './types.js';
export { PostgresAdapter } from './postgres-adapter.js';

import type { DatabaseAdapter, DatabaseConfig } from './types.js';
import { getDatabaseConfig } from './types.js';
import { PostgresAdapter } from './postgres-adapter.js';
import { initializeSchema } from '../schema/index.js';
import { getLog } from '../../services/log.js';

const log = getLog('DbAdapter');

let adapter: DatabaseAdapter | null = null;
let adapterPromise: Promise<DatabaseAdapter> | null = null;
let schemaInitialized = false;

/**
 * Create and initialize a PostgreSQL database adapter
 */
export async function createAdapter(config?: DatabaseConfig): Promise<DatabaseAdapter> {
  const dbConfig = config ?? getDatabaseConfig();
  const pgAdapter = new PostgresAdapter(dbConfig);

  try {
    await pgAdapter.initialize();

    // Initialize schema on first connection
    if (!schemaInitialized) {
      await pgAdapter.transaction(async () => {
        await pgAdapter.exec('SELECT pg_advisory_xact_lock(1492)');

        let skip = false;
        const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

        if (isTest) {
          // Querying a missing table aborts PostgreSQL's transaction even if
          // JavaScript catches the error. Check existence without raising SQL errors.
          const table = await pgAdapter.query<{ name: string | null }>(
            "SELECT to_regclass('public.system_settings') AS name"
          );
          if (table[0]?.name) {
            const res = await pgAdapter.query<{ value: string }>(
              'SELECT value FROM system_settings WHERE key = $1',
              ['schema_init_time']
            );
            const lastInitStr = res[0]?.value;
            if (lastInitStr) {
              const lastInit = parseInt(lastInitStr, 10);
              // If schema was initialized in the last 60 seconds, assume another parallel worker just did it
              if (Date.now() - lastInit < 60000) {
                skip = true;
                log.info(
                  '[Schema] Skipped initializeSchema (recently initialized by another test worker)'
                );
              }
            }
          }
        }

        if (!skip) {
          await initializeSchema(async (sql) => pgAdapter.exec(sql));

          if (isTest) {
            await pgAdapter.execute(
              "INSERT INTO system_settings (key, value) VALUES ('schema_init_time', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
              [Date.now().toString()]
            );
          }
        }
      });
      schemaInitialized = true;
    }
  } catch (err) {
    try {
      await pgAdapter.close();
    } catch (closeErr) {
      log.warn('[Database] Failed to close adapter after initialization error', closeErr);
    }
    throw err;
  }

  return pgAdapter;
}

/**
 * Get the global database adapter instance
 * Creates one if not exists
 */
export async function getAdapter(): Promise<DatabaseAdapter> {
  if (adapter) return adapter;

  // Use a promise lock to prevent duplicate initialization under concurrent calls
  if (!adapterPromise) {
    adapterPromise = createAdapter()
      .then((a) => {
        adapter = a;
        return a;
      })
      .catch((err) => {
        adapterPromise = null;
        throw err;
      });
  }
  return adapterPromise;
}

/**
 * Get the global adapter synchronously (must be initialized first).
 *
 * Only used by code paths that are guaranteed to run AFTER `initializeAdapter()`
 * (currently `soul-heartbeat-service.ts` runner construction). Request handlers
 * and repositories must use the async `getAdapter()` to avoid initialization
 * races.
 */
export function getAdapterSync(): DatabaseAdapter {
  if (!adapter) {
    throw new Error('Database adapter not initialized. Call initializeAdapter() first.');
  }
  return adapter;
}

/**
 * Initialize the global adapter
 */
export async function initializeAdapter(config?: DatabaseConfig): Promise<DatabaseAdapter> {
  if (adapter) {
    log.info('[Database] Adapter already initialized');
    return adapter;
  }
  adapter = await createAdapter(config);
  return adapter;
}

/**
 * Close the global adapter
 */
export async function closeAdapter(): Promise<void> {
  if (adapter) {
    await adapter.close();
    adapter = null;
    adapterPromise = null;
    schemaInitialized = false;
  }
}
