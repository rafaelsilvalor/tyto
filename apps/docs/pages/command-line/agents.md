# Connect an AI agent

::: info How this page was checked
Every command was run on 2026-11-09 on a development build of the branch that added it (TYTO-565, CLI 0.10.9) on Windows 11, with a small agent stand-in that speaks the protocol the way Claude Code does. The outputs below are copied from those runs. The section on the open window was run the same way on the branch that added it (TYTO-566). The section on Tyto's terminal was run by the project's automated tests on the branch that added it (TYTO-567), and its log line copied from that run; the two `claude mcp add` lines were not run, and their folders are the installers' defaults, read in their configuration.
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

## Work with the window that is open

`tyto mcp --window` connects the agent to the Tyto window you have open instead of reading the folder on its own. The agent gets the same tools; while the window is open it listens for an agent, and only a program that can read the connection's key in your Tyto folder can reach it — normally only the programs running as you.

**Claude Code**:

```
claude mcp add tyto-window -- node C:/projects/tyto/tyto/apps/cli/dist/index.js mcp --window C:/projects/my-project
```

With several windows open, it picks the one whose folder holds the folder you named, or else the one opened last, and its log says which:

```
tyto mcp --window: no open window holds this folder; relaying to the most recent one, no folder (pid 28532)
```

While an agent is connected, the status bar shows **Agent connected** (with a count when there are more). Click it to cut every connection; the agent's server stops, and the window keeps listening for the next one. With no window open, the command says so and stops.

Through the window the agent can also:

- **Read the brief in front**: its name, the format the preview shows and its text as it is in the editor, including what you typed and have not saved. A file outside the folder answers with its name only.
- **Read the selection**: each selected range with its lines and columns and the text it covers.
- **Open a file** of the folder in a tab, and **show a format** of the brief in front in the preview. These two need a folder you have [trusted](../editor/workspace-folder.md), and by default the window asks you first in a box that names the file or the format; you choose **Open** (or **Show**) or **Don't**. One question at a time: while a box is up, another request is declined.

- **Propose an edit** to the text of the document in front, in a folder you have trusted. Nothing is written: the change shows in the editor, the old text struck through and the new text beside it, under a bar that says **Proposed by an agent** with **Accept** and **Reject**. Accept puts it in as one step, so one Ctrl+Z takes all of it back; the file is not saved, as if you had typed it. If you type inside the proposed text before deciding, the proposal is dropped as stale, never applied to what you rewrote. One proposal per document at a time; the agent asks afterwards whether you accepted it.

Two [settings](../reference/settings.md) change this. `agentsWindowActions` set to `"allow"` lets the agent open and show without asking; a change to a document's text is always a proposal. `agentsListen` set to `false` closes the connection, cuts every agent, and no agent can connect until it is `true` again.

## From Tyto's terminal

In a terminal Tyto opened, **Terminal: Open an Agent Here** starts Claude Code (or the program `agentCommand` names) already connected to that window, with nothing to register; see [Terminal](../editor/terminal.md#open-an-agent-here). It does not need the command line installed: the app carries the small program that makes the connection.

To type `claude` yourself instead, register that program once. On Windows, with Tyto installed for you alone (the installer's default):

```
claude mcp add tyto-window -- "%LOCALAPPDATA%\Programs\Tyto\resources\node\node.exe" "%LOCALAPPDATA%\Programs\Tyto\resources\app.asar.unpacked\out\relay\agent-relay.js"
```

On macOS, with Tyto in Applications:

```
claude mcp add tyto-window -- /Applications/Tyto.app/Contents/Resources/node/node /Applications/Tyto.app/Contents/Resources/app.asar.unpacked/out/relay/agent-relay.js
```

Started in a Tyto terminal, it reaches the window that opened that terminal, and its log says so:

```
tyto mcp --window: relaying to the window that started this terminal, no folder (pid 11960)
```

Started anywhere else, it picks a window as `tyto mcp --window` does. These paths stay the same when Tyto updates. The portable Windows app and the Linux AppImage unpack themselves into a new folder every time they start, so there use **Open an Agent Here**.

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
- **Not from the window.** The [Commands](../editor/commands.md) tab refuses `tyto mcp`, `--window` included: the agent starts it on its own.

## When something goes wrong

What `tyto mcp` has to say goes to the agent's log for that server, never into the conversation. On start it says which folder it serves and whether it is trusted:

```
tyto mcp: serving on stdio, workspace restricted (C:\projects\tyto\testes\m565)
```

If the agent says it cannot reach Tyto, run the same command in a terminal: it should print that line and wait. Press Ctrl+C to stop it.
