<script setup lang="ts">
import BaseButton from '../components/ui/BaseButton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
</script>

<template>
  <div class="card">
    <EmptyState
      art="compass"
      title="Page not found"
      description="It may have moved, or you don’t have access to it."
    >
      <RouterLink v-slot="{ navigate }" to="/" custom>
        <BaseButton variant="primary" @click="navigate">Go home</BaseButton>
      </RouterLink>
    </EmptyState>
  </div>
</template>
