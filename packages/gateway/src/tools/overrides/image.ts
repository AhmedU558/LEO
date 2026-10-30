/**
 * Image Tool Overrides
 *
 * Replaces the placeholder executors in core/image-tools with real implementations:
 *   - analyze_image: Uses the user's configured AI provider (vision API)
 *   - generate_image: Provider-agnostic image generation via Config Center
 */

import type { ToolRegistry, ToolExecutor, ToolExecutionResult } from '@ownpilot/core/tools';
import { createProvider, type ProviderConfig, type Message } from '@ownpilot/core/agent';
import { getConfigCenter } from '@ownpilot/core/services';
import { resolveDefaultProviderAndModel } from '../../services/app-settings.js';
import {
  getProviderApiKey,
  loadProviderConfig,
  NATIVE_PROVIDERS,
} from '../../services/agent/cache.js';
import { configServicesRepo } from '../../db/repositories/config-services.js';
import { getLog } from '../../services/log.js';
import { getErrorMessage } from '../../utils/common.js';
import { safeFetch } from '../../utils/safe-fetch.js';

const log = getLog('ImageOverrides');

// ============================================================================
// Constants
// ============================================================================

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

const IMAGE_GEN_SERVICE = 'image_generation';
/** Generation can take a minute on slower models; never hang a chat turn forever. */
const IMAGE_GEN_TIMEOUT_MS = 120_000;

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

// ============================================================================
// Config Center Registration
// ============================================================================

async function ensureImageGenService(): Promise<void> {
  try {
    await configServicesRepo.upsert({
      name: IMAGE_GEN_SERVICE,
      displayName: 'Image Generation',
      category: 'ai',
      description:
        'Image generation service (OpenAI DALL-E, Stability AI, FAL, Replicate, Krea, OpenRouter, Pollinations (free), or any OpenAI-compatible API)',
      configSchema: [
        {
          name: 'provider_type',
          label: 'Provider Type',
          type: 'string' as const,
          required: true,
          description:
            'openai, stability, fal, replicate, krea, openrouter, pollinations (free, no key), or openai-compatible',
        },
        {
          name: 'api_key',
          label: 'API Key',
          type: 'secret' as const,
          required: false,
          description: 'Not needed for pollinations',
        },
        {
          name: 'base_url',
          label: 'Base URL',
          type: 'string' as const,
          required: false,
          description: 'Custom API endpoint (required for fal, replicate, openai-compatible)',
        },
        {
          name: 'model',
          label: 'Model',
          type: 'string' as const,
          required: false,
          description: 'e.g. dall-e-3, stable-diffusion-xl, flux-pro',
        },
      ],
    });
  } catch (error) {
    log.debug('Config upsert for image_generation:', getErrorMessage(error));
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getMimeType(format: string): ImageMediaType {
  const map: Record<string, ImageMediaType> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[format.toLowerCase()] ?? 'image/jpeg';
}

function getFormatFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('.').pop()?.toLowerCase() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildAnalysisPrompt(task: string, detailLevel: string, question?: string): string {
  switch (task) {
    case 'describe':
      return detailLevel === 'high'
        ? 'Provide a very detailed description of this image, including all visible elements, their positions, colors, textures, and any notable details.'
        : detailLevel === 'low'
          ? 'Briefly describe the main subject of this image in one or two sentences.'
          : 'Describe this image in detail, including the main subjects, setting, colors, and overall composition.';
    case 'ocr':
      return 'Extract and transcribe all text visible in this image. Format it clearly, preserving the original structure where possible.';
    case 'objects':
      return 'List all distinct objects visible in this image. For each object, provide its name, approximate position, and any notable characteristics.';
    case 'faces':
      return 'Describe any faces visible in this image, including expressions, approximate age range, and any distinguishing features. Do not attempt to identify specific individuals.';
    case 'colors':
      return 'Analyze the color palette of this image. List the dominant colors, their approximate percentages, and describe the overall color mood/tone.';
    case 'custom':
      return question ?? 'Describe this image.';
    default:
      return 'Describe this image.';
  }
}

function getStyleDescription(style: string): string {
  const desc: Record<string, string> = {
    artistic: 'artistic painting style, oil painting texture',
    cartoon: 'cartoon style, animated, vibrant colors',
    sketch: 'pencil sketch, hand-drawn, black and white',
    'digital-art': 'digital art, clean lines, modern illustration',
    '3d-render': '3D rendered, realistic lighting, CGI quality',
    anime: 'anime style, Japanese animation, cel-shaded',
    photography: 'professional photography, high resolution, detailed',
  };
  return desc[style] ?? '';
}

// ============================================================================
// analyze_image Override
// ============================================================================

const analyzeImageOverride: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const task = (params.task as string) || 'describe';
  const question = params.question as string | undefined;
  const detailLevel = (params.detailLevel as string) || 'medium';
  const maxTokens = (params.maxTokens as number) || 2048;

  try {
    // --- Validate & prepare image data ---
    let imageBase64: string;
    let mediaType: ImageMediaType;
    let isUrl = false;

    if (source.startsWith('http://') || source.startsWith('https://')) {
      // URL source — pass as URL, let provider handle it
      const format = getFormatFromUrl(source);
      if (format !== 'unknown' && !SUPPORTED_FORMATS.includes(format)) {
        return {
          content: {
            error: `Unsupported image format: ${format}`,
            supportedFormats: SUPPORTED_FORMATS,
          },
          isError: true,
        };
      }
      imageBase64 = source;
      mediaType = getMimeType(format !== 'unknown' ? format : 'jpeg');
      isUrl = true;
    } else if (source.startsWith('data:image/')) {
      // Base64 data URI
      const match = source.match(/data:image\/(\w+);base64,(.+)/);
      if (!match) return { content: { error: 'Invalid base64 image data' }, isError: true };
      mediaType = getMimeType(match[1]!);
      imageBase64 = match[2]!;
    } else {
      // File path
      const fs = await import('node:fs/promises');
      const pathModule = await import('node:path');

      try {
        const stats = await fs.stat(source);
        if (stats.size > MAX_IMAGE_SIZE) {
          return {
            content: {
              error: `Image too large: ${Math.round(stats.size / 1024 / 1024)}MB (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`,
            },
            isError: true,
          };
        }
      } catch {
        return { content: { error: `Image file not found: ${source}` }, isError: true };
      }

      const ext = pathModule.extname(source).slice(1).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext)) {
        return {
          content: {
            error: `Unsupported image format: ${ext}`,
            supportedFormats: SUPPORTED_FORMATS,
          },
          isError: true,
        };
      }

      const buffer = await fs.readFile(source);
      mediaType = getMimeType(ext);
      imageBase64 = buffer.toString('base64');
    }

    // --- Resolve provider ---
    const { provider: resolvedProvider, model: resolvedModel } =
      await resolveDefaultProviderAndModel('default', 'default');
    if (!resolvedProvider) {
      return {
        content: {
          error: 'No AI provider configured. Set up a provider in Settings to use image analysis.',
        },
        isError: true,
      };
    }

    const apiKey = await getProviderApiKey(resolvedProvider);
    if (!apiKey) {
      return {
        content: { error: `API key not configured for provider: ${resolvedProvider}` },
        isError: true,
      };
    }

    const config = loadProviderConfig(resolvedProvider);
    const providerType = NATIVE_PROVIDERS.has(resolvedProvider) ? resolvedProvider : 'openai';
    const provider = createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl: config?.baseUrl,
      headers: config?.headers,
    });

    // --- Build vision request ---
    const analysisPrompt = buildAnalysisPrompt(task, detailLevel, question);

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: analysisPrompt },
          { type: 'image' as const, data: imageBase64, mediaType, isUrl },
        ],
      },
    ];

    const result = await provider.complete({
      messages,
      model: {
        model: resolvedModel ?? 'gpt-4o',
        maxTokens,
        temperature: 0.3,
      },
    });

    if (!result.ok) {
      return { content: { error: `Vision API error: ${result.error.message}` }, isError: true };
    }

    return {
      content: {
        success: true,
        analysis: result.value.content,
        task,
        detailLevel,
        provider: resolvedProvider,
        model: resolvedModel,
      },
      isError: false,
    };
  } catch (error) {
    return {
      content: { error: `Failed to analyze image: ${getErrorMessage(error)}` },
      isError: true,
    };
  }
};

// ============================================================================
// generate_image Override — Provider-Agnostic
// ============================================================================

interface ImageGenResult {
  base64: string;
  revisedPrompt?: string;
}

async function callOpenAIImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  size: string,
  quality: string,
  n: number
): Promise<ImageGenResult[]> {
  const url = `${baseUrl}/v1/images/generations`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
    body: JSON.stringify({
      prompt,
      model: model || 'dall-e-3',
      size,
      quality,
      n,
      response_format: 'b64_json',
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI Image API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  return (data.data ?? []).map((d) => ({
    base64: d.b64_json ?? '',
    revisedPrompt: d.revised_prompt,
  }));
}

async function callStabilityImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  n: number
): Promise<ImageGenResult[]> {
  const engineId = model || 'stable-diffusion-xl-1024-v1-0';
  const url = `${baseUrl}/v1/generation/${engineId}/text-to-image`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
    body: JSON.stringify({
      text_prompts: [{ text: prompt, weight: 1 }],
      cfg_scale: 7,
      width,
      height,
      samples: n,
      steps: 30,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stability API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as { artifacts?: Array<{ base64?: string }> };
  return (data.artifacts ?? []).map((a) => ({ base64: a.base64 ?? '' }));
}

async function callFalImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  size: string,
  n: number
): Promise<ImageGenResult[]> {
  const url = `${baseUrl}/${model || 'fal-ai/flux-pro'}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
    body: JSON.stringify({ prompt, image_size: size, num_images: n }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`FAL API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as { images?: Array<{ url: string }> };
  // FAL returns URLs — download to base64
  const results: ImageGenResult[] = [];
  for (const img of data.images ?? []) {
    // SECURITY (SSRF-001): img.url comes from the provider's JSON response and
    // must not be fetched with bare fetch() — a spoofed/compromised response
    // could point at 169.254.169.254 or other internal addresses.
    const imgResp = await safeFetch(img.url);
    const buffer = Buffer.from(await imgResp.arrayBuffer());
    results.push({ base64: buffer.toString('base64') });
  }
  return results;
}

async function callReplicateImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  n: number
): Promise<ImageGenResult[]> {
  const url = `${baseUrl}/v1/predictions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
    body: JSON.stringify({
      model: model || 'black-forest-labs/flux-schnell',
      input: { prompt, width, height, num_outputs: n },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Replicate API ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as { output: string[] };
  const results: ImageGenResult[] = [];
  for (const imgUrl of data.output ?? []) {
    // SECURITY (SSRF-001): imgUrl comes from the provider response — fetch via
    // the SSRF guard, not bare fetch().
    const imgResp = await safeFetch(imgUrl);
    const buffer = Buffer.from(await imgResp.arrayBuffer());
    results.push({ base64: buffer.toString('base64') });
  }
  return results;
}

/**
 * Pollinations. Without a key: the legacy anonymous API (watermarked, low-res,
 * ~1 image / 45 s per IP). With a key: gen.pollinations.ai, which spends the
 * account's pollen (free-tier models such as `flux` cost fractions of a pollen).
 */
async function callPollinationsImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  n: number
): Promise<ImageGenResult[]> {
  const results: ImageGenResult[] = [];
  for (let i = 0; i < n; i++) {
    const query = new URLSearchParams({
      width: String(width),
      height: String(height),
      model: model || 'flux',
      nologo: 'true',
      seed: String(Math.floor(Math.random() * 1e9)),
    });
    const endpoint = apiKey
      ? `${baseUrl || 'https://gen.pollinations.ai'}/image/`
      : `${baseUrl || 'https://image.pollinations.ai'}/prompt/`;
    const response = await fetch(`${endpoint}${encodeURIComponent(prompt)}?${query}`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pollinations API ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!response.headers.get('content-type')?.startsWith('image/')) {
      throw new Error('Pollinations API returned no image');
    }
    results.push({ base64: Buffer.from(await response.arrayBuffer()).toString('base64') });
  }
  return results;
}

/** OpenRouter serves image models through chat completions; images come back as data URLs. */
async function callOpenRouterImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  n: number
): Promise<ImageGenResult[]> {
  const results: ImageGenResult[] = [];
  for (let i = 0; i < n; i++) {
    const response = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
      body: JSON.stringify({
        model: model || 'google/gemini-2.5-flash-image',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: nearestAspectRatio(width, height) },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter API ${response.status}: ${text.slice(0, 500)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    };
    for (const img of data.choices?.[0]?.message?.images ?? []) {
      const match = img.image_url?.url?.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
      if (match) results.push({ base64: match[1]! });
    }
  }
  return results;
}

const KREA_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

function nearestAspectRatio(width: number, height: number): string {
  const target = width / height;
  return KREA_ASPECT_RATIOS.reduce((best, r) => {
    const [w, h] = r.split(':').map(Number) as [number, number];
    const [bw, bh] = best.split(':').map(Number) as [number, number];
    return Math.abs(w / h - target) < Math.abs(bw / bh - target) ? r : best;
  });
}
const KREA_POLL_MS = 2000;

/** Krea is job-based: submit, then poll GET /jobs/{id} until it settles. */
async function callKreaImageGen(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  n: number
): Promise<ImageGenResult[]> {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const aspect_ratio = nearestAspectRatio(width, height);
  const deadline = Date.now() + IMAGE_GEN_TIMEOUT_MS;
  const timedOut = () => Object.assign(new Error('timeout'), { name: 'TimeoutError' });

  const results: ImageGenResult[] = [];
  // One job per image; Krea returns a single image per job.
  for (let i = 0; i < n; i++) {
    const submit = await fetch(`${baseUrl}/generate/image/${model || 'krea/krea-3'}`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
      body: JSON.stringify({ prompt, aspect_ratio, resolution: '1K' }),
    });
    if (!submit.ok) {
      const text = await submit.text();
      throw new Error(`Krea API ${submit.status}: ${text.slice(0, 500)}`);
    }
    const { job_id } = (await submit.json()) as { job_id?: string };
    if (!job_id) throw new Error('Krea API returned no job_id');

    let urls: string[] = [];
    for (;;) {
      if (Date.now() + KREA_POLL_MS > deadline) throw timedOut();
      await new Promise((r) => setTimeout(r, KREA_POLL_MS));
      const poll = await fetch(`${baseUrl}/jobs/${encodeURIComponent(job_id)}`, {
        headers,
        signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)),
      });
      if (!poll.ok) {
        const text = await poll.text();
        throw new Error(`Krea API ${poll.status}: ${text.slice(0, 500)}`);
      }
      const job = (await poll.json()) as {
        status?: string;
        result?: { urls?: string[] };
        error?: { code?: string; message?: string };
      };
      if (job.status === 'completed') {
        urls = job.result?.urls ?? [];
        break;
      }
      if (job.status === 'failed' || job.status === 'cancelled') {
        throw new Error(
          `Krea job ${job.status}: ${job.error?.message ?? job.error?.code ?? 'no reason given'}`
        );
      }
    }

    for (const imgUrl of urls) {
      // SECURITY (SSRF-001): result URLs come from the provider — fetch via the SSRF guard.
      const imgResp = await safeFetch(imgUrl);
      results.push({ base64: Buffer.from(await imgResp.arrayBuffer()).toString('base64') });
    }
  }
  return results;
}

/** File extension from the image's magic bytes; providers differ (Pollinations returns JPEG). */
function imageExtension(base64: string): string {
  if (base64.startsWith('/9j/')) return 'jpg';
  if (base64.startsWith('UklGR')) return 'webp';
  return 'png';
}

function parseSizeToDimensions(size: string): { width: number; height: number } {
  const match = size.match(/(\d+)x(\d+)/);
  if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) };
  return { width: 1024, height: 1024 };
}

const generateImageOverride: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const prompt = params.prompt as string;
  const style = (params.style as string) || 'realistic';
  const size = (params.size as string) || '1024x1024';
  const quality = (params.quality as string) || 'standard';
  const outputPath = params.outputPath as string | undefined;
  const n = Math.min(Math.max((params.n as number) || 1, 1), 4);

  // --- Validate prompt ---
  if (!prompt?.trim()) {
    return { content: { error: 'Prompt is required for image generation' }, isError: true };
  }
  if (prompt.length > 4000) {
    return { content: { error: 'Prompt too long. Maximum 4000 characters.' }, isError: true };
  }

  // Hoisted so the catch block can scrub the key out of provider error text.
  let apiKey: string | undefined;

  try {
    // --- Read config (server-side only; the key never leaves this function) ---
    const config = getConfigCenter();
    const providerType = config.getFieldValue(IMAGE_GEN_SERVICE, 'provider_type') as
      string | undefined;
    apiKey = config.getFieldValue(IMAGE_GEN_SERVICE, 'api_key') as string | undefined;
    const baseUrl = config.getFieldValue(IMAGE_GEN_SERVICE, 'base_url') as string | undefined;
    const model = config.getFieldValue(IMAGE_GEN_SERVICE, 'model') as string | undefined;
    // OpenRouter can reuse the chat provider's key, so it needn't be entered twice.
    if (providerType === 'openrouter' && !apiKey) {
      apiKey = await getProviderApiKey('openrouter');
    }

    // Pollinations is free and works without a key.
    if (providerType === 'pollinations') apiKey ??= '';

    if (!providerType || apiKey === undefined || (!apiKey && providerType !== 'pollinations')) {
      return {
        content: {
          error:
            'Image generation not configured. Go to Settings → Config Center → Image Generation and set provider_type + api_key.',
        },
        isError: true,
      };
    }

    // --- Resolve where images go; outputPath must stay inside the workspace ---
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workDir = context.workspaceDir || '.';
    const imagesDir = path.join(workDir, 'generated_images');

    let customPath: string | undefined;
    if (outputPath) {
      customPath = path.isAbsolute(outputPath) ? outputPath : path.join(workDir, outputPath);
      const rel = path.relative(workDir, customPath);
      if (!rel || /^\.\.([\\/]|$)/.test(rel) || path.isAbsolute(rel)) {
        return {
          content: { error: 'outputPath must be a file inside the workspace' },
          isError: true,
        };
      }
    }

    // Enhance prompt with style
    const enhancedPrompt =
      style !== 'realistic' ? `${prompt}, ${getStyleDescription(style)}` : prompt;

    const { width, height } = parseSizeToDimensions(size);

    // --- Call provider ---
    let results: ImageGenResult[];
    const resolvedBaseUrl = baseUrl || getDefaultBaseUrl(providerType);

    switch (providerType) {
      case 'openai':
      case 'openai-compatible':
        results = await callOpenAIImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          size,
          quality,
          n
        );
        break;
      case 'stability':
        results = await callStabilityImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          width,
          height,
          n
        );
        break;
      case 'fal':
        results = await callFalImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          size,
          n
        );
        break;
      case 'replicate':
        results = await callReplicateImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          width,
          height,
          n
        );
        break;
      case 'pollinations':
        results = await callPollinationsImageGen(
          apiKey,
          baseUrl ?? '',
          model ?? '',
          enhancedPrompt,
          width,
          height,
          n
        );
        break;
      case 'openrouter':
        results = await callOpenRouterImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          width,
          height,
          n
        );
        break;
      case 'krea':
        results = await callKreaImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          width,
          height,
          n
        );
        break;
      default:
        // Assume OpenAI-compatible for unknown providers
        results = await callOpenAIImageGen(
          apiKey,
          resolvedBaseUrl,
          model ?? '',
          enhancedPrompt,
          size,
          quality,
          n
        );
    }

    // Providers can answer 200 with an empty or partial payload; keep only real image data.
    results = results.filter((r) => typeof r.base64 === 'string' && r.base64.length > 0);
    if (!results.length) {
      return {
        content: { error: 'No images generated (the provider returned no image data)' },
        isError: true,
      };
    }

    // --- Save to workspace ---
    await fs.mkdir(imagesDir, { recursive: true });

    const savedImages: Array<{ path: string; size: number; revisedPrompt?: string }> = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const filename =
        customPath && results.length === 1
          ? customPath
          : path.join(imagesDir, `image_${Date.now()}_${i}.${imageExtension(result.base64)}`);

      const dir = path.dirname(filename);
      await fs.mkdir(dir, { recursive: true });

      const buffer = Buffer.from(result.base64, 'base64');
      await fs.writeFile(filename, buffer);

      const stats = await fs.stat(filename);
      savedImages.push({ path: filename, size: stats.size, revisedPrompt: result.revisedPrompt });
    }

    // Build markdown for display (use relative paths so UI resolveImageUrl() works)
    const relativePaths = savedImages.map((img) =>
      path.relative(workDir, img.path).replace(/\\/g, '/')
    );
    const markdown = relativePaths.map((p) => `![Generated image](${p})`).join('\n');

    return {
      content: {
        success: true,
        // The chat tool card previews `output` (ToolExecutionDisplay isImageToolResult).
        output: relativePaths[0],
        images: savedImages,
        prompt: enhancedPrompt,
        originalPrompt: prompt,
        style,
        size,
        provider: providerType,
        model: model ?? 'default',
        markdown,
      },
      isError: false,
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? `the image provider did not respond within ${IMAGE_GEN_TIMEOUT_MS / 1000}s`
        : getErrorMessage(error);
    const safeReason = apiKey ? reason.split(apiKey).join('[redacted]') : reason;
    return {
      content: { error: `Failed to generate image: ${safeReason}` },
      isError: true,
    };
  }
};

function getDefaultBaseUrl(providerType: string): string {
  switch (providerType) {
    case 'openai':
      return 'https://api.openai.com';
    case 'stability':
      return 'https://api.stability.ai';
    case 'fal':
      return 'https://fal.run';
    case 'replicate':
      return 'https://api.replicate.com';
    case 'krea':
      return 'https://api.krea.ai';
    case 'openrouter':
      return 'https://openrouter.ai';
    default:
      return 'https://api.openai.com';
  }
}

// ============================================================================
// Registration
// ============================================================================

export async function registerImageOverrides(registry: ToolRegistry): Promise<void> {
  applyImageOverrides(registry);

  // Register the image_generation Config Center service (async, non-blocking)
  ensureImageGenService().catch((err) => log.debug('ensureImageGenService:', getErrorMessage(err)));
}

/**
 * Swap the core placeholder executors for the real ones on any registry.
 *
 * Chat agents and autonomous runners build their own ToolRegistry instead of
 * using the shared one, and `use_tool` executes against that per-agent registry,
 * so each of them must apply this too or the model gets the core stub back.
 */
export function applyImageOverrides(registry: ToolRegistry): void {
  // Override analyze_image executor
  const analyzeName = 'analyze_image';
  if (registry.updateExecutor(analyzeName, analyzeImageOverride)) {
    log.info(`Overrode ${analyzeName} with vision API implementation`);
  } else {
    // Try with qualified name
    if (registry.updateExecutor(`core.${analyzeName}`, analyzeImageOverride)) {
      log.info(`Overrode core.${analyzeName} with vision API implementation`);
    }
  }

  // Override generate_image executor
  const genName = 'generate_image';
  if (registry.updateExecutor(genName, generateImageOverride)) {
    log.info(`Overrode ${genName} with provider-agnostic implementation`);
  } else {
    if (registry.updateExecutor(`core.${genName}`, generateImageOverride)) {
      log.info(`Overrode core.${genName} with provider-agnostic implementation`);
    }
  }
}
