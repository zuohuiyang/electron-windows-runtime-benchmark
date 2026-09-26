const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {validateRun}=require('../runner/data.cjs');
const {quantile}=require('./analyze.cjs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function analyzeRun(directory){
 const cfg=read(path.join(directory,'config.json')),state=read(path.join(directory,'state.json'));
 const saved=read(path.join(directory,'summary.json'));
 for(const item of read(path.join(directory,'SHA256.json')).files){
  const file=path.join(directory,item.path);
  assert.equal(fs.statSync(file).size,item.bytes,item.path);
  assert.equal(digest(file),item.sha256,item.path);
 }
 assert.equal(state.status,'COMPLETE');assert.equal(state.nextIndex,cfg.samples.length);
 const rows=validateRun(directory);assert.deepEqual(rows,saved.rows);assert.equal(rows.length,cfg.samples.length);
 assert.equal(saved.timingOrigin,cfg.timingOrigin);
 // Verify archived scripts against the hashes frozen before sampling. The
 // omitted native helper and media are listed in the build provenance record.
 const originalRoot=path.win32.dirname(path.win32.dirname(cfg.samples[0].profile));
 let frozenFilesChecked=0;
 for(const item of read(path.join(directory,'inputs.json'))){
  const relative=path.win32.relative(originalRoot,item.path);
  if(relative.startsWith('..')||path.win32.isAbsolute(relative))continue;
  const file=path.join(directory,...relative.split('\\'));
  if(!fs.existsSync(file))continue;
  assert.equal(digest(file),item.sha256,item.path);frozenFilesChecked++;
 }
 const stats=[];
 for(const target of cfg.targets)for(const phase of (cfg.warmOnly?['warm']:['cold','warm']))for(const endpoint of ['appReadyMs','firstVideoCallbackMs']){
  const selected=rows.filter(r=>r.target===target.id&&r.phase===phase);assert.equal(selected.length,cfg.count);
  const values=selected.map(r=>r[endpoint]);
  const stat={target:target.id,storage:target.storage,variant:target.variant,phase,endpoint,n:values.length,p50:quantile(values,.5),p90:quantile(values,.9)};
  assert.deepEqual(stat,saved.stats.find(s=>s.target===stat.target&&s.phase===phase&&s.endpoint===endpoint));stats.push(stat);
 }
 const comparisons=stats.filter(s=>s.variant==='C').map(changed=>{
  const baseline=stats.find(s=>s.variant==='A'&&s.storage===changed.storage&&s.phase===changed.phase&&s.endpoint===changed.endpoint);
  assert(baseline);
  const delta=p=>({ms:changed[p]-baseline[p],percent:(changed[p]/baseline[p]-1)*100});
  const comparison={storage:changed.storage,phase:changed.phase,endpoint:changed.endpoint,p50:delta('p50'),p90:delta('p90')};
  assert.deepEqual(comparison,saved.comparisons.find(s=>s.storage===comparison.storage&&s.phase===comparison.phase&&s.endpoint===comparison.endpoint));
  return {...comparison,baseline:{p50:baseline.p50,p90:baseline.p90},changed:{p50:changed.p50,p90:changed.p90}};
 });
 const formal=rows.filter(r=>r.phase!=='warmup'),cold=rows.filter(r=>r.phase==='cold');
 assert.equal(new Set(cold.map(r=>r.boot)).size,cold.length);assert.equal(state.restarts,cold.length);
 for(const item of cfg.samples){const ctx=read(path.join(directory,'results',item.id+'-context.json'));assert.deepEqual(ctx.controllerPriority,{cpu:'Normal',memory:5,io:2});}
 return {dataset:path.basename(directory),verified:true,timingOrigin:cfg.timingOrigin,order:cfg.order,formalLaunches:formal.length,warmupLaunches:rows.length-formal.length,coldIndependentBoots:cold.length,frozenFilesChecked,comparisons};
}
if(require.main===module){const directory=process.argv[2]||path.resolve(__dirname,'../../data/data/async-20260925');console.log(JSON.stringify(analyzeRun(directory),null,2));}
module.exports={analyzeRun};
