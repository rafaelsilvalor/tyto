# Install

Tyto is one desktop app for Windows, macOS and Linux. Every version is on the project's [releases page](https://github.com/rafaelsilvalor/tyto/releases), under a release named after its version; the app's releases are the ones whose tag starts with `desktop-v`.

## Pick the file for your computer

| Computer               | File                       | What it is                                                                          |
| ---------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Windows, installed     | `Tyto-Setup-<version>.exe` | An installer. The installed app updates itself.                                     |
| Windows, not installed | `Tyto-<version>.exe`       | One file that runs from wherever it is: a folder, a USB stick, beside another copy. |
| macOS                  | `Tyto-<version>-….dmg`     | A disk image: open it and drag Tyto to Applications.                                |
| Linux                  | `Tyto-<version>.AppImage`  | One file: allow it to run as a program, then run it.                                |

The `.blockmap` and `latest*.yml` files on the same page are for the app's updater, not for you.

::: warning The Mac file of 0.7.0 is for Apple Silicon only
A `.dmg` whose name ends in `-arm64.dmg`, as 0.7.0's does, opens only on a Mac with an M1 or later processor. On an Intel Mac it does not start.
:::

## The first time you open it

The files are not signed with a paid certificate yet, so each system warns once:

- **Windows** shows "Windows protected your PC". Choose **More info**, then **Run anyway**.
- **macOS** refuses the first attempt. Right-click Tyto in Applications, choose **Open**, and confirm.
- **Linux** runs an AppImage only once it is allowed to run as a program: in the file's properties, or with `chmod +x Tyto-<version>.AppImage`.

The window opens in your computer's language — English or Brazilian Portuguese — and its colour scheme. The [tour of the window](./window-tour.md) names what you see.

## Where Tyto keeps your things

Settings, keyboard shortcuts, snippets, the layout of the panels, recent files and logs are in a folder of their own for **each version**:

| System  | Folder                                         |
| ------- | ---------------------------------------------- |
| Windows | `%APPDATA%\Tyto\<version>`                     |
| macOS   | `~/Library/Application Support/Tyto/<version>` |
| Linux   | `~/.config/Tyto/<version>`                     |

`<version>` is the version you are running, as the header of this manual and **Help ▸ About Tyto** show it. Two versions on one computer never read each other's folder. The first time a new version opens, it offers to bring them from the newest older version on the computer: **Bring them** copies them, **Start fresh** does not, the older version keeps its own copy either way, and the question does not come back. Logs are never brought.

Plugins installed with `tyto plugin install` are elsewhere, shared by every version: `~/.tyto` (on Windows, `%USERPROFILE%\.tyto`).

If something goes wrong, **Help ▸ Open the log folder** opens the `logs` folder inside the version's folder.

## Updates

When the app opens it looks for a newer version. What happens next depends on the file you installed from:

- **Windows installer and Linux AppImage:** the new version downloads in the background. When it is done, the status bar shows **Version … is ready — Restart to update**. Click it to restart now, or keep working: the update is installed when you quit. The app never restarts on its own, and a tab with unsaved text still asks before closing.
- **Windows portable file and macOS:** the status bar shows **Version … available — Download**, which opens the release page; you download and replace the file yourself. On macOS this is because installing an update needs a signed app.

Without a connection the app opens as usual and does not look.

## Uninstall

- **Windows, installed:** Settings ▸ Apps ▸ Installed apps ▸ Tyto ▸ Uninstall.
- **Windows portable, Linux:** delete the file.
- **macOS:** drag Tyto from Applications to the Trash.

Uninstalling leaves [your folders](#where-tyto-keeps-your-things) where they were, so a later install finds your settings. Delete `Tyto` inside the folder of your system, and `.tyto` in your home folder, to remove everything.
