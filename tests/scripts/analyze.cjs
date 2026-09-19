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
function verifyArchive() {
  for (const file of read('benchmark/provenance/SOURCE-FILES.json').files) {
    const bytes = fs.readFileSync(path.join(root, file.path));
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
}
function validateSample(raw, context, result, expected, boots) {
  assert.equal(raw.stderr, '');
  assert.equal(context.user, 'autotest');
  for (const key of ['id', 'runtime', 'profile']) assert.equal(context.sample[key], expected[key]);
  return validate(raw, context, result, expected, boots);
}
function analyze() {
  verifyArchive();
  const cold = read('benchmark/data/cold/config.json').samples;
  const warm = read('benchmark/data/warm/config.json').actions;
  const coldState = read('benchmark/data/cold/state.json'), warmState = read('benchmark/data/warm/state.json');
  assert.equal(coldState.status, 'COMPLETE'); assert.equal(coldState.nextIndex, 80);
  assert.equal(warmState.status, 'COMPLETE'); assert.equal(warmState.nextIndex, 100);
  assert.deepEqual(warmState.completed, warm.map(a => a.id));
  const coldBoots = new Set(), warmBoots = new Set(), rows = [];
  for (const [items, temperature] of [[cold, 'cold'], [warm, 'warm']]) {
    assert.equal(new Set(items.map(a => a.id)).size, items.length);
    assert.equal(new Set(items.map(a => a.profile)).size, items.length);
    for (const a of items) {
      const base = `benchmark/data/${temperature}/results/${a.id}`;
      const raw = read(base + '-sample.json'), context = read(base + '-context.json');
      // The original warm controller recorded integrity once for the entire batch,
      // not a synthetic per-launch result file. COMPLETE + recorded summary attest
      // to its final verify/report step; local binaries are not included here.
      const result = temperature === 'cold' ? read(base + '-result.json') :
        { status: 'SUCCESS', inputsVerifiedAfter: warmState.status === 'COMPLETE' };
      if (temperature === 'warm') {
        assert.equal(context.mode, 'warm'); assert.equal(context.sample.phase, a.phase);
        warmBoots.add(context.boot);
      }
      const row = validateSample(raw, context, result, a, temperature === 'cold' ? coldBoots : new Set());
      if (temperature === 'cold' || a.phase === 'measured') rows.push({ ...row, temperature });
    }
    for (const drive of ['C', 'E']) {
      const formal = items.filter(a => a.drive === drive && (temperature === 'cold' || a.phase === 'measured'));
      let firstA = 0;
      for (let pair = 1; pair <= 20; pair++) {
        const ordered = formal.filter(a => a.pair === pair);
        assert.deepEqual(ordered.map(a => a.variant).sort(), ['A', 'C']);
        firstA += ordered[0].variant === 'A';
      }
      assert.equal(firstA, 10);
      if (temperature === 'warm') for (const variant of ['A', 'C'])
        assert.equal(items.filter(a => a.drive === drive && a.variant === variant && a.phase === 'warmup').length, 5);
    }
  }
  assert.equal(rows.length, 160); assert.equal(coldBoots.size, 80); assert.equal(warmBoots.size, 1);
  const stats = [];
  for (const drive of ['C', 'E']) for (const temperature of ['cold', 'warm'])
    for (const endpoint of ['appReadyMs', 'firstVideoCallbackMs']) {
      const s = { storage: drive === 'C' ? 'SSD' : 'HDD', temperature, endpoint };
      for (const variant of ['A', 'C']) {
        const values = rows.filter(r => r.drive === drive && r.temperature === temperature && r.variant === variant).map(r => r[endpoint]);
        assert.equal(values.length, 20);
        s[variant] = { n: 20, p50: quantile(values, .5), p90: quantile(values, .9) };
      }
      for (const p of ['p50', 'p90']) s[p + 'Change'] = { ms: s.C[p] - s.A[p], percent: (s.C[p] / s.A[p] - 1) * 100 };
      stats.push(s);
    }
  assert.deepEqual(stats, read('benchmark/data/recorded-summary.json').stats, 'Recomputed values differ from the run-completion report');
  return { formalLaunches: 160, warmupLaunches: 20, coldIndependentBoots: 80, warmBoots: [...warmBoots], stats, rows };
}
function table(stats) {
  const fmt = n => n.toFixed(3), change = x => `${x.ms >= 0 ? '+' : '−'}${fmt(Math.abs(x.ms))} ms（${x.percent >= 0 ? '+' : '−'}${Math.abs(x.percent).toFixed(2)}%）`;
  return ['| 存储 | 条件 | 终点 | 基线 P50 | 拆分＋预读 P50 | P50 变化 | 基线 P90 | 拆分＋预读 P90 | P90 变化 |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
    ...stats.map(s => `| ${s.storage} | ${s.temperature === 'cold' ? '冷启动' : '热启动'} | ${s.endpoint === 'appReadyMs' ? 'APP READY' : '视频呈现回调'} | ${fmt(s.A.p50)} | ${fmt(s.C.p50)} | ${change(s.p50Change)} | ${fmt(s.A.p90)} | ${fmt(s.C.p90)} | ${change(s.p90Change)} |`)].join('\n');
}
if (require.main === module) {
  const result = analyze();
  fs.mkdirSync(path.join(root, 'benchmark/reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'benchmark/reports/summary.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'benchmark/reports/RESULTS.zh-CN.md'), '# 最终实体机 benchmark\n\n每条件、每版本 n=20；160 次正式启动，20 次热身不计入。单位 ms。负值更快，正值更慢。\n\n' + table(result.stats) + '\n\n冷启动视频回调 P50：SSD −32.06%，HDD −77.01%。热启动存在退化：视频回调 P50 SSD +8.06%、HDD +7.30%；APP READY 增加约 19–20 ms，具体机制尚待定位。\n\n冷启动指重启后首次启动，保留 Windows 默认缓存；热启动在同一会话中预热后启动新进程。结果仅代表本机、本应用。终点为首次收到可见视频呈现回调，不保证对应解码第一帧或物理屏幕输出。详见 [方法](../../doc/METHODOLOGY.zh-CN.md)。\n');
  console.log('Verified original evidence hashes and 180 launches; recomputed 160 formal samples / 8 comparisons, matching the recorded report.');
}
module.exports = { analyze, quantile, validateSample, table };
