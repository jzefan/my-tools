import Cocoa
import UniformTypeIdentifiers

class MenuCoordinator: NSObject, NSMenuDelegate {
    let anchorPath: String
    let allInitialPaths: [String]
    var docToolsBinaryPath: String

    init(anchorPath: String, allInitialPaths: [String]) {
        self.anchorPath = anchorPath
        self.allInitialPaths = allInitialPaths

        // Locate doc-tools binary
        let defaultAppBinary = "/Applications/DocTools.app/Contents/MacOS/doc-tools"
        if FileManager.default.fileExists(atPath: defaultAppBinary) {
            self.docToolsBinaryPath = defaultAppBinary
        } else {
            let bundleDir = Bundle.main.bundleURL.deletingLastPathComponent().path
            let localCandidate = "\(bundleDir)/doc-tools"
            if FileManager.default.fileExists(atPath: localCandidate) {
                self.docToolsBinaryPath = localCandidate
            } else {
                self.docToolsBinaryPath = "/Applications/DocTools.app/Contents/MacOS/doc-tools"
            }
        }
        super.init()
    }

    func runCliMerge(paths: [String]) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: docToolsBinaryPath)
        var arguments = ["cli-merge"]
        arguments.append(contentsOf: paths)
        task.arguments = arguments

        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            let alert = NSAlert()
            alert.messageText = "执行合并失败"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
        NSApp.terminate(nil)
    }

    @objc func mergeMultiDirectly(_ sender: NSMenuItem) {
        runCliMerge(paths: allInitialPaths)
    }

    @objc func mergeWithSingleFile(_ sender: NSMenuItem) {
        guard let targetPath = sender.representedObject as? String else {
            NSApp.terminate(nil)
            return
        }
        runCliMerge(paths: [anchorPath, targetPath])
    }

    @objc func openInFinderPicker(_ sender: NSMenuItem) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        let panel = NSOpenPanel()
        panel.title = "选择要与「\(URL(fileURLWithPath: anchorPath).lastPathComponent)」合并的文件"
        panel.prompt = "开始合并"
        panel.message = "支持按住 Command 或 Shift 选取多个文件，或在左侧/分栏中随意切换目录"
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.directoryURL = URL(fileURLWithPath: anchorPath).deletingLastPathComponent()

        if panel.runModal() == .OK {
            var filesToMerge = [anchorPath]
            for url in panel.urls {
                if url.path != anchorPath {
                    filesToMerge.append(url.path)
                }
            }
            runCliMerge(paths: filesToMerge)
        } else {
            NSApp.terminate(nil)
        }
    }

    @objc func openFullApp(_ sender: NSMenuItem) {
        // Write pending action and open DocTools GUI
        let home = FileManager.default.homeDirectoryForCurrentUser
        let pendingDir = home.appendingPathComponent(".doctools")
        try? FileManager.default.createDirectory(at: pendingDir, withIntermediateDirectories: true)
        let pendingFile = pendingDir.appendingPathComponent("pending_action.json")

        let payload: [String: Any] = [
            "action": "merge",
            "paths": allInitialPaths
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: .prettyPrinted) {
            try? data.write(to: pendingFile)
        }

        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        task.arguments = ["-a", "DocTools"]
        try? task.run()
        NSApp.terminate(nil)
    }
}

func createCascadingMenu(coordinator: MenuCoordinator) -> NSMenu {
    let menu = NSMenu(title: "合并 PDF 与文档")
    let fm = FileManager.default

    let anchorURL = URL(fileURLWithPath: coordinator.anchorPath)
    let currentDirURL = anchorURL.deletingLastPathComponent()
    let parentDirURL = currentDirURL.deletingLastPathComponent()

    let anchorName = anchorURL.lastPathComponent
    let currentDirName = currentDirURL.lastPathComponent

    let supportedExts: Set<String> = ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "docx", "doc"]

    // 0. If multiple files were selected before right-clicking
    if coordinator.allInitialPaths.count > 1 {
        let multiItem = NSMenuItem(
            title: "⚡ 直接合并已选中的 \(coordinator.allInitialPaths.count) 个文件",
            action: #selector(coordinator.mergeMultiDirectly(_:)),
            keyEquivalent: ""
        )
        multiItem.target = coordinator
        multiItem.attributedTitle = NSAttributedString(
            string: "⚡ 直接合并已选中的 \(coordinator.allInitialPaths.count) 个文件",
            attributes: [.font: NSFont.boldSystemFont(ofSize: 13)]
        )
        menu.addItem(multiItem)
        menu.addItem(NSMenuItem.separator())
    }

    // 1. Header showing anchor file
    let headerItem = NSMenuItem(title: "📄 点选文件: \(anchorName)", action: nil, keyEquivalent: "")
    headerItem.isEnabled = false
    menu.addItem(headerItem)
    menu.addItem(NSMenuItem.separator())

    // 2. Current Directory files & folders
    let currentDirHeader = NSMenuItem(title: "📁 当前目录 (\(currentDirName))", action: nil, keyEquivalent: "")
    let currentSubmenu = NSMenu(title: currentDirName)

    var currentDirFilesCount = 0
    if let currentEntries = try? fm.contentsOfDirectory(at: currentDirURL, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
        for entry in currentEntries {
            if entry.path == coordinator.anchorPath { continue }
            var isDir: ObjCBool = false
            fm.fileExists(atPath: entry.path, isDirectory: &isDir)

            if isDir.boolValue {
                // Child folder submenu
                let subFolderName = entry.lastPathComponent
                let subFolderItem = NSMenuItem(title: "📁 \(subFolderName)", action: nil, keyEquivalent: "")
                let subMenu = NSMenu(title: subFolderName)

                if let childEntries = try? fm.contentsOfDirectory(at: entry, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
                    for child in childEntries {
                        let ext = child.pathExtension.lowercased()
                        if supportedExts.contains(ext) {
                            let item = NSMenuItem(title: "📄 \(child.lastPathComponent)", action: #selector(coordinator.mergeWithSingleFile(_:)), keyEquivalent: "")
                            item.target = coordinator
                            item.representedObject = child.path
                            subMenu.addItem(item)
                        }
                    }
                }
                if subMenu.items.count > 0 {
                    subFolderItem.submenu = subMenu
                    currentSubmenu.addItem(subFolderItem)
                }
            } else {
                let ext = entry.pathExtension.lowercased()
                if supportedExts.contains(ext) {
                    currentDirFilesCount += 1
                    let item = NSMenuItem(title: "📄 \(entry.lastPathComponent)", action: #selector(coordinator.mergeWithSingleFile(_:)), keyEquivalent: "")
                    item.target = coordinator
                    item.representedObject = entry.path
                    currentSubmenu.addItem(item)
                }
            }
        }
    }
    if currentSubmenu.items.isEmpty {
        let empty = NSMenuItem(title: "(当前目录无其它可合并文档)", action: nil, keyEquivalent: "")
        empty.isEnabled = false
        currentSubmenu.addItem(empty)
    }
    currentDirHeader.submenu = currentSubmenu
    menu.addItem(currentDirHeader)

    // Directly expose current files in root menu for 1-click speed
    if let currentEntries = try? fm.contentsOfDirectory(at: currentDirURL, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
        for entry in currentEntries {
            if entry.path == coordinator.anchorPath { continue }
            let ext = entry.pathExtension.lowercased()
            if supportedExts.contains(ext) {
                let item = NSMenuItem(title: "  + 合并: \(entry.lastPathComponent)", action: #selector(coordinator.mergeWithSingleFile(_:)), keyEquivalent: "")
                item.target = coordinator
                item.representedObject = entry.path
                menu.addItem(item)
            }
        }
    }

    // 3. Parent Directory Submenu
    if parentDirURL.path != currentDirURL.path && parentDirURL.path != "/" {
        let parentDirName = parentDirURL.lastPathComponent
        let parentDirHeader = NSMenuItem(title: "📁 上级目录 (\(parentDirName))", action: nil, keyEquivalent: "")
        let parentSubmenu = NSMenu(title: parentDirName)

        if let parentEntries = try? fm.contentsOfDirectory(at: parentDirURL, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
            for entry in parentEntries {
                var isDir: ObjCBool = false
                fm.fileExists(atPath: entry.path, isDirectory: &isDir)
                if !isDir.boolValue {
                    let ext = entry.pathExtension.lowercased()
                    if supportedExts.contains(ext) {
                        let item = NSMenuItem(title: "📄 \(entry.lastPathComponent)", action: #selector(coordinator.mergeWithSingleFile(_:)), keyEquivalent: "")
                        item.target = coordinator
                        item.representedObject = entry.path
                        parentSubmenu.addItem(item)
                    }
                }
            }
        }
        if parentSubmenu.items.isEmpty {
            let empty = NSMenuItem(title: "(上级目录无支持的文档)", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            parentSubmenu.addItem(empty)
        }
        parentDirHeader.submenu = parentSubmenu
        menu.addItem(parentDirHeader)
    }

    menu.addItem(NSMenuItem.separator())

    // 4. Native Finder Multi-file Selection Dialog
    let pickerItem = NSMenuItem(
        title: "📂 在访达窗口多选合并...",
        action: #selector(coordinator.openInFinderPicker(_:)),
        keyEquivalent: ""
    )
    pickerItem.target = coordinator
    menu.addItem(pickerItem)

    // 5. Open Full Studio
    let studioItem = NSMenuItem(
        title: "⚡ 打开 DocTools 完整套件...",
        action: #selector(coordinator.openFullApp(_:)),
        keyEquivalent: ""
    )
    studioItem.target = coordinator
    menu.addItem(studioItem)

    return menu
}

// Entry Point
let args = CommandLine.arguments
let inputPaths = Array(args.dropFirst())

guard let firstPath = inputPaths.first, !firstPath.isEmpty else {
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let coordinator = MenuCoordinator(anchorPath: firstPath, allInitialPaths: inputPaths)
let menu = createCascadingMenu(coordinator: coordinator)

// Position menu right at mouse cursor
let mousePos = NSEvent.mouseLocation
menu.popUp(positioning: nil, at: mousePos, in: nil)
