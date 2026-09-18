/// <reference types="vite/client" />

/** 由 vite.config.ts 的 define 在构建期替换成 package.json 里的版本号字面量。 */
declare const __APP_VERSION__: string;
