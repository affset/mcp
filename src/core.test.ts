import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

describe("core declaration portability", () => {
  it("type-checks without Node ambient types", () => {
    // This test runs from dist/, after declarations have been emitted. Treat
    // core.d.ts as a Workerd/browser consumer would: DOM + ES libs, no
    // @types/node. A NodeJS.ProcessEnv leak in any public dependency fails it.
    const coreDeclaration = fileURLToPath(new URL("./core.d.ts", import.meta.url));
    const program = ts.createProgram([coreDeclaration], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      types: [],
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    });

    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    assert.deepEqual(diagnostics, []);
  });
});
