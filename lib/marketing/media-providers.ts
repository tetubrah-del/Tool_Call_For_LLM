export type MediaChannel = "x" | "tiktok";

export type ProviderKind = "seedream" | "seedance" | "fallback";

export type GenerationStatus = "queued" | "processing" | "succeeded" | "failed";

export type MediaAssetKind = "image" | "video";

export type MediaGenerationErrorCode =
  | "bad_request"
  | "unauthorized"
  | "rate_limited"
  | "provider_unavailable"
  | "content_policy_violation"
  | "timeout"
  | "unknown";

export class MediaProviderError extends Error {
  code: MediaGenerationErrorCode;
  retryable: boolean;
  providerMessage?: string;

  constructor(
    code: MediaGenerationErrorCode,
    message: string,
    options?: { retryable?: boolean; providerMessage?: string }
  ) {
    super(message);
    this.name = "MediaProviderError";
    this.code = code;
    this.retryable = Boolean(options?.retryable);
    this.providerMessage = options?.providerMessage;
  }
}

export type GenerationContext = {
  traceId: string;
  campaignId?: string;
  briefId?: string;
  contentId?: string;
  channel: MediaChannel;
  locale: "ja" | "en";
};

export type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  referenceImageUrl?: string;
  stylePreset?: string;
  outputFormat?: "png" | "jpg" | "webp";
};

export type ImageGenerationResult = {
  provider: ProviderKind;
  model: string;
  assetType: "image";
  sourcePrompt: string;
  seed?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  outputUrl: string;
  thumbUrl?: string;
  latencyMs: number;
  costJpy?: number;
  rawResponseJson?: string;
};

export type VideoGenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  durationSec?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  fps?: number;
  resolution?: "540p" | "720p" | "1080p";
  seed?: number;
  referenceImageUrl?: string;
  referenceVideoUrl?: string;
  referenceAudioUrl?: string;
};

export type VideoGenerationResult = {
  provider: ProviderKind;
  model: string;
  assetType: "video";
  sourcePrompt: string;
  seed?: number;
  durationSec?: number;
  fps?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  outputUrl: string;
  posterUrl?: string;
  latencyMs: number;
  costJpy?: number;
  rawResponseJson?: string;
};

export interface ImageProvider {
  readonly provider: ProviderKind;
  readonly model: string;
  generateImage(input: ImageGenerationRequest, ctx: GenerationContext): Promise<ImageGenerationResult>;
}

export interface VideoProvider {
  readonly provider: ProviderKind;
  readonly model: string;
  generateVideo(input: VideoGenerationRequest, ctx: GenerationContext): Promise<VideoGenerationResult>;
}

export type ProviderRegistry = {
  image: ImageProvider;
  video: VideoProvider;
};

export type ProviderConfig = {
  seedream?: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs?: number;
  };
  seedance?: {
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs?: number;
  };
};

function assertConfigured(value: string | undefined, name: string) {
  if (!value || !value.trim()) {
    throw new MediaProviderError("bad_request", `${name} is required`, { retryable: false });
  }
}

// Skeleton adapter for Seedream 2.0 image generation.
export class SeedreamImageProvider implements ImageProvider {
  readonly provider: ProviderKind = "seedream";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: NonNullable<ProviderConfig["seedream"]>) {
    assertConfigured(config.apiKey, "seedream.apiKey");
    assertConfigured(config.baseUrl, "seedream.baseUrl");
    assertConfigured(config.model, "seedream.model");
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  async generateImage(
    input: ImageGenerationRequest,
    _ctx: GenerationContext
  ): Promise<ImageGenerationResult> {
    const startedAt = Date.now();
    const payload = {
      model: this.model,
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      width: input.width,
      height: input.height,
      seed: input.seed,
      reference_image_url: input.referenceImageUrl,
      style_preset: input.stylePreset,
      output_format: input.outputFormat ?? "png"
    };

    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new MediaProviderError(
        response.status === 429 ? "rate_limited" : "provider_unavailable",
        `seedream request failed with status ${response.status}`,
        { retryable: response.status >= 500 || response.status === 429, providerMessage: raw }
      );
    }

    const data = JSON.parse(raw) as {
      data?: Array<{ url?: string; thumb_url?: string; width?: number; height?: number; mime_type?: string }>;
      seed?: number;
      cost_jpy?: number;
    };
    const item = data.data?.[0];
    if (!item?.url) {
      throw new MediaProviderError("unknown", "seedream response missing output URL", {
        retryable: false,
        providerMessage: raw
      });
    }

    return {
      provider: this.provider,
      model: this.model,
      assetType: "image",
      sourcePrompt: input.prompt,
      seed: data.seed ?? input.seed,
      width: item.width,
      height: item.height,
      mimeType: item.mime_type,
      outputUrl: item.url,
      thumbUrl: item.thumb_url,
      latencyMs: Date.now() - startedAt,
      costJpy: data.cost_jpy,
      rawResponseJson: raw
    };
  }
}

// Skeleton adapter for Seedance 2.0 video generation.
export class SeedanceVideoProvider implements VideoProvider {
  readonly provider: ProviderKind = "seedance";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: NonNullable<ProviderConfig["seedance"]>) {
    assertConfigured(config.apiKey, "seedance.apiKey");
    assertConfigured(config.baseUrl, "seedance.baseUrl");
    assertConfigured(config.model, "seedance.model");
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 120000;
  }

  async generateVideo(
    input: VideoGenerationRequest,
    _ctx: GenerationContext
  ): Promise<VideoGenerationResult> {
    const startedAt = Date.now();
    const payload = {
      model: this.model,
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      duration_sec: input.durationSec ?? 15,
      aspect_ratio: input.aspectRatio ?? "9:16",
      fps: input.fps ?? 24,
      resolution: input.resolution ?? "720p",
      seed: input.seed,
      reference_image_url: input.referenceImageUrl,
      reference_video_url: input.referenceVideoUrl,
      reference_audio_url: input.referenceAudioUrl
    };

    const response = await fetch(`${this.baseUrl}/videos/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new MediaProviderError(
        response.status === 429 ? "rate_limited" : "provider_unavailable",
        `seedance request failed with status ${response.status}`,
        { retryable: response.status >= 500 || response.status === 429, providerMessage: raw }
      );
    }

    const data = JSON.parse(raw) as {
      data?: Array<{
        url?: string;
        poster_url?: string;
        width?: number;
        height?: number;
        duration_sec?: number;
        fps?: number;
        mime_type?: string;
      }>;
      seed?: number;
      cost_jpy?: number;
    };
    const item = data.data?.[0];
    if (!item?.url) {
      throw new MediaProviderError("unknown", "seedance response missing output URL", {
        retryable: false,
        providerMessage: raw
      });
    }

    return {
      provider: this.provider,
      model: this.model,
      assetType: "video",
      sourcePrompt: input.prompt,
      seed: data.seed ?? input.seed,
      durationSec: item.duration_sec,
      fps: item.fps,
      width: item.width,
      height: item.height,
      mimeType: item.mime_type,
      outputUrl: item.url,
      posterUrl: item.poster_url,
      latencyMs: Date.now() - startedAt,
      costJpy: data.cost_jpy,
      rawResponseJson: raw
    };
  }
}

export function buildProviderRegistry(config: ProviderConfig): ProviderRegistry {
  if (!config.seedream) {
    throw new MediaProviderError("bad_request", "seedream config is required", { retryable: false });
  }
  if (!config.seedance) {
    throw new MediaProviderError("bad_request", "seedance config is required", { retryable: false });
  }

  return {
    image: new SeedreamImageProvider(config.seedream),
    video: new SeedanceVideoProvider(config.seedance)
  };
}
