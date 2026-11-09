# Connect an AI agent

::: info How this page was checked
Every command was run on 2026-11-09 on a development build of the branch that added it (TYTO-565, CLI 0.10.9) on Windows 11, with a small agent stand-in that speaks the protocol the way Claude Code does. The outputs below are copied from those runs.
:::

`tyto mcp` lets an AI agent such as Claude Code or Claude Desktop work with a project folder: list its templates, read what a template expects, check a brief for errors and look at a preview of the artwork, before it shows you anything. It speaks the [Model Context Protocol](https://modelcontextprotocol.io), the way those agents reach a program on your computer.

You do not run it yourself: you tell the agent about it once, and the agent starts it when it needs it.

## Tell the agent about it

The command is `node <repository>/apps/cli/dist/index.js mcp <folder>`, where `<folder>` is the project folder the agent should work in. [Get the command](./index.md#get-the-command) says how to build it.

**Claude Code**, in a terminal:

```
claude mcp add tyto -- node C:/projects/tyto/tyto/apps/cli/dist/index.js mcp C:/projects/my-project
```

**Claude Desktop**: open **Settings ▸ Developer ▸ Edit Config**, add the `tyto` entry to `claude_desktop_config.json`, and restart Claude Desktop:

```json
{
  "mcpServers": {
    "tyto": {
      "command": "node",
      "args": ["C:/projects/tyto/tyto/apps/cli/dist/index.js", "mcp", "C:/projects/my-project"]
    }
  }
}
```

Then ask in plain words: "which Tyto templates do I have?", or "write a brief for the banner with this text and show me the preview".

## What the agent can do

Four things, and none of them changes a file:

- **List the templates** a brief in the folder can use: yours, the ones that come with Tyto and the ones plugins add.
- **Describe a template**: its sizes, the fields it expects and the skeleton a new brief starts from.
- **Check a brief**, named by its path in the folder or written out in full, and get each problem with its line and column:

  ```
  {
    "status": "error",
    "diagnostics": [
      {
        "severity": "error",
        "code": "E_UNKNOWN_SLOT",
        "message": "Unknown slot 'titlo'. Template 'banner-teste' declares: titulo.",
        "path": "briefs\\erro.brief",
        "line": 6,
        "column": 3,
        "hint": "Did you mean 'titulo'?"
      }
    ]
  }
  ```

  The check is about the brief itself; it does not look for fonts or download images, so the preview can still warn about those.

- **See a preview** of one size as an image. A large size is shrunk to 1,024 pixels on its longest side, and a carousel shows its first four slides, so the images stay small enough for the agent to look at. A 1200 × 628 banner came back as a 1024 × 536 PNG.

## What stays out of its reach

- **Only the folder and its workspace.** A path outside them is refused, and so is a shortcut inside the folder that leads outside.
- **No passwords or keys.** No answer carries a credential, the environment the plugins read them from, or the plugin settings in `.tyto/project.json`.
- **A folder you have not trusted stays restricted.** Its plugin files are not loaded, as on `tyto render`. Tools that write files are planned; a folder you have not [trusted](../editor/workspace-folder.md) will not be offered them.
- **Not from the window.** The [Commands](../editor/commands.md) tab refuses `tyto mcp`: the agent starts it on its own.

## When something goes wrong

What `tyto mcp` has to say goes to the agent's log for that server, never into the conversation. On start it says which folder it serves and whether it is trusted:

```
tyto mcp: serving on stdio, workspace restricted (C:\projects\tyto\testes\m565)
```

If the agent says it cannot reach Tyto, run the same command in a terminal: it should print that line and wait. Press Ctrl+C to stop it.
