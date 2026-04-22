import Database from 'better-sqlite3'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  DEFAULT_BUILD_TOOL_PREFERENCE,
  DEFAULT_CLOSE_ACTION,
  DEFAULT_HEALTH_CHECK_PATH,
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
  type SavedServiceGroup,
  type SavedServiceGroupService,
  type ServiceGroupSaveRequest,
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
            health_check_path,
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
            @healthCheckPath,
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
            health_check_path = excluded.health_check_path,
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
    | 'buildToolPreference'
    | 'skipTests'
    | 'jvmArgs'
    | 'programArgs'
    | 'springProfiles'
    | 'healthCheckPath'
  > | null {
    const row = this.db
      .prepare(
        `
          SELECT
            build_tool_preference AS buildToolPreference,
            skip_tests AS skipTests,
            jvm_args AS jvmArgs,
            program_args AS programArgs,
            spring_profiles AS springProfiles,
            health_check_path AS healthCheckPath
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
          healthCheckPath: string | null
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
      springProfiles: row.springProfiles ?? DEFAULT_SPRING_PROFILES,
      healthCheckPath: row.healthCheckPath ?? DEFAULT_HEALTH_CHECK_PATH
    }
  }

  getSavedServiceGroups(rootPath: string): SavedServiceGroup[] {
    const groups = this.db
      .prepare(
        `
          SELECT
            group_id AS groupId,
            root_path AS rootPath,
            group_name AS groupName,
            stop_on_failure AS stopOnFailure,
            startup_interval_ms AS startupIntervalMs,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM service_groups
          WHERE root_path = ?
          ORDER BY updated_at DESC
        `
      )
      .all(rootPath) as Array<
        Omit<SavedServiceGroup, 'services' | 'stopOnFailure'> & { stopOnFailure: number }
      >

    return groups.map((group) => ({
      ...group,
      stopOnFailure: group.stopOnFailure === 1,
      services: this.getSavedServiceGroupServices(group.groupId)
    }))
  }

  saveServiceGroup(request: ServiceGroupSaveRequest): SavedServiceGroup {
    if (request.services.length === 0) {
      throw new Error('Service group requires at least one service.')
    }

    const now = new Date().toISOString()
    const groupName = request.groupName.trim() || 'Service Group'
    const existing = this.db
      .prepare(
        `
          SELECT group_id AS groupId, created_at AS createdAt
          FROM service_groups
          WHERE root_path = ? AND group_name = ?
        `
      )
      .get(request.rootPath, groupName) as { groupId: string; createdAt: string } | undefined
    const groupId = existing?.groupId ?? `saved-group-${Date.now()}`
    const createdAt = existing?.createdAt ?? now

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT INTO service_groups (
              group_id,
              root_path,
              group_name,
              stop_on_failure,
              startup_interval_ms,
              created_at,
              updated_at
            )
            VALUES (
              @groupId,
              @rootPath,
              @groupName,
              @stopOnFailure,
              @startupIntervalMs,
              @createdAt,
              @updatedAt
            )
            ON CONFLICT(group_id)
            DO UPDATE SET
              group_name = excluded.group_name,
              stop_on_failure = excluded.stop_on_failure,
              startup_interval_ms = excluded.startup_interval_ms,
              updated_at = excluded.updated_at
          `
        )
        .run({
          groupId,
          rootPath: request.rootPath,
          groupName,
          stopOnFailure: request.stopOnFailure ? 1 : 0,
          startupIntervalMs: normalizeStartupInterval(request.startupIntervalMs),
          createdAt,
          updatedAt: now
        })

      this.db.prepare('DELETE FROM service_group_services WHERE group_id = ?').run(groupId)

      const insertService = this.db.prepare(
        `
          INSERT INTO service_group_services (
            group_id,
            service_id,
            order_index,
            root_path,
            module_path,
            artifact_id,
            main_class,
            runtime_port,
            build_tool_preference,
            skip_tests,
            jvm_args,
            program_args,
            spring_profiles,
            health_check_path
          )
          VALUES (
            @groupId,
            @serviceId,
            @orderIndex,
            @rootPath,
            @modulePath,
            @artifactId,
            @mainClass,
            @runtimePort,
            @buildToolPreference,
            @skipTests,
            @jvmArgs,
            @programArgs,
            @springProfiles,
            @healthCheckPath
          )
        `
      )

      request.services.forEach((service, orderIndex) => {
        insertService.run({
          groupId,
          serviceId: `${service.artifactId}:${service.mainClass}`,
          orderIndex,
          rootPath: service.rootPath,
          modulePath: service.modulePath,
          artifactId: service.artifactId,
          mainClass: service.mainClass,
          runtimePort: service.runtimePort,
          buildToolPreference: service.buildToolPreference,
          skipTests: service.skipTests ? 1 : 0,
          jvmArgs: service.jvmArgs,
          programArgs: service.programArgs,
          springProfiles: service.springProfiles,
          healthCheckPath: service.healthCheckPath
        })
      })
    })

    transaction()
    return this.getSavedServiceGroup(groupId)
  }

  deleteServiceGroup(groupId: string) {
    this.db.prepare('DELETE FROM service_group_services WHERE group_id = ?').run(groupId)
    this.db.prepare('DELETE FROM service_groups WHERE group_id = ?').run(groupId)
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
        health_check_path TEXT NOT NULL DEFAULT '/actuator/health',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_groups (
        group_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        group_name TEXT NOT NULL,
        stop_on_failure INTEGER NOT NULL,
        startup_interval_ms INTEGER NOT NULL DEFAULT 5000,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(root_path, group_name)
      );

      CREATE TABLE IF NOT EXISTS service_group_services (
        group_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        root_path TEXT NOT NULL,
        module_path TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        main_class TEXT NOT NULL,
        runtime_port INTEGER,
        build_tool_preference TEXT NOT NULL,
        skip_tests INTEGER NOT NULL,
        jvm_args TEXT NOT NULL DEFAULT '',
        program_args TEXT NOT NULL DEFAULT '',
        spring_profiles TEXT NOT NULL DEFAULT '',
        health_check_path TEXT NOT NULL DEFAULT '/actuator/health',
        PRIMARY KEY(group_id, service_id),
        FOREIGN KEY(group_id) REFERENCES service_groups(group_id) ON DELETE CASCADE
      );
    `)

    this.ensureColumn('service_preferences', 'jvm_args', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('service_preferences', 'program_args', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('service_preferences', 'spring_profiles', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn(
      'service_preferences',
      'health_check_path',
      `TEXT NOT NULL DEFAULT '${DEFAULT_HEALTH_CHECK_PATH}'`
    )
    this.ensureColumn('service_groups', 'startup_interval_ms', 'INTEGER NOT NULL DEFAULT 5000')
    this.ensureColumn('service_group_services', 'jvm_args', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('service_group_services', 'program_args', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn('service_group_services', 'spring_profiles', "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn(
      'service_group_services',
      'health_check_path',
      `TEXT NOT NULL DEFAULT '${DEFAULT_HEALTH_CHECK_PATH}'`
    )
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

  private getSavedServiceGroup(groupId: string): SavedServiceGroup {
    const group = this.db
      .prepare(
        `
          SELECT
            group_id AS groupId,
            root_path AS rootPath,
            group_name AS groupName,
            stop_on_failure AS stopOnFailure,
            startup_interval_ms AS startupIntervalMs,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM service_groups
          WHERE group_id = ?
        `
      )
      .get(groupId) as
      | (Omit<SavedServiceGroup, 'services' | 'stopOnFailure'> & { stopOnFailure: number })
      | undefined

    if (!group) {
      throw new Error(`Service group ${groupId} was not found.`)
    }

    return {
      ...group,
      stopOnFailure: group.stopOnFailure === 1,
      services: this.getSavedServiceGroupServices(groupId)
    }
  }

  private getSavedServiceGroupServices(groupId: string): SavedServiceGroupService[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            service_id AS serviceId,
            order_index AS orderIndex,
            root_path AS rootPath,
            module_path AS modulePath,
            artifact_id AS artifactId,
            main_class AS mainClass,
            runtime_port AS runtimePort,
            build_tool_preference AS buildToolPreference,
            skip_tests AS skipTests,
            jvm_args AS jvmArgs,
            program_args AS programArgs,
            spring_profiles AS springProfiles,
            health_check_path AS healthCheckPath
          FROM service_group_services
          WHERE group_id = ?
          ORDER BY order_index ASC
        `
      )
      .all(groupId) as Array<Omit<SavedServiceGroupService, 'skipTests'> & { skipTests: number }>

    return rows.map((row) => ({
      ...row,
      skipTests: row.skipTests === 1,
      healthCheckPath: row.healthCheckPath ?? DEFAULT_HEALTH_CHECK_PATH
    }))
  }
}

function normalizeStartupInterval(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.min(Math.trunc(value), 600000)
}

export const persistenceService = new PersistenceService()
