import {defineConfig} from 'vite';
export default defineConfig({
  css: {postcss: {}},
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        zh: 'zh/index.html',
        pdf: 'photos-to-pdf/index.html',
        zhPdf: 'zh/photos-to-pdf/index.html',
        privacy: 'photo-privacy/index.html',
        zhPrivacy: 'zh/photo-privacy/index.html',
        interleave: 'interleave-pdf/index.html',
        zhInterleave: 'zh/interleave-pdf/index.html',
        csv: 'csv-check/index.html',
        zhCsv: 'zh/csv-check/index.html',
        csvDiff: 'csv-diff/index.html',
        zhCsvDiff: 'zh/csv-diff/index.html',
        en0: 'schedule-to-calendar/index.html',
        zh0: 'zh/schedule-to-calendar/index.html',
        en1: 'vcf-select/index.html',
        zh1: 'zh/vcf-select/index.html',
      },
    },
  },
});
