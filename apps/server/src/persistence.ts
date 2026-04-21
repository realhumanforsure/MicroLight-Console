import Database from 'better-sqlite3'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  DEFAULT_BUILD_TOOL_PREFERENCE,
  DEFAULT_CLOSE_ACTION,
  DEFAULT_JVM_ARGS,
  DEFAULT_PROGRAM_ARGS,
  DEFAULT_SKIP_TESTS,
  DEFAULT_SPRING_PROFILES,
  DEFAULT_TRAY_ENABLED,
  type AppSettings,
  type AppSettingsUpdateRequest,
  type BuildToolPreference,
  type DesktopCloseAction,
  type ProjectPreference,
  type ProjectPreferenceUpdateRequest,
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
      lastProjectPath: settingsMap.get('lastProjectPath') ?? null,
      trayEnabled:
        settingsMap.get('trayEnabled') === undefined
          ? DEFAULT_TRAY_ENABLED
          : settingsMap.get('trayEnabled') === 'true',
      closeAction:
        (settingsMap.get('closeAction') as DesktopCloseAction | undefined) ?? DEFAULT_CLOSE_ACTION
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
      statement.run('trayEnabled', String(payload.trayEnabled))
      statement.run('closeAction', payload.closeAction)
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

  saveProjectPreference(preference: ProjectPreferenceUpdateRequest) {
    const updatedAt = new Date().toISOString()

    this.db
      .prepare(
        `
          INSERT INTO project_preferences (
            root_path,
            last_selected_service_id,
            updated_at
          )
          VALUES (
            @rootPath,
            @lastSelectedServiceId,
            @updatedAt
          )
          ON CONFLICT(root_path)
          DO UPDATE SET
            last_selected_service_id = excluded.last_selected_service_id,
            updated_at = excluded.updated_at
        `
      )
      .run({
        rootPath: preference.rootPath,
        lastSelectedServiceId: preference.lastSelectedServiceId,
        updatedAt
      })

    return this.getProjectPreference(preference.rootPath)
  }

  getProjectPreference(rootPath: string): ProjectPreference | null {
    const row = this.db
      .prepare(
        `
          SELECT
            root_path AS rootPath,
            last_selected_service_id AS lastSelectedServiceId,
            updated_at AS updatedAt
          FROM project_preferences
          WHERE root_path = ?
        `
      )
      .get(rootPath) as ProjectPreference | undefined

    return row ?? null
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
            jvm_args,
            program_args,
            spring_profiles,
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
            @jvmArgs,
            @programArgs,
            @springProfiles,
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
            jvm_args = excluded.jvm_args,
            program_args = excluded.program_args,
            spring_profiles = excluded.spring_profiles,
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
  ): Pick<
    ServicePreference,
    'buildToolPreference' | 'skipTests' | 'jvmArgs' | 'programArgs' | 'springProfiles'
  > | null {
    const row = this.db
      .prepare(
        `
          SELECT
            build_tool_preference AS buildToolPreference,
            skip_tests AS skipTests,
            jvm_args AS jvmArgs,
            program_args AS programArgs,
            spring_profiles AS springProfiles
          FROM service_preferences
          WHERE service_id = ?
        `
      )
      .get(serviceId) as
      | {
          buildToolPreference: BuildToolPreference
          skipTests: number
          jvmArgs: string | null
          programArgs: string | null
          springProfiles: string | null
        }
      | undefined

    if (!row) {
      return null
    }

    return {
      buildToolPreference: row.buildToolPreference,
      skipTests: row.skipTests === 1,
      jvmArgs: row.jvmArgs ?? DEFAULT_JVM_ARGS,
      programArgs: row.programArgs ?? DEFAULT_PROGRAM_ARGS,
      springProfiles: row.springProfiles ?? DEFAULT_SPRING_PROFILES
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

      CREATE TABLE IF NOT EXISTS project_preferences (
        root_path TEXT PRIMARY KEY,
        last_selected_service_id TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_preferences (
        service_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        module_path TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        main_class TEXT NOT NULL,
        build_tool_preference TEXT NOT NULL,
        skip_tests INTEGER NOT NULL,
        jvm_args TEXT NOT NULL DEFAULT '',
        program_args TEXT NOT NULL DEFAULT '',
        spring_profiles TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `)

    this.ensureColumn('service_preferences', 'jvm_args', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('service_preferences', 'program_args', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('service_preferences', 'spring_profiles', "TEXT NOT NULL DEFAULT ''")
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>

    if (columns.some((column) => column.name === columnName)) {
      return
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

export const persistenceService = new PersistenceService()
