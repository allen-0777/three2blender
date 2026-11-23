// Supplement the existing capture-scene script with transition/touch verification.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
const output = new URL('./', import.meta.url);
const results = [];
const errors = [];
for (const mobile of [false,true]) {
  const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
  const page = await context.newPage();
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=> {if(m.type()==='error') errors.push(m.text());});
  await page.goto(`http://127.0.0.1:3100/?scene=1&quality=${mobile?'low':'high'}`);
  await page.waitForFunction(()=>window.__scenes);
  if (!mobile) await page.waitForFunction(()=>window.__scenes.two, null, {timeout:90000});
  else await page.waitForTimeout(3500);
  for (const target of [2,1,2]) {
    await page.evaluate(target=>{
      window.polishSamples=[];
      const start=performance.now();
      function record(){
        window.polishSamples.push({ms:Math.round(performance.now()-start),opacity:Number(getComputedStyle(document.querySelector('.scene-fade')).opacity),scene:window.__scenes.current});
        if(window.__scenes.busy || performance.now()-start<100) requestAnimationFrame(record);
      }
      window.__scenes.switchTo(target);
      requestAnimationFrame(record);
    },target);
    if (!mobile && target===2 && results.length===0) {
      for(let i=0;i<9;i++) {
        await page.screenshot({path:new URL(`transition-${String(i).padStart(2,'0')}.png`,output).pathname});
        await page.waitForTimeout(140);
      }
    }
    await page.waitForFunction(()=>!window.__scenes.busy,null,{timeout:90000});
    const samples=await page.evaluate(()=>window.polishSamples);
    assert(samples.some(s=>s.opacity>0.05&&s.opacity<0.95),'Missing gradual transition');
    assert.equal(await page.evaluate(()=>window.__scenes.current),target,JSON.stringify(errors));
    results.push({mobile,target,duration:samples.at(-1).ms,samples});
  }
  for (const time of ['dusk','night','afternoon']) {
    const button=page.locator(`[data-time="${time}"]`);
    const box=await button.boundingBox();
    assert(box && box.height>=44 && box.width>=44 && box.y>=0 && box.y+box.height<=(mobile?844:900));
    assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}),'Button occluded');
    await button.click();
    await page.waitForFunction(()=>!window.__scenes.busy);
    assert.equal(await page.evaluate(()=>window.__scenes.time),time);
    results.push({mobile,time,box});
  }
  await context.close();
}
await browser.close();
writeFileSync(new URL('transition-results.json',output),JSON.stringify({errors,results},null,2));
assert.deepEqual(errors,[]);
console.log('PASS: desktop/mobile round trips, gradual opacity, all time buttons visible and clickable; no browser errors');
