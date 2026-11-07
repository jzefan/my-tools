# Windows 打包与功能完整性审核

审核日期：2026-11-06。对象为当前工作区，延续[前次代码审核](code-audit-2026-11-06.md)。本轮程序修正由用户指定的 GPT-6.1 Sol 执行；主审复核源码、运行回归和界面检查。保留原有未提交改动，未发布或提交代码。

## 结论

**当前不能认定 Windows 安装后功能完整，也未完成 Windows 安装验收。** 源码中确认的多处 Windows 功能缺陷已修正，但磁盘清理仍仅支持 macOS，转换能力依赖额外安装的外部引擎。新增 Windows 安装配置和 CI 不代表安装包已经成功生成。

本机为 macOS aarch64，没有可用的 Windows 运行环境，仓库未配置远程地址，无法在此触发 Windows CI。已取得 Windows MSVC Rust 目标并检查实际 Windows 条件分支；完整应用交叉检查停在资源编译工具缺失，核心业务模块的独立 Windows 类型检查通过。未生成可交付的 Windows `.exe`。

## 确认的问题与修正

| 严重程度 | 原问题及影响 | 本轮处理 |
| --- | --- | --- |
| P1 | 非 macOS 文件选择器无法正常提供文件及目录选择，影响导入和输出路径选择 | 改用 Tauri Dialog 原生选择器，取消返回空结果，阻塞调用放入后台任务 |
| P2 | Windows 文件定位的命令引号不可靠；快速查看在非 macOS 返回成功但不打开文件 | 定位使用 Opener 的原生文件揭示 API；Windows 快速查看改为打开系统默认应用 |
| P1 | 转换依赖探测偏向 macOS，Python 检测与执行可能使用不同解释器；固定安装盘路径漏检工具 | 按模块缓存验证过的 Python 3 解释器，支持 Windows `py -3`、`python`、`python3` 并跳过 WindowsApps 别名；搜索 PATH、Program Files 和 LOCALAPPDATA 中的 LibreOffice、Poppler、Ghostscript |
| P1 | Windows Word 自动化的路径转义、异常退出和 COM 释放不完整；LibreOffice 中间输出可能覆盖同目录同名 PDF | Word 脚本使用环境变量传路径、显式报错并在 finally 关闭和释放 COM；LibreOffice 使用独立工作目录与用户配置，再发布验证后的结果 |
| P1 | 旧 `.doc` 的 OLE 数据被当成 DOCX ZIP 渲染 | `.doc` 先通过现有 Word/LibreOffice 流程转为 PDF，阅读端识别 PDF 文件头；DOCX 仍交给 DOCX 阅读器 |
| P2 | 前端 PDF 字体/CMap 等资源依赖在线地址，离线安装后部分 PDF 无法完整显示 | 构建时从当前安装版本的 pdfjs-dist 打包 CMaps、标准字体和 WASM，配置本地 URL；开发服务为 WASM 回退 JS 提供正确 MIME |
| P2 | Windows 反斜杠、UNC、扩展路径显示错误；无扩展名文件可能误删父目录中的点号后缀 | 统一路径名称、面包屑与扩展名处理，增加盘符/UNC/中文/点号目录回归 |
| P1 | Windows 磁盘清理套用了 macOS 的 HOME/规则和容量命令，可能显示假空结果或无法工作的操作 | 后端明确返回不支持，执行接口拒绝删除；界面仅显示平台限制，不把 0 字节误报成扫描完成。未新增未经实机验证的 Windows 删除规则 |
| P2 | 系统集成页面显示 Finder/textutil 等不适用入口，注册表使用固定 exe 路径 | 返回真实平台并按平台展示入口；Windows 注册表使用当前 exe 路径，正确转义中文、空格和引号，拒绝非法路径；仅生成文本，不自动修改注册表 |
| P2 | 套件启动命令依赖 Unix 单引号转义；没有专门的 Windows 安装配置或持续构建检查 | 改为独立 JSON 配置；增加 NSIS、WebView2 离线安装程序和中英文语言设置；新增 Windows CI 构建、测试及安装包 artifact |

所有外部转换命令有超时；Windows 启动此类命令隐藏控制台窗口。超时终止直接子进程，不保证 Office/LibreOffice 派生进程树的完全清理，这仍需实机验证。

## 安装后能力边界

| 功能 | 当前实现/依赖 | Windows 验收状态 |
| --- | --- | --- |
| 文件/目录选择、文件定位、系统默认应用打开 | 跨平台原生插件已接入 | 待实机验证原生对话框及关联应用 |
| PDF 合并、重排、旋转、基础压缩、水印处理 | 有 Rust 本地实现；增强压缩可用 Ghostscript | 本机回归及核心 Windows 类型检查通过，未在 Windows 执行 |
| PDF 阅读与 DOCX 阅读 | PDF.js/docx-preview；PDF 渲染资源已随前端构建打包 | 资源完整性检查通过，未验证 Windows WebView2 实际渲染 |
| PDF→Word | 主要依赖 Python + pdf2docx；LibreOffice 仅作全页转换回退 | macOS 真实样本保留中文、表格、图片；Windows 字体、引擎版本和排版待测 |
| Word→PDF、旧 DOC 阅读 | 需可用的 Word 或 LibreOffice；docx2pdf 也依赖 Word | 缺引擎会失败并报错，安装应用本身不会提供这些引擎 |
| PDF→图片 | 需 PyMuPDF，或适用的 Poppler/Ghostscript 回退 | Windows 发现逻辑已修正，实际输出待测 |
| 磁盘清理 | 当前只有 macOS 规则 | **Windows 不支持**，界面和后端均明确限制 |
| 资源管理器右键菜单 | 提供 `.reg` 文本，使用实际安装路径；用户手动保存、导入 | 单文件/目录调用待验收；未实现并验证资源管理器多选汇聚到同一会话 |
| AI 概述/问答 | 需用户配置服务及网络 | 错误和引文校验回归通过，不属于离线能力 |

WebView2 离线安装程序只解决 WebView 运行时，不包含 Python、pdf2docx、LibreOffice、Microsoft Word、Ghostscript 或字体。构建时仍需要下载 WebView2，安装包也会变大。配置依据：[Tauri Windows 安装文档](https://v2.tauri.app/distribute/windows-installer/)；原生选择器依据：[Dialog 插件文档](https://v2.tauri.app/plugin/dialog/)。

PDF→Word 代表性样本通过不等于任意 PDF 逐对象完整保真。扫描件仍无 OCR，图像形式保留的表格不能算可编辑 Word 表格；复杂表格、公式、矢量图、多栏和字体替代仍需对照原件检查。

## 已执行的验证

| 检查 | 实际结果 |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --offline --locked` | macOS 上 28 项通过，3 项显式忽略；未执行真实用户目录清理或系统服务安装 |
| `node --test` | 6 项通过：AI 错误/引文、PDF 本地资源、开发服务 MIME、Windows 路径三组 |
| `python3 src-tauri/tests/pdf_conversion_regression.py` | 3 项真实 PDF→DOCX 回归通过 |
| `pnpm build` | TypeScript 与生产构建通过；论文模块约 722 kB，仍有超过 500 kB 提示 |
| Windows/套件配置 schema | 4 份新增 JSON 配置通过安装版本的 Tauri schema 校验 |
| 完整应用 `cargo check --target x86_64-pc-windows-msvc --offline` | **未通过**：Tauri 的 Windows 资源编译阶段缺少 `llvm-rc`，不能据此认定应用 Windows 构建成功 |
| 独立核心模块 `cargo check --target x86_64-pc-windows-msvc --lib --tests --offline` | 通过；临时检查 crate 直接引用实际 models、disk_cleaner、fs_service、pdf_convert、pdf_compress、pdf_merge、pdf_watermark、paper_service 源码；不包含完整 Tauri 应用入口/打包，且没有运行 Windows 测试二进制 |
| Windows 状态的界面检查 | 独立临时浏览器中使用真实组件、模拟 Windows 平台与不支持清理的返回；无 Finder/textutil 操作，无清理按钮，无横向溢出，截图检查布局正常。此项不是 Windows WebView2 实测 |

新增 [Windows CI](/Users/jzefan/work/proj/doc-tools/.github/workflows/windows.yml) 会在 Windows runner 执行 Rust 测试、构建 NSIS 安装包、检查前端资源，并上传 `.exe` artifact；本轮没有运行该工作流。临时界面测试页和测试服务器已移除/停止。

## 发布前仍须完成

按 [Windows 安装验收清单](windows-acceptance.md)，在干净的 Windows 10/11 x64 环境完成安装、离线启动、中文及空格路径、外部引擎有/无两种状态、转换结果内容、WebView2 渲染、右键启动和卸载检查。安装包尚未配置签名，SmartScreen 未验收。ARM64、32 位及多选右键行为未验证。手动导入的右键注册表项目前也需手动移除。

本轮修正解决已确认的可移植性缺陷；完成 Windows 实机验收并补齐 Windows 清理实现之前，不应宣称两个平台功能完全一致。
