function Write-LoadRecord {
 param([string]$Path,[object]$Record)
 $json=$Record|ConvertTo-Json -Depth 10 -Compress
 [IO.File]::AppendAllText($Path,$json+"`r`n",[Text.UTF8Encoding]::new($false))
}
function Get-SystemLoadSnapshot {
 param([string]$Reason,[Nullable[double]]$Cpu)
 $logical=[Environment]::ProcessorCount
 $record=[ordered]@{type='system-load';time=(Get-Date).ToUniversalTime().ToString('o');reason=$Reason;totalCpuPercent=$Cpu;logicalProcessors=$logical;observerPid=$PID;errors=@();topCpu=@();topIo=@();disks=@();memory=$null}
 try{
  $processes=@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -OperationTimeoutSec 5 -ErrorAction Stop|Where-Object {$_.IDProcess -gt 0 -and $_.Name -ne '_Total'})
  $format={param($p)[ordered]@{name=$p.Name;pid=[int]$p.IDProcess;cpuMachinePercent=[math]::Round([double]$p.PercentProcessorTime/$logical,2);cpuRawPercent=$p.PercentProcessorTime;ioReadBytesPerSec=$p.IOReadBytesPersec;ioWriteBytesPerSec=$p.IOWriteBytesPersec;privateWorkingSetBytes=$p.WorkingSetPrivate;elapsedSeconds=$p.ElapsedTime}}
  $record.topCpu=@($processes|Sort-Object PercentProcessorTime -Descending|Select-Object -First 12|ForEach-Object {& $format $_})
  $record.topIo=@($processes|Sort-Object @{Expression={[double]$_.IOReadBytesPersec+[double]$_.IOWriteBytesPersec};Descending=$true}|Select-Object -First 12|ForEach-Object {& $format $_})
 }catch{$record.errors+=@{source='process-counters';message=$_.Exception.Message}}
 try{
  $pids=@($record.topCpu.pid)+@($record.topIo.pid)
  $record.services=@(Get-CimInstance Win32_Service -OperationTimeoutSec 5 -ErrorAction Stop|Where-Object {$_.ProcessId -gt 0 -and $_.ProcessId -in $pids}|Select-Object Name,DisplayName,ProcessId,State)
 }catch{$record.errors+=@{source='services';message=$_.Exception.Message}}
 try{$record.disks=@(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -OperationTimeoutSec 5 -ErrorAction Stop|Select-Object Name,DiskReadBytesPersec,DiskWriteBytesPersec,CurrentDiskQueueLength,PercentIdleTime,AvgDisksecPerRead,AvgDisksecPerWrite)}catch{$record.errors+=@{source='disk-counters';message=$_.Exception.Message}}
 try{$record.memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -OperationTimeoutSec 5 -ErrorAction Stop|Select-Object AvailableMBytes,PercentCommittedBytesInUse,PagesInputPersec,PagesOutputPersec}catch{$record.errors+=@{source='memory-counters';message=$_.Exception.Message}}
 $record.ioNote='Process IO includes file/device/network operations; not proof of physical disk IO. CPU normalized over logical processors. Snapshots identify correlation, not causality.'
 return $record
}
function Wait-BenchmarkIdle {
 param([string]$LogPath,[int]$MaxWaitSeconds=1200,[ValidateRange(10,100)][int]$MaxCpuPercent=10,[scriptblock]$CheckStop={})
 $idle=[Collections.Generic.List[object]]::new();$stable=0;$clock=[Diagnostics.Stopwatch]::StartNew();$nextSnapshot=0.0
 Write-LoadRecord $LogPath @{type='idle-start';time=(Get-Date).ToUniversalTime().ToString('o');thresholdPercent=$MaxCpuPercent;consecutiveReadings=3;maxWaitSeconds=$MaxWaitSeconds}
 do{
  & $CheckStop
  try{
   $counter=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -OperationTimeoutSec 5 -ErrorAction Stop
   if($null -eq $counter -or $null -eq $counter.PercentProcessorTime){throw 'CPU performance counter unavailable'}
   $cpu=[double]$counter.PercentProcessorTime
   if($cpu -lt 0 -or $cpu -gt 100 -or [double]::IsNaN($cpu)){throw 'Invalid CPU performance counter'}
  }catch{
   Write-LoadRecord $LogPath @{type='counter-error';time=(Get-Date).ToUniversalTime().ToString('o');message=$_.Exception.Message}
   Write-LoadRecord $LogPath (Get-SystemLoadSnapshot 'counter-error' $null)
   throw
  }
  $row=@{time=(Get-Date).ToString('o');cpu=$cpu};$idle.Add($row)
  if($cpu -le $MaxCpuPercent){$stable++}else{$stable=0}
  Write-LoadRecord $LogPath @{type='idle-reading';time=$row.time;cpu=$cpu;consecutive=$stable;elapsedSeconds=[math]::Round($clock.Elapsed.TotalSeconds,2)}
  if($stable -ge 3){Write-LoadRecord $LogPath @{type='idle-ready';time=(Get-Date).ToUniversalTime().ToString('o');elapsedSeconds=$clock.Elapsed.TotalSeconds};return [pscustomobject]@{Ready=$true;Readings=$idle.ToArray();Log=$LogPath}}
  if($cpu -gt $MaxCpuPercent -and $clock.Elapsed.TotalSeconds -ge $nextSnapshot){
   Write-LoadRecord $LogPath (Get-SystemLoadSnapshot 'cpu-above-threshold' $cpu)
   $nextSnapshot=$clock.Elapsed.TotalSeconds+30
   # Require fresh idle observations after diagnostics; never profile processes after the accepted idle window.
   $stable=0
  }
  if($clock.Elapsed.TotalSeconds -ge $MaxWaitSeconds){break}
  Start-Sleep -Seconds 2
 }while($true)
 Write-LoadRecord $LogPath (Get-SystemLoadSnapshot 'idle-timeout' $cpu)
 Write-LoadRecord $LogPath @{type='idle-timeout';time=(Get-Date).ToUniversalTime().ToString('o');elapsedSeconds=$clock.Elapsed.TotalSeconds;lastCpu=$cpu}
 return [pscustomobject]@{Ready=$false;Readings=$idle.ToArray();Log=$LogPath}
}
