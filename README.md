# NoCloudFiles

浏览器本地工具站：https://nocloudfiles.com 。英文默认首页 `/`，中文首页 `/zh/`。提供 7 个在当前浏览器本地处理文件与文字的免费工具，无账号、无广告、无支付、无文件上传接口。

方向和证据见 [DIRECTION-REVIEW.md](DIRECTION-REVIEW.md)。界面规范（颜色令牌、字体、组件、禁用做法）见 [DESIGN.md](DESIGN.md)，新增工具页前先读；`tests/design.test.js` 与 `tests/browser/design.spec.js` 自动检查这些约束。

## 全部 7 个工具与 16 条路由

| 工具 | `tool_id` | 英文路由 | 中文路由 | 核心能力与主要边界 |
|---|---|---|---|---|
| 首页任务索引 | `home` | `/` | `/zh/` | 按手头材料分组的任务索引，不堆砌工具卡片 |
| Photos to PDF / 照片转 PDF | `photos_to_pdf` | `/photos-to-pdf/` | `/zh/photos-to-pdf/` | JPG/PNG/WebP/HEIC 转单页 A4 PDF 并按实际字节核对大小上限（最多 20 张、单张 20 MB、总计 80 MB、3600 万像素）。不处理已有 PDF/Word/签名表单，无 OCR，不保留实况视频 |
| Photo privacy check / 照片隐私检查 | `photo_privacy` | `/photo-privacy/` | `/zh/photo-privacy/` | 本地解析 JPEG/HEIC（32 MB、5000 万像素）EXIF/XMP/GPS，默认清空全部元数据/缩略图/厂商数据并按需回写 XMP 后重读核对。输出静态 JPEG；不遮挡画面内容，不处理动态照片视频 |
| Mix front & back scans / 双面扫描正反合并 | `interleave_pdf` | `/interleave-pdf/` | `/zh/interleave-pdf/` | 将单面扫描仪扫出的正面（奇数页）与背面（偶数页）两份 PDF 无损穿插合并为阅读顺序，支持背面倒序/正序、背面旋转 180°、页数核对与尾页追加（单文件 50 MB，总计 80 MB、500 页）。不解密加密 PDF，不做 OCR/纠偏/裁边/去空白页 |
| CSV check / CSV 检查 | `csv_check` | `/csv-check/` | `/zh/csv-check/` | 严格解码（UTF-8/UTF-16 BOM 及显式传统编码）、引号与列数校验、分隔符识别、公式显式选择、导出带 BOM 的 UTF-8 CSV（2 MB、20,000 记录、200 列）。不修复损坏引号，不猜日期，不校验平台业务规则 |
| Compare two CSVs / 表格新旧对比 | `csv_diff` | `/csv-diff/` | `/zh/csv-diff/` | 按 1–2 个唯一主键列在 Worker 中对比新旧两份 CSV/TSV（单表 2 MB、20,000 记录、200 列），标记误清空单元格、删列/增列、增删改行，支持可选数值列精确十进制汇总与整列符号反转检测，导出带 BOM 的差异 CSV。空/重复主键即停不猜测，不将非十进制文本强转为 0 |
| Schedule to calendar / 排班表转日历 | `schedule_to_calendar` | `/schedule-to-calendar/` | `/zh/schedule-to-calendar/` | 粘贴 Excel 或打开 CSV/TSV（2 MB），显式确认有歧义日期顺序、核对跨夜班次后导出浮动本地时间 ICS 与 Google 日历 CSV |
| Select contacts / 挑选联系人 | `vcf_select` | `/vcf-select/` | `/zh/vcf-select/` | Worker 读取 30 MiB 内 vCard 2.1/3.0/4.0（含 2.1 Quoted-Printable 软折行与声明字符集），挑选联系人与字段后重构 UTF-8 vCard 3.0，预览与下载同源，丢弃头像与私有扩展字段 |

所有页面均提供规范 `<link rel="canonical">` 与中英文互指 `hreflang`。`public/robots.txt` 与 16 条路由的 `public/sitemap.xml` 由测试与 `vite.config.js` 保持一一对应。

## 架构与完整性

- 静态多页 Vite 构建（16 个 HTML 入口，配置在 `vite.config.js`，含 `css: { postcss: {} }`），输出部署到独立 Cloudflare Worker 静态资源项目 `nocloudfiles`（apex 与 www 绑定同一构建，保留旧 `paper-ready.1986liubo.workers.dev` 不覆盖）。
- 依赖均为同源打包或同站按需加载：`pdf-lib`（照片转 PDF 与双面扫描无损合并）、`heic-to`（本地 HEIC 解码，LGPL-3.0-or-later，分发包随站提供 `/heic-to-source.tgz`）、`papaparse`（CSV 解析，运行在 Web Worker 中）、`exifreader`（照片元数据读取）。
- 所有工具遵循 [DESIGN.md](DESIGN.md)：样式从 `<head>` 加载（无 JS 注入 CSS）、无内联样式与外部字体（匹配 CSP `style-src 'self'` / `font-src 'self'`）、自定义 `.dropzone` 替代原生文件控件。
- 公开源码与依赖声明由 `scripts/package-source.py` 生成到 `public/source.zip`、`public/heic-to-source.tgz` 和 `public/third-party-notices.txt`。

## 验证与运行

```sh
npm ci --ignore-scripts
npm test
npm run test:e2e
npm run build
wrangler deploy
```

单元测试（`tests/*.test.js`）覆盖全部纯逻辑、设计系统合同、sitemap/打包一致性与统计隐私边界。Playwright 浏览器测试（`tests/browser/*.spec.js`）使用合成数据覆盖示例流、下载产物验证、错误恢复、手机宽度无横向滚动、拖放与无上传请求。线上复验可使用 `npm run test:e2e -- --config playwright.live.config.js` 或 `TEST_URL=<部署地址> npm run test:e2e`。

## 成本与真实用户验证

无按次模型调用、云存储或数据库，处理成本由用户设备承担；静态托管仍受 Cloudflare 账户配额与政策约束。域名由用户注册；当前不投广告、不收款。上线与自动测试只证明程序可用，不证明真实帮助成立。

## 统计与隐私设计（GA4）

GA4 属性 `565307803`、数据流 `16385255213`、衡量 ID `G-94L2V73P1G`（公开配置位于 `public/analytics-config.json`，非密钥；独立于其他项目属性）。GA 后台关闭增强型衡量与广告信号。

### 同意与最小化边界

- **显式同意前零加载**：未点击「Allow analytics / 允许使用统计」前不加载 Google 脚本、不发送事件。同意状态是唯一写入的 `localStorage` 键。拒绝或拦截脚本绝不影响任何工具正常使用。
- **随时可撤回**：页脚「Analytics settings / 统计设置」支持撤回授权，停止后续自定义事件并清除本站 GA Cookie。
- **非匿名声明**：Cloudflare 与（同意后的）Google 仍会处理正常网络连接信息，因此不宣称访问或统计“完全匿名”。
- **严格白名单参数**：`src/analytics.js` 仅放行固定枚举的事件与参数，剥离所有文件名、文档/表格内容、单元格值、联系人、日期、原始异常文本及自由文本反馈。`page_location` 剥离全部 URL 查询参数与锚点，仅在匹配预设白名单时保留已知来源平台标识（`utm_source`，如 `chatgpt.com`，以及匹配的受限 `utm_medium` 枚举值）；`page_referrer` 仅保留 origin。

### 允许的事件与参数表

**事件白名单（`events`）：**

| 事件名 | 所属工具 | 触发时机 |
|---|---|---|
| `page_view` | 全部 | 同意后页面访问（每页一次，带 `tool_id`、`interface_language`） |
| `tool_select` | 全部 | 点击首页任务索引或工具页「其他工具」行（带 `tool_id`、`target_tool`） |
| `tool_start` | 全部工具 | 当前输入来源首次发起真实任务（添加照片、首次检查/对比、解析排班/通讯录、加载扫描件等） |
| `photos_added` | `photos_to_pdf` | 照片列表新增图片 |
| `generate_start` | `photos_to_pdf` | 点击生成 PDF |
| `pdf_ready` | `photos_to_pdf` | 实际输出 PDF 满足字节上限 |
| `photo_inspected` | `photo_privacy` | 原图元数据解析与预览成功 |
| `photo_ready` | `photo_privacy` | 分享副本生成并重读核对成功 |
| `interleave_ready` | `interleave_pdf` | 正反两份扫描 PDF 穿插合并成功 |
| `csv_check_start` | `csv_check` | 点击检查 CSV |
| `csv_checked` | `csv_check` | 结构校验通过（公式选择可能仍阻止导出） |
| `csv_ready` | `csv_check` | 清理后的 CSV 可供下载 |
| `csv_diff_ready` | `csv_diff` | 表格新旧对比完成且差异报告 CSV 可供下载 |
| `schedule_ready` | `schedule_to_calendar` | 排班事件预览与 ICS/CSV 导出成功 |
| `contacts_ready` | `vcf_select` | 所选联系人 vCard 3.0 生成成功 |
| `download_click` | 全部工具 | 每次生成产物首次点击下载（不证明保存或外部网站接受） |
| `generate_error` | 全部工具 | 受限错误分类触发（`error_code`） |
| `generate_cancel` | `photos_to_pdf` / `csv_check` / `csv_diff` | 用户取消处理 |
| `feedback_response` | `photos_to_pdf` | 用户点击固定分类反馈按钮（`feedback_result`） |

**允许的参数枚举与 GA4 后台配置状态（`565307803`）：**

- **已在 GA4 Admin 确认注册的事件级自定义维度（5 项，见 `ACCEPTANCE.md`）**：
  - `tool_id`: `home` | `photos_to_pdf` | `photo_privacy` | `interleave_pdf` | `csv_check` | `csv_diff` | `schedule_to_calendar` | `vcf_select`
  - `input_source`: `sample` | `file` | `mixed`
  - `interface_language`: `en` | `zh`
  - `error_code`: `input_rejected` | `decode_failed` | `too_large` | `generation_failed`
  - `feedback_result`: `helped` | `unclear` | `too_large` | `not_accepted` | `other`
- **待部署后在 GA4 Admin 完成配置与实测收件（尚未在后台验证）**：
  - `target_tool`（`tool_select` 事件发出，同 `tool_id` 但不含 `home`）：需在 GA4 Admin → **Custom definitions** 注册为事件级自定义维度，否则标准报表无法按目标工具拆分。
  - `interleave_ready` 与 `csv_diff_ready`：需在部署到 `nocloudfiles.com` 后通过 Realtime/DebugView 实测收件，并在 GA4 Admin → **Events** 中按需标记为关键事件（Key events）。

### 观测与报告口径

- 按观察窗口、`tool_id`、`interface_language` 与 `input_source` 分组报告；真实任务分析仅看 `input_source=file`，`mixed` 单独列出，排除 `sample` 及上线验收时段。
- 以会话（session）为口径计算漏斗转化（如到达 `*_ready` 与 `download_click` 的会话数除以到达 `tool_start` 的会话数），同时给出原始分子/分母，不用原始事件总数相除，也不在极小样本下宣称统计显著性。
- `?analytics_debug=1` 会附带 `debug_mode=true`，但在 GA4 未启用排除过滤器前不保证自动从常规报表中剔除；自动化测试对 GA 脚本进行了 mock，不等同于 GA 后台实际收到数据（线上实测状态见 `ACCEPTANCE.md`）。
