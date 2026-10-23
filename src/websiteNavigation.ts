export function openCloudWorkspace() { window.location.assign("/cloud"); }

export function returnToHomepage() {
  // Enabled only for the unified development entrance or its explicitly packaged production build.
  if (import.meta.env.DEV || import.meta.env.VITE_UNIFIED_WEBSITE === "true") window.location.assign("/");
}
