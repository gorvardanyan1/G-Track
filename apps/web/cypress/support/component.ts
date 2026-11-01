/// <reference types="cypress" />
import { createPinia, setActivePinia } from 'pinia';
import type { Component } from 'vue';
import { mount } from 'cypress/vue';
import '../../src/styles/main.css';

interface MountOptions {
  props?: Record<string, unknown>;
  slots?: Record<string, unknown>;
  global?: { plugins?: unknown[] };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Mounts a component with a fresh Pinia (stores start empty for every test). */
      mount(component: Component, options?: MountOptions): Chainable;
    }
  }
}

Cypress.Commands.add('mount', (component: Component, options: MountOptions = {}) => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const plugins = [...(options.global?.plugins ?? []), pinia];
  // cypress/vue's overloads can't name "any component"; the props are checked at runtime.
  return mount(component as never, { ...options, global: { ...options.global, plugins } } as never);
});

export {};
