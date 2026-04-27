use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeToolStatus {
    pub available: bool,
    pub command: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDetectionResult {
    pub java: RuntimeToolStatus,
    pub build_tool: RuntimeToolStatus,
    pub build_tool_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCandidate {
    pub service_id: String,
    pub artifact_id: String,
    pub main_class: String,
    pub module_path: String,
    pub java_file_path: String,
    pub default_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScanResult {
    pub root_path: String,
    pub artifact_id: String,
    pub module_count: usize,
    pub services: Vec<ServiceCandidate>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceStatus {
    Building,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInstance {
    pub service_id: String,
    pub artifact_id: String,
    pub main_class: String,
    pub module_path: String,
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub runtime_port: Option<u16>,
    pub build_tool: Option<String>,
    pub started_at: Option<String>,
    pub last_updated_at: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLaunchRequest {
    pub root_path: String,
    pub module_path: String,
    pub artifact_id: String,
    pub main_class: String,
    pub runtime_port: Option<u16>,
    pub skip_tests: bool,
    pub jvm_args: String,
    pub program_args: String,
    pub spring_profiles: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub service_id: String,
    pub source: String,
    pub timestamp: String,
    pub line: String,
}
