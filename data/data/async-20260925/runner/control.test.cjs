// Exercise the real PowerShell state machine with OS effects replaced in a temporary copy.
// These tests never register startup, launch Electron, or restart Windows.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));
const {plan}=require('./data.cjs');
function setup(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-controller-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['runner','harness','results','logs'])fs.mkdirSync(path.join(root,name));
 fs.copyFileSync(path.join(__dirname,'data.cjs'),path.join(root,'runner/data.cjs'));
 fs.copyFileSync(path.join(__dirname,'priority.cs'),path.join(root,'runner/priority.cs'));
 fs.copyFileSync(path.join(__dirname,'../harness/validate.cjs'),path.join(root,'harness/validate.cjs'));
 const sid=spawnSync('powershell.exe',['-NoProfile','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8'}).stdout.trim();
 const samples=['warmup','warm','cold','cold'].map((phase,i)=>({id:phase+'-'+i,phase,variant:'A',runtime:'target.exe',profile:'profile-'+i}));
 const cfg={sid,user:'test-user',electron:'target.exe',node:process.execPath,runKeyName:'ElectronBenchmark',count:2,warmups:1,samples,installedBoot:'2026-09-01T00:00:00.0000000Z'};
 write(path.join(root,'config.json'),cfg);
 write(path.join(root,'state.json'),{status:'PREPARED',nextIndex:0,lastBoot:'',warmBoot:'',restarts:0,error:'',updated:''});
 const fixture=path.resolve(__dirname,'../../data/data/final-20260922/results/cold-001-ssd-A-sample.json');
 fs.writeFileSync(path.join(root,'harness/launch.cjs'),`const fs=require('fs');const row=JSON.parse(fs.readFileSync(${JSON.stringify(fixture)},'utf8').replace(/^\\uFEFF/,''));fs.writeFileSync(process.argv[5],JSON.stringify(row));`);
 fs.writeFileSync(path.join(root,'runner/system-load.ps1'),'function Wait-BenchmarkIdle { return [pscustomobject]@{Ready=$true;Readings=@(@{cpu=0},@{cpu=0},@{cpu=0})} }');
 let script=fs.readFileSync(path.join(__dirname,'control.ps1'),'utf8');
 const replace=(from,to)=>{assert(script.includes(from),from);script=script.replace(from,to);};
 replace("$ErrorActionPreference='Stop'",`$ErrorActionPreference='Stop'
function Get-ItemProperty { if(Test-Path "$PSScriptRoot\\..\\registry.json"){ $v=Get-Content "$PSScriptRoot\\..\\registry.json" -Raw|ConvertFrom-Json;return $v } }
function New-Item { }
function New-ItemProperty { param($LiteralPath,$Name,$Value,$PropertyType,[switch]$Force) @{ElectronBenchmark=$Value}|ConvertTo-Json|Set-Content "$PSScriptRoot\\..\\registry.json" }
function Remove-ItemProperty { Remove-Item "$PSScriptRoot\\..\\registry.json" }
function Get-Process { param($Id,$Name,$ErrorAction) if($Id -or $Name -eq 'explorer'){[pscustomobject]@{SessionId=1}} }
function Get-CimInstance { [pscustomobject]@{LastBootUpTime=[DateTime]::Parse($env:BENCH_TEST_BOOT).ToLocalTime()} }
function Start-Transcript { }
function Stop-Transcript { }
function Start-Process { }
Add-Type 'public static class PilotDesktop { public static string Name(){return "Default";} public static uint SetThreadExecutionState(uint value){return 1;} }'
`);
 replace("if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))","if($false)");
 replace("Add-Type -Path (Join-Path $PSScriptRoot 'desktop.cs')",'# desktop is simulated');
 replace('& "$env:SystemRoot\\System32\\shutdown.exe" /r /t 0',`[IO.File]::AppendAllText((Join-Path $root 'reboots.txt'),"reboot\n"); exit 0`);
 replace('Node-Step verify','# hashing is tested independently');
 fs.writeFileSync(path.join(root,'runner/control.ps1'),'\uFEFF'+script.replace(/^\uFEFF/,''));
 const run=(action,boot='2026-09-01T00:00:00Z')=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'runner/control.ps1'),'-Action',action],{encoding:'utf8',env:{...process.env,BENCH_TEST_BOOT:boot},timeout:20000});
 return {root,run,cfg};
}
test('controller persists progress across boots and never resamples the same boot',{skip:process.platform!=='win32'},t=>{
 const {root,run,cfg}=setup(t);
 // Two measured warm samples are needed for the two-sample report.
 cfg.samples.splice(2,0,{...cfg.samples[1],id:'warm-extra',profile:'extra'});write(path.join(root,'config.json'),cfg);
 let result=run('Start');assert.equal(result.status,0,result.stdout+result.stderr);
 let state=read(path.join(root,'state.json'));assert.equal(state.nextIndex,3);assert.equal(state.status,'WAITING_REBOOT');
 result=run('Run');assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(fs.readFileSync(path.join(root,'reboots.txt'),'utf8'),'reboot\n');
 result=run('Run','2026-09-02T00:00:00Z');assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(read(path.join(root,'state.json')).nextIndex,4);
 result=run('Run','2026-09-03T00:00:00Z');assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(read(path.join(root,'state.json')).status,'COMPLETE');
 assert(!fs.existsSync(path.join(root,'registry.json')));assert(fs.existsSync(path.join(root,'RESULTS.md')));
 assert.equal(read(path.join(root,'summary.json')).stats.length,4);
});
test('STOP removes startup and interrupted measurements cannot be silently retried',{skip:process.platform!=='win32'},t=>{
 const {root,run}=setup(t);let result=run('Start');assert.equal(result.status,0,result.stdout+result.stderr);
 result=run('Stop');assert.equal(result.status,0,result.stdout+result.stderr);assert(!fs.existsSync(path.join(root,'registry.json')));
 fs.unlinkSync(path.join(root,'STOP'));
 const state=read(path.join(root,'state.json'));state.status='MEASURING';write(path.join(root,'state.json'),state);
 result=run('Run','2026-09-02T00:00:00Z');assert.equal(result.status,1);
 assert.equal(read(path.join(root,'state.json')).status,'FAILED');assert(fs.existsSync(path.join(root,'ATTENTION.txt')));
 assert.equal(fs.readFileSync(path.join(root,'reboots.txt'),'utf8'),'reboot\n');
});
test('two-disk controller reboots once per cold target and keeps both groups',{skip:process.platform!=='win32'},t=>{
 const {root,run,cfg}=setup(t);
 cfg.version=2;cfg.count=1;cfg.targets=['SSD','HDD'].map(storage=>({id:storage,storage,variant:'A',runtime:storage+'/electron.exe'}));
 cfg.samples=plan(cfg,root);write(path.join(root,'config.json'),cfg);
 let r=run('Start');assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(read(path.join(root,'state.json')).nextIndex,4);
 r=run('Run','2026-09-02T00:00:00Z');assert.equal(r.status,0,r.stdout+r.stderr);
 r=run('Run','2026-09-03T00:00:00Z');assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(read(path.join(root,'state.json')).status,'COMPLETE');
 assert.equal(read(path.join(root,'summary.json')).stats.length,8);
 assert.equal(fs.readFileSync(path.join(root,'reboots.txt'),'utf8'),'reboot\nreboot\n');
});
test('cold first finishes warm sampling on the last cold boot without extra restart',{skip:process.platform!=='win32'},t=>{
 const {root,run,cfg}=setup(t);
 cfg.version=2;cfg.order='ColdFirst';cfg.count=1;
 cfg.targets=['SSD','HDD'].map(storage=>({id:storage,storage,variant:'A',runtime:storage+'/electron.exe'}));
 cfg.samples=plan(cfg,root);write(path.join(root,'config.json'),cfg);
 let r=run('Start');assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(read(path.join(root,'state.json')).nextIndex,0);
 r=run('Run','2026-09-02T00:00:00Z');assert.equal(r.status,0,r.stdout+r.stderr);
 assert.equal(read(path.join(root,'state.json')).nextIndex,1);
 r=run('Run','2026-09-03T00:00:00Z');assert.equal(r.status,0,r.stdout+r.stderr);
 const state=read(path.join(root,'state.json'));
 assert.equal(state.status,'COMPLETE');assert.equal(state.restarts,2);
 assert.equal(read(path.join(root,'summary.json')).order,'ColdFirst');
 assert.equal(fs.readFileSync(path.join(root,'reboots.txt'),'utf8'),'reboot\nreboot\n');
 assert(!fs.existsSync(path.join(root,'registry.json')));
});
test('warm-only controller completes without registering startup or rebooting',{skip:process.platform!=='win32'},t=>{
 const {root,run,cfg}=setup(t);
 cfg.version=2;cfg.warmOnly=true;cfg.count=1;
 cfg.targets=[{id:'A',storage:'SSD',variant:'A',runtime:'target.exe'}];
 cfg.samples=plan(cfg,root);write(path.join(root,'config.json'),cfg);
 const result=run('Start');assert.equal(result.status,0,result.stdout+result.stderr);
 const state=read(path.join(root,'state.json'));
 assert.equal(state.status,'COMPLETE');assert.equal(state.restarts,0);
 assert.equal(read(path.join(root,'summary.json')).warmOnly,true);
 assert(!fs.existsSync(path.join(root,'reboots.txt')));
 assert(!fs.existsSync(path.join(root,'registry.json')));
});

test('idle gate accepts real 100% CPU only in explicit workflow mode',{skip:process.platform!=='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bench-idle-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const helper=path.join(__dirname,'system-load.ps1').replaceAll("'","''");
 const script=`$ErrorActionPreference='Stop'
. '${helper}'
function Start-Sleep { }
function Get-CimInstance { [pscustomobject]@{PercentProcessorTime=$script:testCpu} }
function Get-SystemLoadSnapshot { return @{type='simulated-diagnostics'} }
$script:testCpu=100
$r=Wait-BenchmarkIdle -LogPath "$PSScriptRoot\\workflow.jsonl" -MaxCpuPercent 100
if(-not $r.Ready -or $r.Readings.Count -ne 3 -or $r.Readings[0].cpu -ne 100){throw 'Workflow gate failed'}
$r=Wait-BenchmarkIdle -LogPath "$PSScriptRoot\\formal.jsonl" -MaxWaitSeconds 0
if($r.Ready){throw 'Formal gate accepted busy CPU'}
$script:testCpu=101
$rejected=$false
try{Wait-BenchmarkIdle -LogPath "$PSScriptRoot\\invalid.jsonl" -MaxCpuPercent 100|Out-Null}catch{$rejected=$true}
if(-not $rejected){throw 'Invalid CPU accepted'}
$script:testCpu=5
$r=Wait-BenchmarkIdle -LogPath "$PSScriptRoot\\idle.jsonl"
if(-not $r.Ready){throw 'Valid idle CPU rejected'}
`;
 const file=path.join(root,'test.ps1');fs.writeFileSync(file,'\uFEFF'+script);
 const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
