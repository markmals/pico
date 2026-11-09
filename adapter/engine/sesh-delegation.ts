import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";

import type { ForwardLaunch, LaunchArguments } from "../worktrees/child-launch.ts";

import { PicoSessionError } from "./errors.ts";

/** Decides where an accepted launch's child works, then forwards the launch to Sesh. */
export type ChildLauncher = (
    args: LaunchArguments,
    forward: ForwardLaunch,
    onUpdate: AgentToolUpdateCallback | undefined,
    signal: AbortSignal | undefined,
) => Promise<AgentToolResult>;

const ROOT_CONSTRAINTS = [
    "$ref",
    "$dynamicRef",
    "allOf",
    "anyOf",
    "oneOf",
    "const",
    "enum",
    "not",
    "if",
    "then",
    "else",
    "dependencies",
    "dependentRequired",
    "dependentSchemas",
    "patternProperties",
    "propertyNames",
];

function launchParameters(schema: unknown): Record<string, unknown> {
    if (
        typeof schema !== "object" ||
        schema === null ||
        Array.isArray(schema) ||
        !("type" in schema) ||
        schema.type !== "object" ||
        !("properties" in schema) ||
        typeof schema.properties !== "object" ||
        schema.properties === null ||
        Array.isArray(schema.properties) ||
        ("required" in schema &&
            schema.required !== undefined &&
            (!Array.isArray(schema.required) ||
                !schema.required.every(key => typeof key === "string"))) ||
        ROOT_CONSTRAINTS.some(key => Object.hasOwn(schema, key))
    ) {
        throw new PicoSessionError(
            "Incompatible sesh/start_session input schema: Pico requires a plain object definition without root references or conditional constraints.",
        );
    }
    const properties: Record<string, unknown> = { ...schema.properties };
    delete properties.agent;
    if (
        ("required" in schema &&
            Array.isArray(schema.required) &&
            schema.required.includes("agent")) ||
        ("additionalProperties" in schema &&
            schema.additionalProperties === false &&
            "minProperties" in schema &&
            typeof schema.minProperties === "number" &&
            schema.minProperties > Object.keys(properties).length)
    ) {
        throw new PicoSessionError(
            "Incompatible sesh/start_session input schema: the host contract must accept an omitted agent field.",
        );
    }
    return {
        ...schema,
        properties,
        ...("required" in schema && Array.isArray(schema.required)
            ? { required: [...schema.required] }
            : {}),
    };
}

export function constrainSeshDelegation(
    tool: CustomTool,
    schema: unknown,
    launch: ChildLauncher,
): CustomTool {
    const parameters = launchParameters(schema);
    const description =
        `${tool.description}\nChildren inherit this session's registered Pico agent. Do not supply an agent field; selecting another harness is unsupported.` +
        "\nEach child starts in a new worktree on a new branch from this session's last commit, so commit first (a launch from a checkout with uncommitted changes fails); its commits stay on that branch for deliberate integration, and once its turn ends without changes Pico removes the worktree.";
    const execute: CustomTool["execute"] = (id, args, onUpdate, context, signal) => {
        if (typeof args === "object" && args !== null && Object.hasOwn(args, "agent")) {
            throw new Error(
                "Pico child sessions inherit this session's agent; an agent override is not supported. Omit the agent field.",
            );
        }
        return launch(
            args as LaunchArguments,
            next => tool.execute(id, next, onUpdate, context, signal),
            onUpdate,
            signal,
        );
    };
    // Keep forbidden fields visible through OMP's schema-healing pass.
    const adapted: CustomTool & Pick<AgentTool, "lenientArgValidation"> = Object.create(tool, {
        lenientArgValidation: { value: true, enumerable: true },
    });
    const boundMethods = new WeakMap<object, unknown>();
    return new Proxy(adapted, {
        get(target, property) {
            if (property === "parameters") return parameters;
            if (property === "description") return description;
            if (property === "execute") return execute;
            const member = Reflect.get(target, property, tool);
            if (typeof member !== "function") return member;
            // SDK methods retain the original receiver and its reconnect state.
            if (!boundMethods.has(member)) boundMethods.set(member, member.bind(tool));
            return boundMethods.get(member);
        },
    });
}
