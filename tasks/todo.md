# Docker 安全磁盘清理

## Plan

- [x] `docker_cleaner.rs`：检测 CLI/daemon，`docker system df` 汇总，可勾选安全清理项
- [x] 默认：已停止容器、悬空镜像、未用网络、构建缓存；未用镜像为 recommended；卷为 caution 默认不勾选
- [x] 注册 `scan_docker_reclaim` / `execute_docker_cleanup`
- [x] 前端：侧栏「Docker 清理」+ `DockerCleanerView`（扫描 → 勾选 → 确认）
- [x] daemon 未运行时简短不可用态；无 CLI 时同样处理
- [x] 单测（解析/状态机 mock）+ `cargo check` / `tsc`

## Notes

- 不对齐 `docker system prune -a --volumes` 默认行为
- 对齐 Mole：`builder prune -af` + dangling image prune + `system df` 报告
- 命名卷（如 postgres）不默认删除；选卷时确认文案额外提示
- 同时勾选「未使用镜像」与「悬空镜像」时，后端只跑 `image prune -a`

## Review

- 新增 `src-tauri/src/docker_cleaner.rs` + Tauri 命令
- 侧栏 `cleaner_docker` → `DockerCleanerView`
- `cargo test --lib docker_cleaner::`：5 passed
- `tsc --noEmit`：通过
