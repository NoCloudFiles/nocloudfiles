# NoCloudFiles

浏览器本地工具站：https://nocloudfiles.com 。英文首页 `/`，中文 `/zh/`。现有工具：`/photos-to-pdf/` 照片转 PDF、`/csv-check/` CSV 检查清理；中文工具有 `/zh/` 前缀。文件及粘贴内容只在浏览器处理。方向和证据见 [DIRECTION-REVIEW.md](DIRECTION-REVIEW.md)。界面规范（颜色令牌、字体、组件、禁用做法）见 [DESIGN.md](DESIGN.md)，新增工具页前先读；`tests/design.test.js` 与 `tests/browser/design.spec.js` 自动检查这些约束。

CSV 限制：2 MB、20,000 条记录（含首行）、200 列。严格解码、分隔符识别、引号/列数检查、公式显式选择；导出 UTF-8 BOM、逗号分隔 CSV。保留字符串，不恢复丢失的前导零或精度，不猜日期，不保证平台导入。上传文件的原始换行保留至用户编辑文本框；编辑后以文本框显示内容为准。以下照片工具研究最初于 2026-11-16 完成。

## 问题依据和选择

- [Handshake 官方上传说明](https://support.joinhandshake.com/hc/en-us/articles/218692648-How-to-Upload-a-New-Document)（2026-10-23更新）要求材料不超过1MB，推荐PDF，说明超限时会直接报错。这证明约束真实，不证明市场规模或我们已经帮助了用户。
- [William & Mary 大学的图片合并PDF指引](https://www.wm.edu/as/facultyresources/dept-prog-administration/additional-resources/how_to_combine_pictures_as_pdf_files.pdf)提供Windows多步操作说明，表明学校会专门解释这个任务。
- [Reddit的PDF合并讨论](https://www.reddit.com/r/software/comments/104ivfz)搜索可见用户为申请使用合并工具，并关注私人材料是否被上传。正文请求超时，因此仅作弱线索，不计为完成用户访谈。
- [MiruKit](https://mirukit.com/en/guides/scan-documents-to-pdf/)及其他免费工具已提供类似能力。本项目不主张独创或竞品空白；用户允许不赚钱，选择依据是明确任务、可验证输出和低运营负担。

## 用户任务与范围

选择JPG/PNG/WebP/HEIC照片 → 排序、旋转、可选裁边 → 选择上传上限 → 生成并预览 → 下载PDF。每张图一页，完整等比居中，不默认裁掉内容。HEIC只取静态主图，不导出Live Photo视频。

当前输入是照片，不处理已有PDF、Word、签名表单。输出是图片型PDF，不提供OCR或可编辑文本；不能替代要求可检索文本或指定原始表单的材料。只验证字节限制，不保证申请获批或任何网站一定接受。

限制：最多20张、单文件20MB、总输入80MB、单图最多3600万像素。限制以十进制MB计算。读取失败不悄悄省略页面。页面修改后立即撤销旧下载结果；生成时锁定编辑、可取消。没有账号、支付、广告或文档上传接口；仅在用户同意后启用可选 GA4 统计。

## 实现与完整性

静态Vite网页，pdf-lib生成PDF，heic-to在本地解码HEIC。每次只解码一张图；逐档降低分辨率与JPEG质量，并检查最终完整PDF字节数。最低档仍超限时明确失败，不无限降低清晰度。输出不复制原图EXIF/GPS或原文件名元数据；用户必须在下载前自行检查文字清晰度。

文档处理代码和依赖由同一站点加载。可选 GA4 会加载 Google 脚本并发送受限使用事件；部署使用 CSP 限定允许的来源。Cloudflare仍处理正常页面访问的网络元信息，不能据此宣称访问完全匿名。

## 验证与运行

```sh
npm ci --ignore-scripts
npm test
npm run test:e2e
npm run build
wrangler deploy
```

测试覆盖纯规则以及真实浏览器的示例、下载产物页数/方向/字节数、文件错误恢复、裁边、手机布局和无上传请求。测试用合成材料，不含私人文件。浏览器路径可在Playwright配置中调整。当前线上地址用 `npm run test:e2e -- --config playwright.live.config.js` 复验；其他部署可用 `TEST_URL=<部署地址> npm run test:e2e`。

## 成本与真实用户验证

没有按次模型调用、存储或数据库，处理成本由用户设备承担；网页静态托管仍受Cloudflare账户的实际配额和政策约束。域名由用户注册；当前不投广告、不收款。本轮模型/研发调用费用未知，不能声称总投入为零。

上线与自动测试只证明可用，不证明真实帮助成立。试用时记录：用户原来要完成什么、是否独立完成、实际文件是否满足上传约束、是否清晰、是否仍需人工帮助。不要提交或收集原材料。首页提供可复制的无文件反馈模板，用户自行决定是否分享。三个独立任务是初始人工验收目标，不是统计显著性；当前真实用户成功数未知。

## 发布

已发布：https://nocloudfiles.com

原照片站 https://paper-ready.1986liubo.workers.dev 保留，未覆盖。

独立 Cloudflare Worker `nocloudfiles` 静态资源项目，apex 与 www 绑定同一构建，不覆盖 MSP 或旧 paper-ready Worker。本地仓库的发布记录和最终验证结果见 `ACCEPTANCE.md`；公开源码包包含应用、测试及部署配置。

## Languages and measurement (2026-11-21)

English is the default at `/`; simplified Chinese is at `/zh/`. Each has a canonical URL and reciprocal language links. `robots.txt` and a six-route sitemap are included. This does not establish Google indexing or search demand; no platform-specific landing-page matrix was created.

GA4 property `565307803`, stream `16385255213`, measurement ID `G-94L2V73P1G`. Public configuration is in `public/analytics-config.json`; it is not a credential. Enhanced measurement is disabled in GA. Event-scoped dimensions: `input_source`, `interface_language`, `error_code`, `feedback_result`; new `tool_id` identifies `home`, `photos_to_pdf`, `csv_check`. GA admin configuration and receipt status are recorded in ACCEPTANCE.md. MSP uses G-1C1FEY4WBB, a different property.

No GA script or event is sent until explicit consent. Consent is the only localStorage value introduced. Declining or blocking analytics never blocks processing. Settings allow withdrawal; subsequent custom events stop and host GA cookies are expired. Google and Cloudflare still process normal connection information; do not describe analytics as anonymous or zero-risk.

Navigation: `tool_select` fires when a task row on the home index or a tool page's "Other tools" list is clicked; `tool_id` is the page, `target_tool` the chosen tool (bounded tool ids only). Register `target_tool` as an event-scoped custom dimension in GA before reporting on it. Measure the index with sessions containing `tool_select` from `tool_id=home` divided by home page-view sessions; the event is pushed just before navigation, so a few may be lost. Events: `tool_start` (first photos added to an empty session), `photos_added`, `generate_start`, `pdf_ready` (actual output fits the byte limit), `generate_error`, `generate_cancel`, `download_click` (once per generated output), `feedback_response` (one fixed category per output). CSV events: `tool_start` and `csv_check_start` per explicit check attempt, `csv_checked` for a structurally valid result (formula choice may still block export), `csv_ready` when an export is available, `download_click` once per output, and bounded error/cancel events. CSV `input_source=file` covers selected files and pasted user text, `sample` is the built-in example, `mixed` is an edited example. Page views and task events carry bounded `tool_id`. All task events carry `input_source=sample|file|mixed` and `interface_language=en|zh`. No filenames, material contents, raw exception messages or free-text feedback are sent. Page location excludes query/fragment; referrer retains origin only. The source classification describes how input was selected, not proof that a file is a real customer task.

Observation: inspect weekly cohorts with `input_source=file`, keep `mixed` separate and exclude `sample`. Compare sessions that reached `generate_start` with sessions that reached `pdf_ready` and `download_click`; do not divide raw event totals or sum repeated attempts as people. Count fixed negative feedback categories and errors to guide fixes. Consent can occur mid-task, no pre-consent events are replayed, and blockers suppress events, so the measured cohort is incomplete and selection-biased. Download clicks do not prove a file was saved or accepted by another website. Actual usefulness remains unproven without real task evidence.

Verification uses synthetic samples and `?analytics_debug=1` for debug tagging. There is no active exclusion filter: debug tagging alone does not guarantee test traffic is absent from ordinary reports. Exclude November 21 launch QA and sample runs when assessing real usage. Automated consent tests mock the GA script/config; their passing results are not server receipt evidence. See `ACCEPTANCE.md` for the separate live receipt check.

## 手机照片隐私检查

英文入口 `/photo-privacy/`，中文入口 `/zh/photo-privacy/`。原件在本地解析；JPEG、HEIC/HEIF（支持的 HEVC 静态主图）最多 32 MB、5000 万像素。预览识别出的原始字段，分享副本按用户选择重新写入 XMP，默认无可选字段。厂商数据和缩略图不复制。部分专用字段只能查看。动态照片输出单张静态 JPEG；配对视频不处理。HDR 副本使用标准亮度，原件保留。画面中可见的地址或人脸仍在画面内。

生产漏斗在 NoCloudFiles GA4 中按 `tool_id=photo_privacy`、语言及观察窗口筛选。依次记录选文件、解析及预览成功、生成且重读副本、点击下载（tool_start / photo_inspected / photo_ready / download_click）。用触发对应阶段的会话数除以开始会话数，另列 input_rejected 和 generation_failed。仅覆盖同意统计的使用者，排除验收时段。文件名、原始字段、选择和替换值都不传入事件。

## 排班转日历与通讯录筛选

`/schedule-to-calendar/` 和 `/vcf-select/` 均有 `/zh/` 中文入口。排班表支持粘贴 Excel 或本地 CSV/TSV。首行是表头，一行一个事件；日期与时间分列，或把时间段放在一列。日期有歧义时手选顺序，核对跨日预览后导出浮动本地时间 ICS 和 Google 英文表头 CSV。建议在新建的独立日历试导，核对事件数和时区。Google 官方支持电脑网页导入。手机系统直接打开多事件文件的表现取决于设备和应用。

通讯录在浏览器 Worker 中读取，支持 30 MiB 内的 vCard 2.1/3.0/4.0。选择联系人及其具体电话、邮箱等字段后，重新构造 UTF-8 vCard 3.0；姓名总是包含，头像和扩展字段会丢弃。最终纯文本预览与下载来自相同字符串。支持 2.1 的 Quoted-Printable 软折行与声明的字符集。无法完整解析时显示错误。

统计沿用 NoCloudFiles 的可选 GA。按工具、界面语言、来源与时间窗口，报告开始任务、生成下载文件、点击下载的会话数与各阶段占开始会话的比例。tool_start 在解析请求时触发，schedule_ready 和 contacts_ready 只在生成成功时触发。排除 sample、mixed 和验收时段。统计不含行、字段、日期、姓名、文件名及搜索词。
