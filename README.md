# 纸张就绪 / Paper Ready

把手机拍的多页材料整理为一份符合上传大小限制的 PDF。免费、无需账户，照片仅在浏览器处理。研究日期 2026-11-16。

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

没有按次模型调用、存储或数据库，处理成本由用户设备承担；网页静态托管仍受Cloudflare账户的实际配额和政策约束。不购买域名、不投广告、不收款。本轮模型/研发调用费用未知，不能声称总投入为零。

上线与自动测试只证明可用，不证明真实帮助成立。试用时记录：用户原来要完成什么、是否独立完成、实际文件是否满足上传约束、是否清晰、是否仍需人工帮助。不要提交或收集原材料。首页提供可复制的无文件反馈模板，用户自行决定是否分享。三个独立任务是初始人工验收目标，不是统计显著性；当前真实用户成功数未知。

## 发布

已发布：https://paper-ready.1986liubo.workers.dev

独立Cloudflare Worker静态资源项目，不覆盖MSP站点。本地仓库的发布记录和最终验证结果见 `ACCEPTANCE.md`；公开源码包包含应用、测试及部署配置。

## Languages and measurement (2026-11-21)

English is the default at `/`; simplified Chinese is at `/zh/`. Each has a canonical URL and reciprocal language links. `robots.txt` and a two-route sitemap are included. This does not establish Google indexing or search demand; no platform-specific landing-page matrix was created.

GA4 property `565307803`, stream `16385255213`, measurement ID `G-94L2V73P1G`. Public configuration is in `public/analytics-config.json`; it is not a credential. Enhanced measurement is disabled in GA. Event-scoped dimensions: `input_source`, `interface_language`, `error_code`, `feedback_result`.

No GA script or event is sent until explicit consent. Consent is the only localStorage value introduced. Declining or blocking analytics never blocks processing. Settings allow withdrawal; subsequent custom events stop and host GA cookies are expired. Google and Cloudflare still process normal connection information; do not describe analytics as anonymous or zero-risk.

Events: `tool_start` (first photos added to an empty session), `photos_added`, `generate_start`, `pdf_ready` (actual output fits the byte limit), `generate_error`, `generate_cancel`, `download_click` (once per generated output), `feedback_response` (one fixed category per output). All task events carry `input_source=sample|file|mixed` and `interface_language=en|zh`. No filenames, material contents, raw exception messages or free-text feedback are sent. Page location excludes query/fragment; referrer retains origin only. The source classification describes how input was selected, not proof that a file is a real customer task.

Observation: inspect weekly cohorts with `input_source=file`, keep `mixed` separate and exclude `sample`. Compare sessions that reached `generate_start` with sessions that reached `pdf_ready` and `download_click`; do not divide raw event totals or sum repeated attempts as people. Count fixed negative feedback categories and errors to guide fixes. Consent can occur mid-task, no pre-consent events are replayed, and blockers suppress events, so the measured cohort is incomplete and selection-biased. Download clicks do not prove a file was saved or accepted by another website. Actual usefulness remains unproven without real task evidence.

Verification uses synthetic samples and `?analytics_debug=1` for debug tagging. There is no active exclusion filter: debug tagging alone does not guarantee test traffic is absent from ordinary reports. Exclude November 21 launch QA and sample runs when assessing real usage. Automated consent tests mock the GA script/config; their passing results are not server receipt evidence. See `ACCEPTANCE.md` for the separate live receipt check.
