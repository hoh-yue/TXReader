# 拾页 · 中文 TXT 阅读器

一个手机优先、无需后端、可离线使用的渐进式 Web 应用（PWA）。

## 功能

- 导入 UTF-8 或 GB18030/GBK 编码的 TXT 文件
- 自动识别“第一章 / 第1卷 / 序章 / 番外”等章节标题
- 根据屏幕尺寸和字号自动分页，支持点按页面两侧翻页
- 使用 IndexedDB 保存书籍、阅读位置和书架
- 调整字号及米白、纯白、护眼绿、夜间四种阅读背景
- 安装到手机主屏幕后可离线使用

## 发布到 GitHub Pages

1. 把本目录提交并推送到 GitHub 仓库。
2. 在仓库 **Settings → Pages** 中，将 Source 设为 **Deploy from a branch**。
3. 选择发布分支（通常为 `main`）和目录 `/ (root)`，然后保存。
4. 等待 GitHub 提供站点链接。所有资源都使用相对路径，因此项目站点和个人主页站点都可工作。

本地预览时请通过 HTTP 服务访问，不要直接双击 `index.html`，否则 Service Worker 无法启用。例如：

```bash
python -m http.server 8080
```

然后访问 <http://localhost:8080>。
