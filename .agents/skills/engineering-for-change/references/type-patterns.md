# Type Patterns: Modeling for Change

Use these examples as prompts to examine actual domain invariants. Adapt naming, error handling, and serialization to the existing project. These are not prescriptions to rewrite unrelated code.

## TypeScript: one state, one shape

Avoid:

```ts
type RequestState<T> = {
    loading: boolean;
    data?: T;
    error?: string;
};
```

This permits `loading: true` together with `data` and `error`, or all fields absent when that does not make sense.

Prefer:

```ts
type RequestState<T> =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; data: T }
    | { status: "failure"; error: string };
```

Use exhaustive checking for transitions or rendering. This type constrains a single snapshot, not which transitions are permitted; enforce transition rules separately if they matter.

## TypeScript: different meanings, different types

Avoid passing every identifier as a `string` when mixing identifiers is a real risk. Branded types can make accidental substitution a compile-time error:

```ts
declare const userIdBrand: unique symbol;
type UserId = string & { readonly [userIdBrand]: true };

function parseUserId(input: unknown): UserId {
    if (typeof input !== "string" || !/^usr_[a-z0-9]+$/.test(input)) {
        throw new TypeError("Invalid user ID");
    }
    // The assertion is confined to the validated construction boundary.
    return input as UserId;
}
```

Brands disappear at runtime. Never assume a cast validates data; encapsulate creation in trusted constructors/parsers. For IDs requiring more than a syntactic check, validate those conditions too. Alternative representations (opaque classes, schemas, tagged objects) may fit better.

## Swift: associate data with the state that owns it

```swift
enum LoadState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(Error)
}

struct UserID: Hashable {
    let rawValue: String

    init?(_ rawValue: String) {
        guard rawValue.hasPrefix("usr_"), rawValue.count > 4 else {
            return nil
        }
        self.rawValue = rawValue
    }
}
```

The initializer centralizes construction; the enum avoids a loaded-without-value state. If the domain requires stronger ID validation, do it there. Ensure decoding and persistence paths do not bypass the invariant.

## Rust: checked construction and explicit variants

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct UserId(String);

impl TryFrom<String> for UserId {
    type Error = &'static str;

    fn try_from(raw: String) -> Result<Self, Self::Error> {
        if raw.starts_with("usr_") && raw.len() > 4 {
            Ok(Self(raw))
        } else {
            Err("invalid user ID")
        }
    }
}

pub enum LoadState<T, E> {
    Idle,
    Loading,
    Loaded(T),
    Failed(E),
}
```

Keep representation fields private when construction must be checked. Avoid public deserialization or conversion paths that bypass the validation. For more complex states, use transition methods or typestate only when they solve a real problem.

## When types are not enough

- **Money and units:** wrappers prevent confusion, but arithmetic and rounding may still need runtime safeguards.
- **Database constraints:** a type cannot replace a unique index, foreign key, or transactional invariant.
- **Concurrency:** a valid single-threaded state representation cannot guarantee atomic transitions across concurrent actors.
- **Cross-process contracts:** parsing, versioning, and validation remain necessary even when both sides use generated types.
- **UI state:** avoid duplicating server-derived state unless there is a defined synchronization strategy.

The goal is not maximum type complexity. It is to place each important rule where future changes are least likely to violate it.
