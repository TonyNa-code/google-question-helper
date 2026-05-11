# 隐私说明

这个扩展是本地浏览器插件，没有自己的服务器。

## 本地保存

- DeepSeek API Key 保存在 Chrome 扩展的本地存储中。
- 题目输入内容和最近一次导入的选中文字可能临时保存在 Chrome 扩展的本地存储中。

## 网络请求

插件会在以下情况发起网络请求：

- 点击讲解按钮时，把题目文字发送到 DeepSeek API：`https://api.deepseek.com/`
- 第一次使用 OCR 时，Tesseract.js 可能下载中英文 OCR 语言包：`https://tessdata.projectnaptha.com/`

## 不会做的事

- 不会把 API Key 上传到作者服务器。
- 不会在后台持续录屏。
- 不会自动读取整个电脑文件。
- 不会提供隐藏监控、规避检测或绕过平台规则的功能。
