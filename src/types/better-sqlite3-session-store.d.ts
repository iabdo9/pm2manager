/**
 * Minimal ambient declaration for `better-sqlite3-session-store`, which ships
 * without TypeScript types. Only the surface we use is declared.
 */
declare module 'better-sqlite3-session-store' {
  import type { Store, SessionOptions } from 'express-session';
  import type { Database } from 'better-sqlite3';

  interface SqliteStoreOptions {
    /** An open better-sqlite3 database connection. */
    client: Database;
    /** Automatic expiry sweep configuration. */
    expired?: {
      clear?: boolean;
      intervalMs?: number;
    };
  }

  type SessionModule = typeof import('express-session');

  interface SqliteStoreClass {
    new (options: SqliteStoreOptions): Store;
  }

  export default function connectSqlite3(session: SessionModule): SqliteStoreClass;

  // The parameter type keeps `session` compatible with express-session.
  export type { SessionOptions };
}
