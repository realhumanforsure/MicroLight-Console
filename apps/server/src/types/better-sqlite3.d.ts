declare module 'better-sqlite3' {
  export interface Statement {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
  }

  export interface Database {
    prepare(sql: string): Statement
    pragma(value: string): void
    exec(sql: string): void
    transaction<T extends (...args: never[]) => unknown>(fn: T): T
  }

  interface DatabaseConstructor {
    new (filename: string): Database
  }

  const Database: DatabaseConstructor
  export default Database
}
