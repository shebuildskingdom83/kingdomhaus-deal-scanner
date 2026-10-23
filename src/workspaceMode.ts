export function usesCloudWorkspace(pathname: string, mode: string): boolean {
  return mode === "cloud" || mode === "cloud-emulator" || pathname === "/cloud" || pathname.startsWith("/cloud/");
}
