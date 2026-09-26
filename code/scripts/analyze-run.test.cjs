const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {analyzeRun}=require('./analyze-run.cjs');
test('async archive hashes and raw samples reproduce all 20-per-group parent-origin results',()=>{
 const result=analyzeRun(path.resolve(__dirname,'../../data/data/async-20260925'));
 assert.equal(result.timingOrigin,'parent-before-spawn-qpc-v1');
 assert.equal(result.formalLaunches,160);assert.equal(result.warmupLaunches,20);
 assert.equal(result.coldIndependentBoots,80);assert.equal(result.comparisons.length,8);
 assert(result.frozenFilesChecked>10);
});
