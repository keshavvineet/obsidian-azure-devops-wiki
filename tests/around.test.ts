import { describe, expect, it } from "vitest";
import { around } from "../src/util/around";

describe("around", () => {
  it("wraps a method and puts the original back", () => {
    const target = { greet: (name: string) => `hi ${name}` };
    const original = target.greet;

    const restore = around(target, "greet", (inner) => (name: string) => inner(name).toUpperCase());
    expect(target.greet("ada")).toBe("HI ADA");

    restore();
    expect(target.greet).toBe(original);
  });

  it("leaves a later patch by someone else alone", () => {
    // Another plugin wrapping the same method must not be torn out from under it when we
    // unload — better to leave our wrapper in place than to break their patch.
    const target = { value: () => 1 };
    const restoreOurs = around(target, "value", (inner) => () => inner() + 1);
    around(target, "value", (inner) => () => inner() * 10);

    restoreOurs();

    expect(target.value()).toBe(20);
  });
});
