/**
 * What upstream says each original in `@tyto/theme-pack` looks like (TYTO-300, ADR 0089): for
 * every token the port takes straight from an upstream palette, the value read from the source
 * `packages/theme-pack/LICENSES` names, with the upstream name of the colour beside it.
 *
 * `theme-pack.test.ts` holds each original to this record, so an original that drifts from
 * upstream — a colour "fixed" in the original instead of in its adjusted twin — fails there.
 * Tokens the port derives (a hover composited over its ground, the translucent active line and
 * its gutter, the scrim and shadows) are not recorded: they are the mapping's, not upstream's,
 * and the test holds them equal between an original and its twin instead.
 */
export const UPSTREAM_COLOURS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  dracula: {
    surface: '#282a36', // BG
    'surface-raised': '#343746', // BGLight
    'surface-sunken': '#21222c', // BGDark
    border: '#44475a', // SELECTION
    hairline: '#191a21', // BGDarker
    text: '#f8f8f2', // FG
    'text-muted': '#6272a4', // COMMENT
    'text-disabled': '#6272a4', // COMMENT
    accent: '#ff79c6', // PINK
    'accent-text': '#282a36', // BG
    'focus-ring': '#6272a4', // COMMENT
    selection: '#44475a', // SELECTION
    error: '#ff5555', // RED
    warning: '#ffb86c', // ORANGE
    info: '#8be9fd', // CYAN
    success: '#50fa7b', // GREEN
    'syntax-keyword': '#ff79c6', // PINK
    'syntax-function': '#50fa7b', // GREEN
    'syntax-constant': '#bd93f9', // PURPLE
    'syntax-attribute': '#50fa7b', // GREEN
    'syntax-string': '#f1fa8c', // YELLOW
    'syntax-tag': '#ff79c6', // PINK
    'syntax-punctuation': '#f8f8f2', // FG
    'syntax-comment': '#6272a4', // COMMENT
  },
  'one-dark': {
    surface: '#282c34', // syntax-bg
    'surface-raised': '#21252b', // level-3
    'surface-sunken': '#1b1d23', // input-bg
    border: '#181a1f', // ui-border
    hairline: '#181a1f', // ui-border
    text: '#abb2bf', // mono-1
    'text-muted': '#828997', // mono-2
    'text-disabled': '#5c6370', // mono-3
    accent: '#528bff', // syntax-accent
    'accent-text': '#001133', // accent-text-dark
    'focus-ring': '#528bff', // syntax-accent
    selection: '#3e4451', // syntax-selection
    hover: '#31363f', // bg-highlight
    error: '#ff6347', // text-error
    warning: '#e2c08d', // text-warning
    info: '#6494ed', // text-info
    success: '#73c990', // text-success
    'syntax-keyword': '#c678dd', // hue-3
    'syntax-function': '#61afef', // hue-2
    'syntax-constant': '#d19a66', // hue-6
    'syntax-attribute': '#d19a66', // hue-6
    'syntax-string': '#98c379', // hue-4
    'syntax-tag': '#e06c75', // hue-5
    'syntax-punctuation': '#abb2bf', // mono-1
    'syntax-comment': '#5c6370', // mono-3
  },
  nord: {
    surface: '#2e3440', // nord0
    'surface-raised': '#3b4252', // nord1
    'surface-sunken': '#2e3440', // nord0
    border: '#4c566a', // nord3
    hairline: '#434c5e', // nord2
    text: '#d8dee9', // nord4
    'text-muted': '#4c566a', // nord3
    'text-disabled': '#4c566a', // nord3
    accent: '#88c0d0', // nord8
    'accent-text': '#2e3440', // nord0
    'focus-ring': '#88c0d0', // nord8
    selection: '#434c5e', // nord2
    hover: '#434c5e', // nord2
    error: '#bf616a', // nord11
    warning: '#ebcb8b', // nord13
    info: '#88c0d0', // nord8
    success: '#a3be8c', // nord14
    'syntax-keyword': '#81a1c1', // nord9
    'syntax-function': '#88c0d0', // nord8
    'syntax-constant': '#b48ead', // nord15
    'syntax-attribute': '#8fbcbb', // nord7
    'syntax-string': '#a3be8c', // nord14
    'syntax-tag': '#81a1c1', // nord9
    'syntax-punctuation': '#eceff4', // nord6
    'syntax-comment': '#4c566a', // nord3
  },
  'solarized-dark': {
    surface: '#002b36', // base03
    'surface-raised': '#073642', // base02
    'surface-sunken': '#002b36', // base03
    border: '#586e75', // base01
    hairline: '#586e75', // base01
    text: '#839496', // base0
    'text-muted': '#586e75', // base01
    'text-disabled': '#586e75', // base01
    accent: '#268bd2', // blue
    'accent-text': '#002b36', // base03
    'focus-ring': '#268bd2', // blue
    selection: '#073642', // base02
    error: '#dc322f', // red
    warning: '#b58900', // yellow
    info: '#2aa198', // cyan
    success: '#859900', // green
    'syntax-keyword': '#859900', // green
    'syntax-function': '#268bd2', // blue
    'syntax-constant': '#2aa198', // cyan
    'syntax-attribute': '#657b83', // base00
    'syntax-string': '#2aa198', // cyan
    'syntax-tag': '#268bd2', // blue
    'syntax-punctuation': '#586e75', // base01
    'syntax-comment': '#586e75', // base01
  },
  'solarized-light': {
    surface: '#fdf6e3', // base3
    'surface-raised': '#eee8d5', // base2
    'surface-sunken': '#fdf6e3', // base3
    border: '#93a1a1', // base1
    hairline: '#93a1a1', // base1
    text: '#657b83', // base00
    'text-muted': '#93a1a1', // base1
    'text-disabled': '#93a1a1', // base1
    accent: '#268bd2', // blue
    'accent-text': '#fdf6e3', // base3
    'focus-ring': '#268bd2', // blue
    selection: '#eee8d5', // base2
    error: '#dc322f', // red
    warning: '#b58900', // yellow
    info: '#2aa198', // cyan
    success: '#859900', // green
    'syntax-keyword': '#859900', // green
    'syntax-function': '#268bd2', // blue
    'syntax-constant': '#2aa198', // cyan
    'syntax-attribute': '#839496', // base0
    'syntax-string': '#2aa198', // cyan
    'syntax-tag': '#268bd2', // blue
    'syntax-punctuation': '#93a1a1', // base1
    'syntax-comment': '#93a1a1', // base1
  },
  'gruvbox-dark': {
    surface: '#282828', // dark0
    'surface-raised': '#3c3836', // dark1
    'surface-sunken': '#1d2021', // dark0_hard
    border: '#7c6f64', // dark4
    hairline: '#665c54', // dark3
    text: '#ebdbb2', // light1
    'text-muted': '#a89984', // light4
    'text-disabled': '#7c6f64', // dark4
    accent: '#b8bb26', // bright_green
    'accent-text': '#282828', // dark0
    'focus-ring': '#83a598', // bright_blue
    selection: '#665c54', // dark3
    hover: '#504945', // dark2
    error: '#fb4934', // bright_red
    warning: '#fabd2f', // bright_yellow
    info: '#83a598', // bright_blue
    success: '#b8bb26', // bright_green
    'syntax-keyword': '#fb4934', // bright_red
    'syntax-function': '#b8bb26', // bright_green
    'syntax-constant': '#d3869b', // bright_purple
    'syntax-attribute': '#8ec07c', // bright_aqua
    'syntax-string': '#b8bb26', // bright_green
    'syntax-tag': '#b8bb26', // bright_green
    'syntax-punctuation': '#83a598', // bright_blue
    'syntax-comment': '#928374', // gray
  },
  'gruvbox-light': {
    surface: '#fbf1c7', // light0
    'surface-raised': '#ebdbb2', // light1
    'surface-sunken': '#f9f5d7', // light0_hard
    border: '#a89984', // light4
    hairline: '#bdae93', // light3
    text: '#3c3836', // dark1
    'text-muted': '#7c6f64', // dark4
    'text-disabled': '#a89984', // light4
    accent: '#79740e', // faded_green
    'accent-text': '#fbf1c7', // light0
    'focus-ring': '#076678', // faded_blue
    selection: '#bdae93', // light3
    hover: '#d5c4a1', // light2
    error: '#9d0006', // faded_red
    warning: '#b57614', // faded_yellow
    info: '#076678', // faded_blue
    success: '#79740e', // faded_green
    'syntax-keyword': '#9d0006', // faded_red
    'syntax-function': '#79740e', // faded_green
    'syntax-constant': '#8f3f71', // faded_purple
    'syntax-attribute': '#427b58', // faded_aqua
    'syntax-string': '#79740e', // faded_green
    'syntax-tag': '#79740e', // faded_green
    'syntax-punctuation': '#076678', // faded_blue
    'syntax-comment': '#928374', // gray
  },
  'tokyo-night': {
    surface: '#1a1b26', // editor.background
    'surface-raised': '#16161e', // sideBar.background
    'surface-sunken': '#14141b', // input.background
    border: '#0f0f14', // input.border
    hairline: '#101014', // editorGroup.border
    text: '#a9b1d6', // editor.foreground
    'text-muted': '#787c99', // foreground
    'text-disabled': '#545c7e', // disabledForeground
    accent: '#3d59a1', // tab.activeBorder
    'accent-text': '#ffffff', // button.foreground
    hover: '#13131a', // list.hoverBackground
    error: '#db4b4b', // editorError.foreground
    warning: '#e0af68', // editorWarning.foreground
    info: '#0da0ba', // editorInfo.foreground
    success: '#73daca', // terminal.ansiGreen
    'syntax-keyword': '#bb9af7', // tok.keyword
    'syntax-function': '#7aa2f7', // tok.function
    'syntax-constant': '#ff9e64', // tok.number
    'syntax-attribute': '#bb9af7', // tok.attribute
    'syntax-string': '#9ece6a', // tok.string
    'syntax-tag': '#f7768e', // tok.tag
    'syntax-punctuation': '#89ddff', // tok.punctuation
    'syntax-comment': '#51597d', // tok.comment
  },
  'tokyo-night-light': {
    surface: '#e6e7ed', // editor.background
    'surface-raised': '#d6d8df', // sideBar.background
    'surface-sunken': '#e6e7ed', // input.background
    border: '#c1c2c7', // input.border
    hairline: '#c1c2c7', // editorGroup.border
    text: '#343b59', // editor.foreground
    'text-muted': '#363c4d', // foreground
    'text-disabled': '#707280', // disabledForeground
    accent: '#2959aa', // tab.activeBorder
    'accent-text': '#ffffff', // button.foreground
    hover: '#e1e2e8', // list.hoverBackground
    error: '#bd4040', // editorError.foreground
    warning: '#8f5e15', // editorWarning.foreground
    info: '#0da0ba', // editorInfo.foreground
    success: '#33635c', // terminal.ansiGreen
    'syntax-keyword': '#65359d', // tok.keyword
    'syntax-function': '#2959aa', // tok.function
    'syntax-constant': '#965027', // tok.number
    'syntax-attribute': '#65359d', // tok.attribute
    'syntax-string': '#385f0d', // tok.string
    'syntax-tag': '#8c4351', // tok.tag
    'syntax-punctuation': '#006c86', // tok.punctuation
    'syntax-comment': '#888b94', // tok.comment
  },
};
