const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {copyTree}=require('./copy-tree.cjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'electron-copy-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'seed');fs.mkdirSync(source);
  return {root,source};
}
test('copies long Chromium cache paths through Windows PowerShell 5.1', {skip:process.platform!=='win32'},t=>{
  const {root,source}=fixture(t);
  const relative=path.join('Code Cache','electron-preload','5A602C67450D9C9B71B4FF16268BB33CAC0C1873905FB5EF048FB64626F6C1C4-046EE14B76106E2E39DCF4D74A8AEE393DEDA01000D21673491EB8D652BB29D2.cache');
  const original=path.join(source,relative);
  fs.mkdirSync(path.dirname(original),{recursive:true});
  fs.writeFileSync(original,Buffer.from([0,1,2,255]));
  fs.utimesSync(original,new Date('2024-01-01'),new Date('2024-01-01'));
  const destination=path.join(root,'中文 directory with spaces', 'x'.repeat(65),'profiles','warmup-001-ssd-A');
  assert(path.join(destination,relative).length>260);
  const script=path.join(root,'copy.ps1');
  fs.writeFileSync(script,'\uFEFFparam($Node,$Helper,$Source,$Destination)\r\n& $Node $Helper $Source $Destination\r\nexit $LASTEXITCODE\r\n');
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',script,process.execPath,path.join(__dirname,'copy-tree.cjs'),source,destination],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(destination,relative)),fs.readFileSync(original));
  assert.equal(fs.statSync(path.join(destination,relative)).mtimeMs,fs.statSync(original).mtimeMs);
});
test('rejects existing destinations and destinations within the source',t=>{
  const {root,source}=fixture(t);
  fs.writeFileSync(path.join(source,'keep'),'original');
  assert.throws(()=>copyTree(source,source),/inside source/);
  assert.throws(()=>copyTree(source,path.join(source,'nested','copy')),/inside source/);
  const destination=path.join(root,'existing');fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination,'keep'),'untouched');
  assert.throws(()=>copyTree(source,destination),/already exists/);
  assert.equal(fs.readFileSync(path.join(destination,'keep'),'utf8'),'untouched');
});
