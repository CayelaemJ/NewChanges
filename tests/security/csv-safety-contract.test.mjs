// Contract prevents exporting sensitive raw values through an old CSV path.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src=(name)=>readFileSync(new URL("../../"+name,import.meta.url),"utf8");
const exporter=src("src/services/exportService.ts");
const templates=src("src/services/templateGenerator.ts");
const safe=src("src/services/csvSafety.ts");

test("all admin and import-batch CSV rows share the spreadsheet-safe encoder",()=>{
  assert.match(exporter,/import \{ csvEscape \} from "\.\/csvSafety\.js"/);
  assert.match(exporter,/columns\.map\(csvEscape\)\.join/);
  assert.match(exporter,/columns\.map\(\(c\) => csvEscape\(r\[c\]\)\)/);
  assert.match(exporter,/exportImportBatchCsv/);
  assert.doesNotMatch(exporter,/function csvEscape\(/);
});

test("template CSV examples also use shared defensive escaping",()=>{
  assert.match(templates,/import \{ csvEscape \} from "\.\/csvSafety\.js"/);
  assert.match(templates,/format\.fields\.map\(\(f\) => csvEscape\(f\.name\)\)/);
  assert.match(templates,/format\.fields\.map\(\(f\) => csvEscape\(f\.example \?\? ""\)\)/);
});

test("CSV encoder quotes carriage returns and guards formula leaders",()=>{
  assert.match(safe,/\[=\+\\-@\]/);
  assert.match(safe,/\r\\n/);
});
