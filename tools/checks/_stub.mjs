// 各校验脚本共用的 DOM 桩：原型是「一个 <script> 直接跑」的结构，
// 这里把它抽出来执行，再拿到内部函数做断言。
import fs from 'node:fs';

export const mkEl = () => ({
  innerHTML:'', textContent:'', disabled:false, offsetWidth:104, dataset:{}, hidden:false,
  className:'', value:'', style:{ setProperty(){} },
  querySelector:()=>mkEl(), querySelectorAll:()=>[], addEventListener(){},
  setAttribute(){}, getAttribute:()=>null, appendChild(){}, insertAdjacentHTML(){}, remove(){},
  getBoundingClientRect:()=>({left:0,top:0,right:760,bottom:614,width:760,height:614}),
  classList:{ add(){}, remove(){}, toggle(){}, contains:()=>false },
});

export function loadProto(file, expose){
  const body = fs.readFileSync(file,'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  const els = {};
  globalThis.window = { innerWidth:1400, innerHeight:900 };
  globalThis.document = {
    getElementById: id => (els[id] ??= mkEl()), createElement: () => mkEl(),
    body: mkEl(), documentElement: mkEl(),
    querySelector: () => mkEl(), querySelectorAll: () => [],
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#3f8f6a' });
  globalThis.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 0);
  new Function(body + `;globalThis.__X={${expose}};`)();
  return globalThis.__X;
}

export const catalog = () =>
  JSON.parse(fs.readFileSync('src/domain/catalog.bundled.json','utf8'));
// 内嵌的 base64 很长，比对文本前先剥掉，否则截取窗口永远够不到内容
export const strip = h => h.replace(/src="data:[^"]*"/g, 'src=""');

export function reporter(){
  let bad = 0;
  return {
    die(m){ console.error('✗', m); bad++; },
    ok(m){ console.log('✓', m); },
    end(){ process.exit(bad ? 1 : 0); },
  };
}
