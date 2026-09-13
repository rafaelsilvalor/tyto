import { type Diagnostic, type SourceRange, didYouMean } from '@tyto/core';

import type { TemplateAttribute, TemplateDocument, TemplateElement } from './ast.js';
import { attributeOf, classesOf } from './frames.js';
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
 */

/** What each structural tag takes. `params` on a `<define>` is E4.10, not here. */
const DEFINE_ATTRIBUTES = ['name'] as const;
const USE_ATTRIBUTES = ['component', 'class'] as const;

interface Component {
  readonly name: string;
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
export function expandComponents(document: TemplateDocument, report: Report): TemplateDocument {
  const components = collectComponents(document, report);

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
    components.set(named.value, { name: named.value, children: element.children });
  }

  return components;
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
  checkAttributes(element, USE_ATTRIBUTES, report);

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

  const body = expandChildren(component.children, components, [...stack, component.name], report);
  const instance = classesOf(element);
  if (instance.length === 0) return body;

  const source = attributeOf(element, 'class');
  return body.map((node) => withClasses(node, instance, source));
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
