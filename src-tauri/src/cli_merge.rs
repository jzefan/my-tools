use std::path::Path;
use std::process::Command;

pub fn run_cli_merge(file_paths: &[String], output_opt: Option<String>) -> Result<String, String> {
    if file_paths.is_empty() {
        return Err("未指定要合并的文件".to_string());
    }

    let first_path = Path::new(&file_paths[0]);
    let parent_dir = first_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = first_path.file_stem().and_then(|s| s.to_str()).unwrap_or("document");

    let output_path = output_opt.unwrap_or_else(|| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        parent_dir
            .join(format!("{}_合并_{}.pdf", stem, now))
            .to_string_lossy()
            .to_string()
    });

    let items: Vec<crate::models::MergeItem> = file_paths
        .iter()
        .map(|p| {
            let path = Path::new(p);
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            crate::models::MergeItem {
                path: p.clone(),
                name,
                extension,
                page_count: None,
                page_range: Some("all".to_string()),
            }
        })
        .collect();

    let req = crate::models::MergeRequest {
        items,
        output_path: output_path.clone(),
    };

    crate::pdf_merge::merge_documents(req)?;

    #[cfg(target_os = "macos")]
    {
        // Display native macOS user notification
        let script = format!(
            "display notification \"已成功合并 {} 个文档并生成文件\" with title \"DocTools 合并完成\"",
            file_paths.len()
        );
        let _ = Command::new("osascript").args(["-e", &script]).output();

        // Reveal the newly created file in Finder
        let _ = Command::new("open").args(["-R", &output_path]).output();
    }

    Ok(output_path)
}
