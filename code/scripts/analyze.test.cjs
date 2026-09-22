const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyze, validateSample, quantile } = require('./analyze.cjs');
const read = p => JSON.parse(fs.readFileSync(path.join(__dirname, '../..', p), 'utf8').replace(/^\uFEFF/, ''));
test('all archived samples reproduce the recorded eight comparisons', () => {
  const r = analyze(); assert.equal(r.rows.length, 160); assert.equal(r.stats.length, 8);
});
test('reject invalid endpoint, network traffic, clock error, profile mismatch and duplicate cold boot', () => {
  const expected = read('data/data/final-20260922/config.json').samples[0];
  const base = 'data/data/final-20260922/results/' + expected.id;
  const raw = read(base + '-sample.json'), ctx = read(base + '-context.json'), result = read(base + '-result.json');
  for (const change of [r => r.stderr = 'unexpected failure', r => r.events.find(e => e.event === 'first-video-frame').frame.presentedFrames = 0,
    r => r.events.find(e => e.event === 'first-video-frame').endpoint = 'old-endpoint',
    r => r.events.find(e => e.event === 'first-video-frame').clock.clockDriftMs = 3,
    r => r.events.find(e => e.event === 'diagnostics').networkRequests.push({ url: 'https://example.invalid' })]) {
    const copy = structuredClone(raw); change(copy); assert.throws(() => validateSample(copy, ctx, result, expected, new Set()));
  }
  assert.throws(() => validateSample(raw, { ...ctx, sample: { ...ctx.sample, profile: 'different-profile' } }, result, expected, new Set()));
  assert.throws(() => validateSample(raw, ctx, result, expected, new Set([ctx.boot])));
  const later = structuredClone(raw); later.events.find(e => e.event === 'first-video-frame').frame.presentedFrames = 4;
  assert.doesNotThrow(() => validateSample(later, ctx, result, expected, new Set()));
});
test('linear interpolation is explicit for small samples', () => {
  assert.equal(quantile([0, 10], .9), 9); assert.equal(quantile([30, 10, 20], .5), 20);
});
