# my-tools Windows 打包脚本 (PowerShell)
# 生成 NSIS 安装程序 (.exe)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistRelease = Join-Path $ProjectRoot "dist-release\windows"

Write-Host "=========================================="
Write-Host "  my-tools Windows 打包程序"
Write-Host "=========================================="

Set-Location $ProjectRoot

# 1. 编译前端
Write-Host ">>> [1/3] 编译前端静态资源..."
pnpm build

# 2. 构建 Windows NSIS 安装包
Write-Host ">>> [2/3] 构建 NSIS 安装程序..."
pnpm tauri build --bundles nsis

# 3. 归档产物
if (-not (Test-Path $DistRelease)) {
    New-Item -ItemType Directory -Path $DistRelease -Force | Out-Null
}

$ExeFiles = Get-ChildItem -Path "$ProjectRoot\src-tauri\target\release\bundle\nsis\*.exe" -ErrorAction SilentlyContinue

if ($ExeFiles.Count -gt 0) {
    foreach ($file in $ExeFiles) {
        Copy-Item -Path $file.FullName -Destination $DistRelease -Force
        $alias = Join-Path $DistRelease "my-tools-windows-x64-setup.exe"
        Copy-Item -Path $file.FullName -Destination $alias -Force
        Write-Host "✓ [完成] Windows 安装包已输出至: $($file.FullName)"
        Write-Host "  别名文件: $alias"
    }
} else {
    Write-Error "❌ 未找到生成的 NSIS 安装文件。"
}

Write-Host ""
Write-Host "=========================================="
Write-Host ">>> [3/3] 打包产物目录: $DistRelease"
Get-ChildItem -Path $DistRelease
Write-Host "=========================================="
