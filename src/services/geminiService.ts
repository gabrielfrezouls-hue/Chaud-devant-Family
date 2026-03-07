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

// MODÈLES OFFICIELS (Le 2.5 n'existe pas, d'où le 404)
const MODELS = [
  "gemini-2.0-flash",        // Le plus récent
  "gemini-1.5-flash",        // Le plus stable
  "gemini-1.5-flash-latest", // Version alternative
];

const callGeminiModel = async (model: string, payload: any): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) { console.error("⛔ VITE_GEMINI_KEY manquante"); return null; }
  
  // v1beta est nécessaire pour url_context
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (res.status === 429) return "__QUOTA__"; 
    
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[Gemini] ${model} ${res.status}:`, body.slice(0, 150));
      return null;
    }
    
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error(`[Network] ${model}:`, err);
    return null;
  }
};

const callGemini = async (payload: any): Promise<string | null> => {
  for (const model of MODELS) {
    const result = await callGeminiModel(model, payload);
    if (result === "__QUOTA__") {
      console.warn(`⚠️ Quota 429 sur ${model}, essai du suivant...`);
      continue;
    }
    if (result !== null) return result;
  }
  return null;
};

// ============================================================================
// FONCTIONS EXPORTÉES
// ============================================================================

export const askButlerAgent = async (history: { role: string; text: string }[], contextData: any) => {
  const systemPrompt = `Tu es le Majordome d'une famille française. Expert en organisation.
Liste de courses : ${contextData?.shopItems || "vide"}.
Si ajout demandé, réponds : {"action": "ADD_HUB", "item": "Nom", "reply": "Message"}.
Sinon, texte naturel.`;

  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Compris." }] },
    ...history.map(h => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] })),
  ];

  const text = await callGemini({ contents });
  const json = cleanJSON(text);
  if (json && json.action) return { type: "action", data: json };
  return { type: "text", data: text || "Je n'ai pas compris." };
};

export const askAIChat = async (history: { role: string; text: string }[]) => {
  const res = await askButlerAgent(history, {});
  return res.type === "text" ? res.data : "Action effectuée.";
};

export const readBarcodeFromImage = async (file: File): Promise<string | null> => {
  try {
    const b64 = await fileToBase64(file);
    const text = await callGemini({
      contents: [{
        parts: [
          { text: "Lis le code barre. Renvoie juste les chiffres." },
          { inline_data: { mime_type: file.type || "image/jpeg", data: b64 } },
        ],
      }],
    });
    return text ? text.replace(/\D/g, "") : null;
  } catch { return null; }
};

export const classifyFrigoItem = async (productName: string) => {
  const today = new Date().toISOString().split('T')[0];
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Classifie "${productName}". Réponds UNIQUEMENT en JSON : {"category": "...", "expiryDate": "YYYY-MM-DD"}. Aujourd'hui : ${today}.`
      }]
    }]
  });
  return cleanJSON(res);
};

export const scanProductImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    const today = new Date().toISOString().split('T')[0];
    const res = await callGemini({
      contents: [{
        parts: [
          { text: `Identifie ce produit. JSON UNIQUEMENT : {"name":"...","category":"...","expiryDate":"..."}. Aujourd'hui : ${today}.` },
          { inline_data: { mime_type: file.type || "image/jpeg", data: b64 } },
        ],
      }],
    });
    return cleanJSON(res);
  } catch { return null; }
};

export const extractRecipeFromUrl = async (url: string) => {
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Extrait la recette de cette URL : ${url}. Réponds UNIQUEMENT en JSON : {"title":"...","chef":"","category":"plat","ingredients":"...","steps":"..."}`
      }]
    }]
  });
  return cleanJSON(res);
};

export const extractProductFromUrl = async (url: string): Promise<{name: string, imageUrl: string, price: string} | null> => {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tools: [{ url_context: {} }], 
            contents: [{
              parts: [{
                text: `Accède à cette URL : ${url}
Extraie le NOM, le PRIX (XX,XX €) et l'URL de la PHOTO.
Réponds UNIQUEMENT en JSON : {"name":"Nom","price":"XX,XX €","imageUrl":"https://..."}`
              }]
            }],
            generationConfig: { temperature: 0 },
          }),
        }
      );

      if (!res.ok) continue;

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();

      if (!text) continue;

      const parsed = cleanJSON(text);
      if (parsed?.name) {
        return {
          name: parsed.name.split(/[|–—\-]/)[0].trim(),
          price: parsed.price || '',
          imageUrl: parsed.imageUrl || ''
        };
      }
    } catch { continue; }
  }
  return null;
};

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Modifie cette config JSON : "${prompt}". JSON UNIQUEMENT. Config : ${JSON.stringify(currentConfig)}`,
      }],
    }],
  });
  const json = cleanJSON(res);
  return json ? { ...currentConfig, ...json } : null;
};
