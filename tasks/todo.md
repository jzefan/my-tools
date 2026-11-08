# 磁盘清理贴近 Mole（保留微信/QQ 特色）

## Plan

- [x] 扩展 `disk_cleaner.rs` 规则与扫描模式（DirChildren / AppSupportLeaves / HomeFiles）
- [x] 修复 `*` 通配路径只扫不清的 bug（execute 走 `expand_sub_path`）
- [x] 贴近 Mole：Library/Caches 子目录扫、App Support 叶子缓存、GoogleUpdater、Brave、Cargo/Rustup/Expo/Bun、zsh
- [x] 保留微信/QQ 深度路径；文案「专清」→「清理」
- [x] 同步侧栏 / 筛选 / Home 文案；更新 developer 副标题
- [x] 跑 `cargo test`（disk_cleaner）与必要前端类型对齐
- [x] Review 记录

## Notes

- 不做 sudo 系统级清理（保持无提权）
- 不做 Docker 镜像/卷硬删（危险）；不扫家目录外路径（如 Clang module cache）
- `.cache` 子项排除模型权重目录；`Library/Caches` 排除已有专属规则的顶层名

## Review

- 规则由 18 条扩到约 28 条；新增 `library_caches` / `dot_cache` / `app_support_caches` / `google_updater_cache` / Brave / Bun·Corepack / Cargo·Rustup / Expo / zsh
- 微信/QQ 深度路径保留；UI「专清」→「清理」；系统侧栏改为「系统与应用缓存」并合并 system_logs + app_cache + trash
- `cargo test --lib disk_cleaner::`：9 passed
- 仍与 Mole 有意差异：无 sudo 系统日志、无 Docker 硬删、无进程守卫/年龄阈值、GUI 勾选后删
