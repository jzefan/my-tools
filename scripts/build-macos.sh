#!/usr/bin/env bash
set -e

# my-tools macOS 打包脚本
# 支持架构:
#   arm64 (Apple Silicon / M系列芯片)
#   x64   (Intel 芯片)
#   all   (两端均打包)

TARGET_ARCH="${1:-all}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_RELEASE="${PROJECT_ROOT}/dist-release/macos"

mkdir -p "${DIST_RELEASE}"

echo "=========================================="
echo "  my-tools macOS 打包程序"
echo "  目标架构: ${TARGET_ARCH}"
echo "=========================================="

cd "${PROJECT_ROOT}"

# 1. 编译前端
echo ">>> [1/3] 编译前端静态资源..."
pnpm build

# 函数：打包指定架构
build_target() {
  local arch="$1"
  local target_triple=""
  local label=""

  if [ "$arch" = "arm64" ]; then
    target_triple="aarch64-apple-darwin"
    label="Apple Silicon (M系列芯片)"
  elif [ "$arch" = "x64" ]; then
    target_triple="x86_64-apple-darwin"
    label="Intel (x86_64 芯片)"
  else
    echo "未知架构: $arch"
    exit 1
  fi

  echo ""
  echo ">>> [2/3] 正在打包 ${label} -> target: ${target_triple}..."

  # 确保 Rust target 已安装
  rustup target add "${target_triple}" 2>/dev/null || true

  # 执行 Tauri 打包
  pnpm tauri build --target "${target_triple}" --bundles dmg

  # 归档产物
  local dmg_path
  dmg_path=$(find "${PROJECT_ROOT}/src-tauri/target/${target_triple}/release/bundle/dmg" -maxdepth 1 -name "*.dmg" 2>/dev/null | head -n 1)

  if [ -n "$dmg_path" ] && [ -f "$dmg_path" ]; then
    local dmg_name
    dmg_name=$(basename "$dmg_path")
    cp "$dmg_path" "${DIST_RELEASE}/${dmg_name}"
    # 生成规范化别名
    local alias_name="my-tools-macos-${arch}.dmg"
    cp "$dmg_path" "${DIST_RELEASE}/${alias_name}"

    echo "✓ [完成] ${label} DMG 打包成功:"
    echo "  - ${DIST_RELEASE}/${dmg_name}"
    echo "  - ${DIST_RELEASE}/${alias_name}"
  else
    echo "❌ 未找到构建产物 DMG 文件: src-tauri/target/${target_triple}/release/bundle/dmg"
    exit 1
  fi
}

# 2. 执行构建
case "${TARGET_ARCH}" in
  arm64|m1|m2|m3|apple)
    build_target "arm64"
    ;;
  x64|x86_64|intel)
    build_target "x64"
    ;;
  all|both)
    build_target "arm64"
    build_target "x64"
    ;;
  *)
    echo "无效参数: ${TARGET_ARCH}. 可用选项: arm64 | x64 | all"
    exit 1
    ;;
esac

echo ""
echo "=========================================="
echo ">>> [3/3] 打包产物目录: ${DIST_RELEASE}"
ls -lh "${DIST_RELEASE}"
echo "=========================================="
