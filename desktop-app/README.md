# 题目助手桌面版

这是和 Chrome 插件版分开的桌面 App 版本。它使用 Electron 构建，目标是 macOS、Windows 和 Linux 都能运行。

## 功能

- 默认小窗启动，可调整大小。
- 小窗默认置顶，方便边看题边使用。
- 支持框选屏幕区域，只 OCR 选中的题目范围。
- 支持整屏识别备用。
- 支持上传图片识别。
- 支持读取剪贴板文字。
- 支持 DeepSeek API 讲解。

## 开发运行

```bash
cd desktop-app
npm install
npm start
```

## 打包

```bash
cd desktop-app
npm run dist:mac
npm run dist:win
npm run dist:linux
```

更推荐用 GitHub Actions 在对应系统上分别打包。仓库里已经提供 `.github/workflows/desktop-app.yml`。

## macOS 权限

第一次使用框选 OCR 时，macOS 可能会要求给 App “屏幕录制”权限。允许后如果截图还是失败，请重启 App 再试。

## 使用边界

这是可见的小窗学习辅助工具，不提供隐藏监控、规避检测或绕过平台规则的功能。
