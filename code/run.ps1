param(
 [Parameter(Mandatory=$true)][string]$ElectronPath,
 [string]$BaselinePath,
 [string]$DiskSSD,
 [string]$DiskHDD,
 [switch]$WorkflowOnly,
 [string]$ClockHelperPath,
 [ValidateRange(1,100)][int]$Count=20,
 [ValidateRange(1,100)][int]$Warmups=5,
 [string]$OutputDirectory,
 [switch]$PrepareOnly
)
$ErrorActionPreference='Stop'
function Say($zh,$en){Write-Host "$zh / $en"}
function Copy-BenchmarkTree([string]$Source,[string]$Destination){
 & $node (Join-Path $PSScriptRoot 'runner\copy-tree.cjs') $Source $Destination
 if($LASTEXITCODE -ne 0){throw '目录复制失败，已停止准备 / Directory copy failed; preparation stopped'}
}
function Save-Json($file,$value){$value|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $file -Encoding UTF8}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw '请使用非管理员终端 / Use a non-elevated terminal'}
$electron=(Resolve-Path -LiteralPath $ElectronPath).Path
if(Test-Path -LiteralPath $electron -PathType Container){$electron=Join-Path $electron 'electron.exe'}
if(-not(Test-Path -LiteralPath $electron -PathType Leaf) -or [IO.Path]::GetExtension($electron) -ne '.exe'){throw '需要 Electron EXE 路径 / An Electron EXE path is required'}
$node=(Get-Command node.exe -ErrorAction Stop).Source
if([int]((& $node --version).Trim().TrimStart('v').Split('.')[0]) -lt 18){throw '需要 Node.js 18+ / Node.js 18+ required'}
if(-not $OutputDirectory){$OutputDirectory=Join-Path $env:LOCALAPPDATA ('ElectronBench\runs\'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))}
$root=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $root){throw '输出目录必须是新目录 / Output directory must not exist'}
$runtimeDir=[IO.Path]::GetDirectoryName($electron).TrimEnd('\')+'\'
if(($root+'\').StartsWith($runtimeDir,[StringComparison]::OrdinalIgnoreCase)){throw '输出不能放入 Electron 目录 / Output must be outside the Electron directory'}
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if(Get-ItemProperty -LiteralPath $runKey -Name ElectronBenchmark -ErrorAction SilentlyContinue){throw '已有自动采样任务，请先停止 / An automatic benchmark is already registered; stop it first'}
New-Item -ItemType Directory -Path $root|Out-Null
foreach($name in @('harness','runner')){Copy-BenchmarkTree (Join-Path $PSScriptRoot $name) (Join-Path $root $name)}
foreach($name in @('results','logs','profiles')){New-Item -ItemType Directory -Path (Join-Path $root $name)|Out-Null}
Say "输出目录：$root" "Output directory: $root"
# Compile the native clock helper in the experiment copy, without modifying PATH permanently.
$build=Join-Path $root 'harness\build-clock-anchor.cmd'
if($ClockHelperPath){
 Copy-Item -LiteralPath $ClockHelperPath -Destination (Join-Path $root 'harness\clock-anchor.exe') -Force
 & (Join-Path $root 'harness\clock-anchor.exe') | Out-Null
}elseif(Get-Command cl.exe -ErrorAction SilentlyContinue){& $build}
else{
 $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
 if(-not(Test-Path -LiteralPath $vswhere)){throw '请安装 Visual Studio C++ x64 构建工具 / Install Visual Studio C++ x64 build tools'}
 $vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
 if(-not $vs){throw '未找到 C++ 工具链 / C++ toolchain not found'}
 $dev=Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
 # cmd expands these characters even inside quotes; reject instead of interpreting a path as code.
 if(($dev+$build) -match '[%"!\r\n]'){throw '构建路径包含不支持的字符 / Unsupported build path characters'}
 $driver=Join-Path $root 'build-helper.cmd'
 [IO.File]::WriteAllText($driver,"@echo off`r`ncall `"%ELECTRON_BENCH_VSDEV%`" -arch=x64 -host_arch=x64`r`nif errorlevel 1 exit /b 1`r`ncall `"%ELECTRON_BENCH_BUILD%`"`r`nexit /b %errorlevel%`r`n",[Text.Encoding]::ASCII)
 $start=[Diagnostics.ProcessStartInfo]::new()
 $start.FileName=$env:ComSpec;$start.Arguments='/d /s /c ""'+$driver+'""'
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $start.EnvironmentVariables['ELECTRON_BENCH_VSDEV']=$dev
 $start.EnvironmentVariables['ELECTRON_BENCH_BUILD']=$build
 $process=[Diagnostics.Process]::Start($start);$process.WaitForExit()
 $global:LASTEXITCODE=$process.ExitCode;$process.Dispose()
}
if($LASTEXITCODE -ne 0){throw '计时程序编译失败 / Clock helper compilation failed'}
$media=Join-Path $root 'harness\app\local-video.mp4'
$mediaHash='BCB75D3DB0A1A5056F4CD5C770CECCDB4CAE920F21ABB8139B29CD9AD39E3857'
if(-not(Test-Path -LiteralPath $media)){throw '仓库视频素材缺失，请重新获取完整仓库 / Bundled video missing; obtain a complete checkout'}
Say '校验视频素材' 'Verifying video fixture'
if((Get-FileHash -LiteralPath $media -Algorithm SHA256).Hash -ne $mediaHash){throw '视频哈希不匹配 / Video hash mismatch'}
$boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
$targets=@()
if([bool]$DiskSSD -ne [bool]$DiskHDD){throw '必须同时指定两块磁盘 / Specify both disks'}
if($BaselinePath -and -not $DiskSSD){throw '对比模式需要两块磁盘 / Comparison mode requires two disks'}
$products=@(@{variant='A';source=$electron})
if($BaselinePath){
 $baseline=(Resolve-Path -LiteralPath $BaselinePath).Path
 if(Test-Path -LiteralPath $baseline -PathType Container){$baseline=Join-Path $baseline 'electron.exe'}
 if(-not(Test-Path -LiteralPath $baseline -PathType Leaf)){throw '基线 EXE 不存在 / Baseline EXE not found'}
 $products=@(@{variant='A';source=$baseline},@{variant='C';source=$electron})
}
if($DiskSSD){
 $diskNumbers=@();$diskIndex=0
 foreach($inputDisk in @($DiskSSD,$DiskHDD)){
  $diskIndex++
  $storageType=if($diskIndex -eq 1){'SSD'}else{'HDD'}
  $destination=[IO.Path]::GetFullPath(($inputDisk.TrimEnd('\')+'\'))
  $volume=[IO.Path]::GetPathRoot($destination)
  if($volume -notmatch '^[A-Za-z]:\\$'){throw '需要本地磁盘路径 / Local disk paths required'}
  $disk=Get-Partition -DriveLetter $volume.Substring(0,1)|Get-Disk
  if(-not $WorkflowOnly -and $diskNumbers -contains $disk.Number){throw '需要两个不同的物理磁盘 / Two distinct physical disks are required'}
  $diskNumbers+= $disk.Number
  $deployment=Join-Path $destination ('ElectronBench-'+[guid]::NewGuid().ToString('N').Substring(0,8))
  foreach($product in $products){
   $id=$storageType.ToLowerInvariant()+'-'+$product.variant
   $targetDir=Join-Path $deployment $product.variant
   $sourceDir=Split-Path $product.source -Parent
   if(($targetDir+'\').StartsWith($sourceDir.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or ($root+'\').StartsWith($sourceDir.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw '部署和输出目录不能在源目录内 / Deployment and output cannot be inside source'}
   if(Test-Path -LiteralPath $targetDir){throw '部署目录已存在 / Deployment already exists'}
   Copy-BenchmarkTree $sourceDir $targetDir
   $targets+=@{id=$id;storage=($storageType+' ('+$volume+')');diskNumber=$disk.Number;diskModel=$disk.FriendlyName;variant=$product.variant;source=$product.source;runtime=(Join-Path $targetDir ([IO.Path]::GetFileName($product.source)))}
  }
 }
}else{$targets=@(@{id='single';storage='Original path';variant='A';source=$electron;runtime=$electron})}
$cfg=@{version=2;workflowOnly=[bool]$WorkflowOnly;electron=$electron;targets=$targets;node=$node;user=$identity.Name;sid=$identity.User.Value;count=$Count;warmups=$Warmups;samples=@();installedBoot=$boot;created=(Get-Date).ToUniversalTime().ToString('o');profileMethod='Independent copies of an initialized seed per target';runKeyName='ElectronBenchmark'}
if($WorkflowOnly){Say '仅验证流程，结果不可作为 SSD/HDD 性能对比' 'Workflow validation only; not an SSD/HDD performance comparison'}
Save-Json (Join-Path $root 'config.json') $cfg
& $node (Join-Path $root 'runner\data.cjs') plan $root
if($LASTEXITCODE -ne 0){throw '采样顺序生成失败 / Sampling plan failed'}
$cfg=Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw|ConvertFrom-Json
$samples=$cfg.samples
Save-Json (Join-Path $root 'environment.json') @{os=(Get-CimInstance Win32_OperatingSystem|Select-Object Caption,Version,BuildNumber);cpu=(Get-CimInstance Win32_Processor|Select-Object Name,NumberOfLogicalProcessors);disks=@(Get-CimInstance Win32_DiskDrive|Select-Object Model,Size,InterfaceType);volumes=@(Get-CimInstance Win32_LogicalDisk|Select-Object DeviceID,FileSystem,Size,FreeSpace);memoryBytes=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory;user=$identity.Name;sid=$identity.User.Value}
foreach($target in $targets){
$seed=Join-Path $root ('profiles\seed-'+$target.id)
Say '使用当前账户实际启动预检并初始化配置' 'Preflighting a real launch and initializing the profile as the current user'
& $node (Join-Path $root 'harness\launch.cjs') $target.variant $target.runtime $seed (Join-Path $root ('preflight-'+$target.id+'.json'))
if($LASTEXITCODE -ne 0){throw '启动预检失败，未设置自动运行 / Preflight failed; automatic startup was not installed'}
$raw=Get-Content -LiteralPath (Join-Path $root ('preflight-'+$target.id+'.json')) -Raw|ConvertFrom-Json
if(-not $raw.valid -or $raw.stderr){throw '启动预检结果无效 / Invalid preflight result'}
foreach($sample in @($samples|Where-Object target -eq $target.id)){Copy-BenchmarkTree $seed $sample.profile}
$preflightCopy=Join-Path $root ('profiles\preflight-copy-'+$target.id)
Copy-BenchmarkTree $seed $preflightCopy
& $node (Join-Path $root 'harness\launch.cjs') $target.variant $target.runtime $preflightCopy (Join-Path $root ('preflight-copy-'+$target.id+'.json'))
if($LASTEXITCODE -ne 0){throw '复制配置的实际启动失败，未设置自动运行 / Cloned-profile launch failed; automatic startup was not installed'}
$copyRaw=Get-Content -LiteralPath (Join-Path $root ('preflight-copy-'+$target.id+'.json')) -Raw|ConvertFrom-Json
if(-not $copyRaw.valid -or $copyRaw.stderr){throw '复制配置预检无效 / Invalid cloned-profile preflight'}
}
& $node (Join-Path $root 'runner\data.cjs') freeze $root
if($LASTEXITCODE -ne 0){throw '冻结输入失败 / Input snapshot failed'}
Save-Json (Join-Path $root 'state.json') @{status='PREPARED';nextIndex=0;lastBoot='';warmBoot='';restarts=0;error='';updated=(Get-Date).ToUniversalTime().ToString('o')}
Say "每个路径 $Warmups 次热身、$Count 次热启动、$Count 次冷启动，共 $($samples.Count) 次启动。请提前配置自动登录、保存工作。" "Per target: $Warmups warmups, $Count warm and $Count cold launches; total $($samples.Count). Configure automatic login and save your work."
Say '停止：在输出目录创建 STOP 文件，或运行 runner\control.ps1 -Action Stop。' 'Stop: create a STOP file in the output directory, or run runner\control.ps1 -Action Stop.'
if($PrepareOnly){Say '准备完成，尚未设置启动项或开始正式测量。执行输出目录的 runner\control.ps1 -Action Start 开始。' 'Prepared without installing startup or starting formal measurements. Run runner\control.ps1 -Action Start in the output directory to begin.'}
else{& (Join-Path $root 'runner\control.ps1') -Action Start}
