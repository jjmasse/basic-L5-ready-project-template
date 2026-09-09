# BUILD-SPEC — {{PROJECT_NAME}}

> The build follows this document. Mechanics, schema, formulas, and the phased
> task breakdown live here; `CLAUDE.md` carries the rules for *how* to build.
> Keep it current: when the product owner changes direction, this file changes
> first and the code follows.

<!-- TEMPLATE: fill each section. Delete sections that do not apply, but say
     so ("no scheduled work in this product") rather than leaving a heading
     empty. -->

## 1. Domain model overview

<!-- TEMPLATE: The nouns and how they relate. One paragraph per core entity: what it is,
     what owns it, what scopes it (tenant, period, account). -->

## 2. Schema (first cut)

<!-- TEMPLATE: Tables/collections with their key columns and the scoping column every
     row carries. Name the audit log table and what a row records. Note which
     magnitudes need wide integers. -->

## 3. Scheduled and background work

<!-- TEMPLATE: What must happen on a clock even when no user is present, and how it is
     guarded so it runs exactly once (a lock, a compare-and-swap fence). If
     nothing, say so. -->

## 4. Tunables (config-as-data)

<!-- TEMPLATE: Where the versioned config lives, how a version is selected, and the
     rule for changing a number (new version, never edit a live one). List the
     first set of knobs. -->

## 5. Core formulas

<!-- TEMPLATE: The calculations that decide outcomes, written so a test can pin them.
     Integer math; stored seeds for anything random. -->

## 6. API surface

<!-- TEMPLATE: The endpoints or commands, grouped by area, each marked read or mutate.
     Every mutate follows the shape in CLAUDE.md. -->

## 7. Phase 1 task breakdown — what gets built first

<!-- TEMPLATE: Ordered tasks with a one-line done bar each. Land the layers that are
     painful to retrofit (scoping, config-as-data, audit) in this phase. -->

## 8. Open implementation choices left to the coding agent

<!-- TEMPLATE: Things the owner does not care to decide. Everything not listed here is
     the owner's call. -->

## 9. Later phases

<!-- TEMPLATE: Direction only, enough that phase 1 does not paint us into a corner. -->
