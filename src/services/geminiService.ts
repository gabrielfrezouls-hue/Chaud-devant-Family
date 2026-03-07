import { SiteConfig } from "../types";

// --- CONFIGURATION ---
const getApiKey = () => import.meta.env.VITE_GEMINI_KEY || "";

// --- UTILITAIRES ---
const cleanJSON = (text: string | null) => {
  if (!text) return null;
  try {
    // Retire les blocs markdown et espaces
    const stripped = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Tente parse direct
    return JSON.parse(stripped);
  } catch {
    try {
      // Extrait le premier objet JSON {} ou tableau [] trouvé dans le texte
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

// Tes modèles fonctionnels (Impératif)
const MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-06-17",
];

const callGeminiModel = async (model: string, payload: any): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) { console.error("⛔ VITE_GEMINI_KEY manquante"); return null; }
  
  // Utilisation de v1beta pour supporter les fonctionnalités avancées
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (res.status === 429) return "__QUOTA__"; // signal quota dépassé
    
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Gemini Error] ${model} ${res.status}:`, body.slice(0, 200));
      return null;
    }
    
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error(`[Network Error] Gemini ${model}:`, err);
    return null;
  }
};

const callGemini = async (payload: any): Promise<string | null> => {
  for (const model of MODELS) {
    const result = await callGeminiModel(model, payload);
    if (result === "__QUOTA__") {
      console.warn(`⚠️ Quota dépassé sur ${model}, essai du modèle suivant...`);
      continue;
    }
    if (result !== null) return result;
  }
  console.error("⛔ Tous les modèles Gemini sont en quota ou indisponibles.");
  return null;
};

// ============================================================================
// FONCTIONS EXPORTÉES
// ============================================================================

// 1. MAJORDOME AGENT (Chat + Actions directes)
export const askButlerAgent = async (
  history: { role: string; text: string }[],
  contextData: any
) => {
  const systemPrompt = `Tu es le Majordome d'une famille française. Expert en organisation domestique, cuisine, gestion de budget et anti-gaspi.
Liste de courses actuelle : ${contextData?.shopItems || "vide"}.
Si l'utilisateur demande d'ajouter un article à la liste de courses, réponds UNIQUEMENT avec ce JSON (sans markdown) :
{"action": "ADD_HUB", "item": "Nom de l'article", "reply": "Très bien, j'ai ajouté [article] à la liste de courses."}
Sinon, réponds en texte naturel, avec des conseils précis et bienveillants.`;

  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Compris, je suis votre Majordome. Comment puis-je vous aider ?" }] },
    ...history.map((h) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.text }],
    })),
  ];

  const text = await callGemini({ contents });
  const json = cleanJSON(text);
  if (json && json.action) return { type: "action", data: json };
  return { type: "text", data: text || "Je n'ai pas compris votre demande." };
};

// 2. CHAT SIMPLE (fallback)
export const askAIChat = async (history: { role: string; text: string }[]) => {
  const res = await askButlerAgent(history, {});
  return res.type === "text" ? res.data : "Action effectuée.";
};

// 2b. APPEL DIRECT GEMINI
export const callGeminiDirect = async (history: { role: string; text: string }[]): Promise<string | null> => {
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }],
  }));
  return callGemini({ contents });
};

// 3. SCANNER CODE BARRE via image (Vision)
export const readBarcodeFromImage = async (file: File): Promise<string | null> => {
  try {
    const b64 = await fileToBase64(file);
    const mimeType = file.type || "image/jpeg";
    const text = await callGemini({
      contents: [{
        parts: [
          { text: "Lis UNIQUEMENT les chiffres du code barre visible sur cette image. Renvoie seulement la suite de chiffres, rien d'autre. Si illisible, renvoie NULL." },
          { inline_data: { mime_type: mimeType, data: b64 } },
        ],
      }],
    });
    const digits = text ? text.replace(/\D/g, "") : null;
    return digits && digits.length > 5 ? digits : null;
  } catch {
    return null;
  }
};

// 4b. CLASSIFIER UN PRODUIT PAR NOM
export const classifyFrigoItem = async (productName: string) => {
  const today = new Date().toISOString().split('T')[0];
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Tu es un assistant de gestion de frigo familial. Classifie ce produit : "${productName}".
Réponds UNIQUEMENT avec un JSON strict sans markdown :
{
  "category": "UNE de ces catégories exactes : Boucherie/Poisson | Boulangerie | Plat préparé | Primeur | Frais & Crèmerie | Épicerie Salée | Épicerie Sucrée | Boissons | Surgelés | Divers",
  "expiryDate": "YYYY-MM-DD"
}
Règles pour expiryDate à partir du ${today} : Boucherie/Poisson +3j, Boulangerie +3j, Plat préparé +4j, Primeur +7j, Frais & Crèmerie +10j, Épicerie +90j, Surgelés +180j.`
      }]
    }]
  });
  return cleanJSON(res);
};

// 4c. SCAN PRODUIT IMAGE
export const scanProductImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    const mimeType = file.type || "image/jpeg";
    const today = new Date().toISOString().split('T')[0];
    const res = await callGemini({
      contents: [{
        parts: [
          {
            text: `Identifie ce produit alimentaire sur la photo. Réponds UNIQUEMENT avec ce JSON (sans markdown) :
{"name":"Nom en français","category":"Boucherie/Poisson ou Boulangerie ou Plat préparé ou Primeur ou Frais & Crèmerie ou Épicerie Salée ou Épicerie Sucrée ou Boissons ou Surgelés ou Divers","expiryDate":"YYYY-MM-DD"}
Calcule expiryDate à partir du ${today}.`,
          },
          { inline_data: { mime_type: mimeType, data: b64 } },
        ],
      }],
    });
    return cleanJSON(res);
  } catch(err) {
    console.error("[scanProductImage] error:", err);
    return null;
  }
};

// 5. IMPORTATEUR DE RECETTES
export const extractRecipeFromUrl = async (url: string) => {
  const proxies = [
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ];

  let html: string | null = null;
  for (const makeUrl of proxies) {
    try {
      const proxyUrl = makeUrl(url);
      const res = await fetch(proxyUrl);
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 500) { html = text; break; }
    } catch { continue; }
  }

  if (html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent || "");
          const items = Array.isArray(json) ? json : json["@graph"] ? json["@graph"] : [json];
          for (const item of items) {
            if (item["@type"] === "Recipe") {
              return {
                title: item.name || "Recette importée",
                chef: item.author?.name || "",
                category: "plat",
                ingredients: (item.recipeIngredient || []).join("\n"),
                steps: (item.recipeInstructions || []).map((s: any) => s.text || s).join("\n"),
              };
            }
          }
        } catch { continue; }
      }
    } catch { /* fallback */ }
  }

  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Extrait la recette de cette URL : ${url}. Réponds UNIQUEMENT avec ce JSON : {"title":"Titre","chef":"","category":"plat","ingredients":"ingrédient 1\\ningrédient 2","steps":"Étape 1\\nÉtape 2"}`
      }]
    }]
  });
  return cleanJSON(res);
};

// 7. EXTRACTION PRODUIT DEPUIS URL (WishList)
export const extractProductFromUrl = async (url: string): Promise<{name: string, imageUrl: string, price: string} | null> => {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  // Utilisation exclusive de tes modèles fonctionnels
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Note: url_context n'est pas supporté par tous les modèles, on l'utilise avec précaution
            tools: [{ url_context: {} }], 
            contents: [{
              parts: [{
                text: `Accède à cette URL de produit : ${url}
Extraie le NOM EXACT, le PRIX (XX,XX €) et l'URL de la PHOTO principale.
Réponds UNIQUEMENT avec ce JSON : {"name":"Nom","price":"XX,XX €","imageUrl":"https://..."}`
              }]
            }],
            generationConfig: { temperature: 0 },
          }),
        }
      );

      if (res.status === 429) continue; // Quota
      if (!res.ok) continue; // Erreur (404, etc.)

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
    } catch (err) {
      continue;
    }
  }

  return null;
};

// 8. ARCHITECTE UI
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Modifie cette config JSON : "${prompt}". Renvoie UNIQUEMENT le JSON. Config : ${JSON.stringify(currentConfig)}`,
      }],
    }],
  });
  const json = cleanJSON(res);
  return json ? { ...currentConfig, ...json } : null;
};
