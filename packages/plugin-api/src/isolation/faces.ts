import {
  type FaceCache,
  type FontFace,
  type TemplateContext,
  createFaceCache,
  measureText,
} from '@tyto/core';

/**
 * The faces a code template measures in its plugin's process (ADR 0048).
 *
 * `TemplateContext.measure` answers synchronously (ADR 0038), in the middle of a template's
 * `build`, and nothing that crosses a process can: a question to the host mid-build would
 * need the host to answer while the guest waits, which ADR 0041 already refused. So the
 * bytes cross with the call instead, and `measure` is rebuilt here over them — with core's
 * own `measureText`, bundled into Tyto's guest and not into the plugin, so what the
 * template is told a node measures is what `compile` then lays out on the host's side.
 *
 * Each face crosses once per process: the host remembers what it sent, and this keeps it.
 */

/** A face's outline bytes as they cross, keyed as `FontSource` is asked. */
export interface ShippedFace {
  readonly face: FontFace;
  readonly bytes: Uint8Array;
}

export interface GuestFaces {
  add(faces: readonly ShippedFace[]): void;
  readonly measure: TemplateContext['measure'];
}

function keyOf(face: FontFace): string {
  return `${face.family}|${String(face.weight)}|${face.style}`;
}

export function guestFaces(): GuestFaces {
  const bytes = new Map<string, Uint8Array>();
  const source = { outlines: (face: FontFace) => bytes.get(keyOf(face)) };
  let cache: FaceCache = createFaceCache(source);

  return {
    add(faces) {
      let added = false;
      for (const shipped of faces) {
        const key = keyOf(shipped.face);
        if (bytes.has(key)) continue;
        bytes.set(key, shipped.bytes);
        added = true;
      }
      // A new cache, because the old one remembers a face it was asked for before its bytes
      // arrived as `undefined` — a face one template left undeclared and another declares.
      if (added) cache = createFaceCache(source);
    },
    measure: (node) => measureText(node, cache),
  };
}
