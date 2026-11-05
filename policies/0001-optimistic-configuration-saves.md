---
id: policy.0001
title: Optimistic Configuration Saves
status: active
established-by: proposal.0007
supersedes: []
---

# Optimistic Configuration Saves

## Introduction

This policy settles how the Mac app saves a reversible Pico setting. The app shows the user's choice immediately and keeps the control usable, while `pico` remains the only authority on what was saved.

## The rule

A Mac app control that saves a reversible Pico setting must show the chosen value immediately and remain usable while `pico` saves it, treating only `pico`'s receipts and reloads as confirmed configuration.

## Why this exists

Disabling a control until each save finished blocked the next edit and hid the user's choice until `pico` answered. Showing a choice before it is saved creates different risks: an earlier save can overwrite a newer choice, a failed save can leave an unsaved value on screen, and a change made outside the window can be overwritten by a stale save. This policy keeps the interface responsive without weakening `pico`'s revision checks.

## What it applies to

- Applies to: Mac app controls that save a Pico setting a later save can replace, such as the default model, reasoning level, and future preference toggles.
- Does not apply to: sign-in, credential creation or deletion, provider disconnects, Sesh registration, or another operation that is external, destructive, or not reversible by saving the previous setting.
- Proposals: applying this pattern to a control that saves an existing setting is an implementation detail and does not need a proposal. Adding a user-facing setting still follows the normal proposal decision.

## Enforcement

- Tier: prose
- Mechanism: the requirements below, verified by native state-transition tests for each control that saves settings.
- Prose justification: no deterministic repository check can determine whether an arbitrary SwiftUI control saves optimistically, preserves ordering, or correctly identifies a reversible setting.

## How to comply

1. Keep confirmed settings, from a load or `pico` receipt, separate from the choices the user sees while saves are pending.
2. Show each choice immediately, keep its controls enabled, and indicate pending saves without blocking further edits.
3. Send changes to `pico` in the order the user made them, using the revision from the latest confirmed settings. Include any context needed to keep a dependent value attached to its original choice, such as the model for a reasoning level.
4. When a save fails, roll back only that change, preserve newer choices, and show the failure's cause.
5. When `pico` reports a revision conflict, discard unsent changes, reload confirmed settings, and tell the user that pending changes were not saved.
6. Add native tests for immediate display, ordered receipts, an older failure followed by a newer edit, a revision conflict, and cancellation. `app/Configuration/OptimisticSettingsTests.swift` is the reference.

## Revision history

| Date | Change | Proposal |
| --- | --- | --- |
| 2026-11-05 | Established from Mark's direction while implementing Beads `pico-bfk.8`. | proposal.0007 |
