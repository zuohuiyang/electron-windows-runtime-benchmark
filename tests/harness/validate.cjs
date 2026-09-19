const assert=require('node:assert/strict');
exports.validate=(row,context,result,expected,boots)=>{
 assert.equal(row.variant,expected.variant);assert.equal(row.valid,true);assert.equal(row.code,0);assert(!row.error&&!row.timedOut);
 assert(!/Failed to grant sandbox access|Encountered error while migrating network context/i.test(row.stderr||''),'Sandbox permission error');assert.equal(result.status,'SUCCESS');assert.equal(result.inputsVerifiedAfter,true);
 assert(context.session>0);assert.equal(context.elevated,false);assert(context.user);
 assert(!boots.has(context.boot),'duplicate boot');boots.add(context.boot);
 assert(row.parentSpawnEpochMs-Date.parse(context.boot)>=120000);
 assert(context.idle.length>=3&&context.idle.slice(-3).every(r=>r.cpu<=10));
 const frames=row.events.filter(e=>e.event==='first-video-frame');assert.equal(frames.length,1);
 const f=frames[0];assert.equal(f.pid,row.pid);assert(Number.isInteger(f.frame.presentedFrames)&&f.frame.presentedFrames>=1);assert.equal(f.endpoint,'first-observed-visible-video-callback-v1');assert.equal(f.frame.width,1280);assert.equal(f.frame.height,720);assert.equal(f.frame.visibility,'visible');assert.equal(f.frame.paused,false);
 assert.equal(f.frame.clockSamples.length,20);assert(f.clock.uncertaintyMs<=2);assert(Math.abs(f.clock.clockDriftMs)<=2);
 assert(f.firstFrameMs>0&&f.firstFrameBoundsMs[0]<=f.firstFrameMs&&f.firstFrameMs<=f.firstFrameBoundsMs[1]);
 const d=row.events.find(e=>e.event==='diagnostics');assert(d);assert.equal(d.networkRequests.length,0);
 const ready=row.events.find(e=>e.event==='app-ready');assert(ready&&ready.sinceCreationMs>0&&ready.sinceCreationMs<f.firstFrameMs);
 return {...expected,firstFrameMs:f.firstFrameMs,firstVideoCallbackMs:f.firstFrameMs,presentedFrames:f.frame.presentedFrames,callbackMinusExpectedDisplayMs:f.frame.callbackNow-f.frame.expectedDisplayTime,appReadyMs:ready.sinceCreationMs,afterReadyMs:f.firstFrameMs-ready.sinceCreationMs,uncertaintyMs:f.clock.uncertaintyMs,driftMs:f.clock.clockDriftMs,gpu:d.gpu,boot:context.boot};
};

