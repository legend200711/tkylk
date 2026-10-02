// ============================================================
// Firestore Service — all database operations
// Collections:
//   users/{uid}
//   users/{uid}/conversations/{convId}/messages/{msgId}
//   users/{uid}/memories/{memId}
//   users/{uid}/learnedKnowledge/{knowledgeId}
//   users/{uid}/relationships/{relId}
//   users/{uid}/projects/{projectId}
//   users/{uid}/corrections/{correctionId}
//   users/{uid}/reflections/{reflectionId}   (alias: reflectionHistory)
//   users/{uid}/learningEvents/{eventId}
//   users/{uid}/preferences/{documentId}
//   users/{uid}/emotionalState/{documentId}
//   users/{uid}/personality/{documentId}
//   users/{uid}/mistakes/{mistakeId}
//   users/{uid}/projectBrains/{projectId}
//   users/{uid}/projectBrains/{projectId}/entries/{entryId}
//   users/{uid}/confidenceData/{conceptKey}
//   users/{uid}/curiosityEvents/{eventId}
//   users/{uid}/globalContributions/{windowId}   (rate-limiting only)
//   users/{uid}/projectRegistry/{projectId}      (persisted project registry)
//
// GLOBAL (cross-user, privacy-filtered only):
//   globalLearningCandidates/{conceptHash}
//   globalKnowledge/{conceptHash}
// ============================================================
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  addDoc, updateDoc, deleteDoc, query, where, orderBy,
  limit, serverTimestamp, writeBatch, onSnapshot, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let _db = null;

export function initFirestore(app) {
  _db = getFirestore(app);
  return _db;
}

export function getDB() {
  if (!_db) throw new Error("Firestore not initialized");
  return _db;
}

// ── Helpers ──────────────────────────────────────────────────
function userRef(uid) { return doc(getDB(), "users", uid); }
function colRef(uid, col) { return collection(getDB(), "users", uid, col); }
function docRef(uid, col, id) { return doc(getDB(), "users", uid, col, id); }

// ── User Profile ──────────────────────────────────────────────
export async function ensureUserProfile(uid, displayName, email) {
  const ref = userRef(uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid, displayName, email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  return (await getDoc(ref)).data();
}

// ── Conversations ──────────────────────────────────────────────
export async function createConversation(uid, title = "New Conversation") {
  const ref = await addDoc(colRef(uid, "conversations"), {
    title,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    messageCount: 0
  });
  return ref.id;
}

export async function getConversations(uid, limitCount = 50) {
  const q = query(colRef(uid, "conversations"), orderBy("updatedAt", "desc"), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function listenConversations(uid, callback) {
  const q = query(colRef(uid, "conversations"), orderBy("updatedAt", "desc"), limit(100));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function updateConversationTitle(uid, convId, title) {
  await updateDoc(docRef(uid, "conversations", convId), { title, updatedAt: serverTimestamp() });
}

export async function deleteConversation(uid, convId) {
  // Delete messages subcollection first
  const msgs = await getDocs(collection(getDB(), "users", uid, "conversations", convId, "messages"));
  const batch = writeBatch(getDB());
  msgs.docs.forEach(d => batch.delete(d.ref));
  batch.delete(docRef(uid, "conversations", convId));
  await batch.commit();
}

export async function touchConversation(uid, convId) {
  await updateDoc(docRef(uid, "conversations", convId), { updatedAt: serverTimestamp() });
}

// ── Messages ──────────────────────────────────────────────────
export async function addMessage(uid, convId, role, content, metadata = {}) {
  const ref = await addDoc(
    collection(getDB(), "users", uid, "conversations", convId, "messages"),
    { role, content, metadata, createdAt: serverTimestamp() }
  );
  await updateDoc(docRef(uid, "conversations", convId), {
    updatedAt: serverTimestamp(),
    messageCount: (await getDoc(docRef(uid, "conversations", convId))).data()?.messageCount + 1 || 1
  });
  return ref.id;
}

export async function getMessages(uid, convId, limitCount = 100) {
  const q = query(
    collection(getDB(), "users", uid, "conversations", convId, "messages"),
    orderBy("createdAt", "asc"),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateMessage(uid, convId, msgId, updates) {
  await updateDoc(
    doc(getDB(), "users", uid, "conversations", convId, "messages", msgId),
    updates
  );
}

// ── Memories ──────────────────────────────────────────────────
export async function saveMemory(uid, memory) {
  if (memory.id) {
    await updateDoc(docRef(uid, "memories", memory.id), {
      ...memory, updatedAt: serverTimestamp()
    });
    return memory.id;
  }
  const ref = await addDoc(colRef(uid, "memories"), {
    ...memory,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getMemories(uid, category = null, maxResults = 200) {
  let q;
  if (category) {
    // where-only query — avoids composite index requirement.
    // Sort by importance client-side.
    q = query(colRef(uid, "memories"), where("category", "==", category), limit(maxResults));
  } else {
    q = query(colRef(uid, "memories"), orderBy("updatedAt", "desc"), limit(maxResults));
  }
  const snap = await getDocs(q);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (category) docs.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  return docs;
}

export async function deleteMemory(uid, memId) {
  await deleteDoc(docRef(uid, "memories", memId));
}

export async function updateMemory(uid, memId, updates) {
  await updateDoc(docRef(uid, "memories", memId), { ...updates, updatedAt: serverTimestamp() });
}

// ── Learned Knowledge ─────────────────────────────────────────
export async function saveKnowledge(uid, knowledge) {
  if (knowledge.id) {
    await updateDoc(docRef(uid, "learnedKnowledge", knowledge.id), {
      ...knowledge, updatedAt: serverTimestamp()
    });
    return knowledge.id;
  }
  const ref = await addDoc(colRef(uid, "learnedKnowledge"), {
    ...knowledge,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getKnowledge(uid, project = null, maxResults = 300) {
  let q;
  if (project) {
    // where-only query — avoids composite index requirement.
    // Sort by confidence client-side.
    q = query(colRef(uid, "learnedKnowledge"), where("project", "==", project), limit(maxResults));
  } else {
    q = query(colRef(uid, "learnedKnowledge"), orderBy("updatedAt", "desc"), limit(maxResults));
  }
  const snap = await getDocs(q);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (project) docs.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  return docs;
}

export async function deleteKnowledge(uid, knowledgeId) {
  await deleteDoc(docRef(uid, "learnedKnowledge", knowledgeId));
}

export async function updateKnowledge(uid, knowledgeId, updates) {
  await updateDoc(docRef(uid, "learnedKnowledge", knowledgeId), { ...updates, updatedAt: serverTimestamp() });
}

// ── Emotional State ───────────────────────────────────────────
export async function saveEmotionalState(uid, state) {
  await setDoc(docRef(uid, "emotionalState", "current"), {
    ...state, updatedAt: serverTimestamp()
  });
}

export async function loadEmotionalState(uid) {
  const snap = await getDoc(docRef(uid, "emotionalState", "current"));
  return snap.exists() ? snap.data() : null;
}

// ── Projects ──────────────────────────────────────────────────
export async function saveProject(uid, project) {
  if (project.id) {
    await updateDoc(docRef(uid, "projects", project.id), {
      ...project, updatedAt: serverTimestamp()
    });
    return project.id;
  }
  const ref = await addDoc(colRef(uid, "projects"), {
    ...project,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getProjects(uid) {
  const snap = await getDocs(colRef(uid, "projects"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteProject(uid, projectId) {
  await deleteDoc(docRef(uid, "projects", projectId));
}

// ── Relationships ─────────────────────────────────────────────
export async function saveRelationship(uid, rel) {
  if (rel.id) {
    await updateDoc(docRef(uid, "relationships", rel.id), { ...rel, updatedAt: serverTimestamp() });
    return rel.id;
  }
  const ref = await addDoc(colRef(uid, "relationships"), {
    ...rel, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getRelationships(uid, fromConcept = null) {
  let q;
  if (fromConcept) {
    q = query(colRef(uid, "relationships"), where("fromConcept", "==", fromConcept));
  } else {
    q = query(colRef(uid, "relationships"), limit(500));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteRelationship(uid, relId) {
  await deleteDoc(docRef(uid, "relationships", relId));
}

// ── Corrections ────────────────────────────────────────────────
export async function saveCorrection(uid, correction) {
  const ref = await addDoc(colRef(uid, "corrections"), {
    ...correction,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getCorrections(uid, maxResults = 100) {
  const q = query(colRef(uid, "corrections"), orderBy("createdAt", "desc"), limit(maxResults));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Reflection History ─────────────────────────────────────────
// "reflections" is the canonical collection.
// "reflectionHistory" is kept for backward compatibility.
export async function saveReflection(uid, reflection) {
  const ref = await addDoc(colRef(uid, "reflections"), {
    ...reflection, createdAt: serverTimestamp()
  });
  // Mirror to legacy collection so existing data is not orphaned
  addDoc(colRef(uid, "reflectionHistory"), {
    ...reflection, canonicalId: ref.id, createdAt: serverTimestamp()
  }).catch(() => {});
  return ref.id;
}

export async function getReflections(uid, maxResults = 50) {
  const q = query(colRef(uid, "reflections"), orderBy("createdAt", "desc"), limit(maxResults));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Learning Events ─────────────────────────────────────────────
export async function saveLearningEvent(uid, event) {
  const ref = await addDoc(colRef(uid, "learningEvents"), {
    ...event, createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function getLearningEvents(uid, maxResults = 200) {
  const q = query(colRef(uid, "learningEvents"), orderBy("createdAt", "desc"), limit(maxResults));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Personality ─────────────────────────────────────────────────
export async function savePersonality(uid, config) {
  await setDoc(docRef(uid, "personality", "config"), {
    ...config, updatedAt: serverTimestamp()
  });
}

export async function loadPersonality(uid) {
  const snap = await getDoc(docRef(uid, "personality", "config"));
  return snap.exists() ? snap.data() : null;
}

// ── Preferences ───────────────────────────────────────────────
export async function savePreferences(uid, prefs) {
  await setDoc(docRef(uid, "preferences", "main"), { ...prefs, updatedAt: serverTimestamp() });
}

export async function loadPreferences(uid) {
  const snap = await getDoc(docRef(uid, "preferences", "main"));
  return snap.exists() ? snap.data() : {};
}

// ── Mistakes ──────────────────────────────────────────────────
export async function saveMistake(uid, mistake) {
  if (mistake.id) {
    await updateDoc(docRef(uid, "mistakes", mistake.id), {
      ...mistake, updatedAt: serverTimestamp()
    });
    return mistake.id;
  }
  const ref = await addDoc(colRef(uid, "mistakes"), {
    ...mistake,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getMistakes(uid, maxResults = 200) {
  const q = query(colRef(uid, "mistakes"), orderBy("createdAt", "desc"), limit(maxResults));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateMistake(uid, mistakeId, updates) {
  await updateDoc(docRef(uid, "mistakes", mistakeId), {
    ...updates, updatedAt: serverTimestamp()
  });
}

// ── Project Brains ──────────────────────────────────────────────
export async function saveProjectBrain(uid, projectId, brain) {
  await setDoc(docRef(uid, "projectBrains", projectId), {
    ...brain, updatedAt: serverTimestamp()
  });
}

export async function getProjectBrain(uid, projectId) {
  const snap = await getDoc(docRef(uid, "projectBrains", projectId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateProjectBrain(uid, projectId, updates) {
  await updateDoc(docRef(uid, "projectBrains", projectId), {
    ...updates, updatedAt: serverTimestamp()
  });
}

export async function getAllProjectBrains(uid) {
  const snap = await getDocs(colRef(uid, "projectBrains"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveProjectBrainEntry(uid, projectId, entry) {
  const col = collection(getDB(), "users", uid, "projectBrains", projectId, "entries");
  const ref = await addDoc(col, {
    ...entry, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function getProjectBrainEntries(uid, projectId, type = null, maxResults = 200) {
  const col = collection(getDB(), "users", uid, "projectBrains", projectId, "entries");
  let q;
  if (type) {
    // where-only query — avoids composite index requirement. Sort client-side.
    q = query(col, where("type", "==", type), limit(maxResults));
  } else {
    q = query(col, orderBy("createdAt", "desc"), limit(maxResults));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Confidence Data ────────────────────────────────────────────
export async function saveConfidenceRecord(uid, record) {
  const key = (record.conceptKey || "").replace(/[/\\]/g, "_").slice(0, 200);
  if (!key) return;
  await setDoc(docRef(uid, "confidenceData", key), {
    ...record, updatedAt: serverTimestamp()
  });
}

export async function getConfidenceRecords(uid, maxResults = 500) {
  const q = query(colRef(uid, "confidenceData"), limit(maxResults));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Curiosity Events ────────────────────────────────────────────
export async function saveCuriosityEvent(uid, event) {
  const ref = await addDoc(colRef(uid, "curiosityEvents"), {
    ...event, createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function getCuriosityEvents(uid, maxResults = 100) {
  const q = query(colRef(uid, "curiosityEvents"), orderBy("createdAt", "desc"), limit(maxResults));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Stats ─────────────────────────────────────────────────────
export async function getUserStats(uid) {
  const [
    memories, knowledge, relationships, conversations,
    reflections, corrections, learningEvents,
    mistakes, projectBrains
  ] = await Promise.all([
    getDocs(query(colRef(uid, "memories"), limit(1000))),
    getDocs(query(colRef(uid, "learnedKnowledge"), limit(1000))),
    getDocs(query(colRef(uid, "relationships"), limit(1000))),
    getDocs(query(colRef(uid, "conversations"), limit(1000))),
    getDocs(query(colRef(uid, "reflections"), limit(1000))),
    getDocs(query(colRef(uid, "corrections"), limit(1000))),
    getDocs(query(colRef(uid, "learningEvents"), limit(1000))),
    getDocs(query(colRef(uid, "mistakes"), limit(1000))),
    getDocs(colRef(uid, "projectBrains"))
  ]);
  return {
    memoryCount:        memories.size,
    knowledgeCount:     knowledge.size,
    relationshipCount:  relationships.size,
    conversationCount:  conversations.size,
    reflectionCount:    reflections.size,
    correctionCount:    corrections.size,
    learningEventCount: learningEvents.size,
    mistakeCount:       mistakes.size,
    projectBrainCount:  projectBrains.size
  };
}

// ── Infrastructure health check ────────────────────────────────
/**
 * Pings Firestore with a lightweight read to verify connectivity.
 * Returns { connected: bool, latencyMs: number }.
 */
export async function checkFirestoreHealth(uid) {
  const start = Date.now();
  try {
    await getDoc(doc(getDB(), "users", uid));
    return { connected: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { connected: false, latencyMs: Date.now() - start, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// GLOBAL LEARNING — Candidates & Promoted Knowledge
// NOTE: UIDs are NEVER stored in these collections.
// Privacy-safe generalized concepts only.
// ══════════════════════════════════════════════════════════════

// ── Global Learning Candidates ────────────────────────────────
export async function saveGlobalCandidate(conceptHash, candidate) {
  const ref = doc(getDB(), "globalLearningCandidates", conceptHash);
  await setDoc(ref, { ...candidate, updatedAt: serverTimestamp() }, { merge: false });
}

export async function getGlobalCandidate(conceptHash) {
  const snap = await getDoc(doc(getDB(), "globalLearningCandidates", conceptHash));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateGlobalCandidate(conceptHash, updates) {
  const ref = doc(getDB(), "globalLearningCandidates", conceptHash);
  await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
}

export async function getAllGlobalCandidates(maxResults = 100) {
  // Simple limit query — orderBy on a single field is fine without a composite index.
  const q = query(
    collection(getDB(), "globalLearningCandidates"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Global Knowledge (promoted) ────────────────────────────────
export async function saveGlobalKnowledge(conceptHash, knowledge) {
  const ref = doc(getDB(), "globalKnowledge", conceptHash);
  await setDoc(ref, { ...knowledge, updatedAt: serverTimestamp() }, { merge: false });
}

export async function getGlobalKnowledgeByHash(conceptHash) {
  const snap = await getDoc(doc(getDB(), "globalKnowledge", conceptHash));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllGlobalKnowledge(maxResults = 200) {
  // Simple limit query — no orderBy to avoid requiring a composite index.
  // Sort client-side after fetch.
  const q = query(
    collection(getDB(), "globalKnowledge"),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return docs.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

export async function getGlobalKnowledgeByCategory(category, maxResults = 50) {
  // Filter by category only — no secondary orderBy to avoid composite index requirement.
  const q = query(
    collection(getDB(), "globalKnowledge"),
    where("category", "==", category),
    limit(maxResults)
  );
  const snap = await getDocs(q);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return docs.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

// ── Per-user global contribution rate-limiting ─────────────────
// Stores only a count per 24-hour window, NOT content.
export async function recordGlobalContribution(uid) {
  const windowId = Math.floor(Date.now() / 86_400_000).toString(); // daily window
  const ref = doc(getDB(), "users", uid, "globalContributions", windowId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { count: (snap.data().count || 0) + 1, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, { count: 1, windowId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

export async function getRecentCandidatesByUser(uid, windowMs) {
  const windowId = Math.floor(Date.now() / 86_400_000).toString();
  const ref = doc(getDB(), "users", uid, "globalContributions", windowId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data().count || 0) : 0;
}

// ── Global Knowledge Stats ─────────────────────────────────────
export async function getGlobalLearningStats() {
  const [candidates, knowledge] = await Promise.all([
    getDocs(query(collection(getDB(), "globalLearningCandidates"), limit(1000))),
    getDocs(query(collection(getDB(), "globalKnowledge"), limit(1000)))
  ]);
  return {
    candidateCount: candidates.size,
    promotedCount:  knowledge.size
  };
}

// ── Project Registry (persistent, slug-keyed) ─────────────────
// Uses a deterministic document ID based on project ID/slug so the
// same project cannot be double-registered on reload.
export async function upsertProjectRegistry(uid, project) {
  // Use project.id as the Firestore document ID (deterministic)
  const id = (project.id || "").replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 60);
  if (!id) return null;
  await setDoc(docRef(uid, "projectRegistry", id), {
    ...project,
    id,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return id;
}

export async function loadProjectRegistry(uid) {
  const snap = await getDocs(colRef(uid, "projectRegistry"));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

export async function deleteProjectFromRegistry(uid, projectId) {
  const id = (projectId || "").replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 60);
  if (!id) return;
  await deleteDoc(docRef(uid, "projectRegistry", id));
}
