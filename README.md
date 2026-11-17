# my-tools

macOS 与 Windows 桌面工具箱。主界面把常用功能放在一起：文档处理、磁盘清理、网盘搜索、打字记词。

![主界面](docs/images/home.png)

安装包在 [Releases](https://github.com/jzefan/my-tools/releases/latest)。Windows 使用 `my-tools-windows-x64-setup.exe`，macOS 按芯片选择 `my-tools-macos-arm64.dmg` 或 `my-tools-macos-intel.dmg`。

## 文档处理

处理 PDF、图片和 Word。

- 合并文件：混排 PDF、图片和 Word，调整顺序，按页码范围提取
- 格式转换：PDF 与 Word 互转，PDF 导出图片
- 压缩文档：按阅读、传输或归档需求减小 PDF 体积
- 去除水印：扫描重复文字、图层和批注水印后清除
- macOS 可在访达右键打开文件所在目录；Windows 可在「系统右键集成」生成注册表项

## 磁盘清理

查看占用并清理可回收空间。

- 全部扫描、目录空间分布
- 微信、QQ、系统与应用缓存
- 软件卸载与残留
- Docker 镜像、构建缓存和已停止容器
- 开发者缓存（Xcode、Node、Rust 等）

## 网盘搜索

搜索主流网盘分享链接，去重后收藏、查看历史并复制提取码。

支持百度、阿里、夸克、123、115、迅雷、天翼、UC、移动、蓝奏、PikPak 和光鸭。可改用自己的 PanSou 服务。[配置与验证](docs/netdisk-search.md)

## 打字记词

边打字边记英语单词。

- 今日练习、指法课程
- 单词跟打、默写、听写
- 短文逐句跟打
- 速度、准确率和错键记录留在本机

[使用与验收](docs/typing-game.md)

## 其他模块

主界面还有论文研读、自媒体分发，以及「纸页快扫」小程序和小学数学举一反三。

## 开发

需要 Node.js 20+、pnpm 9+、Rust 1.80+。

```bash
pnpm install
pnpm app          # 桌面端
pnpm dev          # 浏览器预览
```

单独预览：`pnpm dev:docs`、`pnpm dev:cleaner`、`pnpm dev:netdisk`、`pnpm dev:typing`。

推送到 `main` 后，GitHub Actions 会构建 macOS 与 Windows 安装包并发布 Release。Windows 安装与功能验收见 [Windows 验收清单](docs/windows-acceptance.md)。
