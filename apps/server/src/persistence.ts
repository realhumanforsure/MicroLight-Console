import Database from 'better-sqlite3'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  DEFAULT_BUILD_TOOL_PREFERENCE,
  DEFAULT_SKIP_TESTS,
  type AppSettings,
  type AppSettingsUpdateRequest,
  type BuildToolPreference,
  type RecentProject,
  type ServicePreference
} from '@microlight/shared'

const DATA_DIRECTORY = path.join(os.homedir(), '.microlight-console')
const DATABASE_PATH = path.join(DATA_DIRECTORY, 'microlight-console.db')

mkdirSync(DATA_DIRECTORY, { recursive: true })

class PersistenceService {
  private readonly db: BetterSqliteDatabase

  constructor() {
    this.db = new Database(DATABASE_PATH)
    this.db.pragma('journal_mode = WAL')
    this.initialize()
  }

  getAppSettings(): AppSettings {
    const settings = this.db
      .prepare('SELECT key, value FROM app_settings')
      .all() as Array<{ key: string; value: string }>

    const settingsMap = new Map(settings.map((entry) => [entry.key, entry.value]))

    return {
      locale: (settingsMap.get('locale') as AppSettings['locale'] | undefined) ?? 'zh-CN',
      defaultBuildToolPreference:
        (settingsMap.get('defaultBuildToolPreference') as BuildToolPreference | undefined) ??
        DEFAULT_BUILD_TOOL_PREFERENCE,
      defaultSkipTests:
        settingsMap.get('defaultSkipTests') === undefined
          ? DEFAULT_SKIP_TESTS
          : settingsMap.get('defaultSkipTests') === 'true',
      lastProjectPath: settingsMap.get('lastProjectPath') ?? null
    }
  }

  updateAppSettings(payload: AppSettingsUpdateRequest) {
    const statement = this.db.prepare(
      `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    )

    const transaction = this.db.transaction(() => {
      statement.run('locale', payload.locale)
      statement.run('defaultBuildToolPreference', payload.defaultBuildToolPreference)
      statement.run('defaultSkipTests', String(payload.defaultSkipTests))
      statement.run('lastProjectPath', payload.lastProjectPath ?? '')
    })

    transaction()
    return this.getAppSettings()
  }

  recordRecentProject(rootPath: string) {
    const now = new Date().toISOString()
    const displayName = path.basename(rootPath)

    this.db
      .prepare(
        `
          INSERT INTO recent_projects (root_path, display_name, last_opened_at)
          VALUES (@rootPath, @displayName, @lastOpenedAt)
          ON CONFLICT(root_path)
          DO UPDATE SET
            display_name = excluded.display_name,
            last_opened_at = excluded.last_opened_at
        `
      )
      .run({
        rootPath,
        displayName,
        lastOpenedAt: now
      })

    this.updateAppSettings({
      ...this.getAppSettings(),
      lastProjectPath: rootPath
    })
  }

  getRecentProjects(limit = 8): RecentProject[] {
    return this.db
      .prepare(
        `
          SELECT root_path AS rootPath, display_name AS displayName, last_opened_at AS lastOpenedAt
          FROM recent_projects
          ORDER BY last_opened_at DESC
          LIMIT ?
        `
      )
      .all(limit) as RecentProject[]
  }

  saveServicePreference(preference: Omit<ServicePreference, 'updatedAt'>) {
    const updatedAt = new Date().toISOString()

    this.db
      .prepare(
        `
          INSERT INTO service_preferences (
            service_id,
            root_path,
            module_path,
            artifact_id,
            main_class,
            build_tool_preference,
            skip_tests,
            updated_at
          )
          VALUES (
            @serviceId,
            @rootPath,
            @modulePath,
            @artifactId,
            @mainClass,
            @buildToolPreference,
            @skipTests,
            @updatedAt
          )
          ON CONFLICT(service_id)
          DO UPDATE SET
            root_path = excluded.root_path,
            module_path = excluded.module_path,
            artifact_id = excluded.artifact_id,
            main_class = excluded.main_class,
            build_tool_preference = excluded.build_tool_preference,
            skip_tests = excluded.skip_tests,
            updated_at = excluded.updated_at
        `
      )
      .run({
        ...preference,
        skipTests: preference.skipTests ? 1 : 0,
        updatedAt
      })
  }

  getServicePreference(
    serviceId: string
  ): Pick<ServicePreference, 'buildToolPreference' | 'skipTests'> | null {
    const row = this.db
      .prepare(
        `
          SELECT build_tool_preference AS buildToolPreference, skip_tests AS skipTests
          FROM service_preferences
          WHERE service_id = ?
        `
      )
      .get(serviceId) as
      | {
          buildToolPreference: BuildToolPreference
          skipTests: number
        }
      | undefined

    if (!row) {
      return null
    }

    return {
      buildToolPreference: row.buildToolPreference,
      skipTests: row.skipTests === 1
    }
  }

  getDatabasePath() {
    return DATABASE_PATH
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recent_projects (
        root_path TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_preferences (
        service_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        module_path TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        main_class TEXT NOT NULL,
        build_tool_preference TEXT NOT NULL,
        skip_tests INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }
}

export const persistenceService = new PersistenceService()
