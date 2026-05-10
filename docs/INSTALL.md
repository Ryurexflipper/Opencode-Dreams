# Install and operate opencode-dream

## Requirements

- Node.js `>=20`
- OpenCode configured with compatible `@opencode-ai/plugin` / `@opencode-ai/sdk`
- a model for reflection and dream execution if you want LLM-backed Stage 1 / Stage 2 runs

## Build locally

```bash
cd Opencode-Dream
npm install
npm run build
```

## Load the plugin into OpenCode

Recommended tuple form:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "github-copilot/gpt-5.4",
  "provider": {
    "github-copilot": {}
  },
  "plugin": [
    [
      "file:///ABSOLUTE/PATH/TO/Opencode-Dream/dist/src/index.js",
      {
        "projectRelativeStateDir": ".opencode-dream",
        "captureLiveSessions": true,
        "preferredReflectModel": "github-copilot/gpt-5.4",
        "preferredDreamModel": "github-copilot/gpt-5.4"
      }
    ]
  ]
}
```

### Notes

- `projectRelativeStateDir`, `memoryFile`, and `agentsFile` are now path-confined to the project root.
- If you configure custom paths, they must still resolve inside the repository.

## Initialize plugin state

Run once after OpenCode loads the plugin:

```text
Call tool: opendream_init {"initializeAgentsFile": true}
```

This creates:

- `.opencode-dream/`
- `memory/current.md`
- session directories under `sessions/`
- `reflections/`
- `dreams/`
- an optional managed section in `AGENTS.md`

## What the plugin sets up automatically

### Filesystem layout

```text
.opencode-dream/
  docs/
  dreams/
  memory/
  reflections/
  sessions/
    imports/
    live/
    runtime/
```

### Hooks

- `event`
  - captures live OpenCode events into runtime/live session artifacts
- `experimental.session.compacting`
  - injects current consolidated memory into compaction context
- `shell.env`
  - exports state path and model env variables for scripts/tools

### Shell environment variables

- `OPENCODE_DREAM_ROOT`
- `OPENCODE_DREAM_MEMORY_FILE`
- `OPENCODE_DREAM_AGENTS_FILE`
- `OPENCODE_DREAM_REFLECT_MODEL` when configured
- `OPENCODE_DREAM_DREAM_MODEL` when configured

## First successful workflow

### Automatic/live workflow

1. work in OpenCode normally
2. allow live capture to write `sessions/live/*.jsonl`
3. run `opendream_reflect_batch`
4. run `opendream_dream_run`
5. run `opendream_memory_apply`
6. run `opendream_export_agents`

### Manual/import workflow

1. run `opendream_ingest_generic_jsonl`
2. run `opendream_reflect_run` or `opendream_reflect_batch`
3. run `opendream_dream_run`
4. run `opendream_memory_apply`
5. run `opendream_export_agents`

## External memory setup

### opencode-mem

Enable in plugin config:

```jsonc
{
  "opencodeMem": {
    "enabled": true,
    "url": "http://127.0.0.1:4747",
    "importMode": "append",
    "maxItemLength": 1000
  }
}
```

Useful commands:

- `opendream_mem_probe`
- `opendream_mem_sync`
- `opendream_ext_mem_sync`

### Other supported sources

- `true-mem`
- `simple-memory`
- `opencode-lcm`

All four can be synchronized through `opendream_ext_mem_sync`.

## Operating model

The plugin improves future sessions in two ways:

1. **knowledge accumulation**
   - live/imported traces become reflections
   - reflections become dream consolidations
   - consolidations become memory and AGENTS guidance
2. **system hardening**
   - the pipeline has been tested through Phases 1–8
   - tool boundaries now prefer structured JSON errors over uncontrolled throws
   - memory/export flows are regression-tested for idempotency and marker safety

## Verification commands

```bash
npm run typecheck
npm run build
npm test
```

Current maintained baseline: `182/182` tests passing.

## Related docs

- `README.md`
- `INTEGRATIONS.md`
- `docs/OPENDREAM-MAPPING.md`
- `docs/adversarial-hardening-status.md`
