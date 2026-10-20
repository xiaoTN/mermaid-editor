param([int]$ProcessId, [string]$DropPath, [string]$DialogTitle, [int]$Button = 2, [switch]$Activate)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MermaidNativeInput {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc fn, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int size);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("kernel32.dll")] public static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
  [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern IntPtr GlobalFree(IntPtr handle);
  public static IntPtr Find(uint process, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      uint id; GetWindowThreadProcessId(h, out id);
      if (id != process) return true;
      var text = new StringBuilder(1024);
      if (!String.IsNullOrEmpty(title)) { GetWindowText(h, text, text.Capacity); if (text.ToString() != title) return true; }
      else { GetClassName(h, text, text.Capacity); if (text.ToString() != "webview") return true; }
      found = h; return false;
    }, IntPtr.Zero);
    return found;
  }
  public static void Drop(IntPtr hwnd, string path) {
    byte[] names = Encoding.Unicode.GetBytes(path + "\0\0");
    IntPtr data = GlobalAlloc(0x42, (UIntPtr)(20 + names.Length));
    if (data == IntPtr.Zero) throw new Exception("GlobalAlloc failed");
    IntPtr buffer = GlobalLock(data);
    Marshal.WriteInt32(buffer, 0, 20); Marshal.WriteInt32(buffer, 16, 1);
    Marshal.Copy(names, 0, IntPtr.Add(buffer, 20), names.Length);
    GlobalUnlock(data);
    if (!PostMessage(hwnd, 0x233, data, IntPtr.Zero)) { GlobalFree(data); throw new Exception("PostMessage failed"); }
    // The receiver owns HDROP and calls DragFinish.
  }
}
'@
$title = if ($DialogTitle) { $DialogTitle } else { $null }
$window = [IntPtr]::Zero
$deadline = [DateTime]::UtcNow.AddSeconds(12)
while ([DateTime]::UtcNow -lt $deadline) {
    $window = [MermaidNativeInput]::Find($ProcessId, $title)
    if ($window -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 50
}
if ($window -eq [IntPtr]::Zero) { throw 'Native test window not found' }
if ($Activate) { [void][MermaidNativeInput]::PostMessage($window, 6, [IntPtr]1, [IntPtr]::Zero) }
elseif ($DropPath) { [MermaidNativeInput]::Drop($window, $DropPath) }
else {
    if (-not [MermaidNativeInput]::PostMessage($window, 0x111, [IntPtr]$Button, [IntPtr]::Zero)) { throw 'Dialog command failed' }
}
