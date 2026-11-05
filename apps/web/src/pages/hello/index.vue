<template>
  <main class="hello" :class="{ configuring: view !== 'welcome' }">
    <div class="pageLanguage"><languageSelect popover /></div>
    <section class="welcomePanel" aria-labelledby="welcomeTitle">
      <div v-if="view !== 'welcome'" class="providerContent">
        <header class="providerHeader">
          <el-button text :icon="IconArrowLeft" :disabled="saving" @click="view = 'welcome'">返回</el-button>
          <h1 id="welcomeTitle">配置第三方模型</h1>
        </header>
        <div class="providerBody">
          <languageModel />
        </div>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!customProviders.some((provider) => provider.models.length)"
          @click="completeSetup">
          开始使用
        </el-button>
      </div>
      <div v-else class="welcomeContent">
        <h1 id="welcomeTitle">快速开始</h1>
        <p class="description">无需登录，直接开始创作。使用 AI 功能前，请先配置模型服务。</p>
        <el-button class="startButton" type="primary" :loading="saving" @click="completeSetup">开始使用</el-button>
        <div class="secondaryActions">
          <el-button class="secondaryButton" round :disabled="saving" @click="view = 'custom'">
            <icon-key class="buttonIcon" />
            配置第三方模型
          </el-button>
        </div>
      </div>

      <footer class="pageFooter">
        <el-button class="deviceLink" size="small" :icon="IconDevices" @click="mobileConnectVisible = true">{{ mobileConnectionLabel }}</el-button>
      </footer>
    </section>
    <mobileConnect v-model="mobileConnectVisible" />
  </main>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { IconArrowLeft, IconDevices } from "@tabler/icons-vue";
import { customProviders } from "@/stores/settings";
import { useHelloStore } from "@/stores/hello";
import anonymousData from "@/lib/anonymousData";
import languageSelect from "@/components/languageSelect.vue";
import { mobileConnectionLabel } from "@/lib/mobile";

const languageModel = defineAsyncComponent(() => import("@/components/settings/panels/languageModel/index.vue"));
const mobileConnect = defineAsyncComponent(() => import("@/components/mobileConnect.vue"));
const mobileConnectVisible = ref(false);
const view = ref<"welcome" | "custom">("welcome");
const saving = ref(false);
const router = useRouter();
const hello = useHelloStore();

async function completeSetup() {
  if (saving.value) return;
  saving.value = true;
  try {
    await hello.complete();
    anonymousData.track(view.value === "custom" ? "onboarding.complete" : "onboarding.skip");
    await router.replace("/home");
  } catch {
    ElMessage.error("保存引导状态失败，请重试");
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.hello {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 100svh;
  padding: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-family: "Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;

  .pageLanguage {
    position: fixed;
    top: 16px;
    inset-inline-end: 16px;
    z-index: 2;
    max-width: calc(50% - 24px);
  }

  .welcomePanel {
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 32px;
    min-width: 0;
    min-height: 544px;
    padding: 48px clamp(24px, 4.4vw, 64px);

    .providerContent {
      grid-row: 1;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 24px;
      min-width: 0;
      min-height: 0;
      overflow: hidden;

      .providerHeader {
        h1 {
          margin: 16px 0 0;
          font-size: 28px;
          font-weight: 650;
        }
      }

      .providerBody {
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 2px;
      }
    }

    .welcomeContent {
      grid-row: 1;
      align-self: center;
      justify-self: center;
      width: 100%;
      max-width: 420px;

      h1 {
        margin: 0 0 12px;
        font-size: clamp(32px, 3.4vw, 40px);
        font-weight: 650;
        line-height: 1.35;
        letter-spacing: -0.8px;
        text-align: center;
      }

      .description {
        margin: 0 0 24px;
        color: var(--el-text-color-secondary);
        font-size: 14px;
        line-height: 1.8;
        text-align: center;
      }

      .startButton {
        width: 100%;
        min-height: 42px;
      }

      .buttonIcon {
        width: 18px;
        height: 18px;
        margin-inline-end: 8px;
      }

      .secondaryActions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-top: 20px;

        .secondaryButton {
          height: auto;
          min-height: 36px;
          margin: 0;
          padding: 8px 16px;
          white-space: normal;
          font-size: 13px;
        }
      }
    }

    .pageFooter {
      grid-row: 2;
      align-self: end;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      .deviceLink {
        margin: 0;
        padding: 6px 10px;
        color: var(--el-text-color-secondary);

        &:hover {
          color: var(--el-color-primary);
        }
      }

    }
  }

  &.configuring {
    height: 100dvh;
    min-height: 0;
    overflow: hidden;

    .welcomePanel {
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 24px;
      min-height: 0;

      .pageFooter {
        grid-row: 2;
      }
    }
  }

  @media (max-width: 700px) {
    grid-template-columns: 1fr;

    .pageLanguage {
      inset-inline-end: 16px;
      max-width: calc(100% - 32px);
    }

    .welcomePanel {
      padding: 32px 20px;
    }

  }
}
</style>
