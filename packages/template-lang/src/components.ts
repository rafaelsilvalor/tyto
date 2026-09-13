import { type Diagnostic, type SourceRange, type TemplateManifest, didYouMean } from '@tyto/core';

import type { TemplateAttribute, TemplateDocument, TemplateElement } from './ast.js';
import { attributeOf, classesOf, interpolatedSlots } from './frames.js';
import type { Report } from './values.js';
import { markupProblem } from './vocabulary.js';

/**
 * `<define>` and `<use>`, resolved away before anything else reads the tree (ADR 0022).
 *
 * A component is a subtree written once and drawn where it is named. It is expanded here,
 * above `collectFrames` and far above `build.ts`, so that nothing downstream has to learn
 * a second way of holding children: the document that leaves this function has the tags
 * the author would have typed by hand, and the IR receives a `group` indistinguishable
 * from a hand-written one.
 *
 * The two rules that make that work are both restrictions. An instance's own classes land
 * on **every** node of the expansion — `<use component="chip" class="second">` reaches the
 * `<rect>` inside the component through `.chip-bar.second`, which is how an instance is
 * overridden in a language with no descendant combinator and no second cascade. And a
 * `<define>` may not write an `id`, because an id is unique in a frame and a `<use>` may
 * be written twice, so the existing "id used twice in one frame" check keeps meaning what
 * it means.
 *
 * **A parameter is a slot name, substituted before anything validates it.**
 * `<define name="linha" params="texto">` writes `slot="texto"` in its body and
 * `<use component="linha" texto="titulo">` decides which slot that is. The substitution
 * happens on the component's children _before_ they are expanded, so the tree that reaches
 * `checkSlot` names real slots: the type check, the "not declared by this template" refusal
 * and `renderedSlots` all keep working on markup that never mentions a parameter.
 */

/** What a `<define>` takes. A `<use>` takes `component`, `class` and the declared params. */
const DEFINE_ATTRIBUTES = ['name', 'params'] as const;

/** The two words a `<use>` spends on itself, and so the two a parameter may not be called. */
const USE_RESERVED = ['component', 'class'] as const;

/** A parameter is substituted into a slot position, so it is named the way a slot is. */
const SLOT_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;

interface Component {
  readonly name: string;
  readonly params: readonly string[];
  readonly children: readonly TemplateElement[];
}

/**
 * The document with every `<define>` collected and every `<use>` replaced by its body.
 *
 * Component bodies are walked whether or not anything uses them: a circular `<use>` or a
 * misspelled component name in a `<define>` nobody draws yet is still a mistake, and
 * `tyto template check` is read before the frame that would have found it exists. The
 * duplicate diagnostics that produces for a component that _is_ used are collapsed by
 * `compileTemplate`, which reports one sentence per range.
 */
export function expandComponents(
  document: TemplateDocument,
  manifest: TemplateManifest,
  report: Report,
): TemplateDocument {
  const components = collectComponents(document, manifest, report);

  for (const component of components.values()) {
    expandChildren(component.children, components, [component.name], report);
  }

  return {
    ...document,
    elements: document.elements.flatMap((element) => topLevel(element, components, report)),
  };
}

function topLevel(
  element: TemplateElement,
  components: ReadonlyMap<string, Component>,
  report: Report,
): TemplateElement[] {
  if (element.tag === 'define') return [];
  if (element.tag === 'use') {
    report(
      markupProblem(
        'a <use> draws inside a <frame>, and this one is at the top level',
        element.tagRange,
      ),
    );
    return [];
  }
  return [{ ...element, children: expandChildren(element.children, components, [], report) }];
}

function collectComponents(
  document: TemplateDocument,
  manifest: TemplateManifest,
  report: Report,
): ReadonlyMap<string, Component> {
  const components = new Map<string, Component>();

  for (const element of document.elements) {
    if (element.tag !== 'define') continue;
    checkAttributes(element, DEFINE_ATTRIBUTES, report);

    const named = attributeOf(element, 'name');
    if (named === undefined || named.value === '') {
      report(markupProblem('a <define> needs name="…"', element.tagRange));
      continue;
    }
    if (components.has(named.value)) {
      report(markupProblem(`two components are defined as '${named.value}'`, named.valueRange));
      continue;
    }
    if (element.children.length === 0) {
      report(
        markupProblem(
          `component '${named.value}' holds no tags, so a <use> of it would draw nothing`,
          element.tagRange,
        ),
      );
      continue;
    }

    for (const child of element.children) refuseIds(child, named.value, report);
    components.set(named.value, {
      name: named.value,
      params: parametersOf(element, named.value, manifest, report),
      children: element.children,
    });
  }

  return components;
}

/**
 * The names a `<use>` of this component has to bind, read off `params="a b"`.
 *
 * Three of them are refused rather than accepted and left to surprise somebody. A name a
 * slot could not have would never be substituted into a `slot="…"`. `component` and `class`
 * are the words a `<use>` spends on itself, so a parameter called either could not be bound.
 * And a parameter that shadows a real slot would make `slot="titulo"` inside the body mean
 * the parameter, with no spelling left for the slot — silently, which is the part that
 * earns a refusal.
 */
function parametersOf(
  element: TemplateElement,
  component: string,
  manifest: TemplateManifest,
  report: Report,
): string[] {
  const declared = attributeOf(element, 'params');
  if (declared === undefined) return [];

  const names: string[] = [];
  for (const name of declared.value.split(/\s+/u).filter((item) => item !== '')) {
    if (!SLOT_NAME.test(name)) {
      report(
        markupProblem(
          `parameter '${name}' is not a name a slot could have; a parameter is spelled like a slot`,
          declared.valueRange,
        ),
      );
      continue;
    }
    if ((USE_RESERVED as readonly string[]).includes(name)) {
      report(
        markupProblem(
          `a parameter may not be called '${name}', because that is what a <use> calls its own attribute`,
          declared.valueRange,
        ),
      );
      continue;
    }
    if (manifest.slots[name] !== undefined) {
      report(
        markupProblem(
          `parameter '${name}' has the name of a slot template '${manifest.name}' declares, so slot="${name}" in this body could never reach that slot`,
          declared.valueRange,
        ),
      );
      continue;
    }
    if (names.includes(name)) {
      report(
        markupProblem(
          `component '${component}' declares parameter '${name}' twice`,
          declared.valueRange,
        ),
      );
      continue;
    }
    names.push(name);
  }

  return names;
}

function expandChildren(
  children: readonly TemplateElement[],
  components: ReadonlyMap<string, Component>,
  stack: readonly string[],
  report: Report,
): TemplateElement[] {
  const expanded: TemplateElement[] = [];

  for (const child of children) {
    if (child.tag === 'define') {
      report(markupProblem('a <define> is only written at the top level', child.tagRange));
      continue;
    }
    if (child.tag === 'use') {
      expanded.push(...expandUse(child, components, stack, report));
      continue;
    }
    expanded.push({
      ...child,
      children: expandChildren(child.children, components, stack, report),
    });
  }

  return expanded;
}

function expandUse(
  element: TemplateElement,
  components: ReadonlyMap<string, Component>,
  stack: readonly string[],
  report: Report,
): TemplateElement[] {
  const named = attributeOf(element, 'component');
  if (named === undefined || named.value === '') {
    report(markupProblem('a <use> needs component="…" naming a <define>', element.tagRange));
    return [];
  }
  if (element.children.length > 0) {
    report(
      markupProblem(
        'a <use> draws the component it names, so it holds no tags of its own',
        element.tagRange,
      ),
    );
  }

  const component = components.get(named.value);
  if (component === undefined) {
    report(unknownComponent(named.value, [...components.keys()], named.valueRange));
    return [];
  }
  if (stack.includes(component.name)) {
    report(markupProblem(`use runs in a circle through '${component.name}'`, named.valueRange));
    return [];
  }

  // Before the expansion, not after: a nested `<use>` passes a parameter on by naming it,
  // and by the time that inner tag is expanded the name has to be the slot it stands for.
  // A parameter nobody bound has no slot to stand for, so the component is not drawable
  // and the tree is not expanded: reporting slot='texto' as an undeclared slot would be
  // the consequence of a mistake the author has already been told about.
  const bindings = bindingsOf(element, component, report);
  if (bindings === undefined) return [];
  const bound = bindings.size === 0 ? component.children : substitute(component.children, bindings);

  const body = expandChildren(bound, components, [...stack, component.name], report);
  const instance = classesOf(element);
  if (instance.length === 0) return body;

  const source = attributeOf(element, 'class');
  return body.map((node) => withClasses(node, instance, source));
}

/**
 * What this `<use>` binds each parameter to, with both halves of the contract checked.
 *
 * A binding nothing declares and a declaration nothing binds are the same mistake seen from
 * two sides, and a typo produces both at once. So a parameter that an unknown binding was
 * already told to try is not also reported as unbound: `texo="titulo"` against
 * `params="texto"` is one sentence naming the fix, not two naming each other.
 */
function bindingsOf(
  element: TemplateElement,
  component: Component,
  report: Report,
): ReadonlyMap<string, TemplateAttribute> | undefined {
  const bindings = new Map<string, TemplateAttribute>();
  const named = new Set<string>();

  for (const attribute of element.attributes) {
    if ((USE_RESERVED as readonly string[]).includes(attribute.name)) continue;

    if (!component.params.includes(attribute.name)) {
      const suggestion = didYouMean(attribute.name, component.params);
      if (suggestion !== undefined) named.add(suggestion);
      report(unknownParameter(component, attribute.name, suggestion, attribute.nameRange));
      continue;
    }
    if (attribute.value === '') {
      report(
        markupProblem(
          `parameter '${attribute.name}' is bound to nothing, and it takes the name of a slot`,
          attribute.valueRange,
        ),
      );
      named.add(attribute.name);
      continue;
    }
    bindings.set(attribute.name, attribute);
  }

  for (const parameter of component.params) {
    if (bindings.has(parameter) || named.has(parameter)) continue;
    report(
      markupProblem(
        `component '${component.name}' declares parameter '${parameter}', and this <use> does not bind it`,
        element.tagRange,
      ),
    );
  }

  return bindings.size === component.params.length ? bindings : undefined;
}

/**
 * The component's body with every parameter replaced by the slot it was bound to.
 *
 * Three places name a slot, and all three are rewritten: `slot="texto"`, a `{texto}`
 * spliced into a `src`, and a nested `<use>`'s own binding, which is how a parameter is
 * handed one component further down. The rewritten attribute carries the **binding's**
 * range, because a binding that names a slot the manifest does not declare is a mistake in
 * the `<use>`, and the `<define>` it lands in is correct.
 */
function substitute(
  elements: readonly TemplateElement[],
  bindings: ReadonlyMap<string, TemplateAttribute>,
): TemplateElement[] {
  return elements.map((element) => ({
    ...element,
    attributes: element.attributes.map((attribute) =>
      substituteAttribute(element, attribute, bindings),
    ),
    children: substitute(element.children, bindings),
  }));
}

function substituteAttribute(
  element: TemplateElement,
  attribute: TemplateAttribute,
  bindings: ReadonlyMap<string, TemplateAttribute>,
): TemplateAttribute {
  const passedOn =
    element.tag === 'use' && !(USE_RESERVED as readonly string[]).includes(attribute.name);

  if (attribute.name === 'slot' || passedOn) {
    const binding = bindings.get(attribute.value);
    return binding === undefined ? attribute : bound(attribute, binding.value, binding);
  }

  if (attribute.name !== 'src') return attribute;

  let first: TemplateAttribute | undefined;
  let value = attribute.value;
  for (const name of new Set(interpolatedSlots(attribute.value))) {
    const binding = bindings.get(name);
    if (binding === undefined) continue;
    first ??= binding;
    value = value.split(`{${name}}`).join(`{${binding.value}}`);
  }

  return first === undefined ? attribute : bound(attribute, value, first);
}

/** The value and where it was written; the name stays where the `<define>` wrote it. */
function bound(
  attribute: TemplateAttribute,
  value: string,
  binding: TemplateAttribute,
): TemplateAttribute {
  return { ...attribute, value, range: binding.range, valueRange: binding.valueRange };
}

/**
 * The instance's classes, on this node and on every node under it.
 *
 * Not a wrapper carrying them, and not a descendant selector reading them: the language
 * has neither (`docs/template-authoring.md`, ADR 0017). A flag adjustment already works
 * exactly this way — `{destaque}` is ambient over an artwork and a rule that wants it
 * writes `.item.destaque` — so a component instance spells its override the same way.
 */
function withClasses(
  element: TemplateElement,
  instance: readonly string[],
  source: TemplateAttribute | undefined,
): TemplateElement {
  const own = attributeOf(element, 'class');
  const merged = [...new Set([...classesOf(element), ...instance])].join(' ');
  const at = own ?? source;
  const attribute: TemplateAttribute = {
    name: 'class',
    value: merged,
    range: at?.range ?? element.tagRange,
    nameRange: at?.nameRange ?? element.tagRange,
    valueRange: at?.valueRange ?? element.tagRange,
  };

  return {
    ...element,
    attributes:
      own === undefined
        ? [...element.attributes, attribute]
        : element.attributes.map((item) => (item.name === 'class' ? attribute : item)),
    children: element.children.map((child) => withClasses(child, instance, source)),
  };
}

function refuseIds(element: TemplateElement, component: string, report: Report): void {
  const id = attributeOf(element, 'id');
  if (id !== undefined) {
    report(
      markupProblem(
        `component '${component}' writes id='${id.value}', and a component writes no id: an id is unique in a frame and a <use> may be written twice. Write a class instead, and keep a mask's target outside the component`,
        id.valueRange,
      ),
    );
  }
  for (const child of element.children) refuseIds(child, component, report);
}

function checkAttributes(
  element: TemplateElement,
  accepted: readonly string[],
  report: Report,
): void {
  for (const attribute of element.attributes) {
    if (accepted.includes(attribute.name)) continue;
    report(
      markupProblem(
        `a <${element.tag}> takes ${accepted.join(' and ')}, and this is '${attribute.name}'`,
        attribute.nameRange,
      ),
    );
  }
}

function unknownComponent(
  name: string,
  defined: readonly string[],
  range: SourceRange,
): Diagnostic {
  // No question mark: `E_TEMPLATE_MARKUP` writes the problem into a sentence of its own
  // and ends it, so a problem that punctuates itself reads "…'chip'?.".
  const suggestion = didYouMean(name, defined);
  if (suggestion !== undefined) {
    return markupProblem(`no component is defined as '${name}'; try '${suggestion}'`, range);
  }
  return markupProblem(
    defined.length === 0
      ? `no component is defined as '${name}', and this template defines none`
      : `no component is defined as '${name}'; this template defines ${defined.join(', ')}`,
    range,
  );
}

function unknownParameter(
  component: Component,
  written: string,
  suggestion: string | undefined,
  range: SourceRange,
): Diagnostic {
  if (suggestion !== undefined) {
    return markupProblem(
      `component '${component.name}' declares no parameter '${written}'; try '${suggestion}'`,
      range,
    );
  }
  return markupProblem(
    component.params.length === 0
      ? `component '${component.name}' declares no parameters, and this <use> binds '${written}'`
      : `component '${component.name}' declares no parameter '${written}'; it declares ${component.params.join(', ')}`,
    range,
  );
}
