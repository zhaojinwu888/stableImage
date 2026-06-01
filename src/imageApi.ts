export interface ImageItem {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface ChatChoice {
  message?: {
    content?: unknown;
  };
}

interface ChatImageRequestOptions {
  model: string;
  prompt: string;
  n: number;
  size: string;
  quality: string;
  background: string;
}

function appendUniqueImage(results: ImageItem[], seen: Set<string>, image: ImageItem) {
  const key = image.b64_json ?? image.url;
  if (!key || seen.has(key)) return;

  seen.add(key);
  results.push(image);
}

function collectImagesFromUnknown(value: unknown, results: ImageItem[], seen: Set<string>) {
  if (typeof value === 'string') {
    collectImagesFromText(value, results, seen);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImagesFromUnknown(item, results, seen);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const item = value as Record<string, any>;
  if (typeof item.b64_json === 'string') {
    appendUniqueImage(results, seen, { b64_json: item.b64_json, revised_prompt: item.revised_prompt });
  }

  if (typeof item.url === 'string') {
    appendUniqueImage(results, seen, { url: item.url, revised_prompt: item.revised_prompt });
  }

  if (typeof item.image_url?.url === 'string') {
    appendUniqueImage(results, seen, { url: item.image_url.url });
  }

  if (typeof item.text === 'string') {
    collectImagesFromText(item.text, results, seen);
  }

  if (typeof item.content === 'string' || Array.isArray(item.content)) {
    collectImagesFromUnknown(item.content, results, seen);
  }

  if (Array.isArray(item.data)) {
    collectImagesFromUnknown(item.data, results, seen);
  }

  if (Array.isArray(item.images)) {
    collectImagesFromUnknown(item.images, results, seen);
  }
}

function collectImagesFromText(content: string, results: ImageItem[], seen: Set<string>) {
  const jsonText = content.trim();
  if ((jsonText.startsWith('{') && jsonText.endsWith('}')) || (jsonText.startsWith('[') && jsonText.endsWith(']'))) {
    try {
      collectImagesFromUnknown(JSON.parse(jsonText), results, seen);
    } catch {
      // Some chat responses are plain text or Markdown, so fall through to regex extraction.
    }
  }

  const patterns = [
    /data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/g,
    /!\[[^\]]*]\((https?:\/\/[^)\s"'<>]+)\)/g,
    /https?:\/\/[^\s"'<>)]*(?:\.(?:png|jpe?g|webp|gif)|\/image\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+)(?:\?[^\s"'<>)]*)?/gi,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      appendUniqueImage(results, seen, match[0].startsWith('data:image') ? { b64_json: value } : { url: value });
    }
  }
}

export function buildChatImageRequest(options: ChatImageRequestOptions) {
  const imageOptions = [
    `图片数量：${options.n}`,
    `尺寸：${options.size}`,
    `质量：${options.quality}`,
    `背景：${options.background}`,
  ].join('\n');

  return {
    model: options.model,
    n: options.n,
    size: options.size,
    quality: options.quality,
    background: options.background,
    messages: [
      {
        role: 'user',
        content: `${options.prompt.trim()}\n\n${imageOptions}`.trim(),
      },
    ],
  };
}

export function extractImages(payload: unknown) {
  const results: ImageItem[] = [];
  const seen = new Set<string>();

  if (!payload || typeof payload !== 'object') {
    return results;
  }

  const response = payload as { data?: unknown; images?: unknown; choices?: ChatChoice[] };
  collectImagesFromUnknown(response.data, results, seen);
  collectImagesFromUnknown(response.images, results, seen);

  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      collectImagesFromUnknown(choice.message?.content, results, seen);
    }
  }

  return results;
}
