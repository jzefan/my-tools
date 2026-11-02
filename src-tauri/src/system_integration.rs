use crate::models::{IntegrationStatus, LaunchContext};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const WORKFLOW_NAME: &str = "DocTools - 合并与处理.workflow";

pub fn check_status() -> IntegrationStatus {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let service_path = home.join("Library/Services").join(WORKFLOW_NAME);
    let macos_service_installed = service_path.exists();

    let ghostscript_available = crate::pdf_compress::check_ghostscript_available();

    let soffice_available = Command::new("soffice")
        .arg("--version")
        .output()
        .is_ok()
        || Path::new("/opt/homebrew/bin/soffice").exists()
        || Path::new("/Applications/LibreOffice.app").exists();

    let textutil_available = Path::new("/usr/bin/textutil").exists();

    IntegrationStatus {
        macos_service_installed,
        ghostscript_available,
        libreoffice_available: soffice_available,
        textutil_available,
    }
}

pub fn install_macos_service() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
        let services_dir = home.join("Library/Services");
        fs::create_dir_all(&services_dir).map_err(|e| format!("无法创建 Services 目录: {}", e))?;

        let wf_dir = services_dir.join(WORKFLOW_NAME);
        let contents_dir = wf_dir.join("Contents");
        fs::create_dir_all(&contents_dir).map_err(|e| format!("无法创建 Workflow 目录: {}", e))?;

        let doc_wflow_path = contents_dir.join("document.wflow");
        let wflow_content = generate_wflow_xml();
        fs::write(&doc_wflow_path, wflow_content)
            .map_err(|e| format!("写入 document.wflow 失败: {}", e))?;

        // Refresh macOS Services cache
        let _ = Command::new("/System/Library/CoreServices/pbs")
            .arg("-update")
            .output();

        Ok(format!(
            "访达 (Finder) 右键快捷操作安装成功！\n您现在可以在访达中右键点击任意 PDF、图片或 Word 文档，在「快捷操作 / 服务」中选择「DocTools: 合并与处理」",
        ))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("访达服务仅支持 macOS 系统".to_string())
    }
}

pub fn uninstall_macos_service() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
        let wf_dir = home.join("Library/Services").join(WORKFLOW_NAME);
        if wf_dir.exists() {
            fs::remove_dir_all(&wf_dir).map_err(|e| format!("删除服务失败: {}", e))?;
            let _ = Command::new("/System/Library/CoreServices/pbs")
                .arg("-update")
                .output();
            Ok("已成功卸载访达右键服务".to_string())
        } else {
            Ok("未发现已安装的访达右键服务".to_string())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("仅支持 macOS 系统".to_string())
    }
}

pub fn generate_windows_reg(exe_path_opt: Option<&str>) -> String {
    let exe_path = exe_path_opt.unwrap_or("C:\\\\Program Files\\\\DocTools\\\\DocTools.exe");
    format!(
        r#"Windows Registry Editor Version 5.00

; ========================================================
; DocTools Windows 右键菜单注册表文件
; 支持所有文件以及文件夹右键唤起 DocTools
; ========================================================

[HKEY_CURRENT_USER\Software\Classes\*\shell\DocToolsMerge]
@="使用 DocTools 合并/处理"
"Icon"="\"{exe}\""

[HKEY_CURRENT_USER\Software\Classes\*\shell\DocToolsMerge\command]
@="\"{exe}\" \"%1\""

[HKEY_CURRENT_USER\Software\Classes\Directory\shell\DocToolsMerge]
@="在此文件夹打开 DocTools"
"Icon"="\"{exe}\""

[HKEY_CURRENT_USER\Software\Classes\Directory\shell\DocToolsMerge\command]
@="\"{exe}\" \"%1\""
"#,
        exe = exe_path
    )
}

pub fn check_pending_action() -> Option<LaunchContext> {
    let home = dirs::home_dir()?;
    let pending_file = home.join(".doctools").join("pending_action.json");

    if pending_file.exists() {
        if let Ok(content) = fs::read_to_string(&pending_file) {
            let _ = fs::remove_file(&pending_file);
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                let action = val.get("action").and_then(|a| a.as_str()).unwrap_or("merge").to_string();
                let paths: Vec<String> = val
                    .get("paths")
                    .and_then(|p| p.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();

                let initial_dir = if let Some(first) = paths.first() {
                    Path::new(first)
                        .parent()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(crate::fs_service::get_default_start_dir)
                } else {
                    crate::fs_service::get_default_start_dir()
                };

                return Some(LaunchContext {
                    initial_paths: paths,
                    initial_directory: initial_dir,
                    initial_action: action,
                });
            }
        }
    }
    None
}

fn generate_wflow_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>534</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>mkdir -p "$HOME/.doctools"
python3 -c "import sys, json, os; json.dump({'action': 'merge', 'paths': sys.argv[1:]}, open(os.path.expanduser('~/.doctools/pending_action.json'), 'w'))" "$@"

if pgrep -x "DocTools" &gt;/dev/null || pgrep -x "doc-tools" &gt;/dev/null; then
    osascript -e 'tell application "DocTools" to activate' 2&gt;/dev/null || true
else
    open -a "DocTools" 2&gt;/dev/null || open "$HOME/Applications/DocTools.app" 2&gt;/dev/null || true
fi
</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>56D40683-1628-4062-8F55-1E4D611E26AE</string>
				<key>UUID</key>
				<string>81729B9C-A2C3-4318-8A95-E58133580436</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>value</key>
						<integer>1</integer>
					</dict>
					<key>1</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>source</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
					</dict>
					<key>2</key>
					<dict>
						<key>default value</key>
						<false/>
						<key>name</key>
						<string>CheckedForUserDefaultShell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>value</key>
						<true/>
					</dict>
					<key>3</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>COMMAND_STRING</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
					</dict>
					<key>4</key>
					<dict>
						<key>default value</key>
						<string>/bin/sh</string>
						<key>name</key>
						<string>shell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>value</key>
						<string>/bin/zsh</string>
					</dict>
				</dict>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key>
		<dict/>
		<key>applicationPaths</key>
		<array/>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>"#.to_string()
}
