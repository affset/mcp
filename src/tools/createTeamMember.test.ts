import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { CreateTeamMemberResponse } from "../types.js";
import { createTeamMember } from "./createTeamMember.js";

function fakeClient(response?: unknown) {
  const posts: Array<{ path: string; body: unknown }> = [];
  const created: CreateTeamMemberResponse = {
    token: "sk_live_test_token",
    email: "pub@example.com",
    role: "publisher",
    created_at: Date.UTC(2026, 6, 29),
    permissions: ["read", "write"],
  };
  const client = {
    post: async (path: string, body: unknown) => {
      posts.push({ path, body });
      return response === undefined ? created : response;
    },
  } as unknown as AffsetClient;
  return { client, posts };
}

const baseArgs = {
  email: "pub@example.com",
  role: "publisher" as const,
  confirm: false,
};

describe("createTeamMember confirmation", () => {
  it("does not write during the default dry run", async () => {
    const { client, posts } = fakeClient();
    const result = await createTeamMember(client, baseArgs);

    assert.equal(result.isError, undefined);
    assert.equal(posts.length, 0);
  });

  it("creates exactly once after confirmation, defaulting permissions to read+write", async () => {
    const { client, posts } = fakeClient();
    const result = await createTeamMember(client, { ...baseArgs, confirm: true });

    assert.equal(result.isError, undefined);
    assert.deepEqual(posts, [
      {
        path: "/api/api-keys?type=user",
        body: { email: "pub@example.com", role: "publisher", permissions: ["read", "write"] },
      },
    ]);
  });

  it("echoes the token exactly once in the confirmed result text", async () => {
    const { client } = fakeClient();
    const result = await createTeamMember(client, { ...baseArgs, confirm: true });

    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.equal(text.split("sk_live_test_token").length - 1, 1);
  });

  it("never includes a token in the dry-run preview", async () => {
    const { client } = fakeClient();
    const result = await createTeamMember(client, baseArgs);

    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.doesNotMatch(text, /sk_live_/);
  });

  it("does not report the successful create as failed when optional response fields are invalid", async () => {
    const { client, posts } = fakeClient({
      token: "sk_live_test_token",
      email: "pub@example.com",
      role: "publisher",
      expires_at: Number.POSITIVE_INFINITY,
    });
    const result = await createTeamMember(client, { ...baseArgs, confirm: true });

    assert.equal(posts.length, 1);
    assert.equal(result.isError, undefined);
    assert.match((result.content[0] as { type: "text"; text: string }).text, /created/);
  });

  it("warns not to retry when a successful response omits the token", async () => {
    const { client, posts } = fakeClient({
      email: "pub@example.com",
      role: "publisher",
    });
    const result = await createTeamMember(client, { ...baseArgs, confirm: true });
    const text = (result.content[0] as { type: "text"; text: string }).text;

    assert.equal(posts.length, 1);
    assert.equal(result.isError, undefined);
    assert.match(text, /member was created/i);
    assert.match(text, /Do not retry/);
    assert.doesNotMatch(text, /undefined/);
  });

  it("does not echo an oversized token into model context", async () => {
    const { client, posts } = fakeClient({
      email: "pub@example.com",
      role: "publisher",
      token: `sk_live_${"a".repeat(500)}`,
    });
    const result = await createTeamMember(client, { ...baseArgs, confirm: true });
    const text = (result.content[0] as { type: "text"; text: string }).text;

    assert.equal(posts.length, 1);
    assert.equal(result.isError, undefined);
    assert.match(text, /Do not retry/);
    assert.doesNotMatch(text, /aaaa/);
  });

  it("always includes read when only write is requested", async () => {
    const { client, posts } = fakeClient();
    await createTeamMember(client, {
      ...baseArgs,
      permissions: ["write"],
      confirm: true,
    });

    assert.deepEqual((posts[0]?.body as { permissions: string[] }).permissions, ["read", "write"]);
  });

  it("rejects an already-expired key before writing", async () => {
    const { client, posts } = fakeClient();
    const result = await createTeamMember(client, {
      ...baseArgs,
      expires_at: 1,
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal(posts.length, 0);
    assert.match((result.content[0] as { type: "text"; text: string }).text, /future/);
  });
});

describe("createTeamMember manager_email validation", () => {
  it("rejects manager_email for a role that cannot have one", async () => {
    const { client, posts } = fakeClient();
    const result = await createTeamMember(client, {
      email: "mgr@example.com",
      role: "manager",
      manager_email: "owner@example.com",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal(posts.length, 0);
  });

  it("passes manager_email through for role=publisher", async () => {
    const { client, posts } = fakeClient();
    await createTeamMember(client, {
      ...baseArgs,
      manager_email: "pubmgr@example.com",
      confirm: true,
    });

    assert.equal(
      (posts[0]?.body as { manager_email?: string }).manager_email,
      "pubmgr@example.com",
    );
  });
});
