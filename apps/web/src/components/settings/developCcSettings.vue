<template>
  <div class="developCcSettings">
    <el-form labelPosition="top" @submit.prevent="fetchModels">
      <el-form-item label="API Key">
        <el-input v-model="apiKey" type="password" showPassword autocomplete="off" :disabled="loading" placeholder="填写 develop.cc API Key" />
      </el-form-item>
      <el-button type="primary" nativeType="submit" :loading="loading" :disabled="!apiKey.trim()">保存并拉取模型</el-button>
    </el-form>
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" showIcon />
    <el-text type="info">文字、图片和视频共用此 API Key。</el-text>
    <el-text type="info">{{ media ? 'https://image.develop.cc · https://video.develop.cc' : 'https://api.develop.cc/v1' }}</el-text>
    <div class="modelList">
      <el-tag v-for="model in models" :key="model.id" effect="plain">{{ model.label }}</el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";
import { customProviders, saveSettings, settings, type CustomProviderModel } from "@/stores/settings";
import type { MediaProvider } from "./panels/mediaModel/types";

const { media = false } = defineProps<{ media?: boolean }>();
const savedKey = computed(() => (settings.value.developCc as { apiKey?: string } | undefined)?.apiKey ?? "");
const apiKey = ref(savedKey.value);
const loading = ref(false);
const errorMessage = ref("");
const mediaModels = ref<MediaProvider["models"]>([]);
const models = computed(() => media ? mediaModels.value : customProviders.value.find(item => item.id === "developCc")?.models ?? []);
watch(savedKey, value => { if (!loading.value) apiKey.value = value; });

async function loadMediaProvider() {
  const { data } = await axios.get<{ code: number; data: MediaProvider[]; message?: string }>("/api/providers/media/list");
  if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "读取媒体供应商失败");
  const provider = data.data.find(item => item.id === "developCc");
  if (!provider || provider.loadError) throw new Error(provider?.loadError || "develop.cc 媒体供应商尚未就绪，请重启服务后重试");
  mediaModels.value = provider.models;
  return provider;
}

onMounted(() => {
  if (media) void loadMediaProvider().catch(error => { errorMessage.value = error instanceof Error ? error.message : "读取模型失败"; });
});

async function fetchModels() {
  if (loading.value || !apiKey.value.trim()) return;
  loading.value = true;
  errorMessage.value = "";
  let stage = "校验 API Key";
  try {
    const key = apiKey.value.trim().replace(/^Bearer\s+/i, "").trim();
    if (!key) throw new Error("请填写 API Key");
    if (media) {
      stage = "保存共用 API Key";
      await saveSettings(() => ({ developCc: { apiKey: key } }));
      stage = "读取媒体供应商";
      const provider = await loadMediaProvider();
      stage = "拉取媒体模型";
      const { data } = await axios.post<{ code: number; data: MediaProvider; message?: string }>("/api/providers/media/models", {
        fileName: provider.fileName, revision: provider.revision,
      }, { timeout: 35000 });
      if (data.code !== 200 || !data.data) throw new Error(data.message || "拉取媒体模型失败");
      stage = "保存媒体模型";
      const fetchedModels = data.data.models;
      await saveSettings(current => {
        const configs = current.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
        return { mediaProviderConfigs: { ...configs, developCc: { ...configs?.developCc, models: fetchedModels } } };
      });
      mediaModels.value = fetchedModels;
      invalidateNodeModels("media");
      ElMessage.success("媒体模型列表已更新");
      return;
    }
    stage = "拉取文字模型";
    const { data } = await axios.post<{ code: number; data: (CustomProviderModel & { type?: string })[]; message?: string }>("/api/providers/models", {
      apiUrl: "https://api.develop.cc/v1", protocol: "openai-completions", apiKey: key,
    }, { timeout: 35000 });
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "拉取文字模型失败");
    stage = "读取媒体分类";
    const provider = await loadMediaProvider();
    const mediaIds = new Set(provider.models.map(model => model.id));
    stage = "保存文字模型";
    await saveSettings(current => ({
      developCc: { apiKey: key },
      customProviders: [
        ...(Array.isArray(current.customProviders) ? current.customProviders.filter(item => item?.id !== "developCc") : []),
        { id: "developCc", label: "develop.cc", apiUrl: "https://api.develop.cc/v1", protocol: "openai-completions", apiKey: "", models: data.data.filter(model => model.type === "text" || (!model.type && !mediaIds.has(model.id))) },
      ],
    }));
    ElMessage.success("文字模型列表已更新；图片和视频请在媒体模型页拉取");
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.response?.data?.message || (error.code === "ECONNABORTED" ? "请求超时，请检查服务端网络或代理后重试" : error.message)
      : error instanceof Error ? error.message : "请求失败";
    errorMessage.value = `${stage}失败：${message}`;
  } finally { loading.value = false; }
}
</script>

<style scoped lang="scss">
.developCcSettings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 800px;

  .modelList {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
