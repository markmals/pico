// Derived from oh-my-pi 18.14.0 src/modes/acp/acp-agent.ts (MIT; see THIRD-PARTY-NOTICES.md).

import type { ContentBlock, ResourceLink } from "@agentclientprotocol/sdk";

import { RequestError } from "@agentclientprotocol/sdk";

/**
 * The user text a prompt's content blocks become.
 *
 * Pico accepts the ACP baseline only, so an unsupported block fails the whole
 * request before any of it reaches the model.
 */
export function promptText(blocks: ContentBlock[]): string {
    return blocks
        .map(block => {
            switch (block.type) {
                case "text":
                    return block.text;
                case "resource_link":
                    return resourceReference(block);
                default:
                    throw RequestError.invalidParams(
                        undefined,
                        `prompt content of type "${block.type}" is not supported`,
                    );
            }
        })
        .join("\n");
}

/** Pico does not fetch the resource; the model sees what the link says about it. */
function resourceReference(link: ResourceLink): string {
    const parts = [`${link.name} (${link.uri})`];
    if (link.title) parts.push(link.title);
    if (link.description) parts.push(link.description);
    return parts.join(" — ");
}
