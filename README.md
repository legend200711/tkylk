# Shadow Reaper

> **Adaptive Browser AI — Local Intelligence System**

Shadow Reaper is a standalone browser-based adaptive AI system that runs a local language model directly on the user's device via WebGPU/WebLLM. It has persistent memory, structured learning, a knowledge graph, simulated emotional state, and a personality engine — none of which depend on external AI APIs.

---

## Architecture

```
Shadow Reaper
├── Local Language Model (WebLLM / WebGPU)
├── Conversation Engine
├── Memory Engine (Working / Episodic / Semantic / Procedural / Preference)
├── Learning Adapter (structured interaction analysis)
├── Knowledge Engine (curated learned facts)
├── Knowledge Graph (concept relationships)
├── Context Engine (intelligent retrieval + prompt construction)
├── Reflection Engine (memory consolidation)
├── Emotion Engine (simulated state dimensions)
├── Personality Engine (configurable traits)
├── Privacy Engine (user data isolation)
└── Retrieval Engine (relevance scoring)
```

---

## Setup

### 1. Firebase Project

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** (Email/Password)
3. Enable **Firestore Database** (production mode)
4. Copy your config into `firebase/firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

5. Deploy Firestore security rules:
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### 2. Hosting (Cloudflare Pages)

1. Connect your repository to Cloudflare Pages
2. Set build output to root `/`
3. No build step required — static files served directly
4. Add cache headers for model files via `_headers` or Workers

Or use any static file host (Netlify, Vercel, Firebase Hosting).

---

## Local Development

Since this is static HTML/CSS/JS with ES modules, you need a local server (CORS restrictions prevent `file://` protocol):

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080`

---

## Models

Shadow Reaper uses [WebLLM](https://github.com/mlc-ai/web-llm) to run open-weight models locally. Models are downloaded once and cached by the browser.

Default model selection based on device memory:
- **16GB+**: Llama 3.1 8B Instruct (q4f16)
- **8GB+**: Llama 3.2 3B Instruct (q4f16)
- **< 8GB / no WebGPU**: Phi 3.5 Mini (q4f16)

**WebGPU is required** for best performance. Fallback models work without WebGPU but are slower.

---

## Importing Project Knowledge

Use the Knowledge Center's **IMPORT JSON** button with this format:

```json
{
  "project": "Shadow Nexus Social",
  "description": "Social platform with 24-hour TV system and Creator Studio",
  "features": [
    "24-hour TV broadcast system",
    "Creator Studio for content management",
    "Guest user access mode"
  ],
  "technologies": ["Firebase", "Firestore", "JavaScript"],
  "decisions": [
    "Firebase chosen for real-time sync",
    "Guest users can watch 24-hour TV without login"
  ],
  "knownIssues": [
    "Playback synchronization issue on mobile Safari"
  ],
  "solutions": [
    "HLS stream fallback resolves mobile playback"
  ],
  "relationships": []
}
```

---

## File Structure

```
/index.html
/manifest.json
/css/
  shadow-reaper.css      — Core styles + design system
  animations.css         — All animations
  responsive.css         — Mobile/tablet responsive rules
/js/
  app.js                 — Main entry point, wires all systems
  ui.js                  — DOM, rendering, markdown, notifications
  auth.js                — Firebase authentication
/core/
  shadow-core.js         — Top-level orchestrator
  model-manager.js       — WebLLM model lifecycle
  conversation-engine.js — Message loop + history
  context-engine.js      — Intelligent context construction
  memory-engine.js       — All memory types
  learning-adapter.js    — Interaction analysis + learning
  knowledge-engine.js    — Curated knowledge store
  knowledge-graph.js     — Concept relationships
  reflection-engine.js   — Memory consolidation
  emotion-engine.js      — Simulated emotional state
  personality-engine.js  — Configurable personality traits
  retrieval-engine.js    — Relevance scoring + ranking
  privacy-engine.js      — Data isolation + classification
/firebase/
  firebase-config.js     — Firebase credentials (configure this)
  firestore-service.js   — All Firestore operations
  firestore.rules        — Security rules (deploy to Firebase)
  firestore.indexes.json — Index configuration
/storage/
  indexeddb.js           — Local fast storage layer
  sync-manager.js        — Offline queue sync
/admin/
  shadow-core-dashboard.js — System status + controls
  knowledge-center.js     — Project/knowledge management
  learning-dashboard.js   — Memory/learning inspection
```

---

## Privacy

- All user data is scoped to their Firebase UID via Firestore security rules
- User A can never read User B's memories, knowledge, or conversations
- Private memories are never automatically promoted to shared knowledge
- The Privacy Engine classifies all data before storage

---

## The Core Loop

```
USER TALKS
→ SHADOW REAPER UNDERSTANDS CONTEXT
→ RETRIEVES RELEVANT EXPERIENCE (memory + knowledge + relationships)
→ RESPONDS USING LOCAL MODEL (no API calls)
→ ANALYZES THE INTERACTION (learning adapter)
→ LEARNS USEFUL INFORMATION (structured records)
→ UPDATES MEMORY / KNOWLEDGE (Firebase + IndexedDB)
→ BUILDS RELATIONSHIPS (knowledge graph)
→ ADAPTS INTERNAL STATE (emotion engine)
→ USES THAT EXPERIENCE IN FUTURE CONVERSATIONS
```

That loop is what makes Shadow Reaper more than a chatbot.
