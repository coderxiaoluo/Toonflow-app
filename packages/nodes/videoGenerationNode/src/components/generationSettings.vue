<template>
  <el-popover v-model:visible="settingsVisible" trigger="click" placement="top-start" width="min(340px, calc(100vw - 24px))" :disabled="disabled" :showArrow="false" :popperStyle="{ padding: '14px' }">
    <template #reference>
      <el-button class="settingsButton" text size="small" :disabled="disabled" :aria-expanded="settingsVisible" aria-label="视频生成设置">
        <span v-if="!isSourceVideoOperation" class="ratioShape" :style="ratioStyle(ratio)" aria-hidden="true" />
        <span>{{ summary }}</span>
        <component :is="settingsVisible ? IconChevronDown : IconChevronUp" :size="14" aria-hidden="true" />
      </el-button>
    </template>
    <div class="generationSettings nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop @wheel.stop>
      <div v-if="modes.length" class="sectionLabel">生成模式</div>
      <el-select v-if="modes.length" v-model="mode" :disabled="disabled" :teleported="false" aria-label="视频生成模式">
        <el-option v-for="item in modes" :key="item.value" :value="item.value" :label="item.label" />
      </el-select>
      <template v-if="isDevelopCcSeedance">
        <div class="sectionLabel">业务模式</div>
        <el-select v-model="videoOperation" :disabled="disabled" :teleported="false" aria-label="视频业务模式">
          <el-option value="generate" label="生成" />
          <el-option value="edit" label="编辑" />
          <el-option value="extend" label="延长" />
        </el-select>
        <div v-if="isSourceVideoOperation" class="sourceVideoOptions">
          <p class="operationHint">连接一个 4–30 秒的原视频节点，生成时自动通过 Cloudflare 临时通道供模型读取。无需填写链接或上传存储桶，生成期间请保持电脑联网。</p>
          <template v-if="other.videoOperation === 'extend'">
            <div class="sectionLabel">新增时长</div>
            <el-select v-model="extensionDuration" :disabled="disabled" :teleported="false" aria-label="新增视频时长">
              <el-option :value="-1" label="自动" />
              <el-option v-for="item in extensionDurations" :key="item" :value="item" :label="`${item}秒`" />
            </el-select>
          </template>
          <p class="operationHint">{{ other.videoOperation === 'edit' ? '编辑保持原视频时长，先按 30 秒预扣，完成后按实际时长结算。' : '延长仅返回新增片段；自动时长先按 30 秒预扣。' }}</p>
        </div>
      </template>
      <div v-if="(!isSourceVideoOperation && durations.length) || resolutions.length" class="outputOptions">
        <div v-if="!isSourceVideoOperation && durations.length" class="outputField">
          <div class="sectionLabel">时长</div>
          <el-select v-model="duration" :disabled="disabled" :teleported="false" aria-label="视频时长">
            <el-option v-for="item in durations" :key="item" :value="item" :label="`${item}秒`" />
          </el-select>
        </div>
        <div v-if="resolutions.length" class="outputField">
          <div class="sectionLabel">分辨率</div>
          <el-select v-model="resolution" :disabled="disabled" :teleported="false" aria-label="视频分辨率">
            <el-option v-for="item in resolutions" :key="item" :value="item" :label="item" />
          </el-select>
        </div>
      </div>
      <div v-if="!isSourceVideoOperation" class="sectionLabel">画面比例</div>
      <div v-if="!isSourceVideoOperation" class="ratioOptions" role="group" aria-label="视频比例">
        <el-button v-for="item in ratios" :key="item" class="ratioButton" :disabled="disabled" :aria-label="`比例 ${item}`" :aria-pressed="ratio === item" @click="ratio = item">
          <span class="ratioContent">
            <span class="ratioShape" :style="ratioStyle(item)" aria-hidden="true" />
            <span>{{ item }}</span>
          </span>
        </el-button>
      </div>
      <div v-if="model?.audio === 'optional'" class="audioOption">
        <span class="sectionLabel">生成音频</span>
        <el-switch v-model="generateAudio" :disabled="disabled" aria-label="生成音频" />
      </div>
      <modelForm v-model="other" :rules="model?.rules" :disabled="disabled" />
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElButton, ElPopover, ElSelect, ElOption, ElSwitch } from "element-plus";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import type { NodeMediaModel } from "@toonflow/nodes-scaffold/runtime";
import modelForm from "@toonflow/node-shared/modelForm";

const props = defineProps<{ model?: NodeMediaModel; disabled?: boolean; ratios: string[] }>();
const settingsVisible = ref(false);
const duration = defineModel<number | undefined>("duration", { required: true });
const resolution = defineModel<string>("resolution", { required: true });
const ratio = defineModel<string>("ratio", { required: true });
const mode = defineModel<string>("mode", { required: true });
const generateAudio = defineModel<boolean>("generateAudio", { required: true });
const other = defineModel<Record<string, unknown>>("other", { required: true });
const isDevelopCcSeedance = computed(() => props.model?.providerId === "developCc" && props.model?.modelId === "seedance-2.5");
const isSourceVideoOperation = computed(() => isDevelopCcSeedance.value && (other.value.videoOperation === "edit" || other.value.videoOperation === "extend"));
const videoOperation = computed({
  get: () => typeof other.value.videoOperation === "string" ? other.value.videoOperation : "generate",
  set: (value: string) => { other.value.videoOperation = value; },
});
const extensionDuration = computed({
  get: () => typeof other.value.extensionDuration === "number" ? other.value.extensionDuration : -1,
  set: (value: number) => { other.value.extensionDuration = value; },
});
const extensionDurations = Array.from({ length: 27 }, (_, index) => index + 4);
const summary = computed(() => isSourceVideoOperation.value
  ? [other.value.videoOperation === "edit" ? "编辑" : "延长", "跟随原视频", resolution.value].filter(Boolean).join(" · ")
  : [ratio.value, resolution.value, duration.value ? `${duration.value}秒` : ""].filter(Boolean).join(" · "));

watch([isDevelopCcSeedance, () => other.value.videoOperation, () => other.value.extensionDuration], ([enabled]) => {
  if (!enabled) return;
  if (other.value.videoOperation == null) other.value.videoOperation = "generate";
  if (other.value.extensionDuration == null) other.value.extensionDuration = -1;
}, { immediate: true });

const modeLabels: Record<string, string> = {
  text: "文生视频", singleImage: "单图参考", startEndRequired: "首尾帧必填", endFrameOptional: "尾帧可选", startFrameOptional: "首帧可选",
};
const modes = computed(() => (props.model?.mode ?? []).map(item => ({
  value: JSON.stringify(item),
  label: Array.isArray(item) ? "混合参考" : modeLabels[item] ?? item,
})));
const mappings = computed(() => props.model?.durationResolutionMap ?? []);
const durations = computed(() => [...new Set(mappings.value.flatMap(item => item.duration))].sort((a, b) => a - b));
const resolutions = computed(() => resolutionsFor(duration.value));

function resolutionRank(value: string) {
  if (/^4k$/i.test(value)) return 2160;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

function resolutionsFor(value: number | undefined) {
  return [...new Set(mappings.value.filter(item => value !== undefined && item.duration.includes(value)).flatMap(item => item.resolution))]
    .sort((left, right) => resolutionRank(left) - resolutionRank(right));
}

function ratioStyle(value: string) {
  const [width = Number.NaN, height = Number.NaN] = value.split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: "16px", height: "16px" };
  return { width: `${16 * Math.min(width / height, 1)}px`, height: `${16 * Math.min(height / width, 1)}px` };
}
</script>

<style scoped lang="scss">
.ratioShape {
  display: inline-block;
  flex-shrink: 0;
  border: 1px solid currentColor;
  border-radius: 2px;
  box-sizing: border-box;
}

.settingsButton {
  flex-shrink: 0;
  :deep(> span) { gap: 6px; }
}

.generationSettings {
  text-align: left;

  .sectionLabel {
    margin-bottom: 8px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    font-weight: 500;
  }

  > .el-select { margin-bottom: 14px; }

  .sourceVideoOptions {
    margin-bottom: 14px;

    .operationHint {
      margin: 8px 0 14px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
      line-height: 1.5;

      &:last-child { margin-bottom: 0; }
    }
  }

  .outputOptions {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;
    .outputField { flex: 1; min-width: 0; }
  }

  .ratioOptions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(52px, 1fr));
    gap: 8px;

    .ratioButton {
      height: 60px;
      margin: 0;
      padding: 8px 4px;
      color: var(--el-text-color-secondary);
      --el-button-bg-color: var(--el-fill-color-light);
      --el-button-hover-bg-color: var(--el-fill-color);
      --el-button-hover-text-color: var(--el-text-color-primary);
      --el-button-hover-border-color: var(--el-border-color-darker);

      &[aria-pressed="true"] {
        color: var(--el-text-color-primary);
        border-color: var(--el-text-color-regular);
        background: var(--el-fill-color);
      }

      .ratioContent {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
    }
  }

  .audioOption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
    .sectionLabel { margin: 0; }
  }
}
</style>
