import { prepareFounderRules } from "./founderRules";

try {
  console.log(JSON.stringify(prepareFounderRules()));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Rules preparation failed. No values were logged and no rules were published.");
  process.exitCode = 1;
}
