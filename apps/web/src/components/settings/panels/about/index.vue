<template>
  <div class="about">
    <el-card v-if="isMobile || !isRemoteConnection" class="updateCard" shadow="never">
      <div class="cardHeader">
        <div class="cardLabel">
          <icon-refresh :size="18" aria-hidden="true" />
          <span>版本更新</span>
          <span v-if="currentVersion" class="currentVersion">v{{ currentVersion }}</span>
        </div>
        <el-button v-if="isMobile" tag="a" size="small" type="primary" plain :href="downloadUrl" target="_blank" rel="noopener noreferrer">前往 GitHub 更新</el-button>
        <el-badge v-else isDot :hidden="!hasDesktopUpdate">
          <el-button size="small" type="primary" plain :loading="checking" @click="openUpdate">
            {{ snapshot?.installFailure ? "查看更新失败原因" : snapshot?.updateReady ? "更新已就绪" : snapshot?.updating || action === "download" ? "查看更新进度" : "检查更新" }}
          </el-button>
        </el-badge>
      </div>
      <div v-if="isLocalDesktop" class="autoUpdateSetting">
        <span>自动更新</span>
        <el-switch :modelValue="desktopAutoUpdate" size="small" :loading="autoUpdateSaving" :disabled="!actualPlatform.isLocalDesktop" aria-label="自动更新" @change="(value) => saveAutoUpdate(value === true)" />
      </div>
      <div v-if="!isMobile && snapshot?.installFailure" class="installFailureNotice" role="alert">
        <strong>上次更新未成功</strong>
        <p>{{ snapshot.installFailure.message }}</p>
        <p>请前往 GitHub 最新发布页，选择适合当前系统的完整安装包，关闭客户端后重新安装。</p>
        <el-button tag="a" type="primary" size="small" :href="downloadUrl" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
      </div>
    </el-card>

    <el-dialog v-model="resultVisible" title="版本更新" width="min(480px, 92vw)" alignCenter appendToBody>
      <div class="updateResult" aria-live="polite" :aria-busy="working">
        <div class="resultHeader">
          <icon-refresh v-if="working" :size="22" aria-hidden="true" />
          <icon-alert-circle v-else-if="updateError" :size="22" aria-hidden="true" />
          <icon-arrow-up-circle v-else-if="snapshot?.updateAvailable" :size="22" aria-hidden="true" />
          <icon-circle-check v-else :size="22" aria-hidden="true" />
          <div class="resultCopy">
            <h3>{{ resultTitle }}</h3>
            <p>{{ resultMessage }}</p>
          </div>
        </div>
        <div v-if="!updateError && !snapshot?.installFailure && (action === 'download' || updateProgress || (snapshot?.updateReady && !updateInProgress))" class="updateProgress">
          <div v-if="updateInProgress" class="progressHeader">
            <span>{{ updateProgress?.phase === "preparing" ? "正在解压并校验更新包" : "下载进度" }}</span>
            <span v-if="updateProgress && (updateProgress.received > 0 || updateProgress.total)">
              {{ formatBytes(updateProgress.received) }}<template v-if="updateProgress.total"> / {{ formatBytes(updateProgress.total) }}</template>
            </span>
          </div>
          <el-progress v-if="updateProgress?.total || (!updateInProgress && snapshot?.updateReady)" :percentage="updatePercentage" :status="!updateInProgress && snapshot?.updateReady ? 'success' : undefined" />
        </div>
        <div v-if="!checking && !updateError && snapshot?.updateAvailable" class="releaseInfo">
          <div class="versionItem"><span>当前版本</span><strong>v{{ currentVersion }}</strong></div>
          <icon-arrow-right :size="18" aria-hidden="true" />
          <div class="versionItem"><span>最新版本</span><strong>v{{ snapshot.latestVersion }}</strong></div>
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="resultVisible = false">关闭</el-button>
        <el-button v-if="snapshot?.installFailure || (updateError && !updateInProgress)" tag="a" size="small" :href="downloadUrl" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
        <el-button v-if="!snapshot?.installFailure && snapshot?.updating && !working" size="small" type="primary" @click="runUpdate('read')">重新读取状态</el-button>
        <el-button v-else-if="!snapshot?.installFailure && snapshot?.canUpdate && snapshot.updateAvailable" size="small" :type="snapshot.updateReady ? 'danger' : 'primary'" :loading="working" @click="runUpdate(snapshot.updateReady ? 'apply' : 'download')">
          {{ snapshot.updateReady ? "重启并更新" : "下载更新" }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { translate, t } from "@toonflow/i18n/vue";
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { actualPlatform, isMobile, isLocalDesktop, isRemoteConnection } from "@/lib/platform";
import { IconRefresh, IconAlertCircle, IconArrowUpCircle, IconCircleCheck, IconArrowRight } from "@tabler/icons-vue";
import { saveSettings } from "@/stores/settings";
import {
  desktopAutoUpdate,
  desktopUpdateSnapshot as snapshot,
  desktopUpdateError as updateError,
  desktopUpdateAction as action,
  desktopUpdateChecking,
  hasDesktopUpdate,
  runDesktopUpdate,
  startDesktopUpdate,
} from "@/stores/desktopUpdate";

const downloadUrl = "https://github.com/coderxiaoluo/Toonflow-app/releases/latest";
const currentVersion = computed(() => snapshot.value?.version || import.meta.env.appVersion);
const autoUpdateSaving = ref(false);
const checking = computed(() => desktopUpdateChecking.value);
const working = computed(() => !!action.value);
const updateInProgress = computed(() => working.value || !!snapshot.value?.updating);
const updateProgress = computed(() => snapshot.value?.updateProgress);
const updatePercentage = computed(() => !updateInProgress.value && snapshot.value?.updateReady ? 100
  : updateProgress.value?.total ? Math.min(100, Math.floor(updateProgress.value.received / updateProgress.value.total * 100)) : 0);
const resultVisible = ref(false);
const resultTitle = computed(() => {
  if (snapshot.value?.installFailure) return translate("上次更新未成功");
  if (updateError.value) return translate("更新未完成");
  if (checking.value) return translate("正在检查更新");
  if (action.value === "read") return translate("正在读取更新状态");
  if (action.value === "apply") return translate("正在重启并更新");
  if (working.value) return translate("正在准备更新");
  if (snapshot.value?.updateReady) return translate("更新已准备完成");
  return snapshot.value?.updateAvailable ? translate("发现新版本") : translate("暂无更新");
});
const resultMessage = computed(() => {
  if (snapshot.value?.installFailure) return snapshot.value.installFailure.message;
  if (updateError.value) return updateError.value;
  if (checking.value) return translate("正在获取最新版本信息…");
  if (action.value === "read") return translate("正在确认客户端的更新状态，请稍候…");
  if (action.value === "apply") return translate("客户端即将关闭，更新完成后会自动重新打开。");
  if (working.value) return translate("正在下载并校验更新包，可以关闭此弹窗继续使用。");
  if (snapshot.value?.updateReady) return translate("点击“重启并更新”安装新版本，请先完成正在进行的任务。");
  if (!snapshot.value?.updateAvailable) return t`当前已是最新版本 v${currentVersion.value}`;
  return snapshot.value.canUpdate ? translate("有新的版本可用，下载完成后可重启更新。") : translate("当前客户端不支持应用内更新，请下载安装包。");
});

onMounted(() => {
  if (actualPlatform.isLocalDesktop) void runDesktopUpdate("read").catch(() => {});
});

function openUpdate() {
  resultVisible.value = true;
  if (working.value || snapshot.value?.updateReady || snapshot.value?.installFailure) return;
  void runUpdate("check");
}

async function saveAutoUpdate(enabled: boolean) {
  if (!actualPlatform.isLocalDesktop || autoUpdateSaving.value || enabled === desktopAutoUpdate.value) return;
  autoUpdateSaving.value = true;
  try {
    await saveSettings(() => ({ desktopAutoUpdate: enabled }));
    if (enabled) void startDesktopUpdate().catch(() => {});
  } catch (error) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || error.message : String(error));
  } finally {
    autoUpdateSaving.value = false;
  }
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function runUpdate(nextAction: "read" | "check" | "download" | "apply") {
  if (working.value) return;
  updateError.value = "";
  try {
    await runDesktopUpdate(nextAction);
    if (snapshot.value?.channel === "dev") updateError.value = "开发版本不提供更新检查，请使用正式桌面客户端。";
  } catch {
    // 错误与交接状态由全局 Store 保留，关闭面板不取消更新观察。
  }
}
</script>

<style lang="scss" scoped>
.about {
  .updateCard {
    border-radius: var(--ui-radius);

    .cardHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;

      .cardLabel {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;

        .currentVersion { color: var(--el-text-color-secondary); font-size: 12px; font-weight: 400; }
      }
    }

    .autoUpdateSetting {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 12px;
      font-size: 13px;
    }

    .installFailureNotice {
      margin-top: 14px;
      padding: 12px;
      border-radius: var(--ui-radius);
      background: var(--el-color-danger-light-9);

      strong { color: var(--el-color-danger); }
      p { margin: 8px 0 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
    }
  }
}

.updateResult {
  padding: 8px 0;

  .resultHeader {
    display: flex;
    align-items: flex-start;
    gap: 12px;

    > svg { flex-shrink: 0; color: var(--el-color-primary); }
    .resultCopy {
      min-width: 0;

      h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
      p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
    }
  }

  .updateProgress {
    margin-top: 20px;

    .progressHeader { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
  }

  .releaseInfo {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 20px;
    padding: 14px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--ui-radius);

    .versionItem {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 8px;
      min-width: 0;

      span { color: var(--el-text-color-secondary); font-size: 12px; }
      strong { font-size: 18px; overflow-wrap: anywhere; }
    }
  }
}
</style>
