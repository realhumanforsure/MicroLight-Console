mod models;
mod project;
mod runtime;

use rfd::FileDialog;

use crate::{
    models::{ProjectScanResult, RuntimeDetectionResult, ServiceInstance, ServiceLaunchRequest},
    runtime::AppState,
};

#[tauri::command]
fn select_project_directory() -> Option<String> {
    FileDialog::new()
        .set_title("选择 Maven 项目目录")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn scan_project(root_path: String) -> Result<ProjectScanResult, String> {
    project::scan_project(&root_path)
}

#[tauri::command]
fn detect_runtime(root_path: String) -> Result<RuntimeDetectionResult, String> {
    runtime::detect_runtime(&root_path)
}

#[tauri::command]
fn list_services(state: tauri::State<'_, AppState>) -> Vec<ServiceInstance> {
    runtime::list_services(state)
}

#[tauri::command]
fn launch_service(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: ServiceLaunchRequest,
) -> Result<ServiceInstance, String> {
    runtime::launch_service(app, state, request)
}

#[tauri::command]
fn stop_service(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    service_id: String,
) -> Result<ServiceInstance, String> {
    runtime::stop_service(app, state, service_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            select_project_directory,
            scan_project,
            detect_runtime,
            list_services,
            launch_service,
            stop_service
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
