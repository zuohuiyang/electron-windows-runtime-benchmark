const assert=require('node:assert/strict');
exports.validate=(row,context,result,expected,boots,options={})=>{
 assert.equal(row.variant,expected.variant);assert.equal(row.valid,true);assert.equal(row.code,0);assert(!row.error&&!row.timedOut);
 assert(!/Failed to grant sandbox access|Encountered error while migrating network context/i.test(row.stderr||''),'Sandbox permission error');assert.equal(result.status,'SUCCESS');assert.equal(result.inputsVerifiedAfter,true);
 assert(context.session>0);assert.equal(context.elevated,false);assert(context.user);
 assert(!boots.has(context.boot),'duplicate boot');boots.add(context.boot);
 assert(row.parentSpawnEpochMs-Date.parse(context.boot)>=120000);
 assert(context.idle.length>=3&&context.idle.slice(-3).every(r=>Number.isFinite(r.cpu)&&r.cpu>=0&&r.cpu<=(options.workflowOnly?100:10)));
 const frames=row.events.filter(e=>e.event==='first-video-frame');assert.equal(frames.length,1);
 const f=frames[0];assert.equal(f.pid,row.pid);assert(Number.isInteger(f.frame.presentedFrames)&&f.frame.presentedFrames>=1);assert.equal(f.endpoint,'first-observed-visible-video-callback-v1');assert.equal(f.frame.width,1280);assert.equal(f.frame.height,720);assert.equal(f.frame.visibility,'visible');assert.equal(f.frame.paused,false);
 assert.equal(f.frame.clockSamples.length,20);assert(f.clock.uncertaintyMs<=2);assert(Math.abs(f.clock.clockDriftMs)<=2);
 assert(f.firstFrameMs>0&&f.firstFrameBoundsMs[0]<=f.firstFrameMs&&f.firstFrameMs<=f.firstFrameBoundsMs[1]);
 const d=row.events.find(e=>e.event==='diagnostics');assert(d);assert.equal(d.networkRequests.length,0);
 const ready=row.events.find(e=>e.event==='app-ready');assert(ready&&ready.sinceCreationMs>0&&ready.sinceCreationMs<f.firstFrameMs);
 const validated={...expected,firstFrameMs:f.firstFrameMs,firstVideoCallbackMs:f.firstFrameMs,presentedFrames:f.frame.presentedFrames,callbackMinusExpectedDisplayMs:f.frame.callbackNow-f.frame.expectedDisplayTime,appReadyMs:ready.sinceCreationMs,afterReadyMs:f.firstFrameMs-ready.sinceCreationMs,uncertaintyMs:f.clock.uncertaintyMs,driftMs:f.clock.clockDriftMs,gpu:d.gpu,boot:context.boot};
 const origin=options.timingOrigin ?? 'process-creation-v1';
 assert(['process-creation-v1','parent-before-spawn-qpc-v1'].includes(origin),'Unknown timing origin');
 // Old archives retain their original creation-time metrics and row schema.
 if(origin==='process-creation-v1')return validated;
 assert.equal(row.timingOrigin,origin,'Sample timing origin mismatch');
 for(const field of ['parentToCreationMs','parentAppReadyMs','parentVideoMs','spawnCallMs']) {
  assert(Number.isFinite(row[field]),`Missing parent-origin timing: ${field}`);
 }
 assert(typeof row.parentBeforeSpawnNs==='string'&&/^\d+$/.test(row.parentBeforeSpawnNs));
 assert(typeof row.parentAfterSpawnNs==='string'&&/^\d+$/.test(row.parentAfterSpawnNs));
 const before=BigInt(row.parentBeforeSpawnNs),after=BigInt(row.parentAfterSpawnNs);
 assert(after>=before&&row.parentToCreationMs>=0);
 assert(row.parentToCreationMs<=row.spawnCallMs+2,'Creation falls after spawn returned');
 assert(Math.abs(row.spawnCallMs-Number(after-before)/1e6)<0.001,'Spawn duration mismatch');
 assert(Math.abs(row.parentToCreationMs-(f.creationQpcMs-Number(before)/1e6))<0.001,'Parent/creation clock mismatch');
 assert(Math.abs(row.parentAppReadyMs-ready.sinceCreationMs-row.parentToCreationMs)<0.001,'APP READY origin mismatch');
 assert(Math.abs(row.parentVideoMs-f.firstFrameMs-row.parentToCreationMs)<0.001,'Video origin mismatch');
 return {...validated,timingOrigin:origin,creationAppReadyMs:validated.appReadyMs,creationVideoCallbackMs:validated.firstVideoCallbackMs,
  parentToCreationMs:row.parentToCreationMs,spawnCallMs:row.spawnCallMs,
  appReadyMs:row.parentAppReadyMs,firstFrameMs:row.parentVideoMs,firstVideoCallbackMs:row.parentVideoMs};
};

