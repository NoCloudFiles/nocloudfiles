# 发布验收记录

日期：2026-11-17（Asia/Taipei）。

线上地址：https://paper-ready.1986liubo.workers.dev

Worker：`paper-ready`，独立静态资源项目。

## 功能与证据

- `npm test`：9项规则测试通过。
- `npm run test:e2e`：本地生产构建20项通过，覆盖Chromium和WebKit iPhone 13仿真，各10项。
- `npm run test:e2e -- --config playwright.live.config.js`：对公开Cloudflare地址20项全部通过（1.3分钟）。覆盖实际PDF解析、页数/方向/字节上限、HEIC、EXIF旋转、损坏文件恢复、超大尺寸拒绝、裁边、取消后重试、手机布局、无文档上传请求及部署响应头。
- 真实Chrome中打开线上地址，加载三页示例、生成729.8KB PDF，内嵌阅读器成功展示三页及示例文字。
- 本地下载产物另用Poppler独立解析：3页，911071字节，PDF 1.7，首张A4横向；渲染第二页检查文字完整。与Chrome示例操作不同，因此字节数不同。
- 公开地址返回HTTP 200，具备CSP、nosniff、frame限制、权限限制和no-referrer响应头。
- Vite升级到8.3.8后，安装审计报告0项已知漏洞；这不等同于不存在未知漏洞。

初次功能发布版本：`eca2358d-7841-4c61-a794-3c78d6fdb11b`。上述线上全套测试针对该版本。随后仅补充公开源码包中的线上测试配置和README，不改变应用JS、CSS或响应头。

最终版本：`93b032b7-875b-4f4c-bfef-6755599c4d97`。Wrangler确认只更新`source.zip`和重新打包的`heic-to-source.tgz`两项资源。

## 边界

这些结果证明所测流程可工作，不证明已有真实用户受益。未做用户访谈、没有真实申请提交成功的数据，也没有获客或收入结论。WebKit设备仿真不等于实机iPhone验收。

PNG/JPEG的尺寸可在解码前检查；HEIC/WebP的像素检查在解码后进行，不能保证低内存设备处理所有上限内文件。HEIC只导出静态主图。图片型PDF不提供OCR；清晰度必须由使用者检查。

未购买域名、广告或付费服务；已有Cloudflare账户政策/配额及本轮模型调用成本另计。

下一步效果验证：用三个独立、真实但不收集原材料的任务，观察用户能否自行完成、目标网站是否接受文件、文字是否清楚、是否仍需帮助。三个任务仅作为初步人工验收，不作为统计性需求证明。

## 2026-11-21：英文入口、可选 GA4 与事件验收

发布版本：`cb51a10d-5b8b-4635-ac89-e3cb330a80cb`。

- `/` 为英文，`/zh/` 为中文；两种说明页、canonical/hreflang、robots 和 sitemap 已发布。未购买域名、未提交 GSC，未证明搜索收录。
- 独立 GA4：property `565307803`，stream `16385255213`，measurement `G-94L2V73P1G`。增强型衡量已关闭。后台确认四个事件级维度：input_source、interface_language、error_code、feedback_result。
- 同意前没有 Google 统计请求；拒绝、撤回或拦截脚本不影响工具。照片、文件名、材料内容、自由文字反馈不进入自定义事件。只有有限分类、来源和语言。照片处理仍在浏览器内。
- 最终代码：16 项 Node 测试、28 项本地生产构建浏览器测试全部通过。取消测试固定在一次真实编码完成前等待，再点击取消，避免快速设备与按钮消失竞争。
- 首次完整线上回归：27/28 通过，唯一失败为下载 5 MB 开源分发包超过 45 秒；响应已为 200，并非功能断言失败。公开源码下载测试等待上限改为 120 秒，再对最终版本复验新增体验/统计场景及文档，10/10 通过（1.3 分钟）。

### 真实 Google 脚本发现的问题及修复

仅 mock dataLayer 不足以证明真实 GA 行为。首次线上请求探测发现，后置的旧式 config 没有落实 send_page_view=false 和 URL 清理，出现重复浏览与测试查询参数。`validation/2026-11-21/pre-fix-probe.json` 保留反例（仅合成测试 URL，无私人材料）。

修复为初始化前用全局 `set` 配置，事件显式标记 debug。Google 当前文档说明 config 已弃用，推荐 set 设置页面参数：[Google tag API reference](https://developers.google.com/tag-platform/gtagjs/reference)。修复加了回归测试，并使用真实 Google 脚本核对实际网络请求；没有停留在 mock 队列检查。

- `wire-check.json`：本地生产构建 + 真实 Google 脚本，collect 被测试拦截，**不是 Google 收件证明**。
- `live-probe.json`：最终公开版本，真实 collect 返回 204；一次 page_view，tool_start/photos_added/generate_start/pdf_ready/download_click 各一次。来源 sample、语言 en，page_location 不含查询或片段，debug_mode=true。无页面错误，同意前第三方统计请求为 0。脚本可复跑：`node validation/2026-11-21/live-probe.mjs`。
- 原生 Chrome：允许统计→内置示例→生成→点击下载。生成 3 页、637.8 KB、上限 1 MB。在保存对话框取消，故只证明下载点击；自动化另有实际文件保存及 PDF 解析验证。
- **GA 后台收件已确认**：Paper Ready 属性实时报告显示 generate_start、pdf_ready、download_click 各 1 次；展开 pdf_ready → input_source 显示 sample，计数 1。基础浏览同样可见。这些全是验收流量，不是真实用户收益。
- DebugView 未作为验收依据；没有启用永久排除过滤器。分析真实使用时排除 11 月 21 日 QA 与 sample，不能假定 debug 事件已从普通报表排除。

英文桌面截图和合成示例 PDF 在 `validation/2026-11-21/`。发布源码包包含本次应用和测试；本节验收记录是在发布后写入本地仓库的。

后续观察：以同意统计的 file 来源会话为群体，分别看开始生成、生成达标和下载点击；mixed 单独分析。结合负向反馈分类定位问题。不要将任何阶段等同于用户上传成功，也不要将拒绝统计的人当成放弃使用。真实用户成功数仍未知。
