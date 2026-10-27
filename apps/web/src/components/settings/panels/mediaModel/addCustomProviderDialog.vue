<template>
  <el-dialog
    v-model="visible"
    :title="mode === 'builtin' ? '添加媒体供应商' : '添加自定义媒体供应商'"
    :width="mode === 'builtin' ? 'min(860px, 94vw)' : 'min(760px, 94vw)'"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="false"
    :closeOnPressEscape="!saving"
    :showClose="!saving">
    <div v-if="mode === 'builtin'" class="providerPicker">
      <aside class="providerSidebar" aria-label="选择厂商">
        <button
          v-for="item in mediaProviders"
          :key="item.id"
          class="providerItem"
          type="button"
          :disabled="saving"
          :aria-pressed="selectedProvider === item.id"
          @click="selectedProvider = item.id">
          <img v-if="item.icon" class="providerLogo" :class="{ monochrome: item.id === 'tfRouter' }" :src="item.icon" alt="" />
          <modelIcon v-else :model="item.id" :size="18" />
          <span>{{ item.label }}</span>
        </button>
      </aside>
      <el-scrollbar class="providerDetails">
        <section v-if="activeProvider" :key="selectedProvider" class="providerContent" :aria-label="activeProvider.label">
          <div class="providerHeader">
            <h3>{{ activeProvider.label }}</h3>
            <el-tag v-if="activeProvider.version" size="small" type="info" effect="plain">v{{ activeProvider.version }}</el-tag>
          </div>
          <messageMarkdown v-if="providerReadme" class="providerReadme" :content="providerReadme" />
          <el-divider v-if="providerReadme" contentPosition="left">连接配置</el-divider>
          <form-create v-model:api="formApi" :rule="providerRules" :option="formOptions" />
          <div class="modelHeader">
            <el-text tag="strong">模型列表 <el-text type="info">{{ models.length }}</el-text></el-text>
          </div>
          <el-table v-if="models.length" class="modelList" :data="models" rowKey="id" aria-label="模型列表">
            <el-table-column prop="id" label="模型 ID" minWidth="220" showOverflowTooltip />
            <el-table-column prop="label" label="显示名称" minWidth="180" showOverflowTooltip />
          </el-table>
          <el-alert v-if="formError" :title="formError" type="error" :closable="false" showIcon />
        </section>
      </el-scrollbar>
    </div>
    <el-scrollbar v-else maxHeight="min(65dvh, calc(100dvh - 160px))">
      <div class="dialogContent">
        <el-form class="importForm" labelPosition="top" :disabled="saving" @submit.prevent>
          <el-form-item class="methodField" label="添加方式">
            <el-segmented v-model="activeTab" :options="addMethods" block ariaLabel="添加方式">
              <template #default="{ item }">
                <span class="methodOption">
                  <component :is="item.icon" :size="16" aria-hidden="true" />
                  {{ item.label }}
                </span>
              </template>
            </el-segmented>
          </el-form-item>
        </el-form>
        <el-form v-if="activeTab === 'form'" ref="protocolFormRef" class="protocolForm" :model="protocolForm" :rules="protocolRules" labelPosition="top" :disabled="saving" @submit.prevent>
          <div class="formGrid">
            <el-form-item label="Provider ID" prop="id"><el-input v-model="protocolForm.id" :placeholder="protocolForm.protocol === openaiImagesProtocol ? '例如 myImage' : '例如 myVideo'" /></el-form-item>
            <el-form-item label="显示名称" prop="label"><el-input v-model="protocolForm.label" placeholder="供应商的显示名称" /></el-form-item>
            <el-form-item label="API 地址" prop="apiUrl"><el-input v-model="protocolForm.apiUrl" dir="ltr" :placeholder="protocolForm.protocol === openaiImagesProtocol ? 'https://image.example.com' : 'https://api.example.com'" /></el-form-item>
            <el-form-item label="API 协议">
              <el-select v-model="protocolForm.protocol" aria-label="API 协议">
                <el-option label="火山方舟视频" :value="volcengineArkProtocol" />
                <el-option label="OpenAI 图像" :value="openaiImagesProtocol" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item label="API 密钥" prop="apiKey">
            <el-input v-model="protocolForm.apiKey" type="password" dir="ltr" showPassword autocomplete="off" placeholder="sk-…，可带或不带前缀" />
          </el-form-item>
          <div v-if="protocolForm.protocol === volcengineArkProtocol" class="balanceRow">
            <el-button :icon="IconWallet" :loading="queryingBalance" @click="queryBalance">查询账户余额</el-button>
            <el-text v-if="balanceText" :type="balanceError ? 'danger' : 'info'" size="small">{{ balanceText }}</el-text>
          </div>
          <el-text class="fieldHint" type="info" size="small">{{ protocolHint }}</el-text>
          <div class="modelHeader">
            <el-text tag="strong">模型列表</el-text>
            <el-button @click="restoreRecommendedModels">恢复推荐模型</el-button>
          </div>
          <div class="modelList">
            <div v-for="item in protocolModels" :key="item.key" class="modelRow">
              <el-input v-model="item.id" :readonly="item.preset" placeholder="模型 ID" aria-label="模型 ID" />
              <el-input v-model="item.label" placeholder="显示名称" aria-label="模型显示名称" />
              <el-button text type="danger" :icon="IconTrash" aria-label="删除模型" @click="protocolModels = protocolModels.filter(model => model.key !== item.key)" />
            </div>
          </div>
          <el-button class="manualAdd" :icon="IconPlus" @click="addManualModel">手动添加模型</el-button>
          <el-text class="fieldHint" type="info" size="small">{{ modelHint }}</el-text>
        </el-form>
        <el-form v-else class="importForm" labelPosition="top" :disabled="saving" @submit.prevent>
          <el-form-item v-if="activeTab === 'file'" class="sourceField" label="供应商文件">
            <div class="fileImport">
              <div class="fileSource">
                <!-- ACT: Android 会把 .ts 识别为视频，选中后再校验扩展名和大小。 -->
                <input ref="fileInput" type="file" :accept="isMobile ? undefined : '.ts'" hidden :disabled="saving" @change="readSourceFile" />
                <el-input :modelValue="fileName" :prefixIcon="IconFileCode" placeholder="尚未选择文件" readonly aria-label="已选择的供应商文件" />
                <el-button :icon="IconFolderOpen" @click="fileInput?.click()">选择文件</el-button>
              </div>
              <el-text class="fieldHint" type="info" size="small">支持 .ts 文件，最大 1 MB。</el-text>
            </div>
          </el-form-item>
          <el-form-item v-else class="sourceField" label="供应商代码">
            <el-input v-model="code" class="sourceInput" type="textarea" dir="ltr" :rows="10" resize="none" aria-label="供应商代码" />
          </el-form-item>
        </el-form>
        <section v-if="activeTab !== 'form'" class="providerTips" aria-label="使用 AI 生成供应商">
          <h4>还没有供应商文件？</h4>
          <p>让 AI 读取接口文档并生成代码，遇到登录可手动操作。</p>
          <div class="assistantActions">
            <el-button type="primary" :icon="IconSparkles" :loading="openingAgent" :disabled="!modelChoices.length || saving" @click="openAgent">AI 生成供应商</el-button>
            <el-button :icon="IconCopy" @click="copyPrompt">复制提示词给其他 AI</el-button>
          </div>
          <el-text v-if="!modelChoices.length" class="fieldHint" type="info" size="small">请先在文本模型设置中配置模型。</el-text>
          <details class="promptDetails" :open="promptExpanded" @toggle="promptExpanded = ($event.target as HTMLDetailsElement).open">
            <summary>查看完整提示词</summary>
            <el-input v-if="promptExpanded" :modelValue="providerPrompt" type="textarea" :rows="10" resize="none" readonly aria-label="供应商开发提示词" />
          </details>
        </section>
        <el-alert v-if="formError" class="formError" :title="formError" type="error" :closable="false" showIcon />
      </div>
    </el-scrollbar>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="mode === 'custom' && activeTab === 'form' ? !protocolReady : !source.trim()" @click="addProvider">确定添加供应商</el-button>
    </template>
  </el-dialog>
  <component v-if="providerAgentDialog" :is="providerAgentDialog" v-model="agentVisible" :askUserEnabled="askUserEnabled" @generated="useGeneratedSource" />
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, onBeforeUnmount, reactive, ref, shallowRef, watch, type Component } from "vue";
import formCreate, { type Api, type Options } from "../../formCreate";
import { IconFileCode, IconCode, IconFolderOpen, IconCopy, IconSparkles, IconKey, IconPlus, IconTrash, IconWallet } from "@tabler/icons-vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { mediaProviders } from "@toonflow/providers";
import { createOpenaiImagesSource, openaiImageManualTemplate, openaiImagesProtocol, recommendedOpenaiImageModels, type OpenaiImageModelInput } from "@toonflow/providers/media/openaiImagesCatalog";
import { createVolcengineArkSource, recommendedVolcengineArkModels, volcengineArkManualTemplate, volcengineArkProtocol, type VolcengineArkModelInput } from "@toonflow/providers/media/volcengineArkCatalog";
import { modelIcon } from "@toonflow/model-icons";
import messageMarkdown from "@/components/messageMarkdown.vue";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import tfRouterSource from "@toonflow/providers/media/tfRouter?raw";
import apiMartSource from "@toonflow/providers/media/apiMart?raw";
import metasoSource from "@toonflow/providers/media/metaso?raw";
import compshareSource from "@toonflow/providers/media/compshare?raw";
import type { MediaProvider } from "./types";
import { providerPrompt } from "./providerPrompt";
import { modelChoices, saveSettings } from "@/stores/settings";
import { writeClipboardText } from "@/lib/clipboard";
import { isMobile } from "@/lib/platform";

const { mode = "custom" } = defineProps<{ mode?: "builtin" | "custom" }>();
const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ added: [provider: MediaProvider] }>();
const providerSources: Record<string, string> = { tfRouter: tfRouterSource, apiMart: apiMartSource, metaso: metasoSource, compshare: compshareSource };
const selectedProvider = ref<string>(mediaProviders[0]?.id ?? "");
const activeProvider = computed(() => mediaProviders.find(provider => provider.id === selectedProvider.value));
const models = computed<MediaProvider["models"]>(() => activeProvider.value?.models ?? []);
const providerReadme = computed(() => {
  const provider = activeProvider.value;
  return provider && "readme" in provider && typeof provider.readme === "string" ? provider.readme : "";
});
const activeTab = ref<"form" | "file" | "code">("form");
const addMethods = [
  { label: "接口配置", value: "form", icon: IconKey },
  { label: "文件导入", value: "file", icon: IconFileCode },
  { label: "粘贴代码", value: "code", icon: IconCode },
];
type DraftModel = { key: string; preset: boolean } & (VolcengineArkModelInput | OpenaiImageModelInput);
const protocolFormRef = ref<FormInstance>();
const protocolForm = reactive({ id: "", label: "", apiUrl: "", protocol: volcengineArkProtocol, apiKey: "" });
const protocolModels = ref<DraftModel[]>([]);
const queryingBalance = ref(false);
const balanceText = ref("");
const balanceError = ref(false);
let balanceRequest: AbortController | undefined;
const imageProtocol = computed(() => protocolForm.protocol === openaiImagesProtocol);
const protocolHint = computed(() => imageProtocol.value
  ? "地址填站点根路径，不要带 /v1。文生图走 POST /v1/images/generations，参考图走 POST /v1/images/edits。直链保留 3 天，生成后会立即转存。不支持蒙版局部重绘。"
  : "地址填站点根路径。余额走 GET /api/v1/account/balance，视频走 POST /api/v3/contents/generations/tasks 后轮询。参考视频只接受公网地址。");
const modelHint = computed(() => imageProtocol.value
  ? "推荐模型已带上分辨率档、画幅和参考图上限。不支持参考图的模型只有文生图。手动添加的模型先沿用 gpt-image-2 的规格，保存后可在编辑里调整。"
  : "推荐模型已带上时长、分辨率、画幅和参考数量。手动添加的模型先沿用 Seedance 2.0 的规格，保存后可在编辑里调整。");
const protocolReady = computed(() => !!protocolForm.id.trim() && !!protocolForm.label.trim() && !!protocolForm.apiUrl.trim() && !!protocolForm.apiKey.trim() && protocolModels.value.some(item => item.id.trim()));
const protocolRules: FormRules = {
  id: [
    { required: true, message: "请输入 Provider ID", trigger: "blur" },
    { pattern: /^[a-z][a-zA-Z0-9]*$/, message: "须以小写字母开头，只含字母和数字", trigger: "blur" },
  ],
  label: [{ required: true, whitespace: true, message: "请输入显示名称", trigger: "blur" }],
  apiUrl: [{
    validator: (_rule, value, callback) => {
      try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
        callback();
      } catch { callback(new Error("请输入有效的 HTTP API 地址，不包含查询参数")); }
    },
    trigger: "blur",
  }],
  apiKey: [{ required: true, whitespace: true, message: "请输入 API 密钥", trigger: "blur" }],
};
const promptExpanded = ref(false);
const code = ref("");
const fileSource = ref("");
const fileName = ref("");
const fileInput = ref<HTMLInputElement>();
const saving = ref(false);
const openingAgent = ref(false);
const agentVisible = ref(false);
const askUserEnabled = ref(false);
const providerAgentDialog = shallowRef<Component>();
let agentOpening: AbortController | undefined;
const formError = ref("");
const formApi = shallowRef<Api>();
const addedProvider = shallowRef<MediaProvider>();
const formOptions = computed<Options>(() => ({ form: { labelPosition: "top", disabled: saving.value }, submitBtn: false, resetBtn: false }));
const providerRules = computed(() => formCreate.copyRules([...(activeProvider.value?.rules ?? [])]));
const source = computed(() => mode === "builtin" ? providerSources[selectedProvider.value] ?? "" : activeTab.value === "file" ? fileSource.value : activeTab.value === "code" ? code.value : "");

watch([activeTab, selectedProvider], () => {
  formError.value = "";
  addedProvider.value = undefined;
});

function recommendedDrafts() {
  const models = protocolForm.protocol === openaiImagesProtocol ? recommendedOpenaiImageModels() : recommendedVolcengineArkModels();
  return models.map(item => ({ ...item, key: crypto.randomUUID(), preset: true }));
}

function resetProtocolForm() {
  balanceRequest?.abort();
  Object.assign(protocolForm, { id: "", label: "", apiUrl: "", protocol: volcengineArkProtocol, apiKey: "" });
  protocolModels.value = recommendedDrafts();
  balanceText.value = "";
  balanceError.value = false;
  queryingBalance.value = false;
}

watch(visible, value => {
  agentOpening?.abort();
  balanceRequest?.abort();
  agentOpening = undefined;
  openingAgent.value = false;
  if (!value) { agentVisible.value = false; return; }
  selectedProvider.value = mediaProviders[0]?.id ?? "";
  activeTab.value = "form";
  promptExpanded.value = false;
  formApi.value = undefined;
  addedProvider.value = undefined;
  code.value = fileSource.value = fileName.value = formError.value = "";
  resetProtocolForm();
}, { immediate: true });
watch(() => protocolForm.protocol, (protocol, previous) => {
  if (!visible.value || protocol === previous) return;
  balanceRequest?.abort();
  balanceText.value = "";
  balanceError.value = false;
  protocolModels.value = recommendedDrafts();
});
watch([() => protocolForm.apiUrl, () => protocolForm.apiKey], () => {
  balanceRequest?.abort();
  balanceText.value = "";
  balanceError.value = false;
});

async function openAgent() {
  if (openingAgent.value || saving.value || !modelChoices.value.length) return;
  openingAgent.value = true;
  formError.value = "";
  const controller = new AbortController();
  agentOpening = controller;
  try {
    const { data } = await axios.get<{ data: { tools: { name: string; enabled: boolean; loadError?: string }[] } }>("/api/tools/get", { signal: controller.signal });
    if (controller.signal.aborted || !visible.value) return;
    const browser = data.data.tools.find(tool => tool.name === "browser");
    if (!browser?.enabled) throw new Error("请先在「工具市场」安装并启用网页浏览器工具");
    if (browser.loadError) throw new Error(`浏览器工具加载失败：${browser.loadError}`);
    askUserEnabled.value = data.data.tools.some(tool => tool.name === "askUser" && tool.enabled && !tool.loadError);
    providerAgentDialog.value ??= defineAsyncComponent(() => import("./providerAgentDialog.vue"));
    agentVisible.value = true;
  } catch (error) {
    if (controller.signal.aborted) return;
    formError.value = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "打开生成助手失败";
  } finally { if (agentOpening === controller) { agentOpening = undefined; openingAgent.value = false; } }
}

onBeforeUnmount(() => { agentOpening?.abort(); balanceRequest?.abort(); });

function restoreRecommendedModels() {
  protocolModels.value = recommendedDrafts();
}

function addManualModel() {
  const template = protocolForm.protocol === openaiImagesProtocol ? openaiImageManualTemplate() : volcengineArkManualTemplate();
  protocolModels.value.push({ ...template, key: crypto.randomUUID(), preset: false });
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
}

async function queryBalance() {
  if (queryingBalance.value || saving.value || !(await protocolFormRef.value?.validateField(["apiUrl", "apiKey"]).catch(() => false))) return;
  queryingBalance.value = true;
  balanceText.value = "";
  balanceError.value = false;
  const controller = new AbortController();
  balanceRequest = controller;
  try {
    const { data } = await axios.post<{ code: number; data: { balance: number; unit: string; keyBalance: number | null; accountHidden: boolean }; message?: string }>(
      "/api/providers/media/balance",
      { apiUrl: protocolForm.apiUrl.trim(), apiKey: protocolForm.apiKey.trim(), protocol: volcengineArkProtocol },
      { signal: controller.signal, timeout: 25000 },
    );
    if (controller.signal.aborted) return;
    if (data.code !== 200 || !data.data) throw new Error(data.message || "余额查询失败");
    const balance = data.data;
    const account = `${formatAmount(balance.balance)} ${balance.unit}`;
    balanceText.value = balance.accountHidden
      ? `账户余额已隐藏，当前密钥余额 ${balance.keyBalance == null ? account : `${formatAmount(balance.keyBalance)} ${balance.unit}`}`
      : balance.keyBalance == null ? `账户余额 ${account}，密钥额度无限制` : `账户余额 ${account}，密钥余额 ${formatAmount(balance.keyBalance)} ${balance.unit}`;
  } catch (error) {
    if (controller.signal.aborted) return;
    balanceError.value = true;
    balanceText.value = axios.isAxiosError(error) ? error.response?.data?.message || "余额查询失败，请检查地址和密钥" : error instanceof Error ? error.message : "余额查询失败";
  } finally {
    if (balanceRequest === controller) { balanceRequest = undefined; queryingBalance.value = false; }
  }
}

function useGeneratedSource(source: string) {
  activeTab.value = "code";
  code.value = source;
  formError.value = "";
  addedProvider.value = undefined;
}

async function readSourceFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  formError.value = "";
  try {
    if (!/\.ts$/i.test(file.name) || file.size > 1024 * 1024) throw new Error("请选择不超过 1 MB 的 .ts 文件");
    fileSource.value = await file.text();
    fileName.value = file.name;
  } catch (error) {
    fileSource.value = fileName.value = "";
    formError.value = error instanceof Error ? error.message : "读取文件失败";
  }
}

async function addProvider() {
  const protocolMode = mode === "custom" && activeTab.value === "form";
  if (saving.value || queryingBalance.value) return;
  if (protocolMode) {
    if (!(await protocolFormRef.value?.validate().catch(() => false))) return;
  } else if (!source.value.trim() || (mode === "builtin" && !formApi.value)) return;
  saving.value = true;
  formError.value = "";
  try {
    let values: Record<string, unknown> | undefined;
    let providerSource = source.value;
    if (protocolMode) {
      const id = protocolForm.id.trim();
      if (mediaProviders.some(item => item.id.toLowerCase() === id.toLowerCase())) throw new Error("Provider ID 与内置供应商冲突");
      const models = protocolModels.value.map(({ key: _key, preset: _preset, ...item }) => item);
      providerSource = protocolForm.protocol === openaiImagesProtocol
        ? createOpenaiImagesSource({
          id, label: protocolForm.label, models: models.map(item => {
            if (!("tiers" in item)) throw new Error("模型规格与 OpenAI 图像协议不一致");
            return item;
          }),
        })
        : createVolcengineArkSource({
          id, label: protocolForm.label, models: models.map(item => {
            if (!("durations" in item)) throw new Error("模型规格与火山方舟视频协议不一致");
            return item;
          }),
        });
      values = { apiUrl: protocolForm.apiUrl.trim(), apiKey: protocolForm.apiKey.trim() };
      if (!(values.apiKey as string)) throw new Error("请填写 API 密钥");
      if ((values.apiKey as string).length > 8192) throw new Error("API 密钥过长");
    } else if (mode === "builtin") {
      if (!(await formApi.value!.validate().then(() => true, () => false))) return;
      values = formApi.value!.formData();
      if ("apiKey" in values) {
        values.apiKey = typeof values.apiKey === "string" ? values.apiKey.trim() : "";
        if (!values.apiKey) throw new Error("请填写 API Key");
        if ((values.apiKey as string).length > 8192) throw new Error("API Key 过长");
      }
    }
    if (!addedProvider.value) {
      const { data } = await axios.post<{ data: MediaProvider }>("/api/providers/media/add", { source: providerSource });
      addedProvider.value = data.data;
      emit("added", data.data);
      invalidateNodeModels("media");
    }
    if (values) {
      const providerId = addedProvider.value.id;
      // ACT: 安装成功但配置保存失败时保留安装结果，重试只保存配置。
      await saveSettings(settings => {
        const configs = settings.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
        if (configs !== undefined && (!configs || typeof configs !== "object" || Array.isArray(configs))) throw new Error("媒体供应商配置格式无效");
        const current = configs?.[providerId];
        if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) throw new Error("当前供应商配置格式无效");
        return { mediaProviderConfigs: { ...configs, [providerId]: { ...current, ...values } } };
      });
    }
    invalidateNodeModels("media");
    visible.value = false;
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "添加失败，请重试";
    formError.value = addedProvider.value ? `供应商已添加，连接配置未保存：${message}。填写内容已保留，请重试。` : message;
  } finally {
    saving.value = false;
  }
}

async function copyPrompt() {
  try {
    await writeClipboardText(providerPrompt);
    ElMessage.success("提示词已复制，发给其他 AI 后跟着回答问题即可");
  } catch {
    ElMessage.error("复制失败，请展开「查看完整提示词」后手动复制");
  }
}
</script>

<style lang="scss" scoped>
.providerPicker {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  height: min(560px, 70dvh);
  gap: 24px;

  .providerSidebar {
    overflow-y: auto;
    border-right: 1px solid var(--el-border-color-lighter);
    padding: 2px;

    .providerItem {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 12px;
      margin-bottom: 4px;
      border: 0;
      border-radius: var(--el-border-radius-base);
      background: transparent;
      color: var(--el-text-color-regular);
      font: inherit;
      text-align: left;
      cursor: pointer;

      &:hover { background: var(--el-fill-color-light); }
      &[aria-pressed="true"] {
        background: var(--el-color-primary-light-9);
        color: var(--el-color-primary);
      }
      &:focus-visible { outline: 2px solid var(--el-color-primary); }

      .providerLogo {
        width: 18px;
        height: 18px;
        object-fit: contain;

        &.monochrome {
          .dark & { filter: invert(1); }
        }
      }
    }
  }

  .providerDetails {
    min-width: 0;

    .providerContent {
      padding-right: 12px;

      .providerHeader {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        margin: 4px 0 24px;

        h3 {
          margin: 0;
          color: var(--el-text-color-primary);
          font-size: 18px;
          overflow-wrap: anywhere;
        }
      }
      .providerReadme {
        margin-bottom: 24px;
        overflow-wrap: anywhere;
      }
      .modelHeader {
        margin: 8px 0 12px;
      }
      .modelList {
        margin-bottom: 16px;
      }
    }
  }

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 16px;

    .providerSidebar {
      max-height: 128px;
      border-right: 0;
      border-bottom: 1px solid var(--el-border-color-lighter);
    }
  }
}

.dialogContent {
  padding: 8px 4px;

  .protocolForm {
    .formGrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 20px;

      .el-select { width: 100%; }
    }

    .balanceRow {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 8px;
    }

    .modelHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 16px 0 12px;
    }

    .modelList {
      display: grid;
      gap: 8px;

      .modelRow {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
        align-items: center;
        gap: 8px;

        .el-button { margin: 0; padding: 4px; }
      }
    }

    .manualAdd { width: 100%; margin: 12px 0; }

    .fieldHint { display: block; line-height: 1.5; }

    @media (max-width: 560px) {
      .formGrid, .modelList .modelRow { grid-template-columns: 1fr; }
    }
  }

  .importForm {
    .methodField {
      .methodOption {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 4px 0;
      }
    }

    .sourceField {
      margin-bottom: 0;

      .fileImport {
        width: 100%;

        .fileSource {
          display: flex;
          width: 100%;
          gap: 8px;

          .el-input { min-width: 0; }
          .el-button { flex-shrink: 0; }
        }

        .fieldHint {
          display: block;
          margin-top: 6px;
          line-height: 1.5;
        }
      }

      .sourceInput :deep(.el-textarea__inner) {
        height: min(28dvh, 240px);
        min-height: 140px;
        padding: 12px;
        font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
        font-size: 13px;
        line-height: 1.7;
      }
    }
  }

  .providerTips {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--el-border-color-lighter);

    h4 {
      margin: 0;
      color: var(--el-text-color-primary);
    }

    p {
      margin: 8px 0 12px;
      color: var(--el-text-color-secondary);
      font-size: 13px;
      line-height: 1.6;
    }

    .assistantActions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;

      .el-button { margin-left: 0; }
    }

    .fieldHint {
      display: block;
      margin-top: 8px;
      line-height: 1.5;
    }

    .promptDetails {
      margin-top: 12px;

      summary {
        width: fit-content;
        color: var(--el-text-color-secondary);
        font-size: 12px;
        line-height: 20px;
        cursor: pointer;

        &:hover { color: var(--el-color-primary); }
        &:focus-visible {
          outline: 2px solid var(--el-color-primary);
          outline-offset: 4px;
          border-radius: var(--el-border-radius-small);
        }
      }

      .el-textarea {
        margin-top: 12px;

        :deep(.el-textarea__inner) {
          padding: 12px;
          font-size: 12px;
          line-height: 1.7;
        }
      }
    }
  }

  .formError {
    margin-top: 16px;
  }

  @media (max-width: 560px) {
    .importForm .sourceField .fileImport .fileSource {
      flex-direction: column;

      .el-button { align-self: flex-start; }
    }

    .providerTips .assistantActions {
      .el-button { flex: 1 1 180px; }
    }
  }
}
</style>
