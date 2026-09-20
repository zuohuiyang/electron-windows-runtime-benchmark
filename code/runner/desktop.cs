using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PilotDesktop {
 [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
 [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr h,int index,StringBuilder text,int length,out int needed);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
 [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
 public static string Name(){var h=OpenInputDesktop(0,false,1);if(h==IntPtr.Zero)return "Unavailable";try{var s=new StringBuilder(256);int n;return GetUserObjectInformation(h,2,s,s.Capacity*2,out n)?s.ToString():"Unavailable";}finally{CloseDesktop(h);}}
}
