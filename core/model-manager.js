// ============================================================
// Model Manager — WebLLM local inference
// Manages model lifecycle: load, generate, stream, stop, unload
// ============================================================

/**
 * ModelProvider interface — any model backend must implement:
 *   initialize(onProgress) → Promise<void>
 *   generate(prompt, options) → Promise<string>
 *   generateStream(prompt, options, onChunk, onDone) → Promise<void>
 *   stop() → void
 *   getCapabilities() → object
 *   unload() → Promise<void>
 */

import { saveModelCacheState, loadModelCacheState } from "../storage/indexeddb.js";

// ── Protocol / Context Checks ─────────────────────────────────
export function detectProtocol() {
  const protocol = window.location.protocol;
  const isFileProtocol = protocol === "file:";
  const isSecure = window.isSecureContext === true;
  const isHTTP  = protocol === "http:" || protocol === "https:";
  return { protocol, isFileProtocol, isSecure, isHTTP };
}

// ── WebGPU Detection ──────────────────────────────────────────
// Returns a detailed result object — never throws.
export async function detectWebGPU() {
  // Step 0: file:// protocol → not a secure context, GPU won't work
  const { isFileProtocol } = detectProtocol();
  if (isFileProtocol) {
    return {
      available: false,
      stage: "insecure-context",
      reason: "file:// protocol is not a secure context — WebGPU requires HTTPS"
    };
  }

  // Step 1: Secure context check (WebGPU requires HTTPS)
  if (!window.isSecureContext) {
    return {
      available: false,
      stage: "insecure-context",
      reason: "Not a secure context (HTTPS required for WebGPU)"
    };
  }

  // Step 2: navigator.gpu existence check
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return {
      available: false,
      stage: "no-api",
      reason: "navigator.gpu not present — WebGPU not supported in this browser"
    };
  }

  // Step 3: requestAdapter + requestDevice, with hard 8-second timeout
  const TIMEOUT_MS = 8000;

  const gpuProbe = (async () => {
    // requestAdapter
    let adapter;
    try {
      adapter = await navigator.gpu.requestAdapter();
    } catch (err) {
      return { available: false, stage: "adapter-error", reason: `requestAdapter threw: ${err.message}` };
    }
    if (!adapter) {
      return { available: false, stage: "no-adapter", reason: "requestAdapter() returned null — no compatible GPU adapter" };
    }

    // requestDevice
    let device;
    try {
      device = await adapter.requestDevice();
    } catch (err) {
      return { available: false, stage: "device-error", reason: `requestDevice threw: ${err.message}` };
    }
    if (!device) {
      return { available: false, stage: "no-device", reason: "requestDevice() returned null" };
    }

    device.destroy();
    return { available: true, stage: "ready" };
  })();

  const timeoutGuard = new Promise(resolve =>
    setTimeout(() =>
      resolve({ available: false, stage: "timeout", reason: "WebGPU detection timed out after 8s" }),
      TIMEOUT_MS
    )
  );

  return Promise.race([gpuProbe, timeoutGuard]);
}

// ── Device Capability Detection ───────────────────────────────
export function detectDeviceCapabilities() {
  const mem = navigator.deviceMemory || null;
  const cores = navigator.hardwareConcurrency || null;
  const mobile = /Mobi|Android/i.test(navigator.userAgent);
  const wasm = typeof WebAssembly !== "undefined";

  // Recommend model tier based on device memory
  let modelTier = "small";
  if (mem >= 8)  modelTier = "medium";
  if (mem >= 16) modelTier = "large";

  return { mem, cores, mobile, wasm, modelTier };
}

// ── Model Configurations ──────────────────────────────────────
const MODEL_CONFIGS = {
  "Llama-3.2-3B-Instruct-q4f16_1-MLC": {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B (Recommended)",
    tier: "medium",
    contextLength: 4096,
    webgpuRequired: true
  },
  "Phi-3.5-mini-instruct-q4f16_1-MLC": {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 Mini (Efficient)",
    tier: "small",
    contextLength: 4096,
    webgpuRequired: false
  },
  "Llama-3.1-8B-Instruct-q4f16_1-MLC": {
    id: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    label: "Llama 3.1 8B (High Quality)",
    tier: "large",
    contextLength: 8192,
    webgpuRequired: true
  },
  "gemma-2-2b-it-q4f16_1-MLC": {
    id: "gemma-2-2b-it-q4f16_1-MLC",
    label: "Gemma 2 2B (Fast)",
    tier: "small",
    contextLength: 4096,
    webgpuRequired: false
  }
};

export function getModelConfigs() { return MODEL_CONFIGS; }

// ── Inference engine CDN URLs ─────────────────────────────────
// WebLLM — WebGPU accelerated, requires GPU adapter
const WEBLLM_ESM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";
// Transformers.js — CPU/WASM fallback, no WebGPU needed
const TRANSFORMERS_ESM_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/+esm";

// ── CPU-fallback model (Transformers.js ONNX) ─────────────────
// Qwen2.5-0.5B-Instruct: ~375 MB q4 ONNX.
// 0.5B parameters with a 32768-token context window; materially more
// coherent on complex prompts while still running purely on WASM/CPU
// via ONNX Runtime Web — no WebGPU needed.
// The previous 135M model collapsed under prompt pressure (only 2048
// context tokens; budget was set to 4096; overflow → garbled output).
const CPU_MODEL_ID    = "Qwen/Qwen2.5-0.5B-Instruct";
const CPU_MODEL_LABEL = "Qwen2.5 0.5B (CPU fallback)";

// ── CPU model context window (tokens) ────────────────────────
// Qwen2.5-0.5B-Instruct supports 32768 tokens; we cap it conservatively
// at 4096 for WASM/mobile — large enough for Shadow Reaper's full
// system prompt without overflow, small enough for mobile RAM.
const CPU_CONTEXT_SIZE = 4096;

// ── WebLLM Provider ───────────────────────────────────────────
export class WebLLMProvider {
  constructor(modelId) {
    this._modelId  = modelId;
    this._engine   = null;
    this._loaded   = false;
    this._loading  = false;
    this._stopFlag = false;
    this._config   = MODEL_CONFIGS[modelId];
    if (!this._config) throw new Error(`Unknown model: ${modelId}`);

    // Single authoritative initialization promise — prevents duplicate inits
    // and lets concurrent callers safely await the same operation.
    this._initPromise = null;
  }

  async initialize(onProgress) {
    if (this._loaded) return;

    // If initialization is already running, return the same promise so
    // all concurrent callers wait for the single ongoing operation.
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInitialize(onProgress);
    try {
      await this._initPromise;
    } finally {
      // Keep _initPromise set so late arrivals can still await it and
      // get the resolved/rejected result immediately.
    }
  }

  async _doInitialize(onProgress) {
    this._loading = true;

    try {
      // Import WebLLM from the direct jsDelivr ESM URL (no redirect)
      onProgress?.({ stage: "engine-load", message: "Loading inference engine...", percent: 3 });

      let webllm;
      try {
        webllm = await import(WEBLLM_ESM_URL);
      } catch (err) {
        throw new Error(`ENGINE_LOAD_FAILED: Could not import WebLLM from CDN. ${err.message}`);
      }

      // Verify we have both creation paths available
      const hasCreate = typeof webllm.CreateMLCEngine === "function";
      const hasEngine = typeof webllm.MLCEngine === "function";
      if (!hasCreate && !hasEngine) {
        throw new Error(`ENGINE_LOAD_FAILED: WebLLM imported but neither MLCEngine nor CreateMLCEngine found`);
      }

      onProgress?.({ stage: "model-download", message: `Initializing ${this._config.label}...`, percent: 5 });

      try {
        // ── Explicit two-step initialization: new MLCEngine() then reload() ──
        // CreateMLCEngine() is a convenience wrapper that can return the engine
        // object before the internal reload() promise fully resolves on some
        // browsers/devices (notably Android Chrome and GitHub Pages).
        // Using explicit MLCEngine + reload() guarantees the model is ready
        // for inference before we set this._loaded = true.
        if (hasEngine) {
          this._engine = new webllm.MLCEngine({
            initProgressCallback: (report) => {
              const percent = Math.round((report.progress || 0) * 100);
              onProgress?.({
                stage: "model-download",
                message: report.text || `Loading model... ${percent}%`,
                percent: Math.max(5, percent)
              });
            }
          });
          // Explicit reload() — this is the call the error message refers to.
          // Awaiting it ensures the model is fully loaded before we continue.
          await this._engine.reload(this._modelId);

          // ── Post-reload readiness verification ──────────────────────────────
          // WebLLM 0.2.85: reload() can return without throwing when the
          // internal loading is aborted (e.g. AbortError from a network
          // interruption or CDN timeout).  In that case loadedModelIdToPipeline
          // remains empty — inference would then throw ModelNotLoadedError and
          // report a false ONLINE state.
          // We verify the pipeline map directly; if the model is missing we
          // raise a proper error so _loaded is never set to true on an unloaded engine.
          const loadedIds = this._engine.loadedModelIdToPipeline
            ? Array.from(this._engine.loadedModelIdToPipeline.keys())
            : null;
          if (!loadedIds || !loadedIds.includes(this._modelId)) {
            throw new Error(
              `MODEL_INIT_FAILED: reload() completed but model '${this._modelId}' ` +
              `is not in the engine's pipeline map (loadedIds=[${(loadedIds || []).join(",")}]). ` +
              `This usually means the model download was silently aborted (network error, CDN timeout, ` +
              `or AbortError). Check your network connection and try again.`
            );
          }
        } else {
          // Fallback: CreateMLCEngine (older WebLLM builds without MLCEngine export)
          this._engine = await webllm.CreateMLCEngine(
            this._modelId,
            {
              initProgressCallback: (report) => {
                const percent = Math.round((report.progress || 0) * 100);
                onProgress?.({
                  stage: "model-download",
                  message: report.text || `Loading model... ${percent}%`,
                  percent: Math.max(5, percent)
                });
              }
            }
          );

          // Post-init verification for CreateMLCEngine path
          const loadedIds = this._engine.loadedModelIdToPipeline
            ? Array.from(this._engine.loadedModelIdToPipeline.keys())
            : null;
          if (!loadedIds || !loadedIds.includes(this._modelId)) {
            throw new Error(
              `MODEL_INIT_FAILED: CreateMLCEngine() completed but model '${this._modelId}' ` +
              `is not in the engine's pipeline map. Model may not have loaded correctly.`
            );
          }
        }
      } catch (err) {
        // Classify the download/init error more precisely
        const msg = err.message || "";
        if (msg.startsWith("MODEL_INIT_FAILED")) {
          throw err;  // Already classified — re-throw as-is
        }
        if (msg.includes("fetch") || msg.includes("network") || msg.includes("404")) {
          throw new Error(`MODEL_DOWNLOAD_FAILED: ${msg}`);
        }
        if (msg.includes("WebGPU") || msg.includes("GPU") || msg.includes("adapter")) {
          throw new Error(`WEBGPU_INIT_FAILED: ${msg}`);
        }
        if (msg.includes("out of memory") || msg.includes("OOM")) {
          throw new Error(`MODEL_OOM: Not enough GPU/system memory. ${msg}`);
        }
        if (msg.includes("Cannot find model") || msg.includes("ModelNotFoundError")) {
          throw new Error(`MODEL_INIT_FAILED: Model ID '${this._modelId}' not found in WebLLM's prebuilt model registry. ${msg}`);
        }
        throw new Error(`MODEL_INIT_FAILED: ${msg}`);
      }

      // Only set _loaded AFTER the post-reload verification above confirms the
      // engine's pipeline map contains this._modelId.
      // This is the single authoritative gate: nothing may call generateStream
      // until this flag is true AND the pipeline map entry is confirmed present.
      this._loaded  = true;
      this._loading = false;

      await saveModelCacheState({
        modelId: this._modelId,
        loadedAt: Date.now(),
        status: "loaded"
      });

      onProgress?.({ stage: "ready", message: "Neural core online", percent: 100 });

    } catch (err) {
      this._loading     = false;
      this._initPromise = null;  // Allow retry after failure
      await saveModelCacheState({
        modelId: this._modelId,
        loadedAt: Date.now(),
        status: "error",
        error: err.message
      }).catch(() => {});
      throw err;  // Re-throw with classified message intact
    }
  }

  async generate(prompt, options = {}) {
    this._ensureLoaded();
    const response = await this._engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
      top_p: options.topP ?? 0.9
    });
    return response.choices[0]?.message?.content ?? "";
  }

  async generateStream(messages, options = {}, onChunk, onDone) {
    this._ensureLoaded();
    this._stopFlag = false;

    try {
      const stream = await this._engine.chat.completions.create({
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens:  options.maxTokens  ?? 2048,
        top_p:       options.topP       ?? 0.9,
        stream: true
      });

      let fullText = "";
      for await (const chunk of stream) {
        if (this._stopFlag) break;
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          fullText += delta;
          onChunk?.(delta, fullText);
        }
      }
      onDone?.(fullText, { stopped: this._stopFlag });
    } catch (err) {
      throw new Error(`Generation failed: ${err.message}`);
    }
  }

  stop() {
    this._stopFlag = true;
    try { this._engine?.interruptGenerate?.(); } catch (_) {}
  }

  getCapabilities() {
    return {
      modelId:       this._modelId,
      label:         this._config.label,
      contextLength: this._config.contextLength,
      loaded:        this._loaded,
      loading:       this._loading,
      webgpuRequired: this._config.webgpuRequired
    };
  }

  async unload() {
    if (this._engine) {
      try { await this._engine.unload?.(); } catch (_) {}
      this._engine = null;
    }
    this._loaded      = false;
    this._loading     = false;
    this._initPromise = null;  // Reset so re-initialization is permitted after unload
  }

  _ensureLoaded() {
    if (!this._loaded) throw new Error("Model not loaded");
  }
}

// ── Transformers.js CPU Provider ──────────────────────────────
// Uses ONNX Runtime Web — runs on CPU/WASM, no WebGPU required.
// Suitable for devices where WebGPU is unavailable (no SharedArrayBuffer needed).
export class TransformersJsProvider {
  constructor() {
    this._pipe         = null;
    this._TextStreamer  = null;
    this._loaded       = false;
    this._loading      = false;
    this._stopFlag     = false;
    this._modelId      = CPU_MODEL_ID;
    this._contextSize  = CPU_CONTEXT_SIZE;

    // Single authoritative initialization promise — same pattern as WebLLMProvider
    this._initPromise  = null;
  }

  async initialize(onProgress) {
    if (this._loaded) return;

    // If initialization is already running, return the same promise
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInitialize(onProgress);
    try {
      await this._initPromise;
    } finally {
      // Keep _initPromise set so late arrivals still await correctly
    }
  }

  async _doInitialize(onProgress) {
    this._loading = true;

    try {
      onProgress?.({ stage: "engine-load", message: "Loading CPU inference engine...", percent: 3 });

      let transformers;
      try {
        transformers = await import(TRANSFORMERS_ESM_URL);
      } catch (err) {
        throw new Error(`ENGINE_LOAD_FAILED: Could not import Transformers.js from CDN. ${err.message}`);
      }

      const { pipeline, env, TextStreamer } = transformers;

      if (typeof pipeline !== "function") {
        throw new Error("ENGINE_LOAD_FAILED: Transformers.js imported but pipeline() is not a function");
      }
      if (typeof TextStreamer !== "function") {
        throw new Error("ENGINE_LOAD_FAILED: Transformers.js imported but TextStreamer is not exported");
      }

      // ── Configure env BEFORE calling pipeline() ──────────────
      // env.backends.onnx starts as {} and is populated lazily by the
      // ONNX backend when it loads. We pre-set the wasm sub-config here.
      // numThreads=1: avoids SharedArrayBuffer (not available on GitHub Pages
      //   without COOP/COEP headers). Single-thread WASM is slower but works.
      // proxy=false: run WASM on main thread; no Worker needed (simpler).
      env.backends.onnx = {
        wasm: {
          numThreads: 1,
          proxy: false
        }
      };
      // Do not look for local models — we are in the browser
      env.allowLocalModels  = false;
      // Use browser Cache API to persist downloaded model files
      env.useBrowserCache   = true;

      this._TextStreamer = TextStreamer;

      onProgress?.({ stage: "model-download", message: `Loading ${CPU_MODEL_LABEL}...`, percent: 5 });

      try {
        // device: "cpu" is the correct Transformers.js v3 value for WASM/ONNX
        // ("wasm" is not a valid device string in v3.x and triggers undefined
        // fallback behaviour in some runtime versions)
        this._pipe = await pipeline("text-generation", CPU_MODEL_ID, {
          dtype:  "q4",
          device: "cpu",
          progress_callback: (info) => {
            if (info.status === "progress" && info.loaded != null && info.total != null) {
              const pct = Math.round((info.loaded / info.total) * 100);
              onProgress?.({
                stage:   "model-download",
                message: `Downloading ${info.file?.split("/").pop() || "model"}... ${pct}%`,
                percent: Math.max(5, pct)
              });
            } else if (info.status === "initiate") {
              onProgress?.({ stage: "model-download", message: `Fetching ${info.file?.split("/").pop() || "model files"}...`, percent: 5 });
            } else if (info.status === "done") {
              onProgress?.({ stage: "model-download", message: "Model files loaded, initializing...", percent: 95 });
            }
          }
        });
      } catch (err) {
        const msg = err.message || "";
        if (msg.includes("fetch") || msg.includes("network") || msg.includes("404") || msg.includes("Load model from")) {
          throw new Error(`MODEL_DOWNLOAD_FAILED: ${msg}`);
        }
        if (msg.includes("memory") || msg.includes("OOM") || msg.includes("allocation")) {
          throw new Error(`MODEL_OOM: Not enough memory for CPU model. ${msg}`);
        }
        if (msg.includes("SharedArrayBuffer") || msg.includes("cross-origin")) {
          throw new Error(`MODEL_INIT_FAILED: WASM thread error — SharedArrayBuffer unavailable. ${msg}`);
        }
        throw new Error(`MODEL_INIT_FAILED: ${msg}`);
      }

      this._loaded  = true;
      this._loading = false;

      await saveModelCacheState({
        modelId: this._modelId,
        loadedAt: Date.now(),
        status: "loaded"
      }).catch(() => {});

      onProgress?.({ stage: "ready", message: "Neural core online (CPU)", percent: 100 });

    } catch (err) {
      this._loading     = false;
      this._initPromise = null;  // Allow retry after failure
      await saveModelCacheState({
        modelId: this._modelId,
        loadedAt: Date.now(),
        status: "error",
        error: err.message
      }).catch(() => {});
      throw err;
    }
  }

  async generateStream(messages, options = {}, onChunk, onDone) {
    this._ensureLoaded();
    this._stopFlag = false;

    // Pass messages as a Chat array — the pipeline uses apply_chat_template
    // internally which handles Qwen2.5's chat format correctly.
    const chatMessages = messages.map(m => ({ role: m.role, content: m.content }));

    let fullText = "";

    try {
      const streamer = new this._TextStreamer(this._pipe.tokenizer, {
        skip_prompt:       true,
        skip_special_tokens: true,
        callback_function: (token) => {
          if (this._stopFlag) return;
          fullText += token;
          onChunk?.(token, fullText);
        }
      });

      // Conservative generation parameters for the CPU/WASM 0.5B model:
      // - max_new_tokens capped at 512 (enough for most answers, avoids OOM on mobile)
      // - temperature 0.6 (slightly cooler than GPU path — reduces incoherence at small scale)
      // - repetition_penalty 1.1 (prevents the token-repetition loops common in small models)
      // - do_sample: false when temp would be ≤ 0 (greedy is more reliable on tiny models)
      const temp = options.temperature ?? 0.6;
      await this._pipe(chatMessages, {
        max_new_tokens:     Math.min(options.maxTokens ?? 512, 512),
        temperature:        temp,
        top_p:              options.topP ?? 0.9,
        repetition_penalty: 1.1,
        do_sample:          temp > 0,
        streamer
      });

      onDone?.(fullText, { stopped: this._stopFlag });
    } catch (err) {
      throw new Error(`Generation failed: ${err.message}`);
    }
  }

  stop() {
    this._stopFlag = true;
  }

  getCapabilities() {
    return {
      modelId:        this._modelId,
      label:          CPU_MODEL_LABEL,
      contextLength:  this._contextSize,
      loaded:         this._loaded,
      loading:        this._loading,
      webgpuRequired: false,
      engine:         "transformers.js"
    };
  }

  async unload() {
    if (this._pipe) {
      try { await this._pipe.dispose?.(); } catch (_) {}
      this._pipe = null;
    }
    this._loaded      = false;
    this._loading     = false;
    this._initPromise = null;  // Reset so re-initialization is permitted after unload
  }

  _ensureLoaded() {
    if (!this._loaded) throw new Error("CPU model not loaded");
  }
}

// ── Model Manager ─────────────────────────────────────────────
export class ModelManager {
  constructor() {
    this._provider   = null;
    this._modelId    = null;
    this._webgpu     = null;
    this._caps       = null;
    this._protocol   = null;
    this._onProgress = null;
    this._status     = "uninitialized"; // uninitialized | loading | online | error
    this._error      = null;
    this._errorCode  = null;  // granular: INSECURE_CONTEXT | WEBGPU_UNAVAILABLE | etc.
    // Single authoritative init promise — concurrent callers share one operation
    this._initPromise = null;
  }

  setProgressCallback(cb) { this._onProgress = cb; }

  async initialize(preferredModelId = null) {
    // If already online, nothing to do
    if (this._status === "online") return;

    // If initialization is already in progress, return the same promise so
    // all concurrent callers safely wait for the single ongoing operation
    // instead of receiving an early-returning undefined or racing each other.
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInitialize(preferredModelId);
    try {
      await this._initPromise;
    } catch (err) {
      // _initPromise is cleared inside _doInitialize on failure so retry works
      throw err;
    }
  }

  async _doInitialize(preferredModelId) {
    this._status = "loading";
    this._error  = null;
    this._errorCode = null;

    try {
      // ── Step 0: Secure context check ─────────────────────────
      this._protocol = detectProtocol();
      console.log(`[MODEL] Secure context check — protocol: ${this._protocol.protocol} | isSecureContext: ${this._protocol.isSecure}`);

      if (this._protocol.isFileProtocol) {
        this._status      = "error";
        this._errorCode   = "INSECURE_CONTEXT";
        this._error       = "file:// protocol detected. Open Shadow Reaper via HTTP/HTTPS.";
        this._initPromise = null;  // Allow retry if context changes
        this._onProgress?.({
          stage: "error",
          errorCode: "INSECURE_CONTEXT",
          message: "LOCAL FILE MODE: Open via HTTP/HTTPS for AI functionality",
          percent: 0,
          error: true
        });
        // Don't throw — let the app shell keep running in degraded mode
        return;
      }

      if (!this._protocol.isSecure) {
        this._status      = "error";
        this._errorCode   = "INSECURE_CONTEXT";
        this._error       = "Insecure context (HTTP). WebGPU requires HTTPS.";
        this._initPromise = null;  // Allow retry if context changes
        this._onProgress?.({
          stage: "error",
          errorCode: "INSECURE_CONTEXT",
          message: "INSECURE CONTEXT: WebGPU requires HTTPS",
          percent: 0,
          error: true
        });
        return;
      }
      console.log(`[MODEL] Secure context check — PASS (isSecureContext=true)`);

      // ── Step 1: Device capabilities (sync) ───────────────────
      this._caps = detectDeviceCapabilities();
      console.log(`[MODEL] Device capabilities — mem=${this._caps.mem ?? "unknown"}GB cores=${this._caps.cores} mobile=${this._caps.mobile} wasm=${this._caps.wasm} tier=${this._caps.modelTier} ua="${navigator.userAgent}"`);

      this._onProgress?.({ stage: "device-check", message: "Checking WebGPU...", percent: 1 });

      // ── Step 2: navigator.gpu existence ──────────────────────
      const hasNavigatorGPU = typeof navigator !== "undefined" && !!navigator.gpu;
      console.log(`[MODEL] WebGPU check — navigator.gpu present: ${hasNavigatorGPU}`);

      // ── Step 3: Full WebGPU probe (adapter + device, 8s timeout) ─
      this._webgpu = await detectWebGPU();
      console.log(`[MODEL] GPU adapter request — stage: ${this._webgpu.stage} available: ${this._webgpu.available}${this._webgpu.reason ? " reason: " + this._webgpu.reason : ""}`);

      if (this._webgpu.available) {
        console.log(`[MODEL] GPU device request — PASS`);
        this._onProgress?.({ stage: "device-check", message: "WebGPU available ✓", percent: 8 });
      } else {
        const gpuMsg = this._gpuStatusMessage(this._webgpu);
        console.warn(`[MODEL] WebGPU unavailable — ${gpuMsg} — falling back to CPU engine`);
        this._onProgress?.({
          stage: "device-check",
          message: `WebGPU unavailable — loading CPU model instead`,
          percent: 8
        });
      }

      // ── Step 4: Select engine + model ────────────────────────
      const useCPU = !this._webgpu.available;

      if (useCPU) {
        // ── CPU path: Transformers.js + Qwen2.5-0.5B-Instruct ───
        this._modelId = CPU_MODEL_ID;
        console.log(`[MODEL] Model configuration lookup — CPU fallback: ${CPU_MODEL_ID} (${CPU_MODEL_LABEL})`);
        this._onProgress?.({
          stage: "model-select",
          message: `WebGPU unavailable — using ${CPU_MODEL_LABEL} (CPU)`,
          percent: 10
        });

        console.log(`[MODEL] Inference library import — url: ${TRANSFORMERS_ESM_URL}`);
        this._onProgress?.({ stage: "engine-load", message: "Loading CPU inference engine...", percent: 12 });

        this._provider = new TransformersJsProvider();
        console.log(`[MODEL] Model engine initialization — TransformersJsProvider`);

      } else {
        // ── GPU path: WebLLM ──────────────────────────────────────
        const modelId = preferredModelId
          ? (MODEL_CONFIGS[preferredModelId] ? preferredModelId : this._selectModel())
          : this._selectModel();
        this._modelId = modelId;

        const modelCfg = MODEL_CONFIGS[modelId];
        console.log(`[MODEL] Model configuration lookup — id: ${modelId} label: "${modelCfg?.label}" tier: ${modelCfg?.tier} contextLength: ${modelCfg?.contextLength}`);
        this._onProgress?.({
          stage: "model-select",
          message: `Selected: ${modelCfg?.label || modelId}`,
          percent: 10
        });

        console.log(`[MODEL] Inference library import — url: ${WEBLLM_ESM_URL}`);
        this._onProgress?.({ stage: "engine-load", message: "Loading GPU inference engine...", percent: 12 });

        this._provider = new WebLLMProvider(this._modelId);
        console.log(`[MODEL] Model engine initialization — ${this._modelId}`);
      }

      // ── Step 5: Initialize provider (downloads + initializes model) ─
      await this._provider.initialize((progress) => {
        if (progress.stage === "model-download") {
          const pct = progress.percent || 0;
          if (pct > 0) {
            console.log(`[MODEL] Download progress — ${Math.round(pct)}%`);
          }
        }
        if (progress.stage === "ready") {
          console.log(`[MODEL] Tokenizer initialization — complete`);
          console.log(`[MODEL] Generation engine ready`);
          console.log(`[MODEL] Cache initialization — saved`);
        }
        this._onProgress?.({
          ...progress,
          percent: 12 + Math.round((progress.percent || 0) * 0.84)
        });
      });

      this._status = "online";
      const readyLabel = useCPU ? CPU_MODEL_LABEL : (MODEL_CONFIGS[this._modelId]?.label || this._modelId);
      console.log(`[MODEL] ONLINE — ${this._modelId}`);
      this._onProgress?.({ stage: "ready", message: `MODEL READY — ${readyLabel}`, percent: 100 });

    } catch (err) {
      this._status      = "error";
      this._error       = err.message;
      this._initPromise = null;  // Allow retry after failure

      // Classify error code from the message prefix set by WebLLMProvider
      if (err.message.startsWith("ENGINE_LOAD_FAILED"))        this._errorCode = "ENGINE_LOAD_FAILED";
      else if (err.message.startsWith("MODEL_DOWNLOAD_FAILED")) this._errorCode = "MODEL_DOWNLOAD_FAILED";
      else if (err.message.startsWith("WEBGPU_INIT_FAILED"))    this._errorCode = "WEBGPU_INIT_FAILED";
      else if (err.message.startsWith("MODEL_OOM"))             this._errorCode = "MODEL_OOM";
      else if (err.message.startsWith("MODEL_INIT_FAILED"))     this._errorCode = "MODEL_INIT_FAILED";
      else                                                       this._errorCode = "UNKNOWN";

      console.error(`[MODEL] FAILED [${this._errorCode}]:`, err.message, err);

      this._onProgress?.({
        stage: "error",
        errorCode: this._errorCode,
        message: err.message,
        percent: 0,
        error: true
      });
      throw err;
    }
  }

  _gpuStatusMessage(webgpu) {
    switch (webgpu.stage) {
      case "insecure-context": return "INSECURE CONTEXT — WebGPU requires HTTPS";
      case "no-api":           return "WEBGPU UNAVAILABLE — browser does not support WebGPU";
      case "no-adapter":       return "GPU ADAPTER FAILED — no compatible GPU found";
      case "adapter-error":    return `GPU ADAPTER ERROR — ${webgpu.reason}`;
      case "device-error":     return `GPU DEVICE FAILED — ${webgpu.reason}`;
      case "no-device":        return "GPU DEVICE FAILED — requestDevice returned null";
      case "timeout":          return "WEBGPU DETECTION TIMEOUT — using CPU fallback";
      default:                 return `WebGPU unavailable: ${webgpu.reason}`;
    }
  }

  // Called only when WebGPU IS available — selects the best WebLLM model for the device tier.
  // Mobile devices (Android, iOS) are capped at the small model regardless of reported
  // device-memory tier — browser deviceMemory estimates are unreliable on mobile and the
  // 3B model risks OOM on devices with constrained GPU memory budgets.
  _selectModel() {
    const tier   = this._caps?.modelTier || "small";
    const mobile = this._caps?.mobile === true;

    // Large devices (≥16 GB reported RAM, non-mobile): high-quality 8B
    if (tier === "large" && !mobile) return "Llama-3.1-8B-Instruct-q4f16_1-MLC";

    // Medium devices (8–15 GB reported RAM, non-mobile): recommended 3B
    if (tier === "medium" && !mobile) return "Llama-3.2-3B-Instruct-q4f16_1-MLC";

    // Small tier (< 8 GB) OR mobile: use the efficient small model
    // Phi-3.5-mini is in MODEL_CONFIGS and works without strict WebGPU requirements.
    // This prevents OOM on Android Chrome where GPU memory is limited.
    return "Phi-3.5-mini-instruct-q4f16_1-MLC";
  }

  async generateStream(messages, options, onChunk, onDone) {
    // If initialization is in progress, wait for it to complete before
    // generating.  This prevents the "Model not loaded before trying to
    // complete ChatCompletionRequest" error when the caller fires before
    // the model finishes loading (e.g. rapid submission during startup).
    if (this._status === "loading" && this._initPromise) {
      try {
        await this._initPromise;
      } catch (_) {
        // Init failed — fall through to the online check below which will throw
      }
    }

    if (!this._provider || this._status !== "online") {
      throw new Error("Model not online. Cannot generate.");
    }
    return this._provider.generateStream(messages, options, onChunk, onDone);
  }

  stop() { this._provider?.stop(); }

  getStatus()       { return this._status; }
  getErrorCode()    { return this._errorCode; }
  getModelId()      { return this._modelId; }
  getCapabilities() { return this._provider?.getCapabilities() ?? {}; }
  getWebGPU()       { return this._webgpu; }
  getProtocol()     { return this._protocol; }
  getError()        { return this._error; }
  isOnline()        { return this._status === "online"; }

  // Returns the list of model IDs actually loaded into the WebLLM pipeline map.
  // An empty array means reload() returned without completing (silent-abort case).
  // For the CPU/Transformers.js path returns [modelId] if loaded, [] otherwise.
  getLoadedModelIds() {
    const provider = this._provider;
    if (!provider) return [];
    // WebLLM path
    if (provider._engine?.loadedModelIdToPipeline) {
      return Array.from(provider._engine.loadedModelIdToPipeline.keys());
    }
    // Transformers.js path
    if (provider._pipe && provider._loaded) {
      return [provider._modelId];
    }
    return [];
  }

  async switchModel(newModelId) {
    await this._provider?.unload();
    this._provider    = null;
    this._status      = "uninitialized";
    this._initPromise = null;  // Reset so new initialization can start
    await this.initialize(newModelId);
  }
}
