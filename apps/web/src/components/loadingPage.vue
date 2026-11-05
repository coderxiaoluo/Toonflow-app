<template>
  <teleport to="body">
    <div v-if="visible" class="loadingPage" role="status" aria-label="正在加载项目" />
  </teleport>
</template>

<script setup lang="ts">
import { watch } from "vue";

const props = defineProps<{ active: boolean }>();
const visible = defineModel<boolean>("visible", { default: false });
const drawn = defineModel<boolean>("drawn", { default: false });

watch(() => props.active, active => {
  visible.value = active;
  // 首页等待此信号后进入工作区；移除图标后不再等待描边动画。
  drawn.value = true;
}, { immediate: true });
</script>

<style lang="scss" scoped>
.loadingPage {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: var(--el-bg-color);
}
</style>
