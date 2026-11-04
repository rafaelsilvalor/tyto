<!--
  Added by this repository, above the upstream licence text, so that the version and the
  place the bytes came from are readable without a network. Everything below the rule is
  OFL.txt from the NotoSansMath-v3.000 release archive, unchanged. The `.ttf` is
  byte-for-byte upstream; the `.woff2` is that `.ttf` compressed here, because the release
  ships no WOFF2 (see below). Their SHA-256 are below, so both claims are checkable.
-->

# Noto Sans Math — provenance

| | |
| --- | --- |
| Family | Noto Sans Math |
| Version | 3.000 |
| Upstream | https://github.com/notofonts/math |
| Release | https://github.com/notofonts/math/releases/tag/NotoSansMath-v3.000 |
| Archive | `NotoSansMath-v3.000.zip`, SHA-256 `ac351837b41f8a897f020b97fb0f075ad574c1e9669fb5839ada1f92fd748356` |
| Licence | SIL Open Font License 1.1 (text below) |

| File | Where it comes from | SHA-256 |
| --- | --- | --- |
| `NotoSansMath-Regular.ttf` | the archive, `NotoSansMath/unhinted/ttf/` | `b127e84699212b6b2ef50aff58e0ebebeec04ffe6db1b9eb9e209c8c3d97b4aa` |
| `NotoSansMath-Regular.ttf.woff2` | the `.ttf` above, compressed with fontTools 4.66.1 and brotli 1.2.0 (`TTFont(path).flavor = 'woff2'`) | `d68efcf1e6433ee19850b4f3726d144e04e51d5e8eda203ca3e231f07549e139` |

**Why the `.woff2` was made here.** The release carries TrueType and OpenType files only.
The package README asks for both encodings from one release so that measurement (the `.ttf`)
and the drawn glyphs (the `.woff2`) cannot be two builds of the design; compressing this very
`.ttf` keeps that true. WOFF2 is a container: the outlines, metrics and `cmap` it decodes to
are the `.ttf`'s, and nothing renames or modifies the face, which the OFL requires.

**The unhinted build**, because the exporters render through Chromium, which ignores
TrueType hinting at the sizes Tyto draws, and it is the smallest of the four TrueType builds
in the archive (657,440 bytes against 990,564 hinted).

Added by TYTO-484 (ADR 0168): the face a run falls back to, glyph by glyph, for the math and
science symbols its own face lacks.

---

Copyright 2022 The Noto Project Authors (https://github.com/notofonts/math)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
