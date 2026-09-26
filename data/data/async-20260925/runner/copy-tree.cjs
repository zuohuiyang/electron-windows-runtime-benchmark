const fs = require('node:fs');
const path = require('node:path');
// Node's Windows filesystem operations support extended-length paths. Do not use
// Windows PowerShell 5.1 Copy-Item for Chromium profiles with long cache names.
function copyTree(source, destination) {
  if(fs.lstatSync(source).isSymbolicLink())throw Error('不支持链接 / Links are not supported');
  source=fs.realpathSync(source);
  if(!fs.statSync(source).isDirectory())throw Error('源路径必须是目录 / Source must be a directory');
  destination=path.resolve(destination);
  let ancestor=destination;
  const tail=[];
  while(!fs.existsSync(ancestor)){tail.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}
  destination=path.join(fs.realpathSync(ancestor),...tail);
  const relative=path.relative(source,destination);
  if(relative==='' || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)))
    throw Error('目标不能位于源目录内 / Destination cannot be inside source');
  if(fs.existsSync(destination))throw Error('目标目录已存在 / Destination already exists');
  const entries=[];
  function scan(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw Error('不支持链接 / Links are not supported: '+file);
      if(!entry.isDirectory()&&!entry.isFile())throw Error('不支持的文件类型 / Unsupported file type: '+file);
      entries.push({file,relative:path.relative(source,file),directory:entry.isDirectory()});
      if(entry.isDirectory())scan(file);
    }
  }
  scan(source);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.mkdirSync(destination);
  for(const entry of entries){
    const target=path.join(destination,entry.relative);
    if(entry.directory)fs.mkdirSync(target);
    else{
      fs.copyFileSync(entry.file,target,fs.constants.COPYFILE_EXCL);
      const stat=fs.statSync(entry.file);
      fs.utimesSync(target,stat.atime,stat.mtime);
    }
  }
}
if(require.main===module){
  const [source,destination]=process.argv.slice(2);
  if(!source||!destination)throw Error('需要源和目标目录 / Source and destination are required');
  copyTree(source,destination);
}
module.exports={copyTree};
