use crate::models::{IntegrationStatus, LaunchContext};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const WORKFLOW_NAME: &str = "合并 PDF 与文档.workflow";

pub fn check_status() -> IntegrationStatus {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let service_path = home.join("Library/Services").join(WORKFLOW_NAME);
    let macos_service_installed = cfg!(target_os = "macos") && service_path.exists();

    let ghostscript_available = crate::pdf_compress::check_ghostscript_available();

    let soffice_available = crate::pdf_convert::get_soffice_cmd().is_some();

    let textutil_available = cfg!(target_os = "macos") && Path::new("/usr/bin/textutil").exists();

    IntegrationStatus {
        platform: std::env::consts::OS.to_string(),
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

        // 1. Primary Quick Action: "合并 PDF 与文档.workflow"
        let wf_dir = services_dir.join(WORKFLOW_NAME);
        let contents_dir = wf_dir.join("Contents");
        fs::create_dir_all(&contents_dir).map_err(|e| format!("无法创建 Workflow 目录: {}", e))?;

        let doc_wflow_path = contents_dir.join("document.wflow");
        let wflow_content = generate_wflow_xml();
        fs::write(&doc_wflow_path, &wflow_content)
            .map_err(|e| format!("写入 document.wflow 失败: {}", e))?;

        let info_plist_path = contents_dir.join("Info.plist");
        let info_plist_content =
            generate_info_plist_named("合并 PDF 与文档", "com.doctools.service.quickmerge");
        fs::write(&info_plist_path, &info_plist_content)
            .map_err(|e| format!("写入 Info.plist 失败: {}", e))?;

        // 2. Also keep alias/backup: "合并 PDF 与文档 (DocTools).workflow"
        let wf2_dir = services_dir.join("合并 PDF 与文档 (DocTools).workflow");
        let contents2_dir = wf2_dir.join("Contents");
        let _ = fs::create_dir_all(&contents2_dir);
        let _ = fs::write(contents2_dir.join("document.wflow"), &wflow_content);
        let _ = fs::write(
            contents2_dir.join("Info.plist"),
            generate_info_plist_named(
                "合并 PDF 与文档 (DocTools)",
                "com.doctools.service.quickmerge.legacy",
            ),
        );

        // Read bundles into pbs
        let pbs_bin = "/System/Library/CoreServices/pbs";
        let _ = Command::new(pbs_bin)
            .args(["-read_bundle", &wf_dir.to_string_lossy()])
            .output();
        let _ = Command::new(pbs_bin)
            .args(["-read_bundle", &wf2_dir.to_string_lossy()])
            .output();

        // Enable in pbs plist programmatically so NO manual checkbox in "自定..." is needed
        enable_services_in_pbs_plist();

        // Refresh macOS Services cache and flush
        let _ = Command::new(pbs_bin).arg("-flush").output();
        let _ = Command::new(pbs_bin).arg("-update").output();

        // Register and enable FinderSync Extension for seamless hover cascade menu
        let appex_path = "/Applications/DocTools.app/Contents/PlugIns/DocToolsFinderSync.appex";
        if Path::new(appex_path).exists() {
            let _ = Command::new("pluginkit").args(["-a", appex_path]).output();
            let _ = Command::new("pluginkit")
                .args(["-e", "use", "-i", "com.doctools.desktop.FinderSync"])
                .output();
        }

        // Restart Finder so context menu and Quick Actions reload instantly
        let _ = Command::new("killall").arg("Finder").output();

        Ok(format!(
            "访达 (Finder) 快速操作已就绪！\n已在系统底层默认激活。在访达中右键点击任意 PDF、图片或 Word 文档，选择「快速操作」->「合并 PDF 与文档」即可直接唤起内嵌合并界面！",
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

pub fn generate_windows_reg(exe_path_opt: Option<&str>) -> Result<String, String> {
    let path = match exe_path_opt {
        Some(path) => path.to_string(),
        None => {
            #[cfg(target_os = "windows")]
            { std::env::current_exe().map_err(|e| e.to_string())?.to_str()
                .ok_or_else(|| "程序路径不是有效 Unicode".to_string())?.to_string() }
            #[cfg(not(target_os = "windows"))]
            { return Err("请在 Windows 安装后的程序中生成注册表配置".to_string()); }
        }
    };
    if path.is_empty() || path.contains(['\r', '\n', '\0', '"']) {
        return Err("无效的程序路径".to_string());
    }
    let escape = |value: &str| value.replace('\\', "\\\\").replace('"', "\\\"");
    let icon = escape(&format!("\"{}\"", path));
    let command = escape(&format!("\"{}\" \"%1\"", path));
    Ok(format!(r#"Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Classes\*\shell\DocToolsMerge]
@="使用 DocTools 合并/处理"
"Icon"="{icon}"

[HKEY_CURRENT_USER\Software\Classes\*\shell\DocToolsMerge\command]
@="{command}"

[HKEY_CURRENT_USER\Software\Classes\Directory\shell\DocToolsMerge]
@="在此文件夹打开 DocTools"
"Icon"="{icon}"

[HKEY_CURRENT_USER\Software\Classes\Directory\shell\DocToolsMerge\command]
@="{command}"
"#).replace('\n', "\r\n"))
}

pub fn check_pending_action() -> Option<LaunchContext> {
    let home = dirs::home_dir()?;
    let pending_file = home.join(".doctools").join("pending_action.json");

    if pending_file.exists() {
        if let Ok(content) = fs::read_to_string(&pending_file) {
            let _ = fs::remove_file(&pending_file);
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                let action = val
                    .get("action")
                    .and_then(|a| a.as_str())
                    .unwrap_or("merge")
                    .to_string();
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

fn generate_info_plist_named(title: &str, bundle_id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>zh_CN</string>
	<key>CFBundleIdentifier</key>
	<string>{bundle_id}</string>
	<key>CFBundleName</key>
	<string>{title}</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>{title}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
				<string>public.data</string>
				<string>public.content</string>
				<string>com.adobe.pdf</string>
				<string>public.image</string>
				<string>org.openxmlformats.wordprocessingml.document</string>
				<string>com.microsoft.word.doc</string>
			</array>
		</dict>
	</array>
</dict>
</plist>"#
    )
}

fn enable_services_in_pbs_plist() {
    let script = r#"
import plistlib, os, subprocess
pbs_path = os.path.expanduser('~/Library/Preferences/pbs.plist')
if os.path.exists(pbs_path):
    with open(pbs_path, 'rb') as f:
        data = plistlib.load(f)
else:
    data = {}

status = data.setdefault('NSServicesStatus', {})
keys = [
    'com.doctools.service.quickmerge - 合并 PDF 与文档 - runWorkflowAsService',
    os.path.expanduser('~/Library/Services/合并 PDF 与文档.workflow - 合并 PDF 与文档 - runWorkflowAsService'),
    'com.doctools.service.quickmerge.legacy - 合并 PDF 与文档 (DocTools) - runWorkflowAsService',
    os.path.expanduser('~/Library/Services/合并 PDF 与文档 (DocTools).workflow - 合并 PDF 与文档 (DocTools) - runWorkflowAsService'),
    'com.doctools.service.merge - DocTools: 合并与处理 - runWorkflowAsService',
    os.path.expanduser('~/Library/Services/DocTools - 合并与处理.workflow - DocTools: 合并与处理 - runWorkflowAsService')
]
for k in keys:
    status[k] = {
        'enabled_context_menu': True,
        'enabled_services_menu': True,
        'presentation_modes': {
            'ContextMenu': True,
            'FinderPreview': True,
            'ServicesMenu': True,
            'TouchBar': True
        }
    }

active = data.setdefault('FinderActive', {})
active['合并 PDF 与文档'] = True
active['com.doctools.service.quickmerge'] = True
active['合并 PDF 与文档 (DocTools)'] = True
active['DocTools: 合并与处理'] = True
active['com.doctools.service.merge'] = True

ordering = data.setdefault('FinderOrdering', {})
# Priority 0 so it appears at the very top of Quick Actions
ordering['合并 PDF 与文档'] = 0
ordering['com.doctools.service.quickmerge'] = 0

with open(pbs_path, 'wb') as f:
    plistlib.dump(data, f)
"#;
    let _ = Command::new("python3").args(["-c", script]).output();
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
					<string>if [ -x "/Applications/DocTools.app/Contents/MacOS/doc-tools-menu" ]; then
    /Applications/DocTools.app/Contents/MacOS/doc-tools-menu "$@"
else
    mkdir -p "$HOME/.doctools"
    python3 -c "import sys, json, os; json.dump({'action': 'merge', 'paths': sys.argv[1:]}, open(os.path.expanduser('~/.doctools/pending_action.json'), 'w'))" "$@"
    open -a "DocTools" 2&gt;/dev/null || open "/Applications/DocTools.app" 2&gt;/dev/null || true
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
		<integer>0</integer>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
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

#[cfg(test)]
mod windows_reg_tests {
    use super::generate_windows_reg;

    #[test]
    fn registry_uses_actual_path_and_escapes_values() {
        let reg = generate_windows_reg(Some(r"D:\工具 项目\DocTools\doc-tools.exe")).unwrap();
        assert!(reg.contains(r#"@="\"D:\\工具 项目\\DocTools\\doc-tools.exe\" \"%1\""#));
        assert!(!reg.contains("Program Files"));
        assert!(reg.contains("\r\n"));
    }

    #[test]
    fn invalid_registry_paths_are_rejected() {
        for path in ["", "C:\\bad\nfile.exe", "C:\\bad\"file.exe"] {
            assert!(generate_windows_reg(Some(path)).is_err());
        }
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn non_windows_cannot_generate_a_fake_installed_path() {
        assert!(generate_windows_reg(None).is_err());
    }
}
