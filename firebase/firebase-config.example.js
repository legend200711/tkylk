// ============================================================
// Firebase Configuration — EXAMPLE FILE
//
// INSTRUCTIONS:
//   1. Copy this file to firebase/firebase-config.js
//   2. Replace all placeholder values with your real Firebase
//      project configuration from:
//      Firebase Console → Project Settings → General → Your apps
//   3. NEVER commit private service-account keys to this file.
//      Only the PUBLIC web SDK config belongs here.
//
// SECURITY:
//   - These values (apiKey, appId, etc.) are PUBLIC — they are
//     safe to include in browser JavaScript.
//   - Security is enforced via Firestore Security Rules, not
//     by keeping these values secret.
//   - Restrict this API key in Google Cloud Console:
//     APIs & Services → Credentials → your key →
//     Application restrictions → HTTP referrers (websites)
//     Add: yourdomain.com/* and localhost/*
//
// NEVER PUT IN THIS FILE:
//   - Firebase Admin SDK service-account private keys
//   - Cloudflare API tokens
//   - Any secret server credentials
// ============================================================

export const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ── Cloudflare / R2 configuration (PUBLIC values only) ──────
// Set these as Cloudflare Pages environment variables for
// production deployments. Do NOT hardcode secrets here.
//
// R2 bucket public URL (set after creating R2 bucket):
// export const R2_BASE_URL = "https://shadow-reaper-models.YOUR-ACCOUNT-ID.r2.dev";
//
// Or if using a Cloudflare Worker as R2 proxy:
// export const R2_BASE_URL = "https://models.yourdomain.com";
