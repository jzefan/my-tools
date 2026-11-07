pub mod cli_merge;
pub mod disk_cleaner;
pub mod disk_usage;
pub mod macos_privacy;
pub mod media_publisher;
pub mod fs_service;
pub mod models;
pub mod netdisk_service;
pub mod paper_service;
pub mod pdf_compress;
pub mod pdf_convert;
pub mod pdf_merge;
pub mod pdf_watermark;
pub mod preview_service;
pub mod system_integration;
pub mod typing_store;

use models::{
    CompressRequest, CompressResult, ConvertEngineStatus, ConvertRequest, ConvertResult,
    DirContent, DocumentPreviewData, FileItem, InsertPagesRequest, IntegrationStatus,
    LaunchContext, MergeRequest, OperationResult, PdfToImageRequest, QuickPath, WatermarkAnalysis,
    WatermarkRemoveRequest,
};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Emitter, Manager, State};

pub struct AppState {
    pub initial_context: Mutex<Option<LaunchContext>>,
}

// Tauri synchronous commands run in the invoke handler. Keep filesystem,
// subprocess and PDF work on the blocking pool instead of the UI thread.
async fn blocking_task<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("后台任务失败: {}", e))?
}

static CLEANER_OPERATION: Mutex<()> = Mutex::new(());
static USAGE_GENERATION: AtomicU64 = AtomicU64::new(0);
static OFFICE_OPERATION: Mutex<()> = Mutex::new(());
static PAPER_LIBRARY_OPERATION: Mutex<()> = Mutex::new(());

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
async fn get_directory_contents(
    path: String,
    show_hidden: Option<bool>,
) -> Result<DirContent, String> {
    blocking_task(move || fs_service::read_dir_content(&path, show_hidden.unwrap_or(false))).await
}

#[tauri::command]
async fn get_quick_directories() -> Result<Vec<QuickPath>, String> {
    blocking_task(move || Ok(fs_service::get_quick_paths())).await
}

#[tauri::command]
async fn get_file_info(path: String) -> Result<FileItem, String> {
    blocking_task(move || fs_service::get_file_metadata(&path)).await
}

#[tauri::command]
async fn merge_files(request: MergeRequest) -> Result<OperationResult, String> {
    blocking_task(move || {
        let _guard = OFFICE_OPERATION
            .lock()
            .map_err(|_| "转换任务锁不可用".to_string())?;

        pdf_merge::merge_documents(request)
    })
    .await
}

#[tauri::command]
async fn insert_pages_into_pdf(request: InsertPagesRequest) -> Result<OperationResult, String> {
    blocking_task(move || {
        let _guard = OFFICE_OPERATION
            .lock()
            .map_err(|_| "转换任务锁不可用".to_string())?;

        pdf_merge::insert_pages_into_pdf(request)
    })
    .await
}

#[tauri::command]
async fn convert_pdf_to_images(request: PdfToImageRequest) -> Result<OperationResult, String> {
    blocking_task(move || pdf_convert::convert_pdf_to_images(request)).await
}

#[tauri::command]
async fn compress_pdf_file(request: CompressRequest) -> Result<CompressResult, String> {
    blocking_task(move || pdf_compress::compress_pdf(request)).await
}

#[tauri::command]
async fn analyze_watermarks(path: String) -> Result<WatermarkAnalysis, String> {
    blocking_task(move || pdf_watermark::analyze_pdf_watermarks(&path)).await
}

#[tauri::command]
async fn remove_watermarks_from_pdf(
    request: WatermarkRemoveRequest,
) -> Result<OperationResult, String> {
    blocking_task(move || pdf_watermark::remove_pdf_watermarks(request)).await
}

#[tauri::command]
async fn convert_documents(request: ConvertRequest) -> Result<ConvertResult, String> {
    blocking_task(move || {
        let _guard = OFFICE_OPERATION
            .lock()
            .map_err(|_| "转换任务锁不可用".to_string())?;

        pdf_convert::convert_documents(request)
    })
    .await
}

#[tauri::command]
async fn get_convert_engine_status() -> Result<ConvertEngineStatus, String> {
    blocking_task(move || Ok(pdf_convert::check_convert_engines())).await
}

#[tauri::command]
async fn pick_file_dialog(
    app: tauri::AppHandle,
    prompt: Option<String>,
    for_folder: Option<bool>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking_task(move || {
        let is_folder = for_folder.unwrap_or(false);
        let mut dialog = app.dialog().file().set_title(prompt.unwrap_or_else(|| {
            if is_folder { "请选择文件夹".into() } else { "请选择文件".into() }
        }));
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        let selected = if is_folder {
            dialog.blocking_pick_folder()
        } else {
            dialog.add_filter("文档", &["pdf", "docx", "doc", "png", "jpg", "jpeg", "webp", "bmp", "tiff"])
                .blocking_pick_file()
        };
        selected.map(|file| file.into_path().map(|path| path.to_string_lossy().into_owned())
            .map_err(|e| format!("无法读取所选路径: {}", e))).transpose()
    }).await
}

#[tauri::command]
fn open_file_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_integration_status() -> Result<IntegrationStatus, String> {
    blocking_task(move || Ok(system_integration::check_status())).await
}

#[tauri::command]
async fn install_finder_service() -> Result<String, String> {
    blocking_task(move || system_integration::install_macos_service()).await
}

#[tauri::command]
async fn uninstall_finder_service() -> Result<String, String> {
    blocking_task(move || system_integration::uninstall_macos_service()).await
}

#[tauri::command]
fn get_windows_reg_content() -> Result<String, String> {
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
async fn reveal_in_finder(path: String) -> Result<(), String> {
    blocking_task(move || tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())).await
}

#[tauri::command]
async fn get_document_preview(path: String) -> Result<DocumentPreviewData, String> {
    blocking_task(move || {
        let _guard = OFFICE_OPERATION
            .lock()
            .map_err(|_| "转换任务锁不可用".to_string())?;

        preview_service::get_document_preview(&path)
    })
    .await
}

#[tauri::command]
async fn quick_look_file(path: String) -> Result<(), String> {
    blocking_task(move || preview_service::quick_look_file(&path)).await
}

#[tauri::command]
async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    blocking_task(move || {
        let _office_guard = OFFICE_OPERATION.lock().map_err(|_| "转换任务锁不可用".to_string())?;
        paper_service::read_binary_file(&path)
    }).await
}

#[tauri::command]
async fn read_paper_file(path: String, sha256: String) -> Result<Vec<u8>, String> {
    blocking_task(move || {
        let _guard = OFFICE_OPERATION.lock().map_err(|_| "转换任务锁不可用".to_string())?;
        paper_service::read_paper_file(&path, &sha256)
    }).await
}

#[tauri::command]
async fn save_paper_ai_key(provider: String, key: String) -> Result<(), String> {
    blocking_task(move || paper_service::save_ai_key(&provider, &key)).await
}

#[tauri::command]
async fn load_paper_ai_key(provider: String) -> Result<String, String> {
    blocking_task(move || paper_service::load_ai_key(&provider)).await
}

#[tauri::command]
async fn paper_data_directory() -> Result<String, String> {
    paper_service::paper_data_directory()
}

#[tauri::command]
async fn import_paper_file(path: String) -> Result<paper_service::ImportedPaper, String> {
    blocking_task(move || {
        let _guard = PAPER_LIBRARY_OPERATION.lock().map_err(|_| "资料库任务锁不可用".to_string())?;
        paper_service::import_paper_file(&path)
    }).await
}

#[tauri::command]
async fn choose_paper_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking_task(move || {
        let selected = app.dialog().file().set_title("导入论文")
            .add_filter("论文", &["pdf", "docx", "doc"]).blocking_pick_files().unwrap_or_default();
        selected.into_iter().map(|file| file.into_path().map(|path| path.to_string_lossy().into_owned())
            .map_err(|e| e.to_string())).collect()
    }).await
}

#[tauri::command]
async fn export_paper_markdown(app: tauri::AppHandle, name: String, content: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking_task(move || {
        let chosen = app.dialog().file().set_title("导出 Markdown").set_file_name(name)
            .add_filter("Markdown", &["md"]).blocking_save_file();
        let Some(chosen) = chosen else { return Ok(None); };
        let path = chosen.into_path().map_err(|e| e.to_string())?;
        paper_service::save_markdown_file(&path.to_string_lossy(), &content)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await
}

#[tauri::command]
async fn save_paper_library(data: String) -> Result<(), String> {
    blocking_task(move || {
        let _guard = PAPER_LIBRARY_OPERATION
            .lock()
            .map_err(|_| "资料库任务锁不可用".to_string())?;
        paper_service::save_paper_library_data(&data)
    })
    .await
}

#[tauri::command]
async fn load_paper_library() -> Result<String, String> {
    blocking_task(move || {
        let _guard = PAPER_LIBRARY_OPERATION
            .lock()
            .map_err(|_| "资料库任务锁不可用".to_string())?;
        paper_service::load_paper_library_data()
    })
    .await
}

#[tauri::command]
async fn export_edited_pdf_pages(
    request: paper_service::ReorderPagesRequest,
) -> Result<OperationResult, String> {
    blocking_task(move || {
        let _guard = OFFICE_OPERATION
            .lock()
            .map_err(|_| "转换任务锁不可用".to_string())?;

        paper_service::export_edited_pdf_pages(request)
    })
    .await
}

#[tauri::command]
async fn save_markdown_file(path: String, content: String) -> Result<OperationResult, String> {
    blocking_task(move || paper_service::save_markdown_file(&path, &content)).await
}

#[tauri::command]
async fn scan_disk_clean_items() -> Result<disk_cleaner::DiskCleanScanResult, String> {
    blocking_task(move || {
        let _guard = CLEANER_OPERATION
            .lock()
            .map_err(|_| "清理任务锁不可用".to_string())?;
        // Do not delete conversion caches while an Office subprocess is using them.
        let _office_guard = OFFICE_OPERATION.lock().map_err(|_| "转换任务锁不可用".to_string())?;

        Ok(disk_cleaner::scan_disk_clean_items())
    })
    .await
}

#[tauri::command]
async fn execute_disk_clean(
    request: disk_cleaner::CleanExecutionRequest,
) -> Result<disk_cleaner::CleanExecutionResult, String> {
    blocking_task(move || {
        let _guard = CLEANER_OPERATION
            .lock()
            .map_err(|_| "清理任务锁不可用".to_string())?;
        // Do not delete conversion caches while an Office subprocess is using them.
        let _office_guard = OFFICE_OPERATION.lock().map_err(|_| "转换任务锁不可用".to_string())?;

        Ok(disk_cleaner::execute_clean(request))
    })
    .await
}

#[tauri::command]
async fn execute_disk_clean_path(
    path: String,
) -> Result<disk_cleaner::CleanExecutionResult, String> {
    blocking_task(move || {
        let _guard = CLEANER_OPERATION
            .lock()
            .map_err(|_| "清理任务锁不可用".to_string())?;
        // Do not delete conversion caches while an Office subprocess is using them.
        let _office_guard = OFFICE_OPERATION.lock().map_err(|_| "转换任务锁不可用".to_string())?;

        Ok(disk_cleaner::execute_clean_single_path(&path))
    })
    .await
}

#[tauri::command]
async fn delete_disk_usage_path(path: String) -> Result<disk_usage::UsageDeleteResult, String> {
    blocking_task(move || Ok(disk_usage::delete_home_directory(&path))).await
}

#[tauri::command]
async fn scan_disk_usage(
    app: tauri::AppHandle,
    path: String,
) -> Result<disk_usage::DiskUsageScan, String> {
    let generation = USAGE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    blocking_task(move || {
        disk_usage::scan_disk_usage(
            &path,
            &|progress| {
                let _ = app.emit("disk-usage-progress", &progress);
            },
            &|| USAGE_GENERATION.load(Ordering::SeqCst) != generation,
        )
    })
    .await
}

#[tauri::command]
async fn open_disk_clean_settings() -> Result<(), String> {
    blocking_task(move || disk_cleaner::open_full_disk_access_settings()).await
}

#[tauri::command]
fn full_disk_access_enabled() -> bool {
    macos_privacy::full_disk_access_granted()
}

pub fn prepare_privacy_identity() {
    macos_privacy::prepare_privacy_identity();
}

pub fn run() {
    // Check if headless CLI merge requested
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "cli-merge" {
        let mut paths = Vec::new();
        let mut output = None;
        let mut i = 2;
        while i < args.len() {
            if args[i] == "-o" && i + 1 < args.len() {
                output = Some(args[i + 1].clone());
                i += 2;
            } else {
                paths.push(args[i].clone());
                i += 1;
            }
        }
        match cli_merge::run_cli_merge(&paths, output) {
            Ok(out) => {
                println!("SUCCESS: {}", out);
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("ERROR: {}", e);
                std::process::exit(1);
            }
        }
    }

    // Parse launch arguments
    let mut initial_paths = Vec::new();
    let mut initial_action = "merge".to_string();

    if args.len() > 1 {
        for arg in &args[1..] {
            if arg == "merge" || arg == "compress" || arg == "watermark" || arg == "convert" {
                initial_action = arg.clone();
            } else if !arg.starts_with('-') && Path::new(arg).exists() {
                initial_paths.push(arg.clone());
            }
        }
    }

    let initial_context = if !initial_paths.is_empty() {
        #[cfg(target_os = "macos")]
        if initial_action == "merge" {
            let menu_binary = Path::new("/Applications/DocTools.app/Contents/MacOS/doc-tools-menu");
            if menu_binary.exists() {
                let status = Command::new(menu_binary).args(&initial_paths).status();
                if let Ok(s) = status {
                    if s.success() {
                        std::process::exit(0);
                    }
                }
            }
        }

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
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }
            Ok(())
        })
        .manage(AppState {
            initial_context: Mutex::new(initial_context),
        })
        .plugin(tauri_plugin_opener::init())
        .manage(netdisk_service::NetdiskRequests::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            netdisk_service::search_netdisk_source,
            netdisk_service::cancel_netdisk_search,
            get_launch_context,
            poll_pending_action,
            get_directory_contents,
            get_quick_directories,
            get_file_info,
            merge_files,
            insert_pages_into_pdf,
            compress_pdf_file,
            analyze_watermarks,
            remove_watermarks_from_pdf,
            convert_documents,
            convert_pdf_to_images,
            get_convert_engine_status,
            pick_file_dialog,
            open_file_path,
            get_integration_status,
            install_finder_service,
            uninstall_finder_service,
            get_windows_reg_content,
            reveal_in_finder,
            set_window_mode,
            get_document_preview,
            quick_look_file,
            read_binary_file,
            import_paper_file,
            read_paper_file,
            save_paper_ai_key,
            load_paper_ai_key,
            paper_data_directory,
            choose_paper_files,
            export_paper_markdown,
            save_paper_library,
            load_paper_library,
            export_edited_pdf_pages,
            save_markdown_file,
            scan_disk_clean_items,
            scan_disk_usage,
            delete_disk_usage_path,
            execute_disk_clean,
            execute_disk_clean_path,
            open_disk_clean_settings,
            full_disk_access_enabled,
            typing_store::typing_load_database,
            typing_store::typing_save_database,
            media_publisher::media_get_accounts,
            media_publisher::media_save_account,
            media_publisher::media_delete_account,
            media_publisher::media_check_account_status,
            media_publisher::media_batch_check_accounts,
            media_publisher::media_get_tasks,
            media_publisher::media_create_publish_task,
            media_publisher::media_cancel_task,
            media_publisher::media_retry_task,
            media_publisher::media_clear_completed_tasks,
            media_publisher::media_get_canned_replies,
            media_publisher::media_save_canned_reply,
            media_publisher::media_delete_canned_reply,
            media_publisher::media_get_keyword_rules,
            media_publisher::media_save_keyword_rule,
            media_publisher::media_delete_keyword_rule,
            media_publisher::media_inspect_video,
            media_publisher::media_ai_polish_copy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
