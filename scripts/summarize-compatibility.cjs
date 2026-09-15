const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8').replace(/^\uFEFF/,''));
const text=p=>fs.readFileSync(path.join(root,p),'utf8');
function exportsOf(file){const txt=text('provenance/pe/'+file+'-exports.txt'),expected=Number(txt.match(/(\d+) number of names/)[1]);const rows=[...txt.matchAll(/^\s+\d+\s+[0-9A-F]+\s+(?:[0-9A-F]{8}\s+)?(\S+)(?: \(forwarded to (.+)\))?\s*$/gm)].map(m=>({name:m[1],forwarded:m[2]||null}));assert.equal(rows.length,expected);return rows;}
const A=exportsOf('A-exe'),C=exportsOf('C-exe'),runtime=exportsOf('C-runtime');
assert.equal(new Set(C.map(x=>x.name)).size,C.length);
assert.deepEqual(C.map(x=>x.name),runtime.map(x=>x.name));
const missing=A.filter(x=>!C.some(y=>y.name===x.name));assert.equal(missing.length,0);
const forwarded=C.filter(x=>x.forwarded),direct=C.filter(x=>!x.forwarded);assert(forwarded.every(x=>x.forwarded==='main.'+x.name));
const imports=[...text('provenance/pe/C-exe-imports.txt').matchAll(/^ {4}(\S+\.dll)\s*$/gmi)].map(m=>m[1]);assert(imports.length>0);assert(!imports.some(n=>n.toLowerCase()==='main.dll'));
const artifacts=read('provenance/pe/artifacts.json').artifacts;
const groups={};for(const v of ['A','C']){const m=read('provenance/builds/'+v+'/manifest.json');groups[v]={totalBytes:m.runtimeFiles.reduce((n,f)=>n+f.size,0),fileCount:m.runtimeFiles.length,exeBytes:m.runtimeFiles.find(f=>f.path==='electron.exe').size,runtimeBytes:m.runtimeFiles.find(f=>f.path==='main.dll')?.size||0,zipBytes:artifacts.find(a=>a.variant===v&&a.name==='dist.zip').bytes};}
const rows=[['完整分发（解压后）',groups.A.totalBytes,groups.C.totalBytes],['完整分发 ZIP',groups.A.zipBytes,groups.C.zipBytes],['EXE＋主运行时 DLL',groups.A.exeBytes,groups.C.exeBytes+groups.C.runtimeBytes],['启动 EXE',groups.A.exeBytes,groups.C.exeBytes]];
const summary={groups,baselineNamedExports:A.length,splitNamedExports:C.length,runtimeNamedExports:runtime.length,missingBaselineExports:missing,addedExports:C.filter(x=>!A.some(y=>y.name===x.name)).map(x=>x.name),forwardedNamedExports:forwarded.length,directNamedExports:direct.map(x=>x.name),launcherImportDlls:imports,launcherDirectlyImportsRuntime:false};
fs.writeFileSync(path.join(root,'reports/compatibility.json'),JSON.stringify(summary,null,2)+'\n');
const mib=n=>(n/1048576).toFixed(3),delta=(a,c)=>`${c-a>=0?'+':'−'}${mib(Math.abs(c-a))} MiB（${c>=a?'+':'−'}${(Math.abs(c/a-1)*100).toFixed(2)}%）`;
fs.writeFileSync(path.join(root,'reports/SIZE-AND-EXPORTS.zh-CN.md'),'# 分发体积与 PE 导入／导出\n\n从冻结 Release 清单、实际 ZIP 和 dumpbin 输出复算。1 MiB = 1048576 字节，A 为基线，C 为拆分＋预读。ZIP 与 EXE/DLL 已重新核验原清单 SHA-256。\n\n| 项目 | 基线 MiB | 拆分＋预读 MiB | 变化 |\n|---|---:|---:|---:|\n'+rows.map(([n,a,c])=>`| ${n} | ${mib(a)} | ${mib(c)} | ${delta(a,c)} |`).join('\n')+`\n\n分发文件数 ${groups.A.fileCount} → ${groups.C.fileCount}。单个 EXE 变小不代表总分发变小；主 DLL 为 ${mib(groups.C.runtimeBytes)} MiB。符号包、驻留内存和启动磁盘读取量没有在此表测量。\n\n基线 EXE 有 ${A.length} 个命名导出，拆分 EXE 与 main.dll 各 ${C.length} 个。基线命名导出无缺失，新增 ${summary.addedExports.join(', ')}；拆分 EXE 有 ${forwarded.length} 个命名导出转发至同名 main.dll 符号，另有 ${direct.length} 个直接导出，完整列表见 compatibility.json。不能描述为所有导出均转发。启动器导入目录未直接导入 main.dll，其通过显式 LoadLibraryExW 加载。\n\n这是命名符号与导入目录检查，不证明 ordinal 稳定，也不等同于所有 ABI／原生模块兼容或启动轨迹。原始输出见 [provenance/pe](../provenance/pe)，实际改名 EXE 原生模块与 Fuse 验证见 [兼容性说明](../docs/COMPATIBILITY.zh-CN.md)。\n`);
console.log(JSON.stringify(summary,null,2));
