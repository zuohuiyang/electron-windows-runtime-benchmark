using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class BenchmarkPriority {
 [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int kind, out uint value, uint size, out uint returned);
 public static uint Query(int kind) {
  uint value, returned;
  using(var process=Process.GetCurrentProcess()) {
   int status=NtQueryInformationProcess(process.Handle,kind,out value,4,out returned);
   if(status!=0 || returned!=4) throw new InvalidOperationException("Cannot query process priority: "+status);
  }
  return value;
 }
 public static string Cpu() { using(var process=Process.GetCurrentProcess()) return process.PriorityClass.ToString(); }
}
