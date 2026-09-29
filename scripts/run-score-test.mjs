import { execFileSync } from "node:child_process";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tests/score-engine.test.ts"], { stdio: "inherit" });
