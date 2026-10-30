# Linter usage

The bundled linter reports review hints for Markdown and Swift documentation prose. It does not verify technical claims or replace manual review. In Markdown, it skips backtick-fenced code and lines starting with `|`. In Swift files, it checks documentation-comment lines. It removes single-backtick code spans in both formats.

Resolve the script relative to this skill's directory and pass paths from the working repository. The script needs Bun 1.4.4 or newer and has no dependencies:

```sh
bun /path/to/writing-technical-prose/scripts/lint_technical_writing.ts README.md docs
```

## Additional rules

Use `--rules-file /path/to/rules.json` to append terminology or project rules to the generic defaults. The file must contain a JSON list of objects with exactly three nonempty string fields:

```json
[
    {
        "code": "project-product-name",
        "pattern": "\\bexamplecloud\\b",
        "message": "Use 'ExampleCloud' when naming the product."
    }
]
```

Patterns are regular expressions compiled by the JavaScript runtime, and are case-sensitive unless they open with an inline flag group such as `(?i)`. Python's `(?P<name>...)` group spelling is also accepted. Codes must contain no whitespace and must be unique across the additional rules and built-in diagnostics. An empty list adds no rules.

## Exit status

- `0`: completed, including warnings by default.
- `1`: warnings found with `--fail-on-warnings`.
- `2`: invalid command arguments or a rules file that cannot be read, parsed, or compiled.

The linter prints findings without changing files. Review each warning in context; accurate technical wording and established project terminology take precedence.
