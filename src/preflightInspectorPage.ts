import { readAcquisitionPreflight } from "./acquisitionPreflight";

const button = document.querySelector<HTMLButtonElement>("#inspect")!;
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#report")!;
const allowed = import.meta.env.DEV && import.meta.env.MODE === "development" && window.location.origin === "http://localhost:5173";
if (allowed) {
  button.disabled = false;
  button.addEventListener("click", () => {
    // Access storage only after this explicit action; never mount the scanner application.
    try {
      const report = readAcquisitionPreflight(window.localStorage);
      output.textContent = JSON.stringify(report, null, 2);
      output.hidden = false;
      status.textContent = "Read-only inspection complete. Migration remains inactive.";
    } catch { status.textContent = "Storage inspection was unavailable. Nothing was changed."; }
  });
} else status.textContent = "Inspection is disabled outside the original localhost:5173 development workspace.";
