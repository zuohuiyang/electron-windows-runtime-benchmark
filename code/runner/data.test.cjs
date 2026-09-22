const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateRun, report, inventory, plan } = require('./data.cjs');
const source = path.resolve(__dirname, '../../data/data/final-20260922');
const read = p => JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v));
test('cold-first preserves all samples and balanced rounds; old configs remain warm-first',()=>{
 const cfg={count:20,warmups:5,targets:['A','C'].map(variant=>({id:variant,variant,storage:'SSD',runtime:variant+'/electron.exe'}))};
 const warm=plan(cfg,'C:/test');
 const cold=plan({...cfg,order:'ColdFirst'},'C:/test');
 assert.equal(warm[0].phase,'warmup');assert.equal(cold[0].phase,'cold');
 assert.deepEqual(cold.slice(0,40),warm.filter(s=>s.phase==='cold'));
 assert.deepEqual(cold.slice(40),warm.filter(s=>s.phase!=='cold'));
 assert.throws(()=>plan({...cfg,order:'invalid'},'C:/test'));
});
function experiment(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'electron-runner-test-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'results'));
  const originals=read(path.join(source,'config.json')).samples.slice(0,4);
  const samples=originals.map((v,i)=>({...v,phase:['warmup','warm','cold','cold'][i]}));
  const cfg={electron:'example.exe',user:'example',sid:'example-sid',count:2,warmups:1,samples};
  write(path.join(root,'config.json'),cfg);
  samples.forEach((item,i)=>{
    const prefix=path.join(source,'results',item.id),dest=path.join(root,'results',item.id);
    const raw=read(prefix+'-sample.json'),context=read(prefix+'-context.json');
    context.sid=cfg.sid;context.sample=item;
    if(i===1)context.boot=read(path.join(source,'results',samples[0].id)+'-context.json').boot;
    write(dest+'-sample.json',raw);write(dest+'-context.json',context);
    write(dest+'-result.json',read(prefix+'-result.json'));
  });
  return {root,cfg,samples};
}
test('validates new-user measurements and rejects account, boot and endpoint corruption',t=>{
  const {root,samples}=experiment(t);
  assert.equal(validateRun(root).length,4);
  const p=path.join(root,'results',samples[1].id+'-context.json'),ctx=read(p);
  write(p,{...ctx,sid:'another-user'});assert.throws(()=>validateRun(root),/Account changed/);
  write(p,{...ctx,boot:'2026-01-01T00:00:00Z'});assert.throws(()=>validateRun(root),/multiple boots/);
  write(p,ctx);
  const rawPath=path.join(root,'results',samples[0].id+'-sample.json'),raw=read(rawPath);
  raw.events.find(e=>e.event==='first-video-frame').frame.visibility='hidden';
  write(rawPath,raw);assert.throws(()=>validateRun(root));
});
test('does not emit a complete report for a partial run or incorrect sample count',t=>{
  const {root,samples}=experiment(t);
  assert.throws(()=>report(root));
  fs.unlinkSync(path.join(root,'results',samples[3].id+'-result.json'));
  assert.throws(()=>report(root),/Sampling incomplete/);
  assert(!fs.existsSync(path.join(root,'RESULTS.md')));
});
test('input inventory detects content changes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'electron-hash-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'input');fs.writeFileSync(file,'before');const before=inventory(root);
  fs.writeFileSync(file,'after');assert.notDeepEqual(inventory(root),before);
});
for(const variants of [['A'],['A','C']]) test(`two disks, ${variants.length} versions: complete balanced schedule and grouped results`,t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'electron-matrix-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'results'));
 const cfg={version:2,workflowOnly:variants.length===2,count:20,warmups:5,sid:'test-sid',user:'test',electron:'target.exe',targets:[]};
 for(const disk of ['SSD','HDD'])for(const variant of variants)cfg.targets.push({id:disk+'-'+variant,storage:disk,variant,runtime:disk+'/'+variant+'/electron.exe'});
 cfg.samples=plan(cfg,root);write(path.join(root,'config.json'),cfg);
 assert.equal(cfg.samples.length,variants.length*90);
 for(const target of cfg.targets)for(const phase of ['warmup','warm','cold'])assert.equal(cfg.samples.filter(s=>s.target===target.id&&s.phase===phase).length,phase==='warmup'?5:20);
 for(const phase of ['warm','cold']) {
  const rounds=cfg.samples.filter(s=>s.phase===phase);
  assert.deepEqual(rounds.filter(s=>s.round===1).map(s=>s.target),cfg.targets.map(t=>t.id));
  assert.deepEqual(rounds.filter(s=>s.round===2).map(s=>s.target),cfg.targets.map(t=>t.id).reverse());
 }
 const original=read(path.join(source,'results/cold-001-ssd-A-sample.json'));
 let boot=0;
 for(const item of cfg.samples) {
  const raw=structuredClone(original);raw.variant=item.variant;
  const context={user:cfg.user,sid:cfg.sid,session:1,elevated:false,sample:item,idle:[{cpu:cfg.workflowOnly?100:0},{cpu:cfg.workflowOnly?100:0},{cpu:cfg.workflowOnly?100:0}],
    boot:new Date(Date.UTC(2026,7,1,0,item.phase==='cold'?++boot:0)).toISOString()};
  const dest=path.join(root,'results',item.id);
  write(dest+'-sample.json',raw);write(dest+'-context.json',context);write(dest+'-result.json',{status:'SUCCESS',inputsVerifiedAfter:true});
 }
 report(root);const summary=read(path.join(root,'summary.json'));
 assert.equal(summary.workflowOnly,cfg.workflowOnly);
 assert.equal(summary.stats.length,variants.length*8);assert(summary.stats.every(s=>s.n===20));
 assert.equal(summary.comparisons.length,variants.length===2?8:0);
 const exported=fs.mkdtempSync(path.join(os.tmpdir(),'electron-export-test-'));
 t.after(()=>fs.rmSync(exported,{recursive:true,force:true}));
 fs.cpSync(root,exported,{recursive:true});
 assert.doesNotThrow(()=>report(exported),'Archived results must be portable');
 cfg.samples.reverse();write(path.join(root,'config.json'),cfg);assert.throws(()=>validateRun(root),/Sampling order/);
});
