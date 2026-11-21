# NoCloudFiles direction review — 2026-11-21

Decision: proceed with a browser-local toolbox at nocloudfiles.com. Start with the existing photo-to-PDF tool and CSV structure checking/normalization. English default and Chinese alternative. No account, document database, paid API, advertising or payments. This is a usefulness experiment, not a validated business forecast.

## What the evidence supports

- [Shopify's official import guide](https://help.shopify.com/en/manual/products/import-export/import-products) documents CSV encoding, headers and quoting constraints. The problem exists; a generic CSV checker cannot validate every platform's business rules.
- [IRCC's official instructions](https://www.ircc.canada.ca/english/helpcentre/answer.asp?qnum=1523&top=) require saving/uploading barcode forms electronically rather than printing them. A blanket PDF rasterization/flattening fix can damage required functionality.
- [US State Department scanning requirements](https://travel.state.gov/content/travel/en/us-visas/immigrate/the-immigrant-visa-process/step-8-scan-collected-documents.html) illustrate real file-size and PDF restrictions. Do not reuse one service's limit for another, or equate byte-size compliance with successful submission.
- [Apple Preview documentation](https://support.apple.com/en-tm/guide/preview/prvw11580/mac) distinguishes actual redaction from drawing shapes. A black rectangle is unsafe, but the claim that Preview itself cannot redact is incorrect.
- [MDN connect-src documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src) describes destination restrictions. A whitelist allowing GA cannot prove that content is never transmitted. We need consent gating, bounded payload construction, request inspection and dependency review.
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies) warn against scaled content created without user value. Create a landing page only when it delivers a distinct supported task, not merely a platform-name substitution.

## Claims rejected or unproven

Competitor existence does not establish high conversion, profitability or our ability to acquire users. Carbon's revenue/eCPM figures and fixed search sandbox timeline have no adequate evidence here. Privacy demand is plausible, not universal. A shared domain simplifies operation but does not guarantee that every page ranks after one backlink. A static site still needs dependency and requirements reviews.

Do not promise “100% unrecoverable” PDF redaction based on one parser or self-check. PDF history, embedded objects, forms, OCR and hidden content create a substantially larger verification surface. Keep redaction and automatic government-form repair out of the current product. Academic anonymity/font diagnostics can be reconsidered with specific venue/year rules and a representative test corpus; camera-ready and double-blind submission are different stages.

## Current correctness boundary

CSV: strict decoding, explicit legacy encoding selection, quoting/column consistency, conservative delimiter detection, bounded input and worker cancellation. Preserve strings, original zeros, decimals and unedited embedded newlines. Reject malformed/oversized inputs instead of partial exports. Ambiguous dates and scientific notation receive warnings, not guessed repairs. Spreadsheet formulas require an explicit preserve/escape choice. CSV syntax success is not Shopify/Stripe/QuickBooks import success. Pasted/edited textarea content has browser-normalized newlines.

Photo-to-PDF: retain the existing actual-byte-limit check, preview and cancellation. Do not flatten arbitrary existing PDFs or strip signatures.

## Observation and resource allocation

Use the already-paid domain and existing static hosting; no additional paid service or ad experiment is currently needed. Track each tool separately under the former Paper Ready GA property. Exclude sample/mixed/launch QA when interpreting genuine task behavior. User-supplied files or pasted text are still not proof of a real customer task. Compare session cohorts reaching start/check/output/download; do not divide raw event totals. Downloads do not prove acceptance elsewhere.

Revisit after several weeks using GSC impressions/queries if indexing is verified, plus consented task funnel and fixed error categories. No traffic means investigate discovery/indexing; traffic without starts means inspect promise and usability; starts with errors means prioritize the actual failure category. With small counts report numerator/denominator, not a confident conversion forecast. Expand only after evidence identifies another concrete task we can verify. Search Console submission and actual indexing are not established by the current sitemap alone.
