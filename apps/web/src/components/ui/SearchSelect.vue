<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import ProjectDot from './ProjectDot.vue';

export interface SelectOption {
  value: string;
  label: string;
  /** Options with the same group are listed under a header. */
  group?: string;
  color?: string;
  hint?: string;
  /** Shown slightly indented (e.g. tasks under their project). */
  indent?: boolean;
  /** Extra text the search matches against. */
  keywords?: string;
}

const props = withDefaults(
  defineProps<{
    options: readonly SelectOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    label?: string;
    error?: string | null;
    /** Visual style of the trigger. */
    appearance?: 'field' | 'inline';
    disabled?: boolean;
  }>(),
  {
    placeholder: 'Select…',
    searchPlaceholder: 'Search…',
    emptyText: 'Nothing matches',
    appearance: 'field',
  },
);
const model = defineModel<string | null>({ default: null });
const emit = defineEmits<{ open: [] }>();

const id = useId();
const open = ref(false);
const query = ref('');
const active = ref(0);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLDivElement | null>(null);
const search = ref<HTMLInputElement | null>(null);
const position = ref({ top: 0, bottom: 0, left: 0, width: 280, maxHeight: 320, above: false });

const selected = computed(() => props.options.find((o) => o.value === model.value) ?? null);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) =>
    `${o.label} ${o.group ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q),
  );
});
/** Rows to render: group headers interleaved with options. */
const rows = computed(() => {
  const out: (
    { kind: 'header'; label: string } | { kind: 'option'; option: SelectOption; index: number }
  )[] = [];
  let group: string | undefined;
  filtered.value.forEach((option, index) => {
    if (option.group && option.group !== group) out.push({ kind: 'header', label: option.group });
    group = option.group;
    out.push({ kind: 'option', option, index });
  });
  return out;
});

function place(): void {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  const width = Math.max(rect.width, 300);
  const below = window.innerHeight - rect.bottom - 12;
  const above = rect.top - 12;
  const showAbove = below < 260 && above > below;
  position.value = {
    top: rect.bottom + 6,
    bottom: window.innerHeight - rect.top + 6,
    left: Math.min(rect.left, window.innerWidth - width - 8),
    width,
    maxHeight: Math.min(360, showAbove ? above : below),
    above: showAbove,
  };
}

async function show(): Promise<void> {
  if (props.disabled) return;
  open.value = true;
  query.value = '';
  active.value = Math.max(
    0,
    filtered.value.findIndex((o) => o.value === model.value),
  );
  emit('open');
  place();
  await nextTick();
  search.value?.focus();
  scrollActive();
}

function hide(refocus = true): void {
  open.value = false;
  if (refocus) trigger.value?.focus();
}

function choose(option: SelectOption): void {
  model.value = option.value;
  hide();
}

function scrollActive(): void {
  panel.value
    ?.querySelector(`[data-index="${active.value}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

function onKey(event: KeyboardEvent): void {
  const count = filtered.value.length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (count === 0) return;
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
    void nextTick(scrollActive);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const option = filtered.value[active.value];
    if (option) choose(option);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    hide();
  } else if (event.key === 'Tab') {
    hide(false);
  }
}

function onOutside(event: PointerEvent): void {
  const target = event.target as Node;
  if (!panel.value?.contains(target) && !trigger.value?.contains(target)) hide(false);
}

watch(query, () => {
  active.value = 0;
});
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
  } else {
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
  }
});
onBeforeUnmount(() => {
  open.value = false;
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
});

defineExpose({ show });
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-[13px] font-medium text-ink">{{ label }}</label>
    <button
      :id="id"
      ref="trigger"
      type="button"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-invalid="error ? 'true' : undefined"
      class="group flex min-w-0 items-center gap-2 text-left text-sm transition-colors"
      :class="
        appearance === 'field'
          ? 'field justify-between'
          : 'h-9 rounded-[10px] px-2.5 hover:bg-surface-2'
      "
      @click="open ? hide() : show()"
      @keydown.down.prevent="show()"
    >
      <slot name="trigger" :selected="selected">
        <span class="flex min-w-0 items-center gap-2">
          <ProjectDot v-if="selected?.color" :color="selected.color" />
          <span class="truncate" :class="selected ? 'text-ink' : 'text-faint'">
            {{ selected?.label ?? placeholder }}
          </span>
        </span>
      </slot>
      <AppIcon
        name="chevron-down"
        :size="15"
        class="shrink-0 text-faint transition-transform"
        :class="open && 'rotate-180'"
      />
    </button>
    <p v-if="error" class="text-[12.5px] text-danger" role="alert">{{ error }}</p>

    <Teleport to="body">
      <Transition name="pop">
        <div
          v-if="open"
          ref="panel"
          class="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
          :style="{
            left: `${position.left}px`,
            width: `${position.width}px`,
            maxHeight: `${position.maxHeight}px`,
            ...(position.above ? { bottom: `${position.bottom}px` } : { top: `${position.top}px` }),
          }"
        >
          <div class="flex items-center gap-2 border-b border-line px-3">
            <AppIcon name="search" :size="15" class="text-faint" />
            <input
              ref="search"
              v-model="query"
              class="h-10 w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
              :placeholder="searchPlaceholder"
              role="combobox"
              aria-autocomplete="list"
              :aria-controls="`${id}-list`"
              :aria-activedescendant="`${id}-opt-${active}`"
              @keydown="onKey"
            />
          </div>
          <ul :id="`${id}-list`" role="listbox" class="scrollbar-thin overflow-y-auto p-1.5">
            <li v-if="filtered.length === 0" class="px-3 py-6 text-center text-sm text-faint">
              {{ emptyText }}
            </li>
            <template v-for="(row, i) in rows" :key="i">
              <li
                v-if="row.kind === 'header'"
                class="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase"
                role="presentation"
              >
                {{ row.label }}
              </li>
              <li
                v-else
                :id="`${id}-opt-${row.index}`"
                role="option"
                :data-index="row.index"
                :aria-selected="row.option.value === model"
                class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm"
                :class="[
                  row.index === active ? 'bg-surface-2 text-ink' : 'text-ink',
                  row.option.indent && 'pl-7',
                ]"
                @pointerenter="active = row.index"
                @click="choose(row.option)"
              >
                <ProjectDot v-if="row.option.color" :color="row.option.color" />
                <span class="min-w-0 flex-1 truncate" :class="row.option.indent && 'text-muted'">
                  {{ row.option.label }}
                </span>
                <span v-if="row.option.hint" class="shrink-0 text-xs text-faint">{{
                  row.option.hint
                }}</span>
                <AppIcon
                  v-if="row.option.value === model"
                  name="check"
                  :size="15"
                  class="text-accent"
                />
              </li>
            </template>
          </ul>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
