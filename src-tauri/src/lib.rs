pub mod fs_service;
pub mod models;
pub mod pdf_compress;
pub mod pdf_merge;
pub mod pdf_watermark;
pub mod system_integration;

use models::{
    CompressRequest, CompressResult, DirContent, FileItem, IntegrationStatus, LaunchContext,
    MergeRequest, OperationResult, QuickPath, WatermarkAnalysis, WatermarkRemoveRequest,
};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub initial_context: Mutex<Option<LaunchContext>>,
}

#[tauri::command]
fn get_launch_context(state: State<AppState>) -> LaunchContext {
    // 1. Check if we had launch args
    if let Ok(mut lock) = state.initial_context.lock() {
        if let Some(ctx) = lock.take() {
            return ctx;
        }
    }

    // 2. Check pending action file (from Finder Quick Action)
    if let Some(ctx) = system_integration::check_pending_action() {
        return ctx;
    }

    // 3. Default context
    let default_dir = fs_service::get_default_start_dir();
    LaunchContext {
        initial_paths: Vec::new(),
        initial_directory: default_dir,
        initial_action: "merge".to_string(),
    }
}

#[tauri::command]
fn poll_pending_action() -> Option<LaunchContext> {
    system_integration::check_pending_action()
}

#[tauri::command]
fn get_directory_contents(path: String, show_hidden: Option<bool>) -> Result<DirContent, String> {
    fs_service::read_dir_content(&path, show_hidden.unwrap_or(false))
}

#[tauri::command]
fn get_quick_directories() -> Vec<QuickPath> {
    fs_service::get_quick_paths()
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileItem, String> {
    fs_service::get_file_metadata(&path)
}

#[tauri::command]
fn merge_files(request: MergeRequest) -> Result<OperationResult, String> {
    pdf_merge::merge_documents(request)
}

#[tauri::command]
fn compress_pdf_file(request: CompressRequest) -> Result<CompressResult, String> {
    pdf_compress::compress_pdf(request)
}

#[tauri::command]
fn analyze_watermarks(path: String) -> Result<WatermarkAnalysis, String> {
    pdf_watermark::analyze_pdf_watermarks(&path)
}

#[tauri::command]
fn remove_watermarks_from_pdf(request: WatermarkRemoveRequest) -> Result<OperationResult, String> {
    pdf_watermark::remove_pdf_watermarks(request)
}

#[tauri::command]
fn get_integration_status() -> IntegrationStatus {
    system_integration::check_status()
}

#[tauri::command]
fn install_finder_service() -> Result<String, String> {
    system_integration::install_macos_service()
}

#[tauri::command]
fn uninstall_finder_service() -> Result<String, String> {
    system_integration::uninstall_macos_service()
}

#[tauri::command]
fn get_windows_reg_content() -> String {
    system_integration::generate_windows_reg(None)
}

#[tauri::command]
fn set_window_mode(window: tauri::Window, mode: String) -> Result<(), String> {
    if mode == "compact" {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 860.0,
            height: 560.0,
        }));
        let _ = window.center();
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 1180.0,
            height: 780.0,
        }));
        let _ = window.center();
        let _ = window.set_always_on_top(false);
    }
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(())
    }
}

pub fn run() {
    // Parse launch arguments
    let args: Vec<String> = std::env::args().collect();
    let mut initial_paths = Vec::new();
    let mut initial_action = "merge".to_string();

    if args.len() > 1 {
        for arg in &args[1..] {
            if arg == "merge" || arg == "compress" || arg == "watermark" {
                initial_action = arg.clone();
            } else if !arg.starts_with('-') && Path::new(arg).exists() {
                initial_paths.push(arg.clone());
            }
        }
    }

    let initial_context = if !initial_paths.is_empty() {
        let first_path = Path::new(&initial_paths[0]);
        let dir = if first_path.is_dir() {
            first_path.to_string_lossy().to_string()
        } else {
            first_path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(fs_service::get_default_start_dir)
        };

        Some(LaunchContext {
            initial_paths,
            initial_directory: dir,
            initial_action,
        })
    } else {
        None
    };

    tauri::Builder::default()
        .manage(AppState {
            initial_context: Mutex::new(initial_context),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_launch_context,
            poll_pending_action,
            get_directory_contents,
            get_quick_directories,
            get_file_info,
            merge_files,
            compress_pdf_file,
            analyze_watermarks,
            remove_watermarks_from_pdf,
            get_integration_status,
            install_finder_service,
            uninstall_finder_service,
            get_windows_reg_content,
            reveal_in_finder,
            set_window_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
