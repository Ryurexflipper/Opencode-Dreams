# SDK and source references

This workspace keeps local reference clones under `../_references/`.

## Current reference repositories

- `../_references/opencode`
- `../_references/opencode-sdk-js`
- `../_references/opencode-sdk-go`
- `../_references/opencode-sdk-python`
- `../_references/opendreams`

## Why they exist

These references are used to:

- check current OpenCode plugin APIs and hook shapes
- verify SDK request/response contracts
- compare the local implementation against the broader OpenDream model
- ground future behavior changes in source-backed evidence instead of memory or guesswork

## How to use them

Use these references when:

- a plugin hook shape changes
- tool registration behavior needs to be checked
- the Dream/Reflect model needs comparison against upstream concepts
- an integration or schema behavior needs confirmation before changing local code

These are reference materials only; the implemented plugin behavior is defined by the code in this repository.
