# Install and Use Opencode-Dream

## Build locally

```bash
cd Opencode-Dream
npm install
npm run build
```

## Recommended local plugin install

OpenCode officially auto-loads local project plugins from `.opencode/plugins/`.
The easiest setup is:

```bash
mkdir -p .opencode/plugins
cp dist/src/index.js .opencode/plugins/opencode-dream.js
```

If you want the TypeScript source available in-place instead, keep this package in your workspace and point OpenCode at the built `dist/src/index.js` file using the tuple plugin form below.

## Load into OpenCode

Example:

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

After OpenCode loads the plugin, initialize its state once:

```text
Call tool: opendream_init {"initializeAgentsFile": true}
```

The plugin will then:

- create `.opencode-dream/`
- maintain live session snapshots in `.opencode-dream/sessions/live/`
- keep runtime capture state in `.opencode-dream/sessions/runtime/`
- expose environment variables for shell tools
- inject consolidated memory into session compaction
