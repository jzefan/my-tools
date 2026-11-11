# my-tools - 跨平台多功能桌面生产力套件 (Mac & Windows)

一款基于 **Tauri 2.0 (Rust) + React 19 + TypeScript + Tailwind CSS** 打造的极轻量、高性能跨平台桌面文档与生产力工具箱。

工具箱现包含网盘搜索与自媒体账号一键转发分发模块：
- **自媒体分发**：支持抖音、小红书、B站、视频号、快手、知乎、微信公众号、今日头条、百家号、微博及自定义平台的多账号登录态隔离管理、图文与短视频一键分发、隐式静默发布与显示交互预填、发布任务队列中心、常用话术库、关键词自动回复与视频画幅/AI 文案辅助工具。启动命令 `pnpm app:media`，开发预览 `pnpm dev:media`。
- **网盘搜索**：支持百度、阿里、夸克、123、115、迅雷、天翼、UC、移动、蓝奏、PikPak 和光鸭分享链接，提供多源搜索、去重、收藏、历史、提取码复制和自定义 PanSou 服务。启动命令 `pnpm app:netdisk`，开发预览 `pnpm dev:netdisk`。[网盘搜索配置与验证](docs/netdisk-search.md)。
- **全功能工作台**：启动全部模块使用 `pnpm app`。

针对 macOS 深度优化原生体验（支持访达 Finder 右键快捷操作直达），提供 Windows 构建配置；Windows 功能与安装验收仍需在 Windows 设备完成。

---

## 💡 为什么选择 Tauri？开发与运行时空间占用剖析

针对您所关心的 **"Tauri 是否占空间比较大？"**：

| 对比维度 | **Tauri 2.0** (本项目采用) | **传统 Electron** |
| :--- | :--- | :--- |
| **最终安装包与二进制体积** | **极小（仅 8MB ~ 15MB）** | 巨大（普遍 80MB ~ 160MB+） |
| **运行内存占用 (RAM)** | **极低（约 30MB ~ 50MB）** | 偏高（普遍 150MB ~ 300MB+） |
| **底层核心** | 复用系统原生 Webview (macOS WKWebView / Win WebView2) + 原生 Rust | 强行打包完整的 Chromium 浏览器 + Node.js 运行时 |
| **开发期缓存空间** | Rust `target/` 编译缓存约 1.5GB（可随时 `cargo clean` 释放） | `node_modules` + cache 同样约 1GB~2GB |
| **PDF 处理性能** | 原生 Rust 多线程引擎，秒级处理千页文档，无内存溢出风险 | 受限于 JS/V8 引擎和单线程 IPC 通信限制 |

> **结论**：Tauri 是当前桌面端开发中**轻量化、高性能的标杆**，用户端体积仅有 Electron 的十分之一，非常适合作为常驻系统的轻量级实用小工具。

---

## 🚀 三大核心功能特性

### 1. 合并 PDF / 图片 / Word 文档（深度集成系统右键）
* **右键唤起即用**：
  * 右键点击任意单个或多个文件，在系统菜单中选择「DocTools: 合并与处理」。
  * **绝非弹出传统生硬的文件选择框**：软件启动后自动聚焦该文件所在目录，左侧直接呈现**当前层级完整的目录树与文件结构**，支持向上返回父级目录、双击深入下级目录，配合面包屑导航与搜索过滤，自由挑选需要合并的附件。
* **多格式混排支持**：
  * 原生支持混并 **PDF 文档** (`.pdf`)、**主流图片** (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tiff`) 以及 **Word 文档** (`.docx`, `.doc`)。
  * 图片自动计算最佳比例排版至标准 A4 页面；Word 文档支持通过系统底层无损转排。
* **清单灵活编排**：
  * 支持拖拽与上移/下移调整合并顺序。
  * 针对每个 PDF 支持精确提取指定页码范围（例如 `1-3, 5, 8-12` 或 `all`）。
  * 一键执行合并，完成后支持直接「在访达中定位高亮显示」。

### 2. PDF 智能压缩
* **推荐压缩 (Ebook - 150 DPI)**：最佳画质与体积平衡，平均缩减 60%~80% 体积，阅读与分享两相宜。
* **便携高压缩 (Screen - 96 DPI)**：适合网络传输、手机阅读或邮件附件大小限制。
* **极限压缩 (72 DPI)**：最大化缩减文件体积。
* **自定义与双引擎架构**：
  * 支持自主调节 DPI 分辨率上限 (50~300 DPI) 与 JPEG 质量因子 (10%~95%)。
  * 支持一键清除冗余元数据与历史编辑信息。
  * 支持自动检测并调用专业级 Ghostscript 极速引擎，若未安装则自动回退至纯原生 Rust 重采样压缩引擎。

### 3. PDF 水印智能识别与清理
* **一键特征扫描 (Auto-Scan)**：
  * 深入分析 PDF 页面内容流 (Content Stream `Tj`/`TJ` 算子)、Form XObject 叠层与批注结构。
  * 自动挖掘跨页高频重复的水印候选词（如“机密”、“草稿”、“内部资料”、“Confidential”等），并按出现频次和页数整理成候选标签供用户一键点选。
* **多维度水印消除算法**：
  * **文字水印**：解析重构 PDF 矢量内容流，精准抹除目标水印文字，不伤正文排版。
  * **透明图层水印**：智能剥离背景或前景中的水印 Form XObject 遮罩。
  * **批注图章水印**：一键清除嵌入在 PDF Annotations 中的水印标记。

---

## 🛠️ 项目技术架构

```
doc-tools/
├── src/                          # 前端 UI (React 19 + TypeScript + Tailwind CSS)
│   ├── components/
│   │   ├── Sidebar.tsx           # macOS 风格侧边栏导航与状态监控
│   │   ├── MergeView.tsx         # 核心目录树文件浏览 + 合并编排工作台
│   │   ├── CompressView.tsx      # PDF 压缩控制台与体积对比卡片
│   │   ├── WatermarkView.tsx     # 智能水印扫描与内容流清洗面板
│   │   └── SystemView.tsx        # 访达右键与 Windows 注册表配置中心
│   ├── services/
│   │   └── api.ts                # Tauri IPC 命令类型安全封装
│   ├── types/                    # 全局 TypeScript 接口契约
│   └── utils/                    # 格式化与文件辅助函数
└── src-tauri/                    # 后端核心引擎 (Rust 2024 + Tauri v2)
    ├── src/
    │   ├── fs_service.rs         # 异步目录扫描与 PDF 页数极速嗅探
    │   ├── pdf_merge.rs          # PDF/图片/Word 多格式合并引擎
    │   ├── pdf_compress.rs       # 智能图像降采样与混合压缩引擎
    │   ├── pdf_watermark.rs      # 内容流解码、水印特征提取与重构清洗引擎
    │   ├── system_integration.rs # macOS .workflow 服务生成器与 Windows .reg 注册表
    │   └── lib.rs                # Tauri 指令注册与跨进程 pending_action 监听
    └── tests/
        └── integration_tests.rs  # 全自动化集成测试套件
```

---

## 💻 快速运行与构建指南

### 环境准备
* Node.js >= 20, pnpm >= 9
* Rust >= 1.80

### 1. 启动开发模式
```bash
# 安装前端依赖
pnpm install

# 启动桌面端热重载开发
pnpm tauri dev
```

### 2. 运行自动化测试
```bash
cd src-tauri
cargo test --test integration_tests
```

### 3. 打包发布应用
```bash
# 一键打包 macOS 两种架构 (Apple Silicon + Intel)
pnpm package:mac

# 仅打包 macOS 苹果芯片 (M1/M2/M3/M4)
pnpm package:mac-arm64

# 仅打包 macOS Intel 芯片
pnpm package:mac-intel

# 打包 Windows NSIS 安装包 (.exe)
pnpm package:windows
```
打包产物自动收集至 `dist-release/` 目录：
- `dist-release/macos/my-tools-macos-arm64.dmg`（苹果芯片）
- `dist-release/macos/my-tools-macos-intel.dmg`（Intel 芯片）
- `dist-release/windows/my-tools-windows-x64-setup.exe`（Windows 安装程序）

### 4. GitHub 自动更新 Release

项目已配置 GitHub Actions 自动化发布工作流（`.github/workflows/release.yml`）：
- **触发机制**：每次 push 到 `main` 分支或推送版本 tag（如 `v1.0.0`），GitHub 会自动并发构建并更新 Release。
- **发布产物**：包含 macOS Apple Silicon DMG、macOS Intel DMG、Windows NSIS 安装程序及 `SHA256SUMS.txt` 校验和。

### 5. 访达右键快捷操作集成
启动应用后，进入侧边栏的 **「系统右键集成」** 面板，点击 **「一键安装访达右键快捷操作」**。
安装后，在访达中右键点击任意 PDF、图片或 Word 文档，即可在系统菜单中看到：
> **快捷操作 / 服务 -> DocTools: 合并与处理**

点击后将自动呼出 DocTools，并自动展示当前文件所在的完整目录结构与预载清单。

---

## 🪟 Windows 构建与验收

在 Windows 10/11 x64 上安装 Node.js 22、pnpm、Rust MSVC 工具链及 Visual Studio C++ Build Tools 后执行：

```powershell
pnpm install --frozen-lockfile
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --tests
pnpm tauri build --bundles nsis
```

安装程序输出到 `src-tauri/target/release/bundle/nsis/`。Windows 配置会嵌入 WebView2 离线安装程序；构建机器需要网络下载运行时，安装机器不依赖在线下载。配置依据 [Tauri Windows Installer 文档](https://v2.tauri.app/distribute/windows-installer/)。各套件开发入口 `pnpm app:docs`、`pnpm app:paper`、`pnpm app:cleaner` 使用独立 JSON 配置，可在 Windows 命令行运行。

原生文件/文件夹选择、文件定位和默认应用打开已接入跨平台插件。Finder 快捷操作仅出现在 macOS；Windows 可在系统集成页查看基于实际安装路径生成的 `.reg` 配置，复制后以 UTF-16 LE 编码保存再手动导入。Windows 11 的传统菜单可能位于“显示更多选项”。菜单按单个文件启动应用，不承诺资源管理器多选合并为同一个会话。

PDF 转 Word 支持离线内置转换，标准文本页可编辑，扫描页和转曲页按原页保留为图像。已安装 pdf2docx 时可优先重建表格和排版。Word 转 PDF 和 `.doc` 阅读仍使用系统中可用的转换引擎。Windows 不具备 macOS 的 textutil、Quick Look 或磁盘清理规则。Ghostscript、LibreOffice、Python 及其扩展均未随安装包附带。

[Windows 验收清单](docs/windows-acceptance.md) 与 `.github/workflows/windows.yml` 覆盖构建和回归入口。当前修改仅在 macOS 主机编译及测试，未完成 Windows 安装包或设备验收。
