/**
 * The one object guard in this skill.
 *
 * These scripts have zero dependencies — no schema validator to parse `simctl`'s JSON
 * at the boundary — so `xcrun`'s output is narrowed field by field. This guard exists
 * once, here, rather than being rewritten at each call site.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
