# Cloudflare R2 — Shadow Reaper Setup Guide

## 1. Create the R2 Bucket

In the Cloudflare dashboard:

1. Go to **R2 Object Storage** → **Create bucket**
2. Name: `shadow-reaper-models`
3. Location: Choose closest to your users
4. Click **Create bucket**

---

## 2. Configure Public Access

R2 buckets are private by default. To serve model files to browsers:

### Option A — R2 Public Bucket URL (simplest)
1. Open the bucket → **Settings**
2. Under **Public access**, click **Allow Access**
3. Copy the public URL: `https://shadow-reaper-models.<account-id>.r2.dev`
4. Update `model-manifest.json` → `r2BaseUrl` with this URL

### Option B — Custom Domain (recommended for production)
1. Add a custom domain (e.g. `models.yourdomain.com`) pointing to the bucket
2. Cloudflare CDN will automatically cache model files
3. Update `model-manifest.json` → `r2BaseUrl` with your custom domain

---

## 3. Directory Structure

Upload model assets with this directory layout:

```
/models/
    shadow-reaper-default/
        manifest.json               ← per-model manifest
        config/
            config.json
        tokenizer/
            tokenizer.json
            tokenizer_config.json
            vocab.json
        weights/
            ndarray-cache.json
            params_shard_0.bin
            params_shard_1.bin
            ...
```

---

## 4. CORS Configuration

R2 requires CORS headers for browser access. In the bucket **Settings** → **CORS**:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com", "http://localhost:*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

---

## 5. Caching

Model weight files are immutable once uploaded.
Set **Cache-Control** metadata on weight files:

```
Cache-Control: public, max-age=31536000, immutable
```

Cloudflare CDN will cache these files globally — users in different
regions get fast downloads.

---

## 6. What NOT to Upload to R2

| ❌ Never upload                        | ✅ Safe to upload          |
|---------------------------------------|---------------------------|
| Firebase service-account JSON keys    | Model weight files (.bin) |
| Cloudflare API tokens                 | Tokenizer files           |
| Any private credentials               | Model config JSON         |
| User data / Firestore exports         | Static AI assets          |

---

## 7. WebLLM Note

WebLLM manages its own download and caching using the browser's Cache API.
When the model is already cached, it will not re-download from R2.
Model files only need to be served — not managed by the application.

---

## 8. Upload via Wrangler CLI

```bash
# Install wrangler
npm install -g wrangler

# Login
wrangler login

# Upload a file
wrangler r2 object put shadow-reaper-models/models/shadow-reaper-default/manifest.json \
  --file ./local-path/manifest.json \
  --content-type "application/json"

# Upload directory recursively (Cloudflare dashboard or rclone recommended for bulk)
```

---

## 9. Update model-manifest.json

After creating the bucket, update the `r2BaseUrl` in `model-manifest.json`:

```json
"r2BaseUrl": "https://shadow-reaper-models.YOUR-ACCOUNT-ID.r2.dev"
```
