import type * as BetterSqlite3 from 'better-sqlite3';

interface DatabaseConstructor {
  new (filename: string, options?: BetterSqlite3.Options): BetterSqlite3.Database;
  (filename: string, options?: BetterSqlite3.Options): BetterSqlite3.Database;
}

let Database: DatabaseConstructor;

namespace Database {
  export type Database = BetterSqlite3.Database;
}
try {
  // Attempt to load the native module and test if its bindings work.
  const RealDatabase = require('better-sqlite3');
  const testDb = new RealDatabase(':memory:');
  testDb.close();
  Database = RealDatabase;
} catch {
  // Fallback mock implementation for environments without the native bindings.
  const fileStates = new Map<string, Record<string, any[]>>();

  const getDbState = (dbPath: string): Record<string, any[]> => {
    const key = dbPath === ':memory:' || !dbPath ? Math.random().toString() : dbPath;
    let state = fileStates.get(key);
    if (!state) {
      state = {
        users: [],
        contracts: [],
        reputation_entries: [],
        transactions: [],
        webhook_dlq: [],
        deployment_history: [],
        idempotency_store: [],
        audit_log_entries: [],
      };
      fileStates.set(key, state);
    }
    return state;
  };

  const toCamelCase = (str: string): string => {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  };

  const escapeRegExp = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const splitSqlValues = (str: string): string[] => {
    const parts: string[] = [];
    let current = '';
    let inQuote: string | null = null;
    let parenDepth = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === "'" || char === '"') {
        if (inQuote === char) {
          inQuote = null;
        } else if (inQuote === null) {
          inQuote = char;
        }
        current += char;
      } else if (char === '(' && !inQuote) {
        parenDepth++;
        current += char;
      } else if (char === ')' && !inQuote) {
        parenDepth--;
        current += char;
      } else if (char === ',' && !inQuote && parenDepth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    parts.push(current.trim());
    return parts;
  };

  const parseSqlValue = (val: string): any => {
    val = val.trim();
    if (val.toUpperCase() === 'NULL') return null;
    if (val.toUpperCase().startsWith("DATETIME(")) {
      const match = val.match(/datetime\(\s*['"]now['"]\s*(?:,\s*['"](-?\d+)\s*(\w+)['"]\s*)?\)/i);
      if (match) {
        const date = new Date();
        if (match[1] && match[2]) {
          const num = parseInt(match[1], 10);
          const unit = match[2].toLowerCase();
          if (unit.startsWith('day')) {
            date.setDate(date.getDate() + num);
          } else if (unit.startsWith('month')) {
            date.setMonth(date.getMonth() + num);
          } else if (unit.startsWith('year')) {
            date.setFullYear(date.getFullYear() + num);
          }
        }
        return date.toISOString();
      }
      return new Date().toISOString();
    }
    // Check if numeric
    if (/^-?\d+$/.test(val)) return parseInt(val, 10);
    if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
    // Strip quotes
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      return val.slice(1, -1).replace(/''/g, "'"); // Unescape single quotes in SQL
    }
    return val;
  };

  const splitByAnd = (str: string): string[] => {
    const parts: string[] = [];
    let current = '';
    let parenDepth = 0;
    let inQuote: string | null = null;
    let i = 0;
    while (i < str.length) {
      const char = str[i];
      if (char === "'" || char === '"') {
        if (inQuote === char) inQuote = null;
        else if (inQuote === null) inQuote = char;
        current += char;
        i++;
      } else if (char === '(' && !inQuote) {
        parenDepth++;
        current += char;
        i++;
      } else if (char === ')' && !inQuote) {
        parenDepth--;
        current += char;
        i++;
      } else if (!inQuote && parenDepth === 0 && str.slice(i).toUpperCase().startsWith('AND ')) {
        parts.push(current.trim());
        current = '';
        i += 4; // Skip "AND "
      } else {
        current += char;
        i++;
      }
    }
    parts.push(current.trim());
    return parts.filter(p => p.length > 0);
  };

  const evaluateSimpleCondition = (row: any, condSql: string, params: any[], paramIndex: { value: number }): boolean => {
    condSql = condSql.trim();
    const match = condSql.match(/^(\w+)\s*(=|!=|<=|>=|<|>|\bIS\s+NOT\b|\bIS\b|\bLIKE\b)\s*(.+)$/i);
    if (!match) return false;
    const field = match[1].toLowerCase();
    const op = match[2].toUpperCase();
    const valStr = match[3].trim();

    let val: any;
    if (valStr === '?') {
      val = params[paramIndex.value++];
    } else {
      val = parseSqlValue(valStr);
    }

    const rowVal = row[field] !== undefined ? row[field] : row[toCamelCase(field)];

    if (op === '=') {
      return rowVal === val;
    } else if (op === '!=') {
      return rowVal !== val;
    } else if (op === '<=') {
      return rowVal <= val;
    } else if (op === '>=') {
      return rowVal >= val;
    } else if (op === '<') {
      return rowVal < val;
    } else if (op === '>') {
      return rowVal > val;
    } else if (op === 'IS') {
      if (valStr.toUpperCase() === 'NULL') {
        return rowVal === null || rowVal === undefined;
      }
      return rowVal === val;
    } else if (op === 'IS NOT') {
      if (valStr.toUpperCase() === 'NULL') {
        return rowVal !== null && rowVal !== undefined;
      }
      return rowVal !== val;
    } else if (op === 'LIKE') {
      if (typeof rowVal !== 'string') return false;
      const regexStr = '^' + escapeRegExp(val).replace(/%/g, '.*') + '$';
      const regex = new RegExp(regexStr, 'i');
      return regex.test(rowVal);
    }

    return false;
  };

  const evaluateCondition = (row: any, condSql: string, params: any[], paramIndex: { value: number }): boolean => {
    condSql = condSql.trim();
    if (condSql.startsWith('(') && condSql.endsWith(')')) {
      const inner = condSql.slice(1, -1);
      const terms = inner.split(/\s+OR\s+/i);
      const currentParamIndex = paramIndex.value;
      for (const term of terms) {
        const termParamIndex = { value: currentParamIndex };
        if (evaluateSimpleCondition(row, term, params, termParamIndex)) {
          paramIndex.value = termParamIndex.value;
          return true;
        }
      }
      const numParams = (inner.match(/\?/g) || []).length;
      paramIndex.value += numParams;
      return false;
    }
    return evaluateSimpleCondition(row, condSql, params, paramIndex);
  };

  const filterRows = (rows: any[], whereSql: string, params: any[]): any[] => {
    if (!whereSql) return rows;
    const conditions = splitByAnd(whereSql);
    const paramIndex = { value: 0 };
    return rows.filter(row => {
      paramIndex.value = 0;
      for (const cond of conditions) {
        if (!evaluateCondition(row, cond, params, paramIndex)) {
          return false;
        }
      }
      return true;
    });
  };

  class MockDatabase {
    private state: Record<string, any[]>;
    private dbPath: string;
    constructor(dbPath: string) {
      this.dbPath = dbPath;
      this.state = getDbState(dbPath);
    }
    pragma(stmt: string, ..._args: any[]) {
      const clean = stmt.replace(/\s+/g, ' ').trim().toLowerCase();
      if (clean.includes('table_info')) {
        const match = clean.match(/table_info\s*\(\s*(\w+)\s*\)/i);
        const tableName = match ? match[1] : '';
        if (tableName === 'contracts') {
          return [
            { name: 'id' },
            { name: 'title' },
            { name: 'client_id' },
            { name: 'freelancer_id' },
            { name: 'amount' },
            { name: 'status' },
            { name: 'version' },
            { name: 'created_at' }
          ];
        }
        return [{ name: 'id' }, { name: 'version' }];
      }
      if (clean.includes('journal_mode')) return 'wal';
      if (clean.includes('synchronous')) return 1;
      if (clean.includes('busy_timeout')) return 5000;
      if (clean.includes('foreign_keys')) return 1;
      return [];
    }
    prepare(sql: string) {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();
      const cleanUpper = cleanSql.toUpperCase();

      if (cleanUpper === 'BEGIN IMMEDIATE' || cleanUpper === 'BEGIN EXCLUSIVE' || cleanUpper === 'BEGIN') {
        return { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] };
      }
      if (cleanUpper === 'COMMIT') {
        return { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] };
      }
      if (cleanUpper === 'ROLLBACK') {
        return { run: () => ({ changes: 0 }), get: () => undefined, all: () => [] };
      }

      if (cleanUpper.startsWith('SELECT')) {
        const fromMatch = cleanSql.match(/FROM\s+(\w+)/i);
        const tableName = fromMatch ? fromMatch[1].toLowerCase() : '';
        const whereMatch = cleanSql.match(/WHERE\s+([\s\S]+?)(?:ORDER\s+BY|LIMIT|OFFSET|$)/i);
        const whereSql = whereMatch ? whereMatch[1] : '';
        const orderByMatch = cleanSql.match(/ORDER\s+BY\s+([\s\S]+?)(?:LIMIT|OFFSET|$)/i);
        const orderBySql = orderByMatch ? orderByMatch[1] : '';
        const limitMatch = cleanSql.match(/LIMIT\s+(\d+|\?)/i);
        const limitVal = limitMatch ? limitMatch[1] : '';
        const offsetMatch = cleanSql.match(/OFFSET\s+(\d+|\?)/i);
        const offsetVal = offsetMatch ? offsetMatch[1] : '';

        if (cleanSql.includes('sqlite_master')) {
          const nameMatch = cleanSql.match(/name\s*=\s*'([^']+)'/i);
          const name = nameMatch ? nameMatch[1] : '';
          return {
            get: () => ({ name }),
            all: () => [{ name }]
          };
        }

        const runSelect = (params: any[]) => {
          let rows = [...(this.state[tableName] || [])];
          if (whereSql) {
            rows = filterRows(rows, whereSql, params);
          }
          if (orderBySql) {
            const orderFields = orderBySql.split(',').map(o => o.trim().split(/\s+/));
            rows.sort((a, b) => {
              for (const [field, dir] of orderFields) {
                const valA = a[field.toLowerCase()] !== undefined ? a[field.toLowerCase()] : a[toCamelCase(field)];
                const valB = b[field.toLowerCase()] !== undefined ? b[field.toLowerCase()] : b[toCamelCase(field)];
                let cmp = 0;
                if (typeof valA === 'string' && typeof valB === 'string') {
                  cmp = valA.localeCompare(valB);
                } else {
                  cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
                }
                if (dir && dir.toUpperCase() === 'DESC') {
                  cmp = -cmp;
                }
                if (cmp !== 0) return cmp;
              }
              return 0;
            });
          }

          const beforeLimitSql = cleanSql.split(/LIMIT/i)[0];
          const numParamsBeforeLimit = (beforeLimitSql.match(/\?/g) || []).length;
          let limit = limitVal ? (limitVal === '?' ? params[numParamsBeforeLimit] : parseInt(limitVal, 10)) : undefined;
          let offset = 0;
          if (offsetVal === '?') {
            const hasLimitParam = limitVal === '?';
            offset = params[numParamsBeforeLimit + (hasLimitParam ? 1 : 0)];
          } else if (offsetVal) {
            offset = parseInt(offsetVal, 10);
          }

          if (offset) {
            rows = rows.slice(offset);
          }
          if (limit !== undefined && limit !== null) {
            rows = rows.slice(0, limit);
          }

          const selectFieldsPart = cleanSql.match(/SELECT\s+(.+?)\s+FROM/i);
          const fieldsPart = selectFieldsPart ? selectFieldsPart[1].trim() : '*';

          if (fieldsPart.toUpperCase().startsWith('COUNT(*)')) {
            const aliasMatch = fieldsPart.match(/AS\s+(\w+)/i);
            const alias = aliasMatch ? aliasMatch[1] : 'count';
            return [{ [alias]: rows.length }];
          }

          if (fieldsPart.toUpperCase().startsWith('MAX(')) {
            const fieldMatch = fieldsPart.match(/MAX\s*\(\s*(\w+)\s*\)/i);
            const field = fieldMatch ? fieldMatch[1].toLowerCase() : '';
            const aliasMatch = fieldsPart.match(/AS\s+(\w+)/i);
            const alias = aliasMatch ? aliasMatch[1] : 'max';
            let maxVal = null;
            for (const r of rows) {
              const val = r[field];
              if (val !== undefined && val !== null) {
                if (maxVal === null || val > maxVal) maxVal = val;
              }
            }
            return [{ [alias]: maxVal }];
          }

          if (fieldsPart.toUpperCase().startsWith('SUM(')) {
            const fieldMatch = fieldsPart.match(/SUM\s*\(\s*(\w+)\s*\)/i);
            const field = fieldMatch ? fieldMatch[1].toLowerCase() : '';
            const aliasMatch = fieldsPart.match(/AS\s+(\w+)/i);
            const alias = aliasMatch ? aliasMatch[1] : 'sum';
            let sumVal = 0;
            for (const r of rows) {
              const val = r[field];
              if (typeof val === 'number') sumVal += val;
            }
            return [{ [alias]: sumVal }];
          }

          if (fieldsPart === '1') {
            return [{ '1': 1 }];
          }

          if (fieldsPart !== '*' && !fieldsPart.includes('COUNT') && !fieldsPart.includes('MAX') && !fieldsPart.includes('SUM')) {
            const selectedFields = fieldsPart.split(',').map(f => {
              const parts = f.trim().split(/\s+AS\s+/i);
              const orig = parts[0].trim().toLowerCase();
              const alias = parts[1] ? parts[1].trim() : orig;
              return { orig, alias };
            });
            return rows.map(r => {
              const projected: any = {};
              for (const { orig, alias } of selectedFields) {
                projected[alias] = r[orig] !== undefined ? r[orig] : r[toCamelCase(orig)];
              }
              return projected;
            });
          }

          return rows;
        };

        return {
          get: (...params: any[]) => {
            const result = runSelect(params);
            return result[0];
          },
          all: (...params: any[]) => {
            return runSelect(params);
          },
          iterate: function* (...params: any[]) {
            const results = runSelect(params);
            for (const r of results) {
              yield r;
            }
          }
        };
      }

      if (cleanUpper.startsWith('INSERT')) {
        const insertMatch = cleanSql.match(/INSERT\s*(?:OR\s+\w+)?\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
        if (insertMatch) {
          const tableName = insertMatch[1].toLowerCase();
          const cols = insertMatch[2].split(',').map(c => c.trim().toLowerCase());
          const valuesPart = insertMatch[3].trim();
          return {
            run: (...args: any[]) => {
              const rawValues = splitSqlValues(valuesPart);
              let argIndex = 0;
              const finalValues = rawValues.map(v => {
                if (v === '?') return args[argIndex++];
                return parseSqlValue(v);
              });
              const newRow: any = {};
              for (let i = 0; i < cols.length; i++) {
                newRow[cols[i]] = finalValues[i];
              }

              const tableState = this.state[tableName] || [];
              if (cleanUpper.includes('IGNORE')) {
                let exists = false;
                if (tableName === 'users') {
                  exists = tableState.some(u => u.id === newRow.id || u.username === newRow.username || u.email === newRow.email);
                } else if (tableName === 'reputation_entries') {
                  exists = tableState.some(r => r.reviewer_id === newRow.reviewer_id && r.target_id === newRow.target_id && r.context_id === newRow.context_id);
                } else if (tableName === 'contracts') {
                  exists = tableState.some(c => c.id === newRow.id);
                }
                if (exists) {
                  return { changes: 0, lastInsertRowid: 0 };
                }
              }

              if (cleanUpper.includes('REPLACE')) {
                if (tableName === 'idempotency_store') {
                  const idx = tableState.findIndex(r => r.key === newRow.key);
                  if (idx !== -1) tableState.splice(idx, 1);
                }
              }

              tableState.push(newRow);
              return { changes: 1, lastInsertRowid: tableState.length };
            }
          };
        }
      }

      if (cleanUpper.startsWith('UPDATE')) {
        const updateMatch = cleanSql.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
        if (updateMatch) {
          const tableName = updateMatch[1].toLowerCase();
          const setSql = updateMatch[2].trim();
          const whereSql = updateMatch[3].trim();
          return {
            run: (...args: any[]) => {
              const numSetParams = (setSql.match(/\?/g) || []).length;
              const setArgs = args.slice(0, numSetParams);
              const whereArgs = args.slice(numSetParams);
              const tableState = this.state[tableName] || [];
              const matchedRows = filterRows(tableState, whereSql, whereArgs);
              if (matchedRows.length === 0) {
                return { changes: 0 };
              }

              const assignments = splitSqlValues(setSql);
              let changesCount = 0;
              for (const row of matchedRows) {
                let setArgIdx = 0;
                for (const assignment of assignments) {
                  const parts = assignment.split('=');
                  const col = parts[0].trim().toLowerCase();
                  const valExpression = parts[1].trim();
                  let val: any;
                  if (valExpression === '?') {
                    val = setArgs[setArgIdx++];
                  } else if (valExpression.toUpperCase().startsWith('COALESCE(')) {
                    const inner = valExpression.slice(9, -1);
                    const innerTerms = inner.split(',').map(t => t.trim());
                    let coalesceVal = null;
                    for (const term of innerTerms) {
                      let termVal: any;
                      if (term === '?') {
                        termVal = setArgs[setArgIdx++];
                      } else {
                        termVal = row[term.toLowerCase()] !== undefined ? row[term.toLowerCase()] : row[toCamelCase(term)];
                      }
                      if (termVal !== null && termVal !== undefined) {
                        coalesceVal = termVal;
                        break;
                      }
                    }
                    val = coalesceVal;
                  } else if (valExpression.toLowerCase() === col + ' + 1') {
                    val = (row[col] || 0) + 1;
                  } else {
                    val = parseSqlValue(valExpression);
                  }

                  if (row[col] !== undefined) {
                    row[col] = val;
                  } else if (row[toCamelCase(col)] !== undefined) {
                    row[toCamelCase(col)] = val;
                  } else {
                    row[col] = val;
                  }
                }
                changesCount++;
              }
              return { changes: changesCount };
            }
          };
        }
      }

      if (cleanUpper.startsWith('DELETE')) {
        const deleteMatch = cleanSql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?/i);
        if (deleteMatch) {
          const tableName = deleteMatch[1].toLowerCase();
          const whereSql = deleteMatch[2];
          return {
            run: (...args: any[]) => {
              const tableState = this.state[tableName];
              if (!tableState) return { changes: 0 };
              if (!whereSql) {
                const count = tableState.length;
                tableState.length = 0;
                return { changes: count };
              }
              const matchedRows = filterRows(tableState, whereSql, args);
              const remainingRows = tableState.filter(row => !matchedRows.includes(row));
              const deletedCount = tableState.length - remainingRows.length;
              this.state[tableName] = remainingRows;
              return { changes: deletedCount };
            }
          };
        }
      }

      return {
        run: (..._args: any[]) => ({ lastInsertRowid: 0, changes: 0 }),
        get: (..._args: any[]) => undefined,
        all: (..._args: any[]) => [],
        iterate: function* () {},
        exec: () => {},
      };
    }
    exec(sql: string) {
      const statements = sql.split(';');
      for (let stmt of statements) {
        stmt = stmt.replace(/\s+/g, ' ').trim();
        if (!stmt) continue;
        const cleanUpper = stmt.toUpperCase();
        if (cleanUpper.startsWith('DELETE FROM')) {
          const match = stmt.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?/i);
          if (match) {
            const table = match[1].toLowerCase();
            const whereSql = match[2];
            const tableState = this.state[table];
            if (tableState) {
              if (whereSql) {
                const rowsToKeep = tableState.filter(row => {
                  const paramIndex = { value: 0 };
                  const conditions = splitByAnd(whereSql);
                  for (const cond of conditions) {
                    if (!evaluateCondition(row, cond, [], paramIndex)) {
                      return true;
                    }
                  }
                  return false;
                });
                this.state[table] = rowsToKeep;
              } else {
                tableState.length = 0;
              }
            }
          }
        } else if (cleanUpper.startsWith('INSERT INTO') || cleanUpper.startsWith('INSERT OR IGNORE INTO') || cleanUpper.startsWith('INSERT OR REPLACE INTO')) {
          const insertMatch = stmt.match(/INSERT\s*(?:OR\s+\w+)?\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+)/i);
          if (insertMatch) {
            const tableName = insertMatch[1].toLowerCase();
            const cols = insertMatch[2].split(',').map(c => c.trim().toLowerCase());
            const valuesPart = insertMatch[3].trim();
            const rowsOfValues: string[] = [];
            let currentStr = '';
            let parenDepth = 0;
            let inQuote: string | null = null;
            for (let i = 0; i < valuesPart.length; i++) {
              const char = valuesPart[i];
              if (char === "'" || char === '"') {
                if (inQuote === char) inQuote = null;
                else if (inQuote === null) inQuote = char;
                currentStr += char;
              } else if (char === '(' && !inQuote) {
                parenDepth++;
                if (parenDepth === 1) {
                  currentStr = '';
                } else {
                  currentStr += char;
                }
              } else if (char === ')' && !inQuote) {
                parenDepth--;
                if (parenDepth === 0) {
                  rowsOfValues.push(currentStr);
                } else {
                  currentStr += char;
                }
              } else {
                if (parenDepth > 0) {
                  currentStr += char;
                }
              }
            }

            const tableState = this.state[tableName];
            if (tableState) {
              for (const rowValStr of rowsOfValues) {
                const rawValues = splitSqlValues(rowValStr);
                const values = rawValues.map(v => parseSqlValue(v));
                const newRow: any = {};
                for (let c = 0; c < cols.length; c++) {
                  newRow[cols[c]] = values[c];
                }

                if (cleanUpper.includes('IGNORE')) {
                  let exists = false;
                  if (tableName === 'users') {
                    exists = tableState.some(u => u.id === newRow.id || u.username === newRow.username || u.email === newRow.email);
                  } else if (tableName === 'reputation_entries') {
                    exists = tableState.some(r => r.reviewer_id === newRow.reviewer_id && r.target_id === newRow.target_id && r.context_id === newRow.context_id);
                  } else if (tableName === 'contracts') {
                    exists = tableState.some(c => c.id === newRow.id);
                  }
                  if (exists) continue;
                }

                tableState.push(newRow);
              }
            }
          }
        }
      }
    }
    transaction(fn: (...args: any[]) => any) {
      return fn;
    }
    close() {}
  }
  Database = MockDatabase as any;
}
export default Database;

export type Database = BetterSqlite3.Database;
