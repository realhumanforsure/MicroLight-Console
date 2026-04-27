use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use chrono::Utc;
use pathdiff::diff_paths;
use tauri::{AppHandle, Emitter, State};

use crate::models::{
    LogEvent, RuntimeDetectionResult, RuntimeToolStatus, ServiceInstance, ServiceLaunchRequest,
    ServiceStatus,
};

#[derive(Default)]
pub struct AppState {
    pub(crate) services: Arc<Mutex<HashMap<String, ManagedService>>>,
}

#[derive(Clone)]
pub(crate) struct ManagedService {
    instance: ServiceInstance,
    stop_requested: bool,
}

pub fn detect_runtime(root_path: &str) -> Result<RuntimeDetectionResult, String> {
    let java = detect_tool("java", &["-version"])?;
    let mvnw_path = resolve_maven_wrapper(root_path);
    let (build_tool_kind, build_tool) = if let Some(command) = &mvnw_path {
        ("mvnw".to_string(), detect_tool(command, &["-v"])?)
    } else {
        let mvnd = detect_tool("mvnd", &["-v"])?;
        if mvnd.available {
            ("mvnd".to_string(), mvnd)
        } else {
            ("mvn".to_string(), detect_tool("mvn", &["-v"])?)
        }
    };

    Ok(RuntimeDetectionResult {
        java,
        build_tool_kind: if build_tool.available {
            Some(build_tool_kind)
        } else {
            None
        },
        build_tool,
    })
}

pub fn list_services(state: State<'_, AppState>) -> Vec<ServiceInstance> {
    let mut services = state
        .services
        .lock()
        .expect("service state lock poisoned")
        .values()
        .map(|service| service.instance.clone())
        .collect::<Vec<_>>();

    services.sort_by(|left, right| left.artifact_id.cmp(&right.artifact_id));
    services
}

pub fn launch_service(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ServiceLaunchRequest,
) -> Result<ServiceInstance, String> {
    let service_id = format!("{}:{}", request.artifact_id, request.main_class);

    if let Some(existing) = state
        .services
        .lock()
        .expect("service state lock poisoned")
        .get(&service_id)
        .cloned()
    {
        if existing.instance.pid.is_some()
            || matches!(
                existing.instance.status,
                ServiceStatus::Building | ServiceStatus::Running
            )
        {
            stop_service_internal(&state.services, &service_id)?;
        }
    }

    let runtime = detect_runtime(&request.root_path)?;
    let build_tool_kind = runtime.build_tool_kind.clone();

    let instance = ServiceInstance {
        service_id: service_id.clone(),
        artifact_id: request.artifact_id.clone(),
        main_class: request.main_class.clone(),
        module_path: request.module_path.clone(),
        status: ServiceStatus::Building,
        pid: None,
        runtime_port: request.runtime_port,
        build_tool: build_tool_kind.clone(),
        started_at: None,
        last_updated_at: now_iso(),
        last_error: None,
    };

    {
        let mut services = state.services.lock().expect("service state lock poisoned");
        services.insert(
            service_id.clone(),
            ManagedService {
                instance: instance.clone(),
                stop_requested: false,
            },
        );
    }

    emit_status(&app, &instance);

    let app_handle = app.clone();
    let services = state.services.clone();

    thread::spawn(move || {
        if let Err(message) = run_service(app_handle.clone(), services.clone(), request, service_id.clone()) {
            update_instance(&services, &service_id, |service| {
                service.instance.status = ServiceStatus::Failed;
                service.instance.last_error = Some(message.clone());
                service.instance.last_updated_at = now_iso();
                service.instance.pid = None;
            });

            if let Some(instance) = current_instance(&services, &service_id) {
                emit_status(&app_handle, &instance);
                emit_log(&app_handle, &instance.service_id, "system", &message);
            }
        }
    });

    Ok(instance)
}

pub fn stop_service(
    app: AppHandle,
    state: State<'_, AppState>,
    service_id: String,
) -> Result<ServiceInstance, String> {
    stop_service_internal(&state.services, &service_id)?;
    let instance = current_instance(&state.services, &service_id)
        .ok_or_else(|| format!("服务 {service_id} 不存在。"))?;
    emit_status(&app, &instance);
    Ok(instance)
}

fn run_service(
    app: AppHandle,
    services: Arc<Mutex<HashMap<String, ManagedService>>>,
    request: ServiceLaunchRequest,
    service_id: String,
) -> Result<(), String> {
    let build_tool = resolve_build_tool(&request.root_path)?;
    let build_args = create_build_args(&request)?;

    emit_log(
        &app,
        &service_id,
        "system",
        &format!("build> {} {}", build_tool.command, build_args.join(" ")),
    );

    let mut build_child = Command::new(&build_tool.command)
        .args(&build_args)
        .current_dir(&request.root_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动构建命令失败：{error}"))?;

    update_instance(&services, &service_id, |service| {
        service.instance.pid = Some(build_child.id());
        service.instance.status = ServiceStatus::Building;
        service.instance.build_tool = Some(build_tool.kind.clone());
        service.instance.last_updated_at = now_iso();
        service.instance.last_error = None;
    });

    if let Some(instance) = current_instance(&services, &service_id) {
        emit_status(&app, &instance);
    }

    if let Some(stdout) = build_child.stdout.take() {
        spawn_log_reader(app.clone(), service_id.clone(), "stdout", stdout);
    }
    if let Some(stderr) = build_child.stderr.take() {
        spawn_log_reader(app.clone(), service_id.clone(), "stderr", stderr);
    }

    let build_status = build_child
        .wait()
        .map_err(|error| format!("等待构建命令结束失败：{error}"))?;

    if !build_status.success() {
        return Err(format!(
            "构建失败，退出码：{}。",
            build_status.code().unwrap_or(-1)
        ));
    }

    let jar_path = resolve_runnable_jar(Path::new(&request.module_path))?;
    let java_args = create_java_args(&request, &jar_path)?;

    emit_log(
        &app,
        &service_id,
        "system",
        &format!("run> java {}", java_args.join(" ")),
    );

    let mut java_child = Command::new("java")
        .args(&java_args)
        .current_dir(&request.module_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 Java 进程失败：{error}"))?;

    let started_at = now_iso();

    update_instance(&services, &service_id, |service| {
        service.instance.pid = Some(java_child.id());
        service.instance.status = ServiceStatus::Running;
        service.instance.started_at = Some(started_at.clone());
        service.instance.last_updated_at = now_iso();
        service.instance.last_error = None;
    });

    if let Some(instance) = current_instance(&services, &service_id) {
        emit_status(&app, &instance);
    }

    if let Some(stdout) = java_child.stdout.take() {
        spawn_log_reader(app.clone(), service_id.clone(), "stdout", stdout);
    }
    if let Some(stderr) = java_child.stderr.take() {
        spawn_log_reader(app.clone(), service_id.clone(), "stderr", stderr);
    }

    let exit_status = java_child
        .wait()
        .map_err(|error| format!("等待 Java 进程结束失败：{error}"))?;

    let stopped_by_user = services
        .lock()
        .expect("service state lock poisoned")
        .get(&service_id)
        .map(|service| service.stop_requested)
        .unwrap_or(false);

    update_instance(&services, &service_id, |service| {
        service.instance.pid = None;
        service.instance.last_updated_at = now_iso();

        if stopped_by_user || exit_status.success() {
            service.instance.status = ServiceStatus::Stopped;
            service.instance.last_error = None;
        } else {
            service.instance.status = ServiceStatus::Failed;
            service.instance.last_error = Some(format!(
                "服务异常退出，退出码：{}。",
                exit_status.code().unwrap_or(-1)
            ));
        }
    });

    if let Some(instance) = current_instance(&services, &service_id) {
        emit_status(&app, &instance);
        emit_log(
            &app,
            &service_id,
            "system",
            &format!(
                "进程已结束，退出码：{}。",
                exit_status.code().unwrap_or(-1)
            ),
        );
    }

    Ok(())
}

fn create_build_args(request: &ServiceLaunchRequest) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&request.root_path)
        .canonicalize()
        .map_err(|error| format!("无法解析项目目录：{error}"))?;
    let module = PathBuf::from(&request.module_path)
        .canonicalize()
        .map_err(|error| format!("无法解析模块目录：{error}"))?;
    let relative_module = diff_paths(&module, &root)
        .ok_or_else(|| "无法计算 Maven 模块相对路径。".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let mut args = Vec::new();
    if !relative_module.is_empty() && relative_module != "." {
        args.push("-pl".to_string());
        args.push(relative_module);
        args.push("-am".to_string());
    }

    if request.skip_tests {
        args.push("-DskipTests".to_string());
    }

    args.push("package".to_string());
    Ok(args)
}

fn create_java_args(request: &ServiceLaunchRequest, jar_path: &Path) -> Result<Vec<String>, String> {
    let mut args = shell_words::split(&request.jvm_args)
        .map_err(|error| format!("JVM 参数解析失败：{error}"))?;
    args.push("-jar".to_string());
    args.push(normalize_path_for_process(jar_path));
    args.extend(
        shell_words::split(&request.program_args)
            .map_err(|error| format!("程序参数解析失败：{error}"))?,
    );

    if let Some(port) = request.runtime_port {
        args.push(format!("--server.port={port}"));
    }

    let profiles = request.spring_profiles.trim();
    if !profiles.is_empty() {
        args.push(format!("--spring.profiles.active={profiles}"));
    }

    Ok(args)
}

fn normalize_path_for_process(path: &Path) -> String {
    let raw = path.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{stripped}");
        }

        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }

    raw
}

fn resolve_build_tool(root_path: &str) -> Result<BuildTool, String> {
    if let Some(wrapper) = resolve_maven_wrapper(root_path) {
        return Ok(BuildTool {
            kind: "mvnw".to_string(),
            command: wrapper,
        });
    }

    let daemon_status = detect_tool("mvnd", &["-v"])?;
    if daemon_status.available {
        return Ok(BuildTool {
            kind: "mvnd".to_string(),
            command: "mvnd".to_string(),
        });
    }

    let status = detect_tool("mvn", &["-v"])?;
    if status.available {
        return Ok(BuildTool {
            kind: "mvn".to_string(),
            command: "mvn".to_string(),
        });
    }

    Err("没有检测到可用的 Maven Wrapper 或 mvn。".to_string())
}

fn resolve_runnable_jar(module_path: &Path) -> Result<PathBuf, String> {
    let target = module_path.join("target");
    let entries = fs::read_dir(&target)
        .map_err(|error| format!("读取 target 目录失败 {}: {error}", target.display()))?;
    let mut candidates = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            if !name.ends_with(".jar")
                || name.starts_with("original-")
                || name.ends_with("-sources.jar")
                || name.ends_with("-javadoc.jar")
            {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| right.1.cmp(&left.1));
    candidates
        .into_iter()
        .map(|entry| entry.0)
        .next()
        .ok_or_else(|| "未在 target 目录找到可运行 jar。".to_string())
}

fn detect_tool(command: &str, args: &[&str]) -> Result<RuntimeToolStatus, String> {
    let output = Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            let merged = format!("{stdout}\n{stderr}");
            let version = merged
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(ToOwned::to_owned);
            Ok(RuntimeToolStatus {
                available: result.status.success(),
                command: command.to_string(),
                version,
            })
        }
        Err(_) => Ok(RuntimeToolStatus {
            available: false,
            command: command.to_string(),
            version: None,
        }),
    }
}

fn resolve_maven_wrapper(root_path: &str) -> Option<String> {
    let wrapper_name = if cfg!(windows) { "mvnw.cmd" } else { "mvnw" };
    let wrapper_path = Path::new(root_path).join(wrapper_name);
    wrapper_path.exists().then(|| wrapper_path.to_string_lossy().to_string())
}

fn stop_service_internal(
    services: &Arc<Mutex<HashMap<String, ManagedService>>>,
    service_id: &str,
) -> Result<(), String> {
    let pid = {
        let mut guard = services.lock().expect("service state lock poisoned");
        let service = guard
            .get_mut(service_id)
            .ok_or_else(|| format!("服务 {service_id} 不存在。"))?;
        service.stop_requested = true;
        service.instance.status = ServiceStatus::Stopped;
        service.instance.last_updated_at = now_iso();
        service.instance.pid
    };

    if let Some(pid) = pid {
        kill_process_tree(pid)?;
    }

    Ok(())
}

fn kill_process_tree(pid: u32) -> Result<(), String> {
    if cfg!(windows) {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| format!("终止进程失败：{error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("taskkill 退出码 {}", status.code().unwrap_or(-1)))
        }
    } else {
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|error| format!("终止进程失败：{error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err(format!("kill 退出码 {}", status.code().unwrap_or(-1)))
        }
    }
}

fn emit_status(app: &AppHandle, instance: &ServiceInstance) {
    let _ = app.emit("service-status", instance);
}

fn emit_log(app: &AppHandle, service_id: &str, source: &str, line: &str) {
    let _ = app.emit(
        "service-log",
        LogEvent {
            service_id: service_id.to_string(),
            source: source.to_string(),
            timestamp: now_iso(),
            line: line.to_string(),
        },
    );
}

fn current_instance(
    services: &Arc<Mutex<HashMap<String, ManagedService>>>,
    service_id: &str,
) -> Option<ServiceInstance> {
    services
        .lock()
        .expect("service state lock poisoned")
        .get(service_id)
        .map(|service| service.instance.clone())
}

fn update_instance<F>(
    services: &Arc<Mutex<HashMap<String, ManagedService>>>,
    service_id: &str,
    mutator: F,
) where
    F: FnOnce(&mut ManagedService),
{
    if let Some(service) = services
        .lock()
        .expect("service state lock poisoned")
        .get_mut(service_id)
    {
        mutator(service);
    }
}

fn spawn_log_reader<R>(app: AppHandle, service_id: String, source: &str, stream: R)
where
    R: std::io::Read + Send + 'static,
{
    let source = source.to_string();
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim_end();
            if trimmed.is_empty() {
                continue;
            }
            emit_log(&app, &service_id, &source, trimmed);
        }
    });
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

struct BuildTool {
    kind: String,
    command: String,
}

#[cfg(test)]
mod tests {
    use super::{create_build_args, create_java_args, normalize_path_for_process};
    use crate::models::ServiceLaunchRequest;
    use std::path::{Path, PathBuf};

    fn workspace_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .expect("workspace root")
            .to_path_buf()
    }

    fn request() -> ServiceLaunchRequest {
        let project_root = workspace_root().join("fixtures").join("sample-multi-module-app");
        let module_root = project_root.join("platform").join("service-app");

        ServiceLaunchRequest {
            root_path: project_root.to_string_lossy().to_string(),
            module_path: module_root.to_string_lossy().to_string(),
            artifact_id: "order-service".to_string(),
            main_class: "com.example.OrderApplication".to_string(),
            runtime_port: Some(18081),
            skip_tests: true,
            jvm_args: "-Xms256m -Xmx512m".to_string(),
            program_args: "--feature.alpha=true".to_string(),
            spring_profiles: "local,dev".to_string(),
        }
    }

    #[test]
    fn creates_expected_build_args() {
        let args = create_build_args(&request()).expect("build args");
        assert_eq!(
            args,
            vec![
                "-pl".to_string(),
                "platform/service-app".to_string(),
                "-am".to_string(),
                "-DskipTests".to_string(),
                "package".to_string()
            ]
        );
    }

    #[test]
    fn creates_expected_java_args() {
        let args = create_java_args(&request(), Path::new("D:/repo/service-app/target/order.jar"))
            .expect("java args");
        assert_eq!(args[0], "-Xms256m");
        assert_eq!(args[1], "-Xmx512m");
        assert!(args.contains(&"--feature.alpha=true".to_string()));
        assert!(args.contains(&"--server.port=18081".to_string()));
        assert!(args.contains(&"--spring.profiles.active=local,dev".to_string()));
    }

    #[test]
    fn strips_windows_verbatim_prefix_for_process_arguments() {
        let normalized = normalize_path_for_process(Path::new(r"\\?\D:\repo\service-app\target\order.jar"));
        assert_eq!(normalized, r"D:\repo\service-app\target\order.jar");
    }
}
