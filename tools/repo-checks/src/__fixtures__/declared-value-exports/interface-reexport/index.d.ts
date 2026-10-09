// The shape tsup rolls a type-only re-export into: no `type` modifier, nothing at runtime.
// `Shape` is an interface in its source, so the compiler refuses it as a value anyway.
export { Shape } from './shape.js';
export declare const shapeName: string;
