use std::{
    fs,
    path::{Path, PathBuf},
};

use regex::Regex;
use roxmltree::Document;
use walkdir::WalkDir;

use crate::models::{ProjectScanResult, ServiceCandidate};

#[derive(Clone)]
struct PomProject {
    artifact_id: String,
    modules: Vec<String>,
}

pub fn scan_project(root_path: &str) -> Result<ProjectScanResult, String> {
    let root = PathBuf::from(root_path);
    let root = root
        .canonicalize()
        .map_err(|error| format!("无法访问项目目录：{error}"))?;
    let root_pom = root.join("pom.xml");

    if !root_pom.exists() {
        return Err("所选目录中没有找到 pom.xml。".to_string());
    }

    let root_project = read_pom(&root_pom, &root)?;
    let mut module_paths = Vec::new();
    collect_modules(&root, &mut module_paths)?;

    let mut services = Vec::new();
    for module_path in &module_paths {
        services.extend(scan_module(module_path)?);
    }

    services.sort_by(|left, right| left.artifact_id.cmp(&right.artifact_id));

    Ok(ProjectScanResult {
        root_path: root.to_string_lossy().to_string(),
        artifact_id: root_project.artifact_id,
        module_count: module_paths.len(),
        services,
    })
}

fn collect_modules(module_path: &Path, modules: &mut Vec<PathBuf>) -> Result<(), String> {
    let normalized = module_path
        .canonicalize()
        .map_err(|error| format!("无法解析模块路径 {}: {error}", module_path.display()))?;

    if modules.contains(&normalized) {
        return Ok(());
    }

    modules.push(normalized.clone());

    let pom = read_pom(&normalized.join("pom.xml"), &normalized)?;
    for child in pom.modules {
        collect_modules(&normalized.join(child), modules)?;
    }

    Ok(())
}

fn scan_module(module_path: &Path) -> Result<Vec<ServiceCandidate>, String> {
    let pom = read_pom(&module_path.join("pom.xml"), module_path)?;
    let java_root = module_path.join("src").join("main").join("java");
    let default_port = resolve_default_port(module_path)?;
    let mut services = Vec::new();

    if !java_root.exists() {
        return Ok(services);
    }

    let annotation_pattern = Regex::new(r"@SpringBootApplication\b").map_err(|error| error.to_string())?;
    let main_pattern = Regex::new(r"public\s+static\s+void\s+main\s*\(").map_err(|error| error.to_string())?;
    let run_pattern = Regex::new(r"SpringApplication\.run\s*\(").map_err(|error| error.to_string())?;
    let package_pattern = Regex::new(r"package\s+([\w.]+)\s*;").map_err(|error| error.to_string())?;
    let class_pattern = Regex::new(r"public\s+class\s+(\w+)").map_err(|error| error.to_string())?;

    for entry in WalkDir::new(&java_root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("java"))
    {
        let source = fs::read_to_string(entry.path())
            .map_err(|error| format!("读取源码失败 {}: {error}", entry.path().display()))?;

        if !annotation_pattern.is_match(&source)
            || !main_pattern.is_match(&source)
            || !run_pattern.is_match(&source)
        {
            continue;
        }

        let class_name = class_pattern
            .captures(&source)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().to_string())
            .unwrap_or_else(|| {
                entry
                    .path()
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or("Application")
                    .to_string()
            });

        let package_name = package_pattern
            .captures(&source)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().to_string())
            .unwrap_or_default();

        let main_class = if package_name.is_empty() {
            class_name
        } else {
            format!("{package_name}.{class_name}")
        };

        services.push(ServiceCandidate {
            service_id: format!("{}:{main_class}", pom.artifact_id),
            artifact_id: pom.artifact_id.clone(),
            main_class,
            module_path: module_path.to_string_lossy().to_string(),
            java_file_path: entry.path().to_string_lossy().to_string(),
            default_port,
        });
    }

    Ok(services)
}

fn read_pom(pom_path: &Path, module_path: &Path) -> Result<PomProject, String> {
    let xml = fs::read_to_string(pom_path)
        .map_err(|error| format!("读取 pom.xml 失败 {}: {error}", pom_path.display()))?;
    let document = Document::parse(&xml)
        .map_err(|error| format!("解析 pom.xml 失败 {}: {error}", pom_path.display()))?;
    let project = document.root_element();

    let artifact_id = direct_child_text(project, "artifactId")
        .or_else(|| {
            project
                .children()
                .find(|node| node.is_element() && node.tag_name().name() == "parent")
                .and_then(|parent| direct_child_text(parent, "artifactId"))
        })
        .unwrap_or_else(|| {
            module_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown-module")
                .to_string()
        });

    let modules = project
        .children()
        .find(|node| node.is_element() && node.tag_name().name() == "modules")
        .map(|modules_node| {
            modules_node
                .children()
                .filter(|node| node.is_element() && node.tag_name().name() == "module")
                .filter_map(|node| node.text())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(PomProject { artifact_id, modules })
}

fn direct_child_text(node: roxmltree::Node<'_, '_>, tag_name: &str) -> Option<String> {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == tag_name)
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn resolve_default_port(module_path: &Path) -> Result<Option<u16>, String> {
    let resources = module_path.join("src").join("main").join("resources");
    let candidates = [
        resources.join("application.properties"),
        resources.join("application.yml"),
        resources.join("application.yaml"),
    ];

    for file_path in candidates {
        if !file_path.exists() {
            continue;
        }

        let content = fs::read_to_string(&file_path)
            .map_err(|error| format!("读取配置失败 {}: {error}", file_path.display()))?;

        let port = if file_path.extension().and_then(|ext| ext.to_str()) == Some("properties") {
            Regex::new(r"(?m)^\s*server\.port\s*=\s*(\d+)\s*$")
                .ok()
                .and_then(|pattern| pattern.captures(&content))
                .and_then(|captures| captures.get(1))
        } else {
            Regex::new(r"(?m)^\s*server\.port\s*:\s*(\d+)\s*$")
                .ok()
                .and_then(|pattern| pattern.captures(&content))
                .and_then(|captures| captures.get(1))
                .or_else(|| {
                    Regex::new(r"(?ms)^\s*server\s*:\s*.*?^\s+port\s*:\s*(\d+)\s*$")
                        .ok()
                        .and_then(|pattern| pattern.captures(&content))
                        .and_then(|captures| captures.get(1))
                })
        };

        if let Some(port) = port.and_then(|value| value.as_str().parse::<u16>().ok()) {
            return Ok(Some(port));
        }
    }

    Ok(Some(8080))
}

#[cfg(test)]
mod tests {
    use super::scan_project;
    use std::path::PathBuf;

    fn workspace_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .expect("workspace root")
            .to_path_buf()
    }

    #[test]
    fn scans_single_module_fixture() {
        let project = workspace_root().join("fixtures").join("sample-maven-app");
        let result = scan_project(&project.to_string_lossy()).expect("scan result");

        assert_eq!(result.services.len(), 1);
        assert_eq!(result.services[0].artifact_id, "sample-maven-app");
        assert_eq!(result.services[0].default_port, Some(18080));
    }

    #[test]
    fn scans_multi_module_fixture() {
        let project = workspace_root()
            .join("fixtures")
            .join("sample-multi-module-app");
        let result = scan_project(&project.to_string_lossy()).expect("scan result");

        assert_eq!(result.module_count, 4);
        assert_eq!(result.services.len(), 1);
        assert_eq!(result.services[0].artifact_id, "service-app");
    }
}
