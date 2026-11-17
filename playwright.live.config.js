import config from './playwright.config.js';
export default {...config,use:{...config.use,baseURL:'https://paper-ready.1986liubo.workers.dev'},webServer:undefined};
