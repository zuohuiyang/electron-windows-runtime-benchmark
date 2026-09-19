#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cwchar>
#include <climits>

static uint64_t Value(FILETIME value) {
  return (static_cast<uint64_t>(value.dwHighDateTime) << 32) | value.dwLowDateTime;
}

// Read-only post-endpoint helper: common Windows QPC + precise FILETIME bridge.
int wmain(int argc, wchar_t** argv) {
  const DWORD pid = argc == 2 ? static_cast<DWORD>(std::wcstoul(argv[1], nullptr, 10)) : GetCurrentProcessId();
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return 1;
  FILETIME creation{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) {
    CloseHandle(process);
    return 2;
  }
  CloseHandle(process);
  LARGE_INTEGER frequency{}, before{}, after{}, best_before{}, best_after{};
  FILETIME utc{}, best_utc{};
  if (!QueryPerformanceFrequency(&frequency)) return 3;
  LONGLONG minimum = LLONG_MAX;
  for (int i = 0; i < 32; ++i) {
    QueryPerformanceCounter(&before);
    GetSystemTimePreciseAsFileTime(&utc);
    QueryPerformanceCounter(&after);
    if (after.QuadPart - before.QuadPart < minimum) {
      minimum = after.QuadPart - before.QuadPart;
      best_before = before;
      best_after = after;
      best_utc = utc;
    }
  }
  std::printf("{\"pid\":%lu,\"frequency\":\"%lld\",\"qpcBefore\":\"%lld\","
              "\"qpcAfter\":\"%lld\",\"utcFileTime100ns\":\"%llu\","
              "\"creationFileTime100ns\":\"%llu\"}\n",
              pid, frequency.QuadPart, best_before.QuadPart, best_after.QuadPart,
              static_cast<unsigned long long>(Value(best_utc)),
              static_cast<unsigned long long>(Value(creation)));
  return 0;
}
