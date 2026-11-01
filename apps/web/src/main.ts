import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router/index.ts';
import './styles/main.css';

createApp(App).use(createPinia()).use(router).mount('#app');

// The launch screen covers the session check (a refresh round trip) and the first route.
void router.isReady().finally(() => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 200);
});
