import Cocoa
import FinderSync

@objc(FinderSync)
class FinderSync: FIFinderSync {
    let supportedExtensions: Set<String> = [
        "pdf", "png", "jpg", "jpeg", "webp", "bmp", "docx", "doc"
    ]

    override init() {
        super.init()
        NSLog("[DocToolsFinderSync] Initialized")
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let volumes = URL(fileURLWithPath: "/Volumes")
        FIFinderSyncController.default().directoryURLs = [home, volumes]
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        guard menuKind == .contextualMenuForItems else { return nil }
        guard let selectedURLs = FIFinderSyncController.default().selectedItemURLs(), !selectedURLs.isEmpty else {
            return nil
        }

        let firstURL = selectedURLs[0]
        let ext = firstURL.pathExtension.lowercased()

        if selectedURLs.count == 1 && !entryIsDir(url: firstURL) && !supportedExtensions.contains(ext) {
            return nil
        }

        let menu = NSMenu(title: "")
        let rootItem = NSMenuItem(title: "合并 PDF 与文档", action: nil, keyEquivalent: "")
        let rootSubmenu = NSMenu(title: "合并 PDF 与文档")
        rootItem.submenu = rootSubmenu

        // Case 1: Multiple files selected in Finder before right-clicking
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

        let anchorURL = firstURL
        let currentDirURL = entryIsDir(url: anchorURL) ? anchorURL : anchorURL.deletingLastPathComponent()
        let parentDirURL = currentDirURL.deletingLastPathComponent()

        // Header: Anchor File
        let header = NSMenuItem(title: "📄 点选文件: \(anchorURL.lastPathComponent)", action: nil, keyEquivalent: "")
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
                } else if supportedExtensions.contains(entry.pathExtension.lowercased()) {
                    currentDirFiles.append(entry)
                }
            }
        }

        // Show current directory files directly in the hover submenu
        if !currentDirFiles.isEmpty {
            for file in currentDirFiles {
                let item = NSMenuItem(
                    title: "  + 合并: \(file.lastPathComponent)",
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
                        if supportedExtensions.contains(subFile.pathExtension.lowercased()) {
                            hasSubFiles = true
                            let item = NSMenuItem(
                                title: "📄 \(subFile.lastPathComponent)",
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
            let parentItem = NSMenuItem(title: "📁 上级目录 (\(parentDirURL.lastPathComponent))", action: nil, keyEquivalent: "")
            let parentSubmenu = NSMenu(title: parentDirURL.lastPathComponent)

            if let parentEntries = try? fm.contentsOfDirectory(at: parentDirURL, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
                var hasParentFiles = false
                for pFile in parentEntries {
                    if !entryIsDir(url: pFile) && supportedExtensions.contains(pFile.pathExtension.lowercased()) {
                        hasParentFiles = true
                        let item = NSMenuItem(
                            title: "📄 \(pFile.lastPathComponent)",
                            action: #selector(mergeAnchorWithTarget(_:)),
                            keyEquivalent: ""
                        )
                        item.target = self
                        item.representedObject = [anchorURL.path, pFile.path]
                        parentSubmenu.addItem(item)
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

        menu.addItem(rootItem)
        return menu
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
            panel.prompt = "合并"
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

    func executeCliMerge(paths: [String]) {
        let appURL = URL(fileURLWithPath: "/Applications/DocTools.app")
        let config = NSWorkspace.OpenConfiguration()
        config.arguments = ["cli-merge"] + paths
        config.activates = false
        NSWorkspace.shared.openApplication(at: appURL, configuration: config, completionHandler: nil)
    }
}
