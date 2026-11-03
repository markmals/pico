import type { z } from "zod/v4";

import type { CommandSpec } from "./command.ts";
import type { searchOutput } from "./result-schemas.ts";

import { commandId, usageOf } from "./command.ts";
import { COMMANDS } from "./registry.ts";

const MAX_ITEMS = 5;

/** Words a query carries that say nothing about which command it wants. */
const FILLER = new Set(
    "a an and are as at be by can do does for from how i in is it its me my of on or please that the this to with you your".split(
        " ",
    ),
);

export function searchCommands(query: string): z.infer<typeof searchOutput> {
    const words = queryWords(query);
    const ranked = COMMANDS.map(command => ({ command, score: score(command, words) }))
        .filter(entry => entry.score > 0)
        // A stable sort leaves commands of equal score in registry order.
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_ITEMS);

    return {
        apiVersion: 1,
        query,
        items: ranked.map(({ command }) => ({
            command: commandId(command),
            summary: command.summary,
            usage: usageOf(command),
        })),
    };
}

function queryWords(query: string): string[] {
    return [...new Set(words(query))].filter(word => !FILLER.has(word));
}

function score(command: CommandSpec, queried: readonly string[]): number {
    const searchable = words(
        [
            ...command.path,
            command.summary,
            command.description,
            ...command.keywords,
            ...command.options.map(option => option.name),
        ].join(" "),
    );
    return queried.filter(word => searchable.some(candidate => candidate.startsWith(word))).length;
}

function words(text: string): string[] {
    return text
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .split(/[^\p{Letter}\p{Number}]+/u)
        .filter(word => word.length > 0);
}
