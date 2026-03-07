import { SiteConfig } from "../types";

// --- CONFIGURATION ---
const getApiKey = () => import.meta.env.VITE_GEMINI_KEY || "";

// --- UTILITAIRES ---
const cleanJSON = (text: string | null) => {
  if (!text) return null;
  try {
    const stripped = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(stripped);
  } catch {
    try {
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    } catch {}
    return null;
  }
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// LISTE DE MODÈLES MISE À JOUR (Noms officiels uniquement)
const MODELS = [
  "gemini-2.0-flash",                     // Ton modèle principal (souvent en 429)
  "gemini-2.0-flash-lite-preview-02-05",  // Le VRAI nom du modèle "lite" (très rapide)
  "gemini-1.5-flash",                     // Le fallback standard
  "gemini-1.5-flash-8b",                  // Modèle très léger, rarement en quota
];

const callGeminiModel = async (model: string, payload: any, isWishlist = false): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  
  // Wishlist (url_context) REQUIERT v1beta. Les autres peuvent utiliser v1 pour éviter les 404.
  const apiVersion = isWishlist ? "v1beta" : "v1";
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (res.status === 429) return "__QUOTA__"; 
    
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[Gemini] Skip ${model} (${res.status})`);
      return null;
    }
    
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    return null;
  }
};

const callGemini = async (payload: any, isWishlist = false): Promise<string | null> => {
  for (const model of MODELS) {
    const result = await callGeminiModel(model, payload, isWishlist);
    if (result === "__QUOTA__") continue; // Si 429, on passe au modèle suivant
    if (result !== null) return result;
  }
  return null;
};

// ============================================================================
// FONCTIONS EXPORTÉES
// ============================================================================

export const askButlerAgent = async (history: { role: string; text: string }[], contextData: any) => {
  const systemPrompt = `Tu es le Majordome d'une famille. Liste courses : ${contextData?.shopItems || "vide"}. Si ajout : {"action": "ADD_HUB", "item": "Nom", "reply": "OK"}. Sinon texte.`;
  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    ...history.map(h => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] })),
  ];
  const text = await callGemini({ contents });
  const json = cleanJSON(text);
  return json?.action ? { type: "action", data: json } : { type: "text", data: text || "Désolé..." };
};

export const askAIChat = async (history: { role: string; text: string }[]) => {
  const res = await askButlerAgent(history, {});
  return res.type === "text" ? res.data : "Fait.";
};

export const readBarcodeFromImage = async (file: File): Promise<string | null> => {
  const b64 = await fileToBase64(file);
  const text = await callGemini({
    contents: [{ parts: [{ text: "Code barre ?" }, { inline_data: { mime_type: file.type || "image/jpeg", data: b64 } }] }],
  });
  return text ? text.replace(/\D/g, "") : null;
};

export const classifyFrigoItem = async (productName: string) => {
  const today = new Date().toISOString().split('T')[0];
  const res = await callGemini({
    contents: [{ parts: [{ text: `Classifie "${productName}" en JSON : {"category": "...", "expiryDate": "YYYY-MM-DD"}. Aujourd'hui : ${today}.` }] }]
  });
  return cleanJSON(res);
};

export const scanProductImage = async (file: File) => {
  const b64 = await fileToBase64(file);
  const today = new Date().toISOString().split('T')[0];
  const res = await callGemini({
    contents: [{ parts: [{ text: `Identifie en JSON : {"name":"...","category":"...","expiryDate":"..."}. Aujourd'hui : ${today}.` }, { inline_data: { mime_type: file.type || "image/jpeg", data: b64 } }] }],
  });
  return cleanJSON(res);
};

export const extractRecipeFromUrl = async (url: string) => {
  const res = await callGemini({
    contents: [{ parts: [{ text: `Recette de ${url} en JSON : {"title":"...","chef":"","category":"plat","ingredients":"...","steps":"..."}` }] }]
  });
  return cleanJSON(res);
};

// --- LA FONCTION WISH-LIST CORRIGÉE ---
export const extractProductFromUrl = async (url: string): Promise<{name: string, imageUrl: string, price: string} | null> => {
  const payload = {
    tools: [{ url_context: {} }], 
    contents: [{
      parts: [{
        text: `Accède à cette URL : ${url}. Extraie le NOM, le PRIX (XX,XX €) et l'URL de la PHOTO. Réponds UNIQUEMENT en JSON : {"name":"Nom","price":"XX,XX €","imageUrl":"https://..."}`
      }]
    }],
    generationConfig: { temperature: 0 },
  };

  // On force isWishlist = true pour utiliser v1beta (obligatoire pour url_context)
  const text = await callGemini(payload, true);
  if (!text) return null;

  const parsed = cleanJSON(text);
  if (parsed?.name) {
    return {
      name: parsed.name.split(/[|–—\-]/)[0].trim(),
      price: parsed.price || '',
      imageUrl: parsed.imageUrl || ''
    };
  }
  return null;
};

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const res = await callGemini({
    contents: [{ parts: [{ text: `Modifie JSON : "${prompt}". Config : ${JSON.stringify(currentConfig)}` }] }],
  });
  const json = cleanJSON(res);
  return json ? { ...currentConfig, ...json } : null;
};
