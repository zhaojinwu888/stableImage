<script setup lang="ts">
import { computed, ref } from 'vue';
import { buildImageGenerationRequest, extractImages, type ImageItem } from './imageApi';

type DownloadMode = 'direct' | 'link';

const baseUrl = ref('');
const apiKey = ref('');
const model = ref('gpt-image-2');
const n = ref(1);
const prompt = ref('');
const size = ref('1024x1024');
const quality = ref('high');
const background = ref('auto');
const downloadMode = ref<DownloadMode>('direct');
const loading = ref(false);
const elapsed = ref('');
const error = ref('');
const images = ref<ImageItem[]>([]);

let startedAt = 0;
let timer = 0;
const retryDelays = [800, 1600];

const normalizedEndpoint = computed(() => {
  const trimmed = baseUrl.value.trim().replace(/\/+$/, '');
  return `${trimmed}/v1/images/generations`;
});

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function startClock() {
  startedAt = Date.now();
  elapsed.value = '00:00';
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    elapsed.value = formatElapsed(Date.now() - startedAt);
  }, 1000);
}

function stopClock() {
  window.clearInterval(timer);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableError(message: string, status?: number) {
  const normalized = message.toLowerCase();
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    normalized.includes('upstream connect error') ||
    normalized.includes('connection refused') ||
    normalized.includes('remote connection failure') ||
    normalized.includes('transport failure') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror')
  );
}

function formatRequestError(message: string, status?: number) {
  if (isRetryableError(message, status)) {
    return `上游服务连接失败或暂时不可用，已自动重试但仍失败。请稍后再试，或检查 Base URL/平台上游渠道是否正常。原始错误：${message}`;
  }

  return message;
}

async function readResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function imageSrc(image: ImageItem) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }

  return image.url ?? '';
}

function downloadImage(image: ImageItem, index: number) {
  const href = imageSrc(image);
  if (!href) return;

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `stableapi-gpt-image-${index + 1}.png`;
  anchor.target = downloadMode.value === 'link' ? '_blank' : '_self';
  anchor.rel = 'noreferrer';
  anchor.click();
}

async function generateImage() {
  error.value = '';
  images.value = [];

  if (!apiKey.value.trim()) {
    error.value = '请先填写 API Key。';
    return;
  }

  loading.value = true;
  startClock();

  try {
    const requestBody = JSON.stringify(buildImageGenerationRequest({
      model: model.value,
      prompt: prompt.value,
      n: Number(n.value),
      size: size.value,
      quality: quality.value,
      background: background.value,
    }));
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      const response = await fetch(normalizedEndpoint.value, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.value.trim()}`,
      },
        body: requestBody,
      });

      const payload = await readResponsePayload(response);
      if (!response.ok) {
        const message = payload?.error?.message ?? payload?.message ?? `请求失败：${response.status}`;
        lastError = new Error(formatRequestError(message, response.status));
        if (attempt < retryDelays.length && isRetryableError(message, response.status)) {
          await wait(retryDelays[attempt]);
          continue;
        }

        throw lastError;
      }

      images.value = extractImages(payload);
      if (images.value.length === 0) {
        error.value = '接口返回成功，但没有找到图片数据。';
      }
      return;
    }

    throw lastError ?? new Error('生成失败，请稍后重试。');
  } catch (requestError) {
    const message = requestError instanceof Error ? requestError.message : '生成失败，请稍后重试。';
    error.value = formatRequestError(message);
  } finally {
    loading.value = false;
    stopClock();
  }
}

function clearResult() {
  images.value = [];
  error.value = '';
  elapsed.value = '';
}
</script>

<template>
  <main class="page-shell">
    <section class="control-panel">
      <h1>StableAPI GPT<br />Image</h1>
      <p class="intro">
        这个页面直接在浏览器里调用 StableAPI 的 OpenAI 兼容图片接口。默认模型名填的是
        <b>gpt-image-2</b>，如果你在平台里配置的是别名，比如 <b>gptimage2</b>，直接改掉即可。
      </p>

      <form class="form-grid" @submit.prevent="generateImage">
        <label class="field wide">
          <span>Base URL</span>
          <input v-model="baseUrl" autocomplete="url" />
          <small>程序会自动拼成 /v1/images/generations。</small>
        </label>

        <label class="field wide">
          <span>API Key</span>
          <input v-model="apiKey" autocomplete="off" type="password" />
          <small>出于安全考虑，页面不会把 API Key 保存到本地存储。</small>
        </label>

        <label class="field">
          <span>模型名</span>
          <input v-model="model" />
        </label>

        <label class="field">
          <span>图片数量</span>
          <input v-model.number="n" min="1" max="4" type="number" />
        </label>

        <label class="field wide">
          <span>提示词</span>
          <textarea v-model="prompt" rows="6" />
        </label>

        <label class="field">
          <span>尺寸</span>
          <select v-model="size">
            <option>1024x1024</option>
            <option>1024x1536</option>
            <option>1536x1024</option>
          </select>
        </label>

        <label class="field">
          <span>质量</span>
          <select v-model="quality">
            <option>high</option>
            <option>medium</option>
            <option>low</option>
            <option>auto</option>
          </select>
        </label>

        <label class="field">
          <span>背景</span>
          <select v-model="background">
            <option value="auto">默认</option>
            <option value="transparent">透明</option>
            <option value="opaque">不透明</option>
          </select>
        </label>

        <label class="field">
          <span>下载方式</span>
          <select v-model="downloadMode">
            <option value="direct">固定为直接下载模式</option>
            <option value="link">打开图片链接</option>
          </select>
        </label>

        <div class="actions wide">
          <button class="primary" :disabled="loading" type="submit">
            {{ loading ? '生成中' : '生成图片' }}
          </button>
          <button class="secondary" type="button" @click="clearResult">清空结果</button>
        </div>
      </form>
    </section>

    <section class="result-panel">
      <header class="result-header">
        <div>
          <h2>生成结果</h2>
          <p>接口返回图片链接或 base64 图片数据后，会在这里显示并支持下载。</p>
        </div>
        <div class="status">
          <span :class="{ active: loading }">{{ loading ? '生成中' : '空闲' }}</span>
          <p>耗时 {{ elapsed }}</p>
        </div>
      </header>

      <div v-if="error" class="error-box">
        {{ error }}
      </div>

      <div v-else-if="images.length" class="gallery" :class="{ single: images.length === 1 }">
        <article v-for="(image, index) in images" :key="index" class="image-card">
          <img :src="imageSrc(image)" :alt="`生成图片 ${index + 1}`" />
          <div class="image-actions">
            <span>图片 {{ index + 1 }}</span>
            <button type="button" @click="downloadImage(image, index)">下载</button>
          </div>
        </article>
      </div>

      <div v-else class="empty-state">
        <p>
          填好左侧参数后点击“生成图片”。<br />
          如果你是直接双击打开本地 HTML，某些浏览器环境可能会遇到跨域限制，建议用一个本地静态服务器访问这个页面。
        </p>
      </div>

      <p class="notice">
        注意：这是前端直连方案，API Key 会出现在浏览器环境中。正式部署时，更安全的做法是让你自己的后端代理请求。
      </p>
    </section>
  </main>
</template>
