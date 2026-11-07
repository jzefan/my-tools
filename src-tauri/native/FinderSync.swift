import Cocoa
import FinderSync

@objc(FinderSync)
class FinderSync: FIFinderSync {
    let supportedExtensions: Set<String> = [
        "pdf", "png", "jpg", "jpeg", "webp", "bmp", "docx", "doc", "txt", "md"
    ]

    override init() {
        super.init()
        NSLog("[DocToolsFinderSync] Initialized! Setting directoryURLs to root and Users")
        FIFinderSyncController.default().directoryURLs = Set([
            URL(fileURLWithPath: "/"),
            URL(fileURLWithPath: "/Users"),
            URL(fileURLWithPath: "/Volumes")
        ])
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        NSLog("[DocToolsFinderSync] menu(for:) called with menuKind: %ld", menuKind.rawValue)
        guard menuKind == .contextualMenuForItems || menuKind == .contextualMenuForContainer else { return nil }
        
        let selectedURLs = FIFinderSyncController.default().selectedItemURLs() ?? []
        let targetedURL = FIFinderSyncController.default().targetedURL()

        let anchorURL: URL
        let isContainerContext: Bool
        if !selectedURLs.isEmpty {
            anchorURL = selectedURLs[0]
            isContainerContext = false
        } else if let tURL = targetedURL {
            anchorURL = tURL
            isContainerContext = true
        } else {
            NSLog("[DocToolsFinderSync] Neither selectedItemURLs nor targetedURL available")
            return nil
        }

        NSLog("[DocToolsFinderSync] anchorURL is: %@", anchorURL.path)
        let currentDirURL = entryIsDir(url: anchorURL) ? anchorURL : anchorURL.deletingLastPathComponent()
        let parentDirURL = currentDirURL.deletingLastPathComponent()

        let menu = NSMenu(title: "")
        let rootItem = NSMenuItem(title: "合并 PDF 与文档", action: nil, keyEquivalent: "")
        let rootSubmenu = NSMenu(title: "合并 PDF 与文档")
        rootItem.submenu = rootSubmenu

        // Case 1: Multiple files were selected in Finder before right-clicking
        if selectedURLs.count > 1 {
            let multiItem = NSMenuItem(
                title: "⚡ 直接合并已选中的 \(selectedURLs.count) 个文件",
                action: #selector(mergeMultipleSelection(_:)),
                keyEquivalent: ""
            )
            multiItem.target = self
            multiItem.representedObject = selectedURLs.map { $0.path }
            rootSubmenu.addItem(multiItem)
            rootSubmenu.addItem(NSMenuItem.separator())
        }

        // Header: Current Context
        let headerTitle = isContainerContext 
            ? "📁 当前文件夹: \(anchorURL.lastPathComponent)"
            : "📄 点选文件: \(anchorURL.lastPathComponent)"
        let header = NSMenuItem(title: headerTitle, action: nil, keyEquivalent: "")
        header.isEnabled = false
        rootSubmenu.addItem(header)
        rootSubmenu.addItem(NSMenuItem.separator())

        let fm = FileManager.default

        // Section A: Current Directory files & folders
        var currentDirFiles: [URL] = []
        var currentDirFolders: [URL] = []

        if let entries = try? fm.contentsOfDirectory(at: currentDirURL, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
            for entry in entries {
                if entry.path == anchorURL.path { continue }
                if entryIsDir(url: entry) {
                    currentDirFolders.append(entry)
                } else {
                    let ext = entry.pathExtension.lowercased()
                    if supportedExtensions.contains(ext) {
                        currentDirFiles.append(entry)
                    }
                }
            }
        }

        // Show current directory files directly in the hover submenu
        if !currentDirFiles.isEmpty {
            for file in currentDirFiles {
                let icon = iconForExtension(file.pathExtension.lowercased())
                let item = NSMenuItem(
                    title: "\(icon) 合并: \(file.lastPathComponent)",
                    action: #selector(mergeAnchorWithTarget(_:)),
                    keyEquivalent: ""
                )
                item.target = self
                item.representedObject = [anchorURL.path, file.path]
                rootSubmenu.addItem(item)
            }
        } else {
            let emptyItem = NSMenuItem(title: "  (当前目录无其它可合并文档)", action: nil, keyEquivalent: "")
            emptyItem.isEnabled = false
            rootSubmenu.addItem(emptyItem)
        }

        // Section B: Subfolders in current directory
        if !currentDirFolders.isEmpty {
            rootSubmenu.addItem(NSMenuItem.separator())
            for folder in currentDirFolders {
                let folderItem = NSMenuItem(title: "📁 \(folder.lastPathComponent)", action: nil, keyEquivalent: "")
                let folderSubmenu = NSMenu(title: folder.lastPathComponent)

                if let subEntries = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) {
                    var hasSubFiles = false
                    for subFile in subEntries {
                        let ext = subFile.pathExtension.lowercased()
                        if supportedExtensions.contains(ext) {
                            hasSubFiles = true
                            let icon = iconForExtension(ext)
                            let item = NSMenuItem(
                                title: "\(icon) \(subFile.lastPathComponent)",
                                action: #selector(mergeAnchorWithTarget(_:)),
                                keyEquivalent: ""
                            )
                            item.target = self
                            item.representedObject = [anchorURL.path, subFile.path]
                            folderSubmenu.addItem(item)
                        }
                    }
                    if !hasSubFiles {
                        let empty = NSMenuItem(title: "(此文件夹无支持文档)", action: nil, keyEquivalent: "")
                        empty.isEnabled = false
                        folderSubmenu.addItem(empty)
                    }
                }
                folderItem.submenu = folderSubmenu
                rootSubmenu.addItem(folderItem)
            }
        }

        // Section C: Parent directory
        if parentDirURL.path != currentDirURL.path && parentDirURL.path != "/" {
            rootSubmenu.addItem(NSMenuItem.separator())
            let parentDirName = parentDirURL.lastPathComponent
            let parentItem = NSMenuItem(title: "📁 上级目录 (\(parentDirName))", action: nil, keyEquivalent: "")
            let parentSubmenu = NSMenu(title: parentDirName)

            if let parentEntries = try? fm.contentsOfDirectory(at: parentDirURL, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
                var hasParentFiles = false
                for pFile in parentEntries {
                    if !entryIsDir(url: pFile) {
                        let ext = pFile.pathExtension.lowercased()
                        if supportedExtensions.contains(ext) {
                            hasParentFiles = true
                            let icon = iconForExtension(ext)
                            let item = NSMenuItem(
                                title: "\(icon) \(pFile.lastPathComponent)",
                                action: #selector(mergeAnchorWithTarget(_:)),
                                keyEquivalent: ""
                            )
                            item.target = self
                            item.representedObject = [anchorURL.path, pFile.path]
                            parentSubmenu.addItem(item)
                        }
                    }
                }
                if !hasParentFiles {
                    let empty = NSMenuItem(title: "(上级目录无支持文档)", action: nil, keyEquivalent: "")
                    empty.isEnabled = false
                    parentSubmenu.addItem(empty)
                }
            }
            parentItem.submenu = parentSubmenu
            rootSubmenu.addItem(parentItem)
        }

        // Section D: Native Multi-select Panel
        rootSubmenu.addItem(NSMenuItem.separator())
        let openPicker = NSMenuItem(
            title: "📂 在访达窗口多选合并...",
            action: #selector(openFinderMultiSelect(_:)),
            keyEquivalent: ""
        )
        openPicker.target = self
        openPicker.representedObject = anchorURL.path
        rootSubmenu.addItem(openPicker)

        // Section E: Full Studio App
        let openStudio = NSMenuItem(
            title: "⚡ 打开 DocTools 完整套件...",
            action: #selector(openFullStudio(_:)),
            keyEquivalent: ""
        )
        openStudio.target = self
        openStudio.representedObject = selectedURLs.map { $0.path }
        rootSubmenu.addItem(openStudio)

        menu.addItem(rootItem)
        return menu
    }

    private func iconForExtension(_ ext: String) -> String {
        switch ext {
        case "pdf": return "📕"
        case "docx", "doc": return "📘"
        case "png", "jpg", "jpeg", "webp", "bmp": return "🖼"
        case "txt", "md": return "📄"
        default: return "📄"
        }
    }

    private func entryIsDir(url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)
        return isDirectory.boolValue
    }

    @objc func mergeAnchorWithTarget(_ sender: NSMenuItem) {
        guard let paths = sender.representedObject as? [String] else { return }
        executeCliMerge(paths: paths)
    }

    @objc func mergeMultipleSelection(_ sender: NSMenuItem) {
        guard let paths = sender.representedObject as? [String] else { return }
        executeCliMerge(paths: paths)
    }

    @objc func openFinderMultiSelect(_ sender: NSMenuItem) {
        guard let anchorPath = sender.representedObject as? String else { return }
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
            let panel = NSOpenPanel()
            panel.title = "选择要合并的一个或多个文件"
            panel.prompt = "开始合并"
            panel.directoryURL = URL(fileURLWithPath: anchorPath).deletingLastPathComponent()
            panel.allowsMultipleSelection = true
            panel.canChooseFiles = true
            panel.canChooseDirectories = false

            if panel.runModal() == .OK {
                var allPaths = [anchorPath]
                for u in panel.urls {
                    if u.path != anchorPath {
                        allPaths.append(u.path)
                    }
                }
                self.executeCliMerge(paths: allPaths)
            }
        }
    }

    @objc func openFullStudio(_ sender: NSMenuItem) {
        guard let paths = sender.representedObject as? [String] else { return }
        let home = FileManager.default.homeDirectoryForCurrentUser
        let pendingDir = home.appendingPathComponent(".doctools")
        try? FileManager.default.createDirectory(at: pendingDir, withIntermediateDirectories: true)
        let pendingFile = pendingDir.appendingPathComponent("pending_action.json")

        let payload: [String: Any] = [
            "action": "merge",
            "paths": paths
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: .prettyPrinted) {
            try? data.write(to: pendingFile)
        }

        let appURL = URL(fileURLWithPath: "/Applications/DocTools.app")
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        NSWorkspace.shared.openApplication(at: appURL, configuration: config, completionHandler: nil)
    }

    func executeCliMerge(paths: [String]) {
        let binPath = "/Applications/DocTools.app/Contents/MacOS/doc-tools"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: binPath)
        process.arguments = ["cli-merge"] + paths
        do {
            try process.run()
            return
        } catch {
            NSLog("[DocToolsFinderSync] Process run failed: %@, fallback to NSWorkspace", error.localizedDescription)
        }

        let appURL = URL(fileURLWithPath: "/Applications/DocTools.app")
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        config.arguments = ["cli-merge"] + paths
        config.activates = false
        NSWorkspace.shared.openApplication(at: appURL, configuration: config, completionHandler: nil)
    }
}
