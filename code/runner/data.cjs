const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { validate } = require('../harness/validate.cjs');
const quantile = (values, p) => {
  const sorted = [...values].sort((a,b) => a-b), i = (sorted.length-1)*p;
  return sorted[Math.floor(i)] + (sorted[Math.ceil(i)]-sorted[Math.floor(i)])*(i-Math.floor(i));
};
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
const fingerprint = p => ({ path: p, bytes: fs.statSync(p).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') });
function inventory(directory) {
  const entries = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const p = path.join(directory, item.name);
    assert(!item.isSymbolicLink(), `不支持符号链接 / Symbolic links unsupported: ${p}`);
    if (item.isDirectory()) entries.push(...inventory(p));
    else if (item.isFile()) entries.push(fingerprint(p));
  }
  return entries;
}
function plan(cfg, root) {
  const samples=[];
  const paths=/^[A-Za-z]:[\\/]|^\\\\/.test(root)?path.win32:path;
  assert(cfg.targets.length>0 && new Set(cfg.targets.map(t=>t.id)).size===cfg.targets.length);
  const order=cfg.order || 'WarmFirst';
  assert(['WarmFirst','ColdFirst'].includes(order),'Unknown sampling order');
  for(const phase of (order==='ColdFirst'?['cold','warmup','warm']:['warmup','warm','cold'])) {
    const count=phase==='warmup'?cfg.warmups:cfg.count;
    for(let round=1;round<=count;round++) {
      // Reverse each round to balance which target runs first (AB / BA, or AC / CA).
      const ordered=round%2 ? cfg.targets : [...cfg.targets].reverse();
      for(const target of ordered) {
        const id=`${phase}-${String(round).padStart(3,'0')}-${target.id}`;
        samples.push({id,phase,round,target:target.id,storage:target.storage,variant:target.variant,
          runtime:target.runtime,profile:paths.join(root,'profiles',id)});
      }
    }
  }
  return samples;
}
function validateRun(root) {
  const cfg = read(path.join(root, 'config.json'));
  if(cfg.version===2) {
    const first=cfg.samples[0].profile;
    const paths=/^[A-Za-z]:[\\/]|^\\\\/.test(first)?path.win32:path;
    const originalRoot=paths.dirname(paths.dirname(first));
    assert.deepEqual(cfg.samples,plan(cfg,originalRoot),'采样顺序不匹配 / Sampling order mismatch');
  }
  const coldBoots = new Set(), warmBoots = new Set();
  const rows = [];
  for (const item of cfg.samples) {
    const prefix = path.join(root, 'results', item.id);
    if (!fs.existsSync(prefix + '-result.json')) continue;
    const raw = read(prefix + '-sample.json'), ctx = read(prefix + '-context.json');
    assert.equal(ctx.sid, cfg.sid, '运行账户改变 / Account changed');
    assert.equal(raw.stderr, '', '标准错误输出不为空 / Nonempty stderr');
    assert.deepEqual(ctx.sample, item);
    if (item.phase !== 'cold') warmBoots.add(ctx.boot);
    rows.push(validate(raw, ctx, read(prefix + '-result.json'), item,
      item.phase === 'cold' ? coldBoots : new Set(), {workflowOnly:cfg.workflowOnly===true}));
  }
  assert(warmBoots.size <= 1, '热启动批次跨越了系统重启 / Warm batch spans multiple boots');
  return rows;
}
function report(root) {
  const cfg = read(path.join(root, 'config.json')), rows = validateRun(root);
  assert.equal(rows.length, cfg.samples.length, '采样未完成 / Sampling incomplete');
  const stats = [];
  const targets=cfg.targets || [{id:'single',storage:'Original path',variant:'A',runtime:cfg.electron}];
  for(const target of targets) for (const phase of ['warm', 'cold']) for (const endpoint of ['appReadyMs', 'firstVideoCallbackMs']) {
    const values = rows.filter(r => r.phase === phase && (!cfg.targets || r.target===target.id)).map(r => r[endpoint]);
    assert.equal(values.length, cfg.count);
    stats.push({ target:target.id,storage:target.storage,variant:target.variant,phase, endpoint, n: values.length, p50: quantile(values,.5), p90: quantile(values,.9) });
  }
  const comparisons=[];
  for(const s of stats.filter(s=>s.variant==='C')) {
    const baseline=stats.find(b=>b.variant==='A'&&b.storage===s.storage&&b.phase===s.phase&&b.endpoint===s.endpoint);
    if(baseline)comparisons.push({storage:s.storage,phase:s.phase,endpoint:s.endpoint,
      p50:{ms:s.p50-baseline.p50,percent:(s.p50/baseline.p50-1)*100},
      p90:{ms:s.p90-baseline.p90,percent:(s.p90/baseline.p90-1)*100}});
  }
  write(path.join(root, 'summary.json'), { order:cfg.order || 'WarmFirst',workflowOnly:!!cfg.workflowOnly,electron: cfg.electron, targets,user: cfg.user, sid: cfg.sid, stats,comparisons, rows });
  fs.writeFileSync(path.join(root, 'RESULTS.md'), '# Electron 启动测量结果 / Startup benchmark results\n\n' +
    `采样顺序 / Sampling order: ${cfg.order || 'WarmFirst'}\n\n`+
    (cfg.workflowOnly?'**仅验证流程，不代表 SSD/HDD 性能对比 / Workflow validation only, not an SSD/HDD performance comparison.**\n\n':'')+
    `Electron: ${cfg.electron}\n\n账户 / User: ${cfg.user}\n\n每种条件 / Samples per condition: ${cfg.count}; 热身（不计入） / Excluded warmups: ${cfg.warmups}. 单位 / Unit: ms.\n\n` +
    '| 磁盘 / Disk | 版本 / Variant | 条件 / Condition | 终点 / Endpoint | 样本数 / N | P50 | P90 |\n|---|---|---|---|---:|---:|---:|\n' +
    stats.map(s => `| ${s.storage} | ${s.variant} | ${s.phase === 'cold' ? '冷启动 / Cold' : '热启动 / Warm'} | ${s.endpoint === 'appReadyMs' ? 'APP READY' : '视频呈现回调 / Visible video callback'} | ${s.n} | ${s.p50.toFixed(0)} | ${s.p90.toFixed(0)} |`).join('\n') +
    (comparisons.length?'\n\n## 改动版 − 基线 / Changed − baseline\n\n| 磁盘 / Disk | 条件 / Condition | 终点 / Endpoint | Δ P50 | Δ P90 |\n|---|---|---|---:|---:|\n'+comparisons.map(c=>`| ${c.storage} | ${c.phase} | ${c.endpoint} | ${c.p50.ms.toFixed(0)} ms (${c.p50.percent.toFixed(1)}%) | ${c.p90.ms.toFixed(0)} ms (${c.p90.percent.toFixed(1)}%) |`).join('\n'):'')+
    '\n\n冷启动为重启后的首次被测 Electron 启动，保留 Windows 默认缓存。视频终点为首次收到可见视频呈现回调，不保证是解码第一帧或物理屏幕输出。结果仅代表本次机器和配置。\n\nCold means the first target Electron launch after reboot, with default Windows caching. The video endpoint is the first observed visible video callback, not necessarily decoded frame one or physical scanout. Results apply to this machine and configuration.\n');
}
if (require.main === module) {
  const [cmd, root] = process.argv.slice(2);
  if(cmd==='plan') {
    const cfg=read(path.join(root,'config.json'));cfg.samples=plan(cfg,root);write(path.join(root,'config.json'),cfg);
  } else if (cmd === 'freeze' || cmd === 'verify') {
    const cfg = read(path.join(root, 'config.json'));
    if(cmd==='freeze' && cfg.targets) {
      const sources=new Map();
      const relative=(dir)=>inventory(dir).map(f=>({...f,path:path.relative(dir,f.path)}));
      for(const target of cfg.targets) {
        const source=path.dirname(target.source),destination=path.dirname(target.runtime);
        if(!sources.has(source))sources.set(source,relative(source));
        assert.deepEqual(relative(destination),sources.get(source),'部署文件与源产物不一致 / Deployment differs from source');
      }
    }
    const files = [fingerprint(path.join(root, 'config.json')), fingerprint(cfg.node),
      ...[...new Set((cfg.targets || [{runtime:cfg.electron}]).map(t=>path.dirname(t.runtime)))].flatMap(inventory), ...inventory(path.join(root, 'harness')),
      ...inventory(path.join(root, 'runner'))];
    const dest = path.join(root, 'inputs.json');
    if (cmd === 'freeze') write(dest, files);
    else assert.deepEqual(files, read(dest), '被测文件或脚本发生变化 / Inputs changed');
  } else if (cmd === 'validate') validateRun(root);
  else if (cmd === 'report') report(root);
  else throw Error('未知命令 / Unknown command');
}
module.exports = { inventory, validateRun, report, plan };
