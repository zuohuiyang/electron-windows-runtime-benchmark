param([ValidateSet('Start','Run','Stop','Status')][string]$Action='Status')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$cfg=Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw|ConvertFrom-Json
$statePath=Join-Path $root 'state.json'
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($identity.User.Value -ne $cfg.sid){throw '请使用准备实验的同一账户 / Use the account that prepared this experiment'}
function Save-State{
 $script:state.updated=(Get-Date).ToUniversalTime().ToString('o')
 $tmp=Join-Path $root 'state.next.json'
 $script:state|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $tmp -Encoding UTF8
 [IO.File]::Replace($tmp,$statePath,(Join-Path $root 'state.previous.json'))
}
function Remove-Startup{
 $registered=Get-ItemProperty -LiteralPath $key -Name $cfg.runKeyName -ErrorAction SilentlyContinue
 if($registered -and $registered.($cfg.runKeyName) -eq $script:command){Remove-ItemProperty -LiteralPath $key -Name $cfg.runKeyName}
}
$command='"'+$env:SystemRoot+'\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Action Run'
if($Action -eq 'Status'){Get-Content -LiteralPath $statePath;exit 0}
if($Action -eq 'Stop'){
 [IO.File]::WriteAllText((Join-Path $root 'STOP'),'Stop requested')
 Remove-Startup
 Write-Host '已取消登录启动；正在进行的单次采样最多等待 30 秒后停止 / Login startup removed; an active sample may take up to 30 seconds to finish.'
 exit 0
}
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw '请使用非管理员终端 / Use a non-elevated terminal'}
$lock=$null;$state=$null;$awake=$false;$transcript=$false
function Check-Stop{if(Test-Path -LiteralPath (Join-Path $root 'STOP')){throw '收到停止请求 / Stop requested'}}
function Node-Step([string]$verb){& $cfg.node (Join-Path $PSScriptRoot 'data.cjs') $verb $root;if($LASTEXITCODE -ne 0){throw "数据校验失败 / Data step failed: $verb"}}
function Assert-Desktop{
 Check-Stop
 $session=(Get-Process -Id $PID).SessionId
 $desktops=@(Get-Process explorer -ErrorAction SilentlyContinue)
 if($session -eq 0 -or -not($desktops|Where-Object SessionId -eq $session) -or [PilotDesktop]::Name() -ne 'Default'){throw '需要已解锁的交互桌面 / An unlocked interactive desktop is required'}
 $otherDesktops=@($desktops|Where-Object SessionId -ne $session)
 if($otherDesktops){
  if(-not $cfg.warmOnly){throw '另一个用户桌面仍在运行 / Another user desktop is running'}
  $sessions=@(& "$env:SystemRoot\System32\quser.exe" 2>$null)
  if($LASTEXITCODE -ne 0){throw '无法检查其他会话状态 / Cannot check other session states'}
  foreach($desktop in $otherDesktops){
   if(-not($sessions|Where-Object {$_ -match ("\s+"+$desktop.SessionId+"\s+Disc\s+")})){
    throw '另一个用户桌面仍在运行 / Another user desktop is running'
   }
  }
 }
 $name=@($cfg.samples|ForEach-Object {[IO.Path]::GetFileNameWithoutExtension($_.runtime)}|Select-Object -Unique)
 if(Get-Process -Name @($name + @('vmware-vmx')) -ErrorAction SilentlyContinue){throw '被测程序或虚拟机正在运行，请先关闭 / Close the target application and running VMs first'}
}
function Restart-Next{
 if($cfg.warmOnly){throw '热启动专用实验禁止重启 / Warm-only run cannot reboot'}
 Assert-Desktop
 if($state.restarts -ge @($cfg.samples|Where-Object phase -eq 'cold').Count){throw '已达到重启次数上限 / Reboot limit reached'}
 $state.restarts++;$state.status='WAITING_REBOOT';Save-State
 Write-Host '即将重启，登录后自动续跑 / Restarting; measurement resumes after login.'
 # /t 0 without /f does not implicitly force-close applications.
 & "$env:SystemRoot\System32\shutdown.exe" /r /t 0
 if($LASTEXITCODE -ne 0){throw 'Windows 拒绝重启 / Windows rejected the restart'}
 for($i=0;$i -lt 12;$i++){Start-Sleep -Seconds 5}
 throw '重启未完成，已停止自动重试 / Restart did not complete; no automatic retry'
}
try{
 try{$lock=[IO.File]::Open((Join-Path $root 'runner.lock'),'OpenOrCreate','ReadWrite','None')}
 catch [IO.IOException]{Write-Host '已有采样进程 / A runner is already active';exit 0}
 $state=Get-Content -LiteralPath $statePath -Raw|ConvertFrom-Json
 if($Action -eq 'Run' -and $state.status -in @('COMPLETE','FAILED','STOPPED','PREPARED')){exit 0}
 if($Action -eq 'Start'){
  if($state.status -ne 'PREPARED'){throw '仅支持启动新准备的实验；失败样本不可自动替换 / Only a prepared experiment can start; failed samples are not automatically replaced'}
  Check-Stop
  $registered=Get-ItemProperty -LiteralPath $key -Name $cfg.runKeyName -ErrorAction SilentlyContinue
  if($registered -and $registered.($cfg.runKeyName) -ne $command){throw '已有其他自动实验 / Another experiment is registered'}
  if($command.Length -gt 260){throw '输出路径太长，无法注册登录启动 / Output path is too long for login startup'}
  if(-not $cfg.warmOnly){
   if(-not(Test-Path -LiteralPath $key)){New-Item -Path $key|Out-Null}
   New-ItemProperty -LiteralPath $key -Name $cfg.runKeyName -Value $command -PropertyType String -Force|Out-Null
  }
  $state.status='STARTING';Save-State
 }
 Start-Transcript -Path (Join-Path $root ('logs\run-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.log'))|Out-Null;$transcript=$true
 Add-Type -Path (Join-Path $PSScriptRoot 'desktop.cs')
 Add-Type -Path (Join-Path $PSScriptRoot 'priority.cs')
 [void][PilotDesktop]::SetThreadExecutionState([uint32]2147483651);$awake=$true
 $os=Get-CimInstance Win32_OperatingSystem
 $boot=$os.LastBootUpTime.ToUniversalTime().ToString('o')
 if($state.status -eq 'WAITING_REBOOT' -and $boot -eq $state.lastBoot){Write-Host '等待新的系统启动 / Waiting for a new boot';exit 0}
 # Never re-launch a potentially already measured sample after an interrupted process.
 if($state.status -in @('MEASURING','VERIFYING')){throw '上次采样被中断，保留现场 / Previous sample interrupted; evidence retained'}
 for($i=0;$i -lt 300;$i++){
  Check-Stop
  if([PilotDesktop]::Name() -eq 'Default' -and (Get-Process explorer -ErrorAction SilentlyContinue|Where-Object SessionId -eq (Get-Process -Id $PID).SessionId)){break}
  Start-Sleep -Seconds 2
 }
 Assert-Desktop
 . (Join-Path $PSScriptRoot 'system-load.ps1')
 while($state.nextIndex -lt $cfg.samples.Count){
  $item=$cfg.samples[$state.nextIndex]
  if($item.phase -eq 'cold'){
   if($boot -eq $state.lastBoot -or $boot -eq $cfg.installedBoot){Restart-Next}
  }else{
   if($state.warmBoot -and $state.warmBoot -ne $boot){throw '热启动批次不得跨重启 / Warm batch must stay in one boot'}
   $state.warmBoot=$boot
  }
  $prefix=Join-Path $root ('results\'+$item.id)
  if(Test-Path -LiteralPath ($prefix+'-sample.json')){throw '已有样本，不覆盖 / Sample already exists; refusing overwrite'}
  $state.status='WAITING_IDLE';Save-State
  while(((Get-Date)-$os.LastBootUpTime).TotalSeconds -lt 120){Check-Stop;Start-Sleep -Seconds 2}
  Write-Host "等待系统空闲：$($item.id) / Waiting for idle: $($item.id)"
   $cpuLimit=if($cfg.workflowOnly){100}else{10}
  $idle=Wait-BenchmarkIdle -LogPath ($prefix+'-idle.jsonl') -MaxWaitSeconds 1200 -MaxCpuPercent $cpuLimit -CheckStop {Check-Stop}
  if(-not $idle.Ready){throw '系统繁忙超时，占用进程已记录 / Idle wait timed out; process diagnostics saved'}
  Assert-Desktop
  $priority=@{cpu=[BenchmarkPriority]::Cpu();io=[BenchmarkPriority]::Query(33);memory=[BenchmarkPriority]::Query(39)}
  @{user=$cfg.user;sid=$identity.User.Value;session=(Get-Process -Id $PID).SessionId;elevated=$false;boot=$boot;idle=@($idle.Readings);controllerPriority=$priority;sample=$item}|ConvertTo-Json -Depth 20|Set-Content -LiteralPath ($prefix+'-context.json') -Encoding UTF8
  if($priority.cpu -ne 'Normal' -or $priority.io -ne 2 -or $priority.memory -ne 5){throw '控制器优先级异常，已记录并停止 / Unexpected controller priority; recorded and stopped'}
  $state.lastBoot=$boot;$state.status='MEASURING';Save-State
  Write-Host "正在测量：$($item.id) / Measuring: $($item.id)"
  & $cfg.node (Join-Path $root 'harness\launch.cjs') $item.variant $item.runtime $item.profile ($prefix+'-sample.json')
  if($LASTEXITCODE -ne 0){throw '单次测量失败 / Launch measurement failed'}
  $state.status='VERIFYING';Save-State
  # Hash only AFTER measurement. Cold samples are followed by another reboot.
  Node-Step verify
  @{status='SUCCESS';inputsVerifiedAfter=$true}|ConvertTo-Json|Set-Content -LiteralPath ($prefix+'-result.json') -Encoding UTF8
  Node-Step validate
  $state.nextIndex++;$state.status='SAMPLE_SAVED';Save-State
  Check-Stop
  if($item.phase -eq 'cold' -and $state.nextIndex -lt $cfg.samples.Count -and $cfg.samples[$state.nextIndex].phase -eq 'cold'){Restart-Next}
 }
 Node-Step report
 $state.status='COMPLETE';Save-State;Remove-Startup
 Write-Host "全部完成，报告：$root\RESULTS.md / Complete. Report: $root\RESULTS.md"
 try{Start-Process -FilePath "$env:SystemRoot\System32\notepad.exe" -ArgumentList ('"'+$root+'\RESULTS.md"')}
 catch{Write-Host '报告已保存，自动打开失败 / Report saved; opening it failed'}
}catch{
 $message=$_.Exception.Message
 if($state){$state.status=if(Test-Path -LiteralPath (Join-Path $root 'STOP')){'STOPPED'}else{'FAILED'};$state.error=$message;Save-State}
 Remove-Startup
 $notice="采样停止，不会继续自动重启 / Sampling stopped; no further automatic reboot.`r`n$message`r`n$root"
 $notice|Set-Content -LiteralPath (Join-Path $root 'ATTENTION.txt') -Encoding UTF8
 Write-Host $notice
 exit 1
}finally{
 if($awake){[void][PilotDesktop]::SetThreadExecutionState([uint32]2147483648)}
 if($transcript){Stop-Transcript|Out-Null}
 if($lock){$lock.Dispose()}
}
