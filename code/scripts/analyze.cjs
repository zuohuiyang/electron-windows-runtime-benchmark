const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { validate } = require('../harness/validate.cjs');
const root = path.resolve(__dirname, '../..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const quantile = (values, p) => {
  const a = [...values].sort((a, b) => a - b);
  assert(a.length > 0 && a.every(Number.isFinite));
  const i = (a.length - 1) * p, lo = Math.floor(i);
  return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo);
};
function validateSample(raw, context, result, expected, boots) {
  assert.equal(raw.stderr, '');
  for (const key of ['id', 'runtime', 'profile']) assert.equal(context.sample[key], expected[key]);
  return validate(raw, context, result, expected, boots);
}
function table(stats) {
  const fmt = n => n.toFixed(0), change = x => `${x.ms >= 0 ? '+' : '−'}${fmt(Math.abs(x.ms))} ms（${x.percent >= 0 ? '+' : '−'}${Math.abs(x.percent).toFixed(1)}%）`;
  return ['| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
    ...stats.map(s => `| ${s.storage} | ${s.temperature === 'cold' ? '冷启动' : '热启动'} | ${s.endpoint === 'appReadyMs' ? 'APP READY' : '视频呈现回调'} | ${fmt(s.A.p50)} | ${fmt(s.C.p50)} | ${change(s.p50Change)} | ${fmt(s.A.p90)} | ${fmt(s.C.p90)} | ${change(s.p90Change)} |`)].join('\n');
}
function analyzeFinal(name='final-20260922') {
  const directory=path.join(root,'data/data',name);
  for(const file of JSON.parse(fs.readFileSync(path.join(directory,'SHA256.json'),'utf8')).files){
    const bytes=fs.readFileSync(path.join(directory,file.path));
    assert.equal(bytes.length,file.bytes,file.path);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
  }
  const cfg=read(`data/data/${name}/config.json`),state=read(`data/data/${name}/state.json`);
  assert.equal(state.status,'COMPLETE');assert.equal(state.nextIndex,cfg.samples.length);
  assert.equal(cfg.workflowOnly,false);assert.equal(cfg.count,20);
  assert.equal(cfg.order,'ColdFirst');assert.equal(cfg.warmups,5);
  for(const item of cfg.samples){
    const ctx=read(`data/data/${name}/results/${item.id}-context.json`);
    assert.deepEqual(ctx.controllerPriority,{cpu:'Normal',memory:5,io:2});
  }
  const rows=require('../runner/data.cjs').validateRun(directory);
  assert.deepEqual(rows,read(`data/data/${name}/summary.json`).rows);
  assert.equal(rows.length,180);
  const formal=rows.filter(r=>r.phase!=='warmup'),stats=[];
  assert.equal(new Set(formal.filter(r=>r.phase==='cold').map(r=>r.boot)).size,80);
  for(const storage of ['SSD','HDD'])for(const temperature of ['cold','warm'])for(const endpoint of ['appReadyMs','firstVideoCallbackMs']){
    const s={storage,temperature,endpoint};
    for(const variant of ['A','C']){
      const values=formal.filter(r=>r.storage.startsWith(storage)&&r.phase===temperature&&r.variant===variant).map(r=>r[endpoint]);
      assert.equal(values.length,20);s[variant]={n:20,p50:quantile(values,.5),p90:quantile(values,.9)};
      const recorded=read(`data/data/${name}/summary.json`).stats.find(r=>r.storage.startsWith(storage)&&r.phase===temperature&&r.variant===variant&&r.endpoint===endpoint);
      assert.equal(s[variant].p50,recorded.p50);assert.equal(s[variant].p90,recorded.p90);
    }
    for(const p of ['p50','p90'])s[p+'Change']={ms:s.C[p]-s.A[p],percent:(s.C[p]/s.A[p]-1)*100};stats.push(s);
  }
  return {dataset:name,order:cfg.order||'WarmFirst',formalLaunches:formal.length,warmupLaunches:rows.length-formal.length,coldIndependentBoots:new Set(formal.filter(r=>r.phase==='cold').map(r=>r.boot)).size,stats,rows:formal};
}
if (require.main === module) {
  const result = analyzeFinal();
  fs.mkdirSync(path.join(root, 'data/reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/reports/summary.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'data/reports/RESULTS.zh-CN.md'), '# 最终实体机基准测试结果\n\n最终批次：20260922-005203-daabfc，先冷后热。每条件、每版本 n=20；160 次正式启动，20 次热身不计入。单位 ms。负值更快，正值更慢；差值按未取整数据计算。\n\n' + table(result.stats) + '\n\n冷启动视频回调 P50：SSD −22.4%，HDD −36.9%。HDD APP READY P90 增加 897 ms（+26.5%）；热启动 APP READY P50 增加约 20 ms，视频回调增加约 8–11 ms。HDD 改动版 READY 前 9 轮约 4.1–4.4 秒，第 10 轮起约 2.6–2.7 秒，未单独确认原因。\n\n冷启动指重启后首次启动，保留 Windows 默认缓存；热启动在同一会话中预热后启动新进程。结果仅代表本机、本应用和本次顺序。此前先热后冷批次在 SSD 冷启动出现劣化，不并入本批统计；仓库仅收录本次最终批次。终点为首次收到可见视频呈现回调，不保证对应解码第一帧或物理屏幕输出。详见 [方法](../../doc/METHODOLOGY.zh-CN.md)。\n');
  console.log('Verified original evidence hashes and 180 launches; recomputed 160 formal samples / 8 comparisons, matching the recorded report.');
}
module.exports = { analyze: analyzeFinal, analyzeFinal, quantile, validateSample, table };
