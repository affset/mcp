import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readResponseText, ResponseTooLargeError } from "./readBody.js";

describe("readResponseText", () => {
  it("returns the decoded body when it fits the limit", async () => {
    const res = new Response("hello", { status: 200 });
    assert.equal(await readResponseText(res, 100), "hello");
  });

  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const res = new Response("tiny", {
      status: 200,
      headers: { "Content-Length": "1000" },
    });
    await assert.rejects(
      () => readResponseText(res, 10),
      (err: unknown) =>
        err instanceof ResponseTooLargeError && err.kind === "declared" && err.size === 1000,
    );
  });

  it("cancels an oversized stream without masking the error on releaseLock", async () => {
    const chunk = new Uint8Array(8);
    const res = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      { status: 200 },
    );

    await assert.rejects(
      () => readResponseText(res, 10),
      (err: unknown) => err instanceof ResponseTooLargeError && err.kind === "streaming",
    );
  });
});
