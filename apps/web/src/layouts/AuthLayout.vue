<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import BrandMark from '../components/layout/BrandMark.vue';

/** A slow, decorative clock face on the brand panel (device time, purely visual). */
const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => (timer = setInterval(() => (now.value = new Date()), 1000)));
onBeforeUnmount(() => clearInterval(timer));
const angle = (fraction: number) => fraction * 360;
</script>

<template>
  <div class="grid min-h-dvh lg:grid-cols-[1fr_minmax(480px,560px)]">
    <aside class="relative hidden overflow-hidden bg-[#0d0d1a] lg:block">
      <div
        class="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_30%,rgb(91_91_247/0.45),transparent_70%),radial-gradient(40%_40%_at_80%_80%,rgb(34_197_94/0.18),transparent_70%)]"
      />
      <div
        class="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div class="relative flex h-full flex-col justify-between p-12 text-white">
        <BrandMark tone="light" />
        <div class="flex items-center justify-center">
          <svg
            viewBox="0 0 200 200"
            class="w-[min(420px,38vw)] drop-shadow-[0_20px_60px_rgb(91_91_247/0.35)]"
            aria-hidden="true"
          >
            <circle
              cx="100"
              cy="100"
              r="92"
              fill="rgb(255 255 255 / 0.03)"
              stroke="rgb(255 255 255 / 0.12)"
            />
            <circle cx="100" cy="100" r="76" fill="none" stroke="rgb(255 255 255 / 0.06)" />
            <line
              v-for="i in 60"
              :key="i"
              x1="100"
              y1="12"
              x2="100"
              :y2="i % 5 === 0 ? 22 : 16"
              :stroke="i % 5 === 0 ? 'rgb(255 255 255 / 0.55)' : 'rgb(255 255 255 / 0.18)'"
              stroke-width="1.2"
              :transform="`rotate(${i * 6} 100 100)`"
            />
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="54"
              stroke="white"
              stroke-width="3.5"
              stroke-linecap="round"
              :transform="`rotate(${angle(((now.getHours() % 12) + now.getMinutes() / 60) / 12)} 100 100)`"
            />
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="34"
              stroke="white"
              stroke-width="2.5"
              stroke-linecap="round"
              :transform="`rotate(${angle((now.getMinutes() + now.getSeconds() / 60) / 60)} 100 100)`"
            />
            <line
              x1="100"
              y1="112"
              x2="100"
              y2="26"
              stroke="#7d7dff"
              stroke-width="1.4"
              stroke-linecap="round"
              class="transition-transform duration-300"
              :transform="`rotate(${angle(now.getSeconds() / 60)} 100 100)`"
            />
            <circle cx="100" cy="100" r="4" fill="#7d7dff" />
          </svg>
        </div>
        <div>
          <p class="max-w-md text-[28px] leading-tight font-semibold tracking-tight">
            Every minute, exactly where it belongs.
          </p>
          <p class="mt-3 max-w-md text-[15px] text-white/60">
            Server-timed tracking that stays right across devices, timezones and daylight saving.
          </p>
        </div>
      </div>
    </aside>
    <main class="flex items-center justify-center px-5 py-12 sm:px-10">
      <div class="w-full max-w-[400px]">
        <BrandMark class="mb-10 lg:hidden" />
        <RouterView v-slot="{ Component, route }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </div>
    </main>
  </div>
</template>
