import config from './playwright.config.js';
export default {...config,use:{...config.use,baseURL:'https://nocloudfiles.com'},webServer:undefined};
