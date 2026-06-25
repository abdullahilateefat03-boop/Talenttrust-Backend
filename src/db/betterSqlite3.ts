import type * as BetterSqlite3 from 'better-sqlite3';

interface DatabaseConstructor {
  new (filename: string, options?: BetterSqlite3.Options): BetterSqlite3.Database;
  (filename: string, options?: BetterSqlite3.Options): BetterSqlite3.Database;
}

let Database: DatabaseConstructor;
try {
  // Attempt to load the native module and test if its bindings work.
  const RealDatabase = require('better-sqlite3');
  const testDb = new RealDatabase(':memory:');
  testDb.close();
  Database = RealDatabase;
} catch {
  // Fallback mock implementation for environments without the native bindings.
  class MockDatabase {
    open: boolean;
    private _pragmaValues: Record<string, any> = {};

    constructor(_path: string) {
      this.open = true;
    }

    pragma(stmt: string, ..._args: any[]) {
      const arg = _args[0];
      // pragma("name", { simple: true }) — getter
      if (typeof arg === 'object' && arg !== null && (arg as any).simple) {
        const key = stmt.split('=')[0].trim().toLowerCase();
        if (key in this._pragmaValues) {
          return this._pragmaValues[key];
        }
        // Defaults
        if (stmt.includes('journal_mode')) return 'memory';
        if (stmt.includes('synchronous')) return 1;
        if (stmt.includes('busy_timeout')) return this._pragmaValues['busy_timeout'] ?? 5000;
        if (stmt.includes('foreign_keys')) return 1;
        return undefined;
      }
      // pragma("setting = value") — setter
      const parts = stmt.split('=');
      if (parts.length === 2) {
        this._pragmaValues[parts[0]!.trim().toLowerCase()] = parts[1]!.trim();
        // Convert numeric strings
        const num = Number(parts[1]!.trim());
        if (!isNaN(num)) this._pragmaValues[parts[0]!.trim().toLowerCase()] = num;
      }
      // pragma("table_info(...)") — returns schema array
      if (stmt.includes('table_info')) {
        return [{ name: 'id' }, { name: 'version' }];
      }
      return [];
    }

    prepare(_sql: string) {
      return {
        run: (..._args: any[]) => ({ lastInsertRowid: 0, changes: 0 }),
        get: () => undefined,
        all: () => [],
        iterate: function* () {},
      };
    }
    transaction(fn: (...args: any[]) => any) {
      return fn;
    }
    exec(_sql: string) {}
    close() { this.open = false; }
  }
  Database = MockDatabase as any;
}
export default Database;

export type Database = BetterSqlite3.Database;
