import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeDiscoveryValue, fingerprintDiscoveryValue } from "../../discovery/fingerprint.js";
import { DiscoveryError } from "../../discovery/diagnostics.js";

describe("discovery canonical bindings", () => {
  it("uses ordinal key order including numeric-looking keys and preserves array order and strings", () => {
    expect(canonicalizeDiscoveryValue({ "2": "two", "10": "ten", z: ["B", "A"], A: " e\u0301 " }))
      .toBe('{"10":"ten","2":"two","A":" é ","z":["B","A"]}');
    expect(canonicalizeDiscoveryValue({ nested: { b: true, a: null } }))
      .toBe('{"nested":{"a":null,"b":true}}');
  });

  it("hashes an explicit versioned envelope deterministically without changing the payload", () => {
    const payload = { capabilities: [{ capabilityId: "support.ticket.get", capabilityVersion: "1.0.0", sourceContentHash: "example_hash" }] };
    const before = structuredClone(payload);
    const expected = 'sha256:' + createHash("sha256").update(
      '{"kind":"registry_source","payload":{"capabilities":[{"capabilityId":"support.ticket.get","capabilityVersion":"1.0.0","sourceContentHash":"example_hash"}]},"version":"1.0"}'
    ).digest("hex");
    expect(fingerprintDiscoveryValue("registry_source", payload)).toBe(expected);
    expect(fingerprintDiscoveryValue("registry_source", payload)).toBe(expected);
    expect(payload).toEqual(before);
    expect(canonicalizeDiscoveryValue([1, 2])).not.toBe(canonicalizeDiscoveryValue([2, 1]));
  });

  it("allows repeated references that are not cycles and null-prototype JSON objects", () => {
    const value = { a: 1 };
    expect(canonicalizeDiscoveryValue([value, value])).toBe('[{"a":1},{"a":1}]');
    expect(canonicalizeDiscoveryValue(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  });

  it.each([undefined, NaN, Infinity, -Infinity, 1n, Symbol("value"), () => 1, new Date(), new Map(), new Set(),
    { a: undefined }, { a: () => 1 }, [undefined], new Array(2)
  ].map(value => [value]))("rejects values outside finite JSON", (value) => {
    expect(() => canonicalizeDiscoveryValue(value)).toThrow(DiscoveryError);
  });

  it("rejects cycles, symbol properties, extra array properties, and accessors without invoking them", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    let accessed = false;
    const getter = Object.defineProperty({}, "value", { enumerable: true, get() { accessed = true; return 1; } });
    for (const value of [cyclic, { [Symbol("key")]: 1 }, Object.assign([1], { extra: true }), getter]) {
      expect(() => canonicalizeDiscoveryValue(value)).toThrow(DiscoveryError);
    }
    expect(accessed).toBe(false);
    expect(() => fingerprintDiscoveryValue("unknown" as never, {} as never)).toThrow(DiscoveryError);
  });
});

