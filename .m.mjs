import { chromium } from '@playwright/test';
const base = process.argv[2];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (const u of ['/csv-check/','/csv-diff/','/interleave-pdf/','/photos-to-pdf/','/photo-privacy/','/schedule-to-calendar/','/vcf-select/']) {
  await p.goto(base + u);
  const r = await p.evaluate(() => [...document.querySelectorAll('main > *, main .intro > *')].filter(e=>e.getBoundingClientRect().width>0).map(e => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}:${Math.round(e.getBoundingClientRect().right)}`));
  console.log(u, r.join('  '));
}
await b.close();
