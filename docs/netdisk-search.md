# 网盘搜索

网盘搜索作为 `netdisk` 套件接入工作台和侧边栏，可单独构建，旧项目 `~/work/proj/netdisk` 保持原样。采用本地桌面客户端直接查询搜索源的方式，不需要迁移旧项目的 SQLite、Meilisearch、Redis、爬虫或 Docker 栈。

## 运行

```sh
pnpm app                     # 完整桌面工具箱
pnpm app:netdisk             # 单独网盘模块
pnpm dev:netdisk             # 网页开发预览，使用本机 Vite 传输层
pnpm build:netdisk           # 前端构建
pnpm tauri build --config src-tauri/tauri.netdisk.conf.json
```

桌面端使用 Rust/reqwest，跟随系统及环境代理配置并验证 TLS 证书。网页开发通过 Vite 的同源中间件查询上游，避免跨域限制；静态托管和 `vite preview` 不提供该服务。网页开发环境由 Node 原生 fetch 负责网络连接，其代理行为与桌面端可能不同。

## 搜索源

| 搜索源 | 协议 | 地址 |
| --- | --- | --- |
| Melost（默认启用） | POST `/v1/search/disk`，综合查询后补充百度、阿里 | `https://www.melost.cn` |
| QKPAN（默认启用） | POST `/v1/search/disk` | `https://qkpanso.com` |
| PanSou（可选，默认关闭） | `/api/search`，`res=merge` | `https://so.252035.xyz` |
| 盘搜（可选，默认关闭） | 搜索页 `__NEXT_DATA__` | `https://www.pansearch.me` |
| 趣盘搜（可选，默认关闭） | POST `/search` | `https://v.funletu.com` |

搜索源设置中可禁用、移除、恢复默认和添加兼容 PanSou 的服务。自建实例地址填写服务根地址，如 `http://localhost:8888`，反向代理路径前缀也受支持。如开启认证，在对应服务行填写访问令牌；令牌只保存在当前页面内存中，不写入 localStorage。

旧版来源数组会升级为版本 2 配置：添加已验证的两个直连源，关闭旧默认公开 PanSou 地址，保留自定义服务、收藏和历史。保存版本 2 配置后，用户移除或关闭的来源不会在下次启动时重新添加。

单个源连接失败会展示状态和错误，其他源继续返回。上游收录范围和网络情况决定实际可用结果；识别一种网盘链接不代表该源对每个关键词都能返回该网盘的结果。未将任何搜索结果标为“已验证有效”，打开链接后仍可能遇到上游分享失效或登录要求。

## 参考与选型

2026-11-06 检查了以下上游的当前源码和文档；本项目自行实现客户端协议、归一化和界面，没有引入其服务端代码。

- [fish2018/pansou](https://github.com/fish2018/pansou)：采用其公开 API 协议，参考多源并发、异步补全和分类机制。
- [PanSou 的 pansearch 插件](https://github.com/fish2018/pansou/blob/main/plugin/pansearch/pansearch.go)：核对盘搜页面及 `__NEXT_DATA__` 字段。
- [PanSou 的 qupansou 插件](https://github.com/fish2018/pansou/blob/main/plugin/qupansou/qupansou.go)：核对趣盘搜请求格式与返回字段。
- [PanSou 的 melost 插件](https://github.com/fish2018/pansou/blob/main/plugin/melost/melost.go)与 [hunhepan 插件](https://github.com/fish2018/pansou/blob/main/plugin/hunhepan/hunhepan.go)：复用上游协议知识，在本地客户端实现对 Melost、QKPAN 的直接查询，运行时不经过 PanSou 服务。
- [wu529778790/panhub.shenzjd.com](https://github.com/wu529778790/panhub.shenzjd.com)：检查其聚合方式及[当前配置](https://github.com/wu529778790/panhub.shenzjd.com/blob/main/src/config.ts)。当前官方服务需要认证，不作为匿名默认源；旧项目中将其当作开放 PanSou 镜像的配置未沿用。

## 行为与边界

- 最多 12 个源，最多 4 个同时搜索；首批结果立即显示。
- Melost 首先查询综合结果，再查询百度和阿里，各请求 50 条；QKPAN 查询 50 条。补充请求失败时保留已返回结果。来源的总收录数不等于本轮返回数。
- PanSou 首次查询后分别等待 3 秒和 6 秒再读取上游缓存，以补齐慢插件；只有首个请求可带 `refresh=true`。每源整轮最多 30 秒，原生单次 HTTP 最多 22 秒。
- 停止、新搜索和组件卸载会中断请求；旧请求不能覆盖新结果。原生取消也处理了“取消命令先于请求注册到达”的竞态。
- 成功非空结果在内存保留 5 分钟，最多缓存 30 个查询。空结果不缓存。强制重新搜索跳过本地缓存。
- 按实际分享域名、网盘类型和分享 ID 去重，合并来源、日期和提取码；阿里与 123 的域名别名归一化。不接收任意跳转站点或可执行 URI。
- 每页 40 条结果；按相关度或发布时间排序，支持网盘筛选。
- 收藏最多 200 条，历史最多 20 条，配置和收藏保存在当前应用的 localStorage；单独套件和完整工具箱使用同一应用标识。写入失败会明确提示，不伪装成成功。
- 盘搜目前读取搜索页首屏数据，趣盘搜单次最多请求 500 条。PanSou 覆盖更多插件与公开频道，可通过自建服务扩充上游插件配置。

## 验证

```sh
pnpm test:netdisk
node --test tests/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib --tests
# 仅在需要真实联网验收时显式运行
cargo test --manifest-path src-tauri/Cargo.toml --test netdisk_transport live_direct_sources -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --test netdisk_transport live_pansou -- --ignored --nocapture
```

测试覆盖上游不同响应格式、域名别名、无效链接、HTML 文本、提取码补全、排序、多源故障隔离、并发上限、取消及旧结果抑制、渐进取回、缓存和本地存储损坏。原生传输测试使用临时本地 HTTP 服务，检查编码、认证、页面提取、错误状态和 8 MiB 响应上限。

2026-11-06 针对用户报告的“史记”超时重新验证：公开 PanSou 请求出现响应中途超时及无响应，不再作为默认来源。新默认来源的浏览器验收直接访问真实上游，没有响应回放：首批结果约 1.8 秒，整轮约 4.4 秒，去重后 115 个分享，包括百度 28、阿里 6、夸克 80、UC 1。请求记录只有 Melost、QKPAN；旧单源配置迁移和阿里筛选均已验证。具体数量随上游变化。

前端 24 项测试（其中网盘专项 18 项）、原生传输及显式联网测试通过。联网测试经实际 Rust 客户端查询两源的“史记”“红楼梦”，并单独验证了百度、阿里。仓库和候选来源的筛选依据见 [搜索源分析记录](netdisk-source-audit-2026-11-06.md)。

`pnpm build`、`pnpm build:netdisk` 和 macOS `pnpm tauri build --no-bundle` 均通过。完整工具箱发布二进制位于 `src-tauri/target/release/doc-tools`。本轮未进行 Windows 设备验收。

当前修复版另已通过 `pnpm tauri bundle --bundles app` 打包，可打开 `src-tauri/target/release/bundle/macos/Workspace.app` 使用。
