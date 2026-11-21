import {defineConfig} from 'vite';
export default defineConfig({build:{rollupOptions:{input:{privacy:'photo-privacy/index.html',zhPrivacy:'zh/photo-privacy/index.html',main:'index.html',zh:'zh/index.html',pdf:'photos-to-pdf/index.html',zhPdf:'zh/photos-to-pdf/index.html',csv:'csv-check/index.html',zhCsv:'zh/csv-check/index.html'}}}});
