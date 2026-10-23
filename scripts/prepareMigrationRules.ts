import { prepareMigrationRules } from "./migrationRules";
try { console.log(JSON.stringify(prepareMigrationRules())); }
catch { console.error("Migration rules preparation stopped. Review local candidate/configuration consistency. No values were logged or rules published."); process.exitCode = 1; }
