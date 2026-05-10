import { describe, expect, it } from "vitest";

import {
  DEFAULT_SNIPPET_CHAR_LIMIT,
  REDACTED_PLACEHOLDER,
  URL_PLACEHOLDER,
  makeSafeRedactor,
  normalizeText,
  safeNativeMemoryText,
} from "./redaction.js";

describe("normalizeText", () => {
  it("collapses runs of whitespace to single spaces", () => {
    expect(normalizeText("foo   bar\n\nbaz\tqux")).toBe("foo bar baz qux");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });
});

describe("safeNativeMemoryText", () => {
  describe("credential redaction", () => {
    it("redacts api_key", () => {
      expect(safeNativeMemoryText("my api_key=abc123")).toBe(REDACTED_PLACEHOLDER);
      expect(safeNativeMemoryText("API-KEY: secret")).toBe(REDACTED_PLACEHOLDER);
    });

    it("redacts api_token / access_token / bearer token", () => {
      expect(safeNativeMemoryText("api_token: 123")).toBe(REDACTED_PLACEHOLDER);
      expect(safeNativeMemoryText("access_token=xyz")).toBe(REDACTED_PLACEHOLDER);
      expect(safeNativeMemoryText("Bearer Token foo")).toBe(REDACTED_PLACEHOLDER);
    });

    it("redacts password", () => {
      expect(safeNativeMemoryText("password=hunter2")).toBe(REDACTED_PLACEHOLDER);
    });

    it("redacts Stripe live secret keys", () => {
      expect(safeNativeMemoryText("here is sk_live_AbCdEf12345")).toBe(
        REDACTED_PLACEHOLDER,
      );
    });

    it("redacts HuggingFace tokens", () => {
      expect(safeNativeMemoryText("token hf_AbCdEfGhIj1234567890")).toBe(
        REDACTED_PLACEHOLDER,
      );
    });

    it("does NOT redact harmless text containing 'key' or 'token' as substrings", () => {
      // Word-boundary matters: "monkey" must not trigger the api_key pattern.
      expect(safeNativeMemoryText("the monkey ate a token of trust")).not.toBe(
        REDACTED_PLACEHOLDER,
      );
      // But "api_token" as a real word does.
      expect(safeNativeMemoryText("the api_token must be set")).toBe(
        REDACTED_PLACEHOLDER,
      );
    });
  });

  describe("URL stripping", () => {
    it("replaces http and https URLs with [link]", () => {
      expect(
        safeNativeMemoryText("see https://example.com/path?q=1 for details"),
      ).toBe(`see ${URL_PLACEHOLDER} for details`);
      expect(safeNativeMemoryText("ref http://localhost:7500")).toBe(
        `ref ${URL_PLACEHOLDER}`,
      );
    });

    it("strips multiple URLs in one string", () => {
      expect(
        safeNativeMemoryText("a https://x.com b https://y.com c"),
      ).toBe(`a ${URL_PLACEHOLDER} b ${URL_PLACEHOLDER} c`);
    });
  });

  describe("length capping", () => {
    it("does not truncate text within the limit", () => {
      const text = "a".repeat(50);
      expect(safeNativeMemoryText(text, 100)).toBe(text);
    });

    it("truncates text over the limit and appends '...'", () => {
      const text = "a".repeat(200);
      const result = safeNativeMemoryText(text, 50);
      expect(result.length).toBe(50);
      expect(result.endsWith("...")).toBe(true);
    });

    it("uses default limit of 180", () => {
      expect(DEFAULT_SNIPPET_CHAR_LIMIT).toBe(180);
      const text = "x".repeat(200);
      expect(safeNativeMemoryText(text).length).toBe(180);
    });
  });

  describe("ordering", () => {
    it("redacts before truncating (a credential in a long string still becomes the placeholder)", () => {
      const text = "lorem ipsum ".repeat(50) + " api_key=secret";
      expect(safeNativeMemoryText(text, 50)).toBe(REDACTED_PLACEHOLDER);
    });
  });
});

describe("makeSafeRedactor", () => {
  it("extends the pattern set with caller-provided regexes", () => {
    const redact = makeSafeRedactor([/\bvendor_secret_[A-Z0-9]+\b/]);
    expect(redact("vendor_secret_ABC123 was leaked")).toBe(REDACTED_PLACEHOLDER);
    // Built-in patterns still work
    expect(redact("api_key=foo")).toBe(REDACTED_PLACEHOLDER);
    // Harmless text still passes through
    expect(redact("hello world")).toBe("hello world");
  });

  it("respects a caller-provided length limit", () => {
    const redact = makeSafeRedactor([], 20);
    const result = redact("a".repeat(100));
    expect(result.length).toBe(20);
  });
});
