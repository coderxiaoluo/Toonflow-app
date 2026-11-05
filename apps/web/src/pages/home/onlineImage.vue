<template>
  <div class="onlineImage">
    <header class="pageHeader">
      <div>
        <h1>在线生成</h1>
        <p>选择已启用的{{ mediaLabel }}模型，生成结果会保存在本地。</p>
      </div>
      <el-button text @click="emit('openSettings')">模型设置</el-button>
    </header>
    <el-radio-group v-model="mediaType" class="mediaTabs" aria-label="生成类型" :disabled="generating">
      <el-radio-button value="image">图片</el-radio-button>
      <el-radio-button value="video">视频</el-radio-button>
    </el-radio-group>
    <div class="studio">
      <form class="controls" :aria-busy="generating" @submit.prevent="submit">
        <label class="field">
          <span>提示词</span>
          <el-mention ref="promptInput" v-model="prompt" :options="mentionOptions" name="prompt" autocomplete="off" type="textarea" :autosize="{ minRows: 10, maxRows: 22 }" resize="vertical" maxlength="20000" placeholder="输入提示词，输入 @ 引用已添加的素材…" aria-label="提示词" :disabled="generating" />
        </label>
        <div class="field">
          <span>参考图片（{{ imageSlots.length }}/{{ referenceLimits.image }}）</span>
          <div class="references">
            <div v-for="(label, index) in referenceLabels" :key="label" class="referenceSlot" :class="{ dragOver: dragIndex === index, filled: slots[index] }">
              <button type="button" :aria-label="slots[index] ? `更换${label}` : `上传${label}`" :disabled="generating || !referencesAllowed" @click="pickReference(index)" @dragover="dragOver(index, $event)" @dragleave="dragLeave(index, $event)" @drop="dropReference(index, $event)">
                <img v-if="slots[index]" :src="slots[index]?.preview" :alt="label" width="160" height="160" />
                <span v-if="slots[index]" class="slotState">{{ label }}</span>
                <template v-else>
                  <icon-plus :size="18" aria-hidden="true" />
                  <span>{{ label }}</span>
                </template>
                <span v-if="slots[index]?.uploading" class="slotState">上传中…</span>
              </button>
              <button v-if="slots[index] && !generating" class="clearReference" type="button" :aria-label="`移除${label}`" @click="clearReference(index)">
                <icon-x :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
          <input ref="fileInput" name="reference" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/tiff" hidden aria-label="上传参考图" :disabled="generating || !referencesAllowed" @change="selectReference" />
        </div>
        <template v-if="mediaType === 'video'">
          <label v-if="supportsEditing" class="field">
            <span>视频操作</span>
            <el-select v-model="videoOperation" :disabled="generating" aria-label="视频操作">
              <el-option label="视频生成" value="generate" />
              <el-option label="视频编辑" value="edit" />
              <el-option label="视频延长" value="extend" />
            </el-select>
          </label>
          <template v-if="modifyingVideo">
            <label class="field">
              <span>原视频公网直链（4–30 秒）</span>
              <el-input v-model="sourceVideoUrl" :disabled="generating || videoUploading" placeholder="上传本地视频或粘贴 https://…/source.mp4" aria-label="原视频公网直链" />
              <el-button :loading="videoUploading" :disabled="generating || videoUploading" @click="pickVideo(true)">上传原视频到 Litterbox</el-button>
            </label>
            <p class="formMessage">{{ videoOperation === 'edit' ? '提示词描述要编辑的内容，成片时长与原视频一致。' : '提示词描述向前或向后延长；返回的成片仅包含新增片段。' }}比例跟随原视频；自动时长先按 30 秒预扣，完成后按实际时长结算。</p>
            <label v-if="videoOperation === 'extend'" class="field">
              <span>新增时长</span>
              <el-select v-model="extensionDuration" :disabled="generating" aria-label="新增时长">
                <el-option label="自动决定" :value="-1" />
                <el-option v-for="item in 27" :key="item" :label="`${item + 3} 秒`" :value="item + 3" />
              </el-select>
            </label>
          </template>
          <div v-else-if="referenceLimits.video" class="field">
            <span>参考视频（{{ videoUrls.length }}/{{ referenceLimits.video }}）</span>
            <div v-for="(_, index) in videoUrls" :key="index" class="referenceRow">
              <el-input v-model="videoUrls[index]" :disabled="generating" :aria-label="`视频${index + 1}公网直链`" :placeholder="`视频${index + 1}：https://…/video.mp4`" />
              <el-button :disabled="generating" aria-label="移除参考视频" @click="videoUrls.splice(index, 1)">移除</el-button>
            </div>
            <el-button :disabled="generating || videoUrls.length >= referenceLimits.video" @click="videoUrls.push('')">添加视频直链</el-button>
            <el-button :loading="videoUploading" :disabled="generating || videoUploading || videoUrls.length >= referenceLimits.video" @click="pickVideo(false)">上传本地参考视频</el-button>
          </div>
          <p class="formMessage">本地视频将上传至第三方 Litterbox，临时链接有效约 24 小时，无需存储桶。请勿上传敏感素材；链接过期后需重新上传。</p>
          <input ref="videoInput" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" hidden aria-label="上传视频到 Litterbox" :disabled="generating || videoUploading" @change="selectVideo" />
          <div v-if="referenceLimits.audio" class="field">
            <span>参考音频（{{ audioSlots.length }}/{{ referenceLimits.audio }}）</span>
            <div v-for="(item, index) in audioSlots" :key="item.preview" class="referenceRow">
              <span>音频{{ index + 1 }}{{ item.uploading ? ' · 上传中…' : '' }}</span>
              <audio :src="item.preview" controls preload="metadata" />
              <el-button :disabled="generating" @click="removeAudio(index)">移除</el-button>
            </div>
            <el-button :disabled="generating || audioSlots.length >= referenceLimits.audio" @click="audioInput?.click()">添加参考音频</el-button>
            <input ref="audioInput" type="file" accept="audio/*" hidden aria-label="上传参考音频" :disabled="generating" @change="selectAudio" />
          </div>
        </template>
        <div class="options">
          <label class="field">
            <span>模型</span>
            <el-select v-model="modelId" :loading="modelsLoading" :disabled="generating || !providerId" placeholder="选择模型" aria-label="模型" :noDataText="`当前平台没有${mediaLabel}模型`" @change="syncSize">
              <template #label="{ label }"><span translate="no">{{ label }}</span></template>
              <el-option v-for="item in providerModels" :key="item.modelId" :label="item.label" :value="item.modelId">
                <span translate="no">{{ item.label }}</span>
              </el-option>
            </el-select>
          </label>
          <label v-if="mediaType === 'image' || resolutionOptions.length" class="field">
            <span>分辨率</span>
            <el-select v-model="selectedResolution" :disabled="generating || !currentModel" placeholder="分辨率" aria-label="分辨率">
              <template #label="{ label }"><span translate="no">{{ label }}</span></template>
              <el-option v-for="item in mediaType === 'video' ? resolutionOptions : sizeOptions" :key="item" :label="item" :value="item">
                <span translate="no">{{ item }}</span>
              </el-option>
            </el-select>
          </label>
          <label v-if="ratioOptions.length && !modifyingVideo" class="field">
            <span>比例</span>
            <el-select v-model="ratio" :disabled="generating || !currentModel" placeholder="比例" aria-label="比例">
              <template #label="{ label }"><span translate="no">{{ label }}</span></template>
              <el-option v-for="item in ratioOptions" :key="item" :label="item" :value="item">
                <span translate="no">{{ item }}</span>
              </el-option>
            </el-select>
          </label>
          <label v-if="mediaType === 'image'" class="field">
            <span>数量</span>
            <el-select v-model="count" :disabled="generating" aria-label="生成数量">
              <el-option v-for="item in counts" :key="item" :label="`×${item}`" :value="item" />
            </el-select>
          </label>
          <label v-if="mediaType === 'video' && durationOptions.length && !modifyingVideo" class="field">
            <span>时长</span>
            <el-select v-model="duration" :disabled="generating || !currentModel" aria-label="视频时长">
              <el-option v-for="item in durationOptions" :key="item" :label="`${item} 秒`" :value="item" />
            </el-select>
          </label>
          <label v-if="mediaType === 'video' && currentModel?.audio !== undefined" class="field">
            <span>生成音频</span>
            <el-switch v-model="generateAudio" :disabled="generating || currentModel?.audio !== 'optional'" aria-label="生成音频" />
          </label>
        </div>
        <p v-if="modelsError" class="formMessage" role="alert">{{ modelsError }} <el-button text @click="loadModels">重试</el-button></p>
        <p v-else-if="!modelsLoading && !providers.length" class="formMessage">还没有可用的{{ mediaLabel }}模型。<el-button text @click="emit('openSettings')">去设置里添加</el-button></p>
        <p v-if="formError" class="formMessage" role="alert">{{ formError }}</p>
        <el-button v-if="generating" class="submitButton" nativeType="button" @click="cancel">停止生成</el-button>
        <el-button v-else class="submitButton" type="primary" nativeType="submit">生成</el-button>
      </form>
      <section class="stage" :aria-busy="generating" aria-label="生成结果">
        <div v-if="generating" class="stageState" role="status">
          <icon-loader-2 class="isLoading" :size="28" aria-hidden="true" />
          <span>正在生成…</span>
        </div>
        <template v-else-if="result && (result.mediaType ?? 'image') === mediaType">
          <template v-if="result.mediaType === 'video'">
            <video class="stageVideo" :src="assetUrl(result.images[0]?.path || '')" :aria-label="result.prompt" controls preload="metadata" />
            <el-button text @click="openDetail(result)">查看生成设置</el-button>
          </template>
          <button v-else type="button" class="stageImage" aria-label="查看生成结果" @click="openDetail(result)">
            <img :src="assetUrl(result.images[0]?.path || '')" :alt="result.prompt" width="720" height="720" fetchpriority="high" />
          </button>
          <div v-if="result.mediaType !== 'video' && result.images.length > 1" class="stageThumbs">
            <button v-for="(image, index) in result.images" :key="image.path" type="button" :aria-label="`查看第 ${index + 1} 张`" @click="openDetail(result)">
              <img :src="assetUrl(image.path)" alt="" width="64" height="64" />
            </button>
          </div>
        </template>
        <div v-else class="stageState">生成的{{ mediaLabel }}会显示在这里</div>
      </section>
    </div>
    <section class="history" aria-labelledby="onlineHistoryTitle">
      <div class="historyHeader">
        <h2 id="onlineHistoryTitle">归档</h2>
        <div class="historyTools">
          <template v-if="managing">
            <span class="selectedCount">已选 {{ selectedIds.length }} 条</span>
            <el-button text :disabled="!filteredHistory.length" @click="toggleSelectAll">{{ allSelected ? "取消全选" : "全选" }}</el-button>
            <el-button text type="danger" :disabled="!selectedIds.length || deletingSelected" @click="removeSelected">删除所选</el-button>
            <el-button text @click="exitManage">完成</el-button>
          </template>
          <template v-else>
            <el-button text :disabled="!filteredHistory.length" @click="managing = true">管理</el-button>
            <el-button text :disabled="historyLoading" @click="loadHistory">刷新</el-button>
          </template>
        </div>
      </div>
      <p v-if="historyError" class="formMessage" role="alert">{{ historyError }} <el-button text @click="loadHistory">重试</el-button></p>
      <p v-else-if="historyLoading && !filteredHistory.length" class="formMessage" role="status">正在加载历史…</p>
      <p v-else-if="!filteredHistory.length" class="formMessage">还没有生成记录。填写提示词后点生成。</p>
      <div v-else class="historyGrid">
        <div v-for="item in visibleHistory" :key="item.id" class="historyCard" :class="{ managing, selected: selectedIds.includes(item.id) }">
          <div class="historyPreview" role="button" tabindex="0" :aria-label="managing ? `选择：${item.prompt}` : `查看：${item.prompt}`" :aria-pressed="managing ? selectedIds.includes(item.id) : undefined" @click="openHistory(item)" @keydown.enter.self="openHistory(item)" @keydown.space.self.prevent="openHistory(item)">
            <img v-if="item.mediaType !== 'video'" :src="assetUrl(item.images[0]?.path || '')" :alt="item.prompt" width="160" height="160" loading="lazy" />
            <span v-else class="videoArchive" @click.stop>
              <video :src="assetUrl(item.images[0]?.path || '')" :aria-label="item.prompt" :controls="!managing" preload="metadata" @click="managing && openHistory(item)" @keydown.stop />
              <el-button v-if="!managing" text @click="openDetail(item)">查看详情</el-button>
            </span>
            <span v-if="managing" class="selectedMark" aria-hidden="true">{{ selectedIds.includes(item.id) ? "✓" : "" }}</span>
            <span v-if="item.images.length > 1" class="countBadge">×{{ item.images.length }}</span>
            <span class="historyPrompt">{{ readablePrompt(item) }}</span>
          </div>
          <button v-if="!managing" class="historyDelete" type="button" aria-label="删除这条记录" @click="removeRecord(item)">
            <icon-trash :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
      <el-button v-if="visibleHistory.length < filteredHistory.length" class="loadMore" text @click="historyVisible += pageSize">加载更多</el-button>
    </section>
    <el-dialog v-model="detailVisible" class="onlineImageDetail" title="生成结果" width="min(760px, 92vw)" appendToBody alignCenter>
      <template v-if="detail">
        <div class="detailImages">
          <template v-if="detail.mediaType === 'video'">
            <video v-for="image in detail.images" :key="image.path" :src="assetUrl(image.path)" :aria-label="detail.prompt" controls preload="metadata" />
          </template>
          <template v-else>
            <el-image v-for="image in detail.images" :key="image.path" :src="assetUrl(image.path)" :previewSrcList="detail.images.map(item => assetUrl(item.path))" fit="contain" />
          </template>
        </div>
        <p class="detailPrompt">{{ readablePrompt(detail) }}</p>
        <p class="detailMeta"><span translate="no">{{ detail.providerLabel }}</span> · <span translate="no">{{ detail.modelLabel }}</span><template v-if="detail.size || detail.resolution"> · <span translate="no">{{ detail.resolution || detail.size }}</span></template><template v-if="detail.duration"> · {{ detail.duration }} 秒</template><template v-if="detail.mediaType === 'video' && detail.generateAudio !== undefined"> · {{ detail.generateAudio ? '有音频' : '无音频' }}</template><template v-if="detail.ratio"> · <span translate="no">{{ detail.ratio }}</span></template></p>
        <div class="detailActions">
          <el-button @click="applyRecord(detail)">使用此设置</el-button>
          <el-button @click="downloadImage(detail.images[0]?.path || '')">下载</el-button>
          <el-button type="danger" plain @click="removeRecord(detail)">删除</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onUnmounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type MentionInstance } from "element-plus";
import { IconLoader2, IconPlus, IconTrash, IconX } from "@tabler/icons-vue";

type MediaType = "image" | "video";
type MediaModel = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
  type: string;
  imageReferences?: number;
  imageSizes?: string[];
  imageRatios?: string[];
  videoRatios?: string[];
  durationResolutionMap?: { duration: number[]; resolution: string[] }[];
  defaultDuration?: number;
  defaultResolution?: string;
  audio?: boolean | "optional";
  mode?: (string | string[])[];
};
type ImageFile = { path: string; mimeType: string };
type OnlineRecord = {
  id: string;
  createdAt: number;
  prompt: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  mediaType?: MediaType;
  size?: string;
  resolution?: string;
  duration?: number;
  generateAudio?: boolean;
  other?: Record<string, unknown>;
  ratio?: string;
  images: ImageFile[];
  references: ImageFile[];
  audios?: ImageFile[];
  videoUrls?: string[];
  referenceOrder?: { type: "image" | "video" | "audio"; index: number }[];
};
type ReferenceSlot = { preview: string; path?: string; mimeType?: string; uploading: boolean };
type ApiResponse<T> = { code: number; data: T; message?: string };

const props = defineProps<{ active: boolean }>();
const emit = defineEmits<{ openSettings: [] }>();
const audioSlots = ref<ReferenceSlot[]>([]);
const audioInput = ref<HTMLInputElement>();
const videoUrls = ref<string[]>([]);
const videoInput = ref<HTMLInputElement>();
const videoUploading = ref(false);
let videoUploadController: AbortController | undefined;
let uploadAsSource = false;
const videoOperation = ref("generate");
const sourceVideoUrl = ref("");
const extensionDuration = ref(-1);
const counts = [1, 2, 3, 4];
const pageSize = 24;
const extensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff",
};
const prompt = ref("");
const promptInput = ref<MentionInstance>();
const formError = ref("");
const formErrorKind = ref<"prompt" | "upload" | "model" | "generate" | "">("");
const models = ref<MediaModel[]>([]);
const modelsLoading = ref(false);
const modelsError = ref("");
const providerId = ref("");
const modelId = ref("");
const mediaType = ref<MediaType>("image");
const mediaLabel = computed(() => mediaType.value === "video" ? "视频" : "图片");
const size = ref("");
const resolution = ref("");
const duration = ref<number>();
const generateAudio = ref(false);
const other = ref<Record<string, unknown>>({});
const selectedResolution = computed({
  get: () => mediaType.value === "video" ? resolution.value : size.value,
  set: value => { if (mediaType.value === "video") resolution.value = value; else size.value = value; },
});
const ratio = ref("");
const count = ref(1);
const slots = ref<(ReferenceSlot | null)[]>([null, null, null]);
const dragIndex = ref(-1);
const fileInput = ref<HTMLInputElement>();
const pickIndex = ref(0);
const generating = ref(false);
const result = ref<OnlineRecord>();
const history = ref<OnlineRecord[]>([]);
const historyLoading = ref(false);
const historyError = ref("");
const historyVisible = ref(pageSize);
const managing = ref(false);
const selectedIds = ref<string[]>([]);
const deletingSelected = ref(false);
const detail = ref<OnlineRecord>();
const detailVisible = computed({
  get: () => !!detail.value,
  set: visible => { if (!visible) detail.value = undefined; },
});
let generationController: AbortController | undefined;
let inputDirectoryReady = false;
let historyVersion = 0;
let disposed = false;

const typeModels = computed(() => models.value.filter(model => model.type === mediaType.value && model.providerId === "developCc"));
const providers = computed(() => {
  const groups = new Map<string, { providerId: string; providerLabel: string }>();
  for (const model of typeModels.value) if (!groups.has(model.providerId)) groups.set(model.providerId, { providerId: model.providerId, providerLabel: model.providerLabel });
  return [...groups.values()];
});
const providerModels = computed(() => typeModels.value.filter(model => model.providerId === providerId.value));
const currentModel = computed(() => providerModels.value.find(model => model.modelId === modelId.value));
const sizeOptions = computed(() => {
  const sizes = currentModel.value?.imageSizes?.length ? currentModel.value.imageSizes : ["2K"];
  return [...sizes].sort((left, right) => (Number.parseFloat(left) || Infinity) - (Number.parseFloat(right) || Infinity));
});
const durationOptions = computed(() => [...new Set(currentModel.value?.durationResolutionMap?.flatMap(item => item.duration) ?? [])].sort((left, right) => left - right));
const resolutionOptions = computed(() => [...new Set(currentModel.value?.durationResolutionMap?.filter(item => duration.value !== undefined && item.duration.includes(duration.value)).flatMap(item => item.resolution) ?? [])]);
const ratioOptions = computed(() => mediaType.value === "video" ? currentModel.value?.videoRatios ?? [] : currentModel.value?.imageRatios?.length ? currentModel.value.imageRatios : ["1:1"]);
const supportsEditing = computed(() => mediaType.value === "video" && currentModel.value?.modelId === "seedance-2.5");
const modifyingVideo = computed(() => supportsEditing.value && videoOperation.value !== "generate");
const referenceLimits = computed(() => {
  const limits = { image: mediaType.value === "image" ? currentModel.value?.imageReferences ?? 0 : 0, video: 0, audio: 0 };
  if (mediaType.value === "video") for (const mode of currentModel.value?.mode ?? []) {
    if (!Array.isArray(mode)) continue;
    for (const item of mode) {
      const match = /^(image|video|audio)Reference:(\d+)$/.exec(item);
      if (match) limits[match[1] as keyof typeof limits] = Number(match[2]);
    }
  }
  return limits;
});
const imageSlots = computed(() => slots.value.filter((slot): slot is ReferenceSlot => !!slot));
const referenceLabels = computed(() => Array.from({ length: Math.min(referenceLimits.value.image, Math.max(3, slots.value.length + (slots.value.every(Boolean) ? 1 : 0))) }, (_, index) => `图片${index + 1}`));
const referencesAllowed = computed(() => referenceLimits.value.image > 0);
const mentionOptions = computed(() => [
  ...slots.value.flatMap((slot, index) => slot?.path ? [{ value: `图片${index + 1}` }] : []),
  ...(mediaType.value === "video" ? [
    ...(!modifyingVideo.value ? videoUrls.value.flatMap((url, index) => url.trim() ? [{ value: `视频${index + 1}` }] : []) : []),
    ...audioSlots.value.flatMap((slot, index) => slot.path ? [{ value: `音频${index + 1}` }] : []),
  ] : []),
]);
const uploading = computed(() => slots.value.some(slot => slot?.uploading) || audioSlots.value.some(slot => slot.uploading));
const filteredHistory = computed(() => history.value.filter(item => (item.mediaType ?? "image") === mediaType.value));
const visibleHistory = computed(() => filteredHistory.value.slice(0, historyVisible.value));
const allSelected = computed(() => filteredHistory.value.length > 0 && filteredHistory.value.every(item => selectedIds.value.includes(item.id)));

watch(currentModel, () => { other.value = {}; syncSize(); }, { flush: "sync" });
watch(duration, syncSize, { flush: "sync" });
watch(mediaType, () => {
  exitManage();
  historyVisible.value = pageSize;
  formError.value = "";
  formErrorKind.value = "";
  if (!providers.value.some(item => item.providerId === providerId.value)) providerId.value = providers.value[0]?.providerId ?? "";
  selectProvider();
}, { flush: "sync" });
watch(prompt, () => {
  if (formErrorKind.value === "model") return;
  formErrorKind.value = "";
  formError.value = "";
});
watch(() => props.active, active => {
  if (!active) return;
  void loadModels();
  if (!generating.value) void loadHistory();
}, { immediate: true });
onUnmounted(() => {
  disposed = true;
  generationController?.abort();
  videoUploadController?.abort();
  slots.value.forEach(clearPreview);
  audioSlots.value.forEach(clearPreview);
});

function assetUrl(path: string) {
  return `/api/assets/read?path=${encodeURIComponent(path)}`;
}

function requestError(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ message?: string }>(error)) return error.response?.data?.message || fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

function syncSize() {
  if (mediaType.value === "video") {
    const model = currentModel.value;
    if (!durationOptions.value.includes(duration.value!)) duration.value = durationOptions.value.includes(model?.defaultDuration!) ? model?.defaultDuration : durationOptions.value[0];
    if (!resolutionOptions.value.includes(resolution.value)) resolution.value = resolutionOptions.value.includes(model?.defaultResolution ?? "") ? model!.defaultResolution! : resolutionOptions.value[0] ?? "";
    if (model?.audio !== "optional") generateAudio.value = model?.audio === true;
  } else if (!sizeOptions.value.includes(size.value)) size.value = sizeOptions.value[0] ?? "";
  if (!ratioOptions.value.includes(ratio.value)) ratio.value = ratioOptions.value.includes("1:1") ? "1:1" : ratioOptions.value.includes("16:9") ? "16:9" : ratioOptions.value[0] ?? "";
}

function selectProvider() {
  if (!providerModels.value.some(model => model.modelId === modelId.value)) modelId.value = providerModels.value[0]?.modelId ?? "";
  syncSize();
}

async function loadModels() {
  modelsLoading.value = true;
  modelsError.value = "";
  try {
    const { data } = await axios.get<ApiResponse<MediaModel[]>>("/api/ai/media/models");
    if (disposed) return;
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "读取媒体模型失败");
    models.value = data.data.filter(model => model.type === "image" || model.type === "video");
    if (generating.value) return;
    if (!providers.value.some(item => item.providerId === providerId.value)) providerId.value = providers.value[0]?.providerId ?? "";
    selectProvider();
  } catch (error) {
    if (!disposed) modelsError.value = requestError(error, "读取媒体模型失败");
  } finally {
    modelsLoading.value = false;
  }
}

async function loadHistory() {
  const version = ++historyVersion;
  historyLoading.value = true;
  historyError.value = "";
  try {
    const { data } = await axios.get<ApiResponse<OnlineRecord[]>>("/api/onlineImage/history");
    if (disposed || version !== historyVersion) return;
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "读取历史失败");
    history.value = data.data;
    selectedIds.value = selectedIds.value.filter(id => filteredHistory.value.some(item => item.id === id));
    if (!filteredHistory.value.length) exitManage();
  } catch (error) {
    if (!disposed && version === historyVersion) historyError.value = requestError(error, "读取历史失败");
  } finally {
    if (version === historyVersion) historyLoading.value = false;
  }
}

function clearPreview(slot: ReferenceSlot | null) {
  if (slot?.preview.startsWith("blob:")) URL.revokeObjectURL(slot.preview);
}

function clearReference(index: number) {
  clearPreview(slots.value[index] ?? null);
  slots.value[index] = null;
}

function pickReference(index: number) {
  if (generating.value || !referencesAllowed.value) return;
  pickIndex.value = index;
  fileInput.value?.click();
}

function selectReference(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void putFile(file, pickIndex.value);
}

function dragOver(index: number, event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files") || generating.value || !referencesAllowed.value) return;
  event.preventDefault();
  dragIndex.value = index;
}

function dragLeave(index: number, event: DragEvent) {
  const current = event.currentTarget;
  if (current instanceof Node && event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) return;
  if (dragIndex.value === index) dragIndex.value = -1;
}

function dropReference(index: number, event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dragIndex.value = -1;
  if (generating.value || !referencesAllowed.value) return;
  const file = [...event.dataTransfer.files].find(item => item.type.startsWith("image/"));
  if (!file) return void ElMessage.warning("请拖入图片文件");
  void putFile(file, index);
}

function onPaste(event: ClipboardEvent) {
  if (!props.active || generating.value || !referencesAllowed.value) return;
  const target = event.target;
  if (target instanceof Element && (target.closest(".el-overlay") || target.closest("input, textarea, [contenteditable='true']"))) return;
  const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith("image/"));
  if (!file) return;
  const index = slots.value.findIndex(slot => !slot);
  void putFile(file, index < 0 ? slots.value.length : index);
}

async function ensureInputDirectory() {
  if (inputDirectoryReady) return;
  for (const path of ["在线生图", "在线生图/input"]) {
    try { await axios.post("/api/assets/mkdir", { path }); }
    catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error;
    }
  }
  inputDirectoryReady = true;
}

async function putFile(file: File, index: number) {
  if (generating.value || !referencesAllowed.value) return;
  if (index >= referenceLimits.value.image) return void ElMessage.warning(`当前模型最多支持 ${referenceLimits.value.image} 张参考图片`);
  const rawType = file.type.split(";")[0]!.trim().toLowerCase();
  const mimeType = rawType === "image/jpg" ? "image/jpeg" : rawType;
  const extension = extensions[mimeType];
  if (!extension) return void ElMessage.warning("只支持 PNG、JPEG、WebP、GIF、AVIF、BMP、TIFF");
  if (!file.size || file.size > 50 * 1024 * 1024) return void ElMessage.warning("参考图不能为空，且不能超过 50 MB");
  const preview = URL.createObjectURL(file);
  clearPreview(slots.value[index] ?? null);
  slots.value[index] = { preview, uploading: true };
  try {
    await ensureInputDirectory();
    const path = `在线生图/input/ref${crypto.randomUUID()}.${extension}`;
    await axios.put("/api/assets/save", file, { params: { path }, headers: { "Content-Type": "application/octet-stream" } });
    if (disposed || slots.value[index]?.preview !== preview) return void URL.revokeObjectURL(preview);
    slots.value[index] = { preview, path, mimeType, uploading: false };
  } catch (error) {
    if (slots.value[index]?.preview === preview) slots.value[index] = null;
    URL.revokeObjectURL(preview);
    if (!disposed) ElMessage.error(requestError(error, "参考图上传失败"));
  }
}

function removeAudio(index: number) {
  clearPreview(audioSlots.value[index] ?? null);
  audioSlots.value.splice(index, 1);
}

async function selectAudio(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || audioSlots.value.length >= referenceLimits.value.audio) return;
  const audioExtensions: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "audio/flac": "flac", "audio/aac": "aac", "audio/mp4": "m4a" };
  const extension = audioExtensions[file.type];
  if (!extension || !file.size || file.size > 50 * 1024 * 1024) return void ElMessage.warning("请上传不超过 50 MB 的 MP3、WAV、OGG、WebM、FLAC、AAC 或 M4A 音频");
  const preview = URL.createObjectURL(file);
  audioSlots.value.push({ preview, uploading: true });
  try {
    await ensureInputDirectory();
    const path = `在线生图/input/ref${crypto.randomUUID()}.${extension}`;
    await axios.put("/api/assets/save", file, { params: { path }, headers: { "Content-Type": "application/octet-stream" } });
    const slot = audioSlots.value.find(item => item.preview === preview);
    if (disposed || !slot) return void URL.revokeObjectURL(preview);
    Object.assign(slot, { path, mimeType: file.type === "audio/x-wav" ? "audio/wav" : file.type, uploading: false });
  } catch (error) {
    const index = audioSlots.value.findIndex(item => item.preview === preview);
    if (index >= 0) removeAudio(index);
    if (!disposed) ElMessage.error(requestError(error, "参考音频上传失败"));
  }
}

function pickVideo(asSource: boolean) {
  if (generating.value || videoUploading.value) return;
  uploadAsSource = asSource;
  videoInput.value?.click();
}

async function selectVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || generating.value || videoUploading.value) return;
  if (!/\.(mp4|mov|webm)$/i.test(file.name) || !file.size || file.size > 100 * 1024 * 1024) {
    return void ElMessage.warning("请上传不超过 100 MB 的 MP4、MOV 或 WebM 视频");
  }
  const asSource = uploadAsSource;
  const selectedModel = modelId.value;
  const selectedOperation = videoOperation.value;
  const selectedType = mediaType.value;
  if (!asSource && videoUrls.value.length >= referenceLimits.value.video) return;
  const controller = new AbortController();
  videoUploadController = controller;
  videoUploading.value = true;
  try {
    const { data } = await axios.post<ApiResponse<{ url: string; expiresAt: number }>>("/api/onlineImage/uploadVideo", file, {
      headers: { "Content-Type": "application/octet-stream" }, signal: controller.signal,
    });
    if (disposed || controller.signal.aborted) return;
    if (data.code !== 200 || !data.data?.url) throw new Error(data.message || "视频上传失败");
    if (selectedModel !== modelId.value || selectedOperation !== videoOperation.value || selectedType !== mediaType.value) {
      ElMessage.warning("视频已上传，但生成设置已切换，请在当前设置下重新选择视频");
      return;
    }
    if (asSource) sourceVideoUrl.value = data.data.url;
    else if (videoUrls.value.length < referenceLimits.value.video) videoUrls.value.push(data.data.url);
  } catch (error) {
    if (!disposed && !controller.signal.aborted) ElMessage.error(requestError(error, "Litterbox 视频上传失败，请稍后重试"));
  } finally {
    if (videoUploadController === controller) {
      videoUploadController = undefined;
      videoUploading.value = false;
    }
  }
}

function cancel() {
  generationController?.abort();
}

async function submit() {
  if (generating.value) return;
  const trimmed = prompt.value.trim();
  if (!trimmed) {
    formErrorKind.value = "prompt";
    formError.value = "请输入提示词";
    promptInput.value?.input?.focus();
    return;
  }
  if (uploading.value || videoUploading.value) {
    formErrorKind.value = "upload";
    formError.value = "参考素材还在上传，请稍候再点生成。";
    return;
  }
  const model = currentModel.value;
  if (!model) {
    formErrorKind.value = "model";
    formError.value = "请先选择模型";
    return;
  }
  formErrorKind.value = "";
  formError.value = "";
  const images = slots.value.flatMap(slot => slot?.path && slot.mimeType ? [{ path: slot.path, mimeType: slot.mimeType }] : []);
  const type = mediaType.value;
  const audios = type === "video" ? audioSlots.value.flatMap(slot => slot.path && slot.mimeType ? [{ path: slot.path, mimeType: slot.mimeType }] : []) : [];
  const videos = type === "video" && !modifyingVideo.value ? videoUrls.value.map(url => url.trim()) : [];
  if (images.length > referenceLimits.value.image || audios.length > referenceLimits.value.audio || videos.length > referenceLimits.value.video) {
    formError.value = "参考素材数量超过当前模型上限，请移除多余素材。";
    return;
  }
  if (videos.some(url => !/^https?:\/\//i.test(url)) || (modifyingVideo.value && !/^https?:\/\//i.test(sourceVideoUrl.value.trim()))) {
    formError.value = "请填写可公开下载的视频 HTTP(S) 直链。";
    return;
  }
  const referenceOrder: { type: "image" | "video" | "audio"; index: number }[] = [];
  let invalidMention = false;
  const submittedPrompt = trimmed.replace(/@(图片|视频|音频)(\d+)/g, (marker, kind: string, number: string) => {
    const index = Number(number) - 1;
    const referenceType = kind === "图片" ? "image" : kind === "视频" ? "video" : "audio";
    const itemIndex = referenceType === "image" ? slots.value.slice(0, index).filter(slot => slot?.path).length : index;
    const available = referenceType === "image" ? !!slots.value[index]?.path : referenceType === "video" ? !!videos[index] : !!audios[index];
    if (!available) { invalidMention = true; return marker; }
    if (type === "image") return `@图片${itemIndex + 1}`;
    referenceOrder.push({ type: referenceType, index: itemIndex });
    return `{{ref ${referenceOrder.length}}}`;
  });
  if (invalidMention) { formError.value = "提示词引用的素材不存在，请重新输入 @ 选择。"; return; }
  const videoMode = type === "video" ? model.mode?.find(mode => {
    if (Array.isArray(mode)) return (images.length + videos.length + audios.length > 0 || modifyingVideo.value) && [
      ["image", images.length], ["video", videos.length], ["audio", audios.length],
    ].every(([kind, total]) => Number(total) <= Number(mode.find(item => item.startsWith(`${kind}Reference:`))?.split(":")[1] ?? 0));
    if (mode === "text") return images.length + videos.length + audios.length === 0 && !modifyingVideo.value;
    if (mode === "singleImage") return images.length === 1;
    if (mode === "startEndRequired") return images.length === 2;
    return ["endFrameOptional", "startFrameOptional"].includes(mode) && images.length >= 1 && images.length <= 2;
  }) : undefined;
  if (type === "video" && videoMode === undefined) {
    formErrorKind.value = "model";
    formError.value = "参考素材不符合当前视频模型的模式，请调整素材或更换模型。";
    return;
  }
  if (type === "video" && ((durationOptions.value.length > 0 && !durationOptions.value.includes(duration.value!))
    || (resolutionOptions.value.length > 0 && !resolutionOptions.value.includes(resolution.value))
    || (ratioOptions.value.length > 0 && !ratioOptions.value.includes(ratio.value)))) {
    formErrorKind.value = "model";
    formError.value = "请按当前模型能力选择时长、分辨率和比例。";
    return;
  }
  const controller = new AbortController();
  generationController = controller;
  generating.value = true;
  try {
    const { data } = await axios.post<ApiResponse<OnlineRecord>>("/api/onlineImage/generate", {
      prompt: submittedPrompt, providerId: model.providerId, modelId: model.modelId, mediaType: type,
      ...(ratio.value ? { ratio: ratio.value } : {}),
      ...(type === "video" ? {
        ...(resolution.value ? { resolution: resolution.value } : {}),
        ...(duration.value !== undefined ? { duration: duration.value } : {}),
        ...(model.audio !== undefined ? { generateAudio: generateAudio.value } : {}),
        n: 1, mode: videoMode, audios, videoUrls: videos, referenceOrder,
        other: { ...other.value, ...(supportsEditing.value ? { videoOperation: videoOperation.value, ...(modifyingVideo.value ? { sourceVideoUrl: sourceVideoUrl.value.trim() } : {}), extensionDuration: extensionDuration.value } : {}) },
      } : { size: size.value, n: count.value }),
      ...(images.length ? { images } : {}),
    }, { signal: controller.signal });
    if (controller.signal.aborted || disposed) return;
    if (data.code !== 200 || !data.data?.images?.length) throw new Error(data.message || "生成失败");
    result.value = data.data;
    historyVersion += 1;
    history.value = [data.data, ...history.value.filter(item => item.id !== data.data.id)];
  } catch (error) {
    if (controller.signal.aborted || axios.isCancel(error)) return;
    if (!disposed) {
      formErrorKind.value = "generate";
      formError.value = `${requestError(error, "生成失败")}，请调整提示词或模型后再试。`;
    }
  } finally {
    if (generationController === controller) generationController = undefined;
    generating.value = false;
  }
}

function exitManage() {
  managing.value = false;
  selectedIds.value = [];
}

function openHistory(record: OnlineRecord) {
  if (!managing.value) {
    detail.value = record;
    return;
  }
  selectedIds.value = selectedIds.value.includes(record.id)
    ? selectedIds.value.filter(id => id !== record.id)
    : [...selectedIds.value, record.id];
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : filteredHistory.value.map(item => item.id);
}

function readablePrompt(record: OnlineRecord) {
  return record.prompt.replace(/\{\{ref (\d+)\}\}/g, (marker, number: string) => {
    const reference = record.referenceOrder?.[Number(number) - 1];
    return reference ? `@${{ image: "图片", video: "视频", audio: "音频" }[reference.type]}${reference.index + 1}` : marker;
  });
}

function openDetail(record: OnlineRecord) {
  detail.value = record;
}

function applyRecord(record: OnlineRecord) {
  if (generating.value) return void ElMessage.warning("请先停止当前生成，再使用归档设置");
  mediaType.value = record.mediaType ?? "image";
  prompt.value = readablePrompt(record);
  const model = typeModels.value.find(item => item.providerId === record.providerId && item.modelId === record.modelId);
  if (model) {
    providerId.value = model.providerId;
    modelId.value = model.modelId;
    syncSize();
    if (record.size && sizeOptions.value.includes(record.size)) size.value = record.size;
    if (record.duration !== undefined && durationOptions.value.includes(record.duration)) duration.value = record.duration;
    if (record.resolution && resolutionOptions.value.includes(record.resolution)) resolution.value = record.resolution;
    if (record.ratio && ratioOptions.value.includes(record.ratio)) ratio.value = record.ratio;
    if (model.audio === "optional") generateAudio.value = record.generateAudio ?? false;
    other.value = { ...record.other };
  } else ElMessage.warning("原来的模型已不可用，请重新选择");
  slots.value.forEach(clearPreview);
  slots.value = (record.references ?? []).map(file => ({ preview: assetUrl(file.path), path: file.path, mimeType: file.mimeType, uploading: false }));
  while (slots.value.length < Math.min(3, referenceLimits.value.image)) slots.value.push(null);
  audioSlots.value.forEach(clearPreview);
  audioSlots.value = (record.audios ?? []).map(file => ({ preview: assetUrl(file.path), path: file.path, mimeType: file.mimeType, uploading: false }));
  videoUrls.value = [...record.videoUrls ?? []];
  videoOperation.value = supportsEditing.value && ["edit", "extend"].includes(String(record.other?.videoOperation)) ? String(record.other?.videoOperation) : "generate";
  sourceVideoUrl.value = typeof record.other?.sourceVideoUrl === "string" ? record.other.sourceVideoUrl : "";
  extensionDuration.value = typeof record.other?.extensionDuration === "number" ? record.other.extensionDuration : -1;
  detail.value = undefined;
}

async function downloadImage(path: string) {
  try {
    const { data } = await axios.get<Blob>("/api/assets/read", { params: { path, download: true }, responseType: "blob" });
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = path.split("/").pop() || "image.png";
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    ElMessage.error(requestError(error, "下载失败"));
  }
}

async function requestDelete(id: string) {
  const { data } = await axios.delete<ApiResponse<null>>("/api/onlineImage/delete", { data: { id } });
  if (data.code !== 200) throw new Error(data.message || "删除失败");
}

function dropRecords(ids: string[]) {
  const removed = new Set(ids);
  history.value = history.value.filter(item => !removed.has(item.id));
  selectedIds.value = selectedIds.value.filter(id => !removed.has(id));
  if (result.value && removed.has(result.value.id)) result.value = undefined;
  if (detail.value && removed.has(detail.value.id)) detail.value = undefined;
  if (!filteredHistory.value.length) exitManage();
}

async function removeSelected() {
  const ids = selectedIds.value.filter(id => filteredHistory.value.some(item => item.id === id));
  if (!ids.length || deletingSelected.value) return;
  const confirmed = await ElMessageBox.confirm(`删除选中的 ${ids.length} 条生成记录？此操作不可恢复。`, "删除归档", {
    confirmButtonText: "删除", cancelButtonText: "取消", type: "warning",
  }).then(() => true, () => false);
  if (!confirmed || disposed) return;
  deletingSelected.value = true;
  const results = await Promise.allSettled(ids.map(async id => {
    await requestDelete(id);
    return id;
  }));
  deletingSelected.value = false;
  if (disposed) return;
  dropRecords(results.flatMap(item => item.status === "fulfilled" ? [item.value] : []));
  const failed = results.filter(item => item.status === "rejected").length;
  if (failed) ElMessage.error(`${failed} 条删除失败，其余已删除`);
}

async function removeRecord(record: OnlineRecord) {
  const confirmed = await ElMessageBox.confirm("删除这条记录，并删除对应的本地媒体文件。", "删除生成记录", {
    confirmButtonText: "删除", cancelButtonText: "取消", type: "warning",
  }).then(() => true, () => false);
  if (!confirmed || disposed) return;
  try {
    await requestDelete(record.id);
    dropRecords([record.id]);
  } catch (error) {
    if (!disposed) ElMessage.error(requestError(error, "删除失败"));
  }
}

window.addEventListener("toonflow:provider-config-changed", loadModels);
window.addEventListener("paste", onPaste);
onUnmounted(() => {
  window.removeEventListener("toonflow:provider-config-changed", loadModels);
  window.removeEventListener("paste", onPaste);
});
</script>

<style scoped lang="scss">
.onlineImage {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  container-type: inline-size;
  padding: 28px max(clamp(20px, 4vw, 56px), env(safe-area-inset-right)) calc(48px + env(safe-area-inset-bottom)) max(clamp(20px, 4vw, 56px), env(safe-area-inset-left));
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  button:focus-visible:not(.el-button), .historyPreview:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: 2px;
  }

  .pageHeader {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;

    h1 { margin: 0 0 6px; font-size: 28px; font-weight: 650; letter-spacing: -0.4px; text-wrap: balance; }
    p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; text-wrap: pretty; }
  }

  .mediaTabs { margin-bottom: 20px; }

  .studio {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(320px, 460px) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }

  .controls, .stage, .historyCard, .referenceSlot {
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 18px;
    background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    font-weight: 600;

    .el-select { width: 100%; }

    :deep(.el-textarea__inner) {
      padding: 14px 16px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 400;
      line-height: 1.8;
    }
  }

  .references {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .referenceSlot {
    position: relative;
    aspect-ratio: 1;
    user-select: none;

    > button:first-child {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      padding: 0;
      overflow: hidden;
      border: 0;
      border-radius: inherit;
      background: transparent;
      color: var(--el-text-color-secondary);
      cursor: pointer;

      img { width: 100%; height: 100%; object-fit: cover; }
      &:hover:not(:disabled) { background: var(--el-fill-color-light); }
      &:disabled { cursor: wait; }
    }

    &.filled > button:first-child:hover:not(:disabled) { background: transparent; }

    &.dragOver { border-color: var(--el-color-primary); }

    .slotState {
      position: absolute;
      inset: auto 8px 8px;
      padding: 2px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--el-bg-color) 86%, transparent);
      font-size: 11px;
    }

    .clearReference {
      position: absolute;
      top: 6px;
      inset-inline-end: 6px;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: color-mix(in srgb, var(--el-bg-color) 90%, transparent);
      color: var(--el-text-color-primary);
      cursor: pointer;

      &:hover { background: var(--el-fill-color); }
    }
  }

  .referenceRow {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;

    .el-input { flex: 1; min-width: 0; }
    audio { flex: 1; width: 0; min-width: 0; height: 32px; }
    .el-button { margin: 0; }
  }

  .options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .formMessage {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;

    &[role="alert"] { color: var(--el-color-danger); }
  }

  .submitButton { width: 100%; height: 42px; }

  .stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 460px;
    padding: 16px;
    overflow: hidden;
  }

  .stageState {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--el-text-color-secondary);
    font-size: 13px;

    .isLoading { animation: onlineSpin 1s linear infinite; }
  }

  @media (prefers-reduced-motion: reduce) {
    .stageState .isLoading { animation: none; }
  }

  .stageImage {
    width: min(100%, 720px);
    padding: 0;
    border: 0;
    border-radius: 14px;
    background: transparent;
    cursor: zoom-in;

    img { display: block; width: 100%; max-height: 640px; object-fit: contain; border-radius: inherit; }
    &:hover { opacity: 0.92; }
  }

  .stageVideo { display: block; width: 100%; max-height: 640px; border-radius: 14px; }

  .stageThumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;

    button {
      width: 64px;
      height: 64px;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: 10px;
      background: transparent;
      cursor: pointer;

      &:hover { border-color: var(--el-color-primary); }
      img { width: 100%; height: 100%; object-fit: cover; }
    }
  }

  .history { margin-top: 36px; }

  .historyHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;

    h2 { margin: 0; font-size: 18px; text-wrap: balance; scroll-margin-top: 16px; }

    .historyTools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
    }

    .selectedCount {
      margin-inline-end: 4px;
      color: var(--el-text-color-secondary);
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
  }

  .historyGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }

  .historyCard {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    content-visibility: auto;
    contain-intrinsic-size: 160px 160px;

    .historyPreview {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: zoom-in;

      img { width: 100%; height: 100%; object-fit: cover; }
    }

    .videoArchive {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--el-fill-color-light);

      video { width: 100%; min-height: 0; flex: 1; object-fit: contain; }
      .el-button { margin: 0; }
    }

    &.managing .historyPreview { cursor: pointer; }
    &:has(.videoArchive) { aspect-ratio: 4 / 3; }
    &:has(.videoArchive) .historyPrompt { display: none; }

    &.selected { box-shadow: inset 0 0 0 2px var(--el-text-color-primary); }

    .selectedMark {
      position: absolute;
      top: 8px;
      inset-inline-start: 8px;
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border: 2px solid white;
      border-radius: 50%;
      background: rgb(0 0 0 / 35%);
      color: white;
      font-size: 13px;
      font-weight: 700;
    }

    &.selected .selectedMark { background: var(--el-text-color-primary); border-color: var(--el-text-color-primary); }

    &.managing .countBadge { inset-inline-start: 38px; }

    .countBadge, .historyPrompt {
      position: absolute;
      color: white;
      pointer-events: none;
    }

    .countBadge {
      top: 8px;
      inset-inline-start: 8px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgb(0 0 0 / 55%);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    .historyPrompt {
      inset: auto 0 0;
      padding: 28px 10px 10px;
      background: linear-gradient(transparent, rgb(0 0 0 / 72%));
      font-size: 12px;
      line-height: 1.4;
      text-align: start;
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    &:focus-within .historyPrompt { opacity: 1; }

    .historyDelete {
      position: absolute;
      top: 6px;
      inset-inline-end: 6px;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: color-mix(in srgb, var(--el-bg-color) 90%, transparent);
      color: var(--el-color-danger);
      cursor: pointer;
    }

    &:focus-within .historyDelete { opacity: 1; }
  }

  @media (hover: hover) and (pointer: fine) {
    .historyCard .historyPrompt,
    .historyCard .historyDelete { opacity: 0; }
    .historyCard:hover .historyPrompt,
    .historyCard:hover .historyDelete,
    .historyCard:focus-within .historyPrompt,
    .historyCard:focus-within .historyDelete { opacity: 1; }
  }

  .referenceSlot button:focus-visible,
  .historyCard button:focus-visible,
  .historyPreview:focus-visible,
  .stageImage:focus-visible,
  .stageThumbs button:focus-visible {
    outline-offset: -2px;
  }

  .loadMore { margin-top: 8px; }

  @container (max-width: 760px) {
    .studio { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .stage { min-height: 220px; }
    .pageHeader, .historyHeader { flex-wrap: wrap; }
  }

  @container (max-width: 360px) {
    .options { grid-template-columns: minmax(0, 1fr); }
    .historyGrid { grid-template-columns: minmax(0, 1fr); }
  }

  @media (max-width: 900px) {
    padding: 16px max(16px, env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));

    .pageHeader { margin-bottom: 16px; h1 { font-size: 22px; } }
    .studio { grid-template-columns: 1fr; gap: 16px; }
    .stage { min-height: 168px; }
    .history { margin-top: 24px; }
  }
}

@keyframes onlineSpin { to { transform: rotate(360deg); } }
</style>

<style lang="scss">
.onlineImageDetail {
  overscroll-behavior: contain;

  .el-dialog__body { overscroll-behavior: contain; }

  .detailImages {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;

    .el-image { height: 280px; border-radius: 12px; background: var(--el-fill-color-light); }
    video { width: 100%; max-height: 520px; border-radius: 12px; background: var(--el-fill-color-light); }
  }

  .detailPrompt { margin: 14px 0 6px; white-space: pre-wrap; }
  .detailMeta { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; }
  .detailActions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
}
</style>
