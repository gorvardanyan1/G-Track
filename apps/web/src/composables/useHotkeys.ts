import { onBeforeUnmount, onMounted } from 'vue';

/** True while the user is typing somewhere (shortcuts must not fire then). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    el.closest('[role="dialog"]') !== null
  );
}

/** Single-key shortcuts ("s", "n"), ignored while typing, in dialogs or with modifiers. */
export function useHotkeys(bindings: Record<string, () => void>): void {
  function onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (isTyping(event.target)) return;
    const action = bindings[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
  }
  onMounted(() => document.addEventListener('keydown', onKey));
  onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
}
