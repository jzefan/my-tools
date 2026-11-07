# Windows 安装验收

当前状态：仅在 macOS aarch64 完成源码检查及可运行的本机回归。Windows CI 尚未运行；下表不是已通过的结果。

构建入口：Windows 10/11 x64、Node.js 22、pnpm 10、Rust stable MSVC、Visual Studio C++ Build Tools；运行 `pnpm install --frozen-lockfile`、`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --tests`、`pnpm tauri build --bundles nsis`。CI 配置位于 `.github/workflows/windows.yml`，生成 NSIS `.exe`，不发布软件或操作注册表。

| 场景 | 检查结果应满足 |
| --- | --- |
| 全新普通用户安装 | NSIS 安装并启动；缺少 WebView2 时由离线安装程序安装运行时 |
| 无网络启动 | 本地 PDF、图片及已有资料库正常显示；AI 网络失败明确报错 |
| 文件和文件夹选择 | 原生选择器能打开、取消及选择含空格/中文的路径 |
| 定位与默认应用打开 | 文件夹定位选中正确文件；快速查看在 Windows 打开系统默认程序 |
| PDF 合并、重排、旋转、压缩 | 使用临时 fixtures，重开结果检查页序、内容、旋转与实际大小 |
| Word 转换及旧 DOC 阅读 | 分别测试有/无 LibreOffice、Word；缺引擎有明确错误，不能把 OLE DOC 当 ZIP DOCX |
| DOCX 阅读 | 原始 DOCX 交给 docx-preview；文本、分页、图像正常显示 |
| AI 概述和问答 | 无配置、HTTP 错误不输出伪造结果；正确配置后引文可在源页核验 |
| 平台入口 | Windows 不显示 Finder 安装、textutil 回退或可执行的 macOS 清理入口 |
| 注册表配置 | 使用临时安装目录含中文/空格；生成文本正确引用实际 exe；先审阅，UTF-16 LE 保存后由测试者手动导入/移除 |
| 右键启动 | 单文件和目录传入正确路径；Windows 11 同时检查“显示更多选项” |
| 更新/卸载 | 用户资料库保留策略确认；手动导入的右键注册表项需手动移除 |

外部工具未随包附带；转换能力取决于可用引擎及字体。NSIS 包未配置代码签名，发布前需另外处理签名及 SmartScreen 验证。Windows ARM64、32 位、资源管理器多选合并会话未验证。

WebView2 配置依据 [Tauri 官方 Windows 安装文档](https://v2.tauri.app/distribute/windows-installer/)；选择器使用 [Tauri Dialog 插件](https://v2.tauri.app/plugin/dialog/)。离线安装模式增加安装包体积，构建时仍需下载运行时。
