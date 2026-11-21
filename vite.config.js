import {defineConfig} from 'vite';
export default defineConfig({build:{rollupOptions:{input:{main:'index.html',zh:'zh/index.html',pdf:'photos-to-pdf/index.html',zhPdf:'zh/photos-to-pdf/index.html',csv:'csv-check/index.html',zhCsv:'zh/csv-check/index.html'}}}});
