import { SiteConfig } from "../types";

// --- CONFIGURATION ---
// Utilise la clé API définie dans ton fichier .env (VITE_GEMINI_KEY)
const getApiKey = () => import.meta.env.VITE_GEMINI_KEY || "";

// --- UTILITAIRES ---
const cleanJSON = (text: string | null) => {
  if (!text) return null;
  try {
    // Retire les blocs markdown json et les espaces superflus
    const stripped = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(stripped);
  } catch {
    try {
      // Extraction de secours du premier objet ou tableau JSON trouvé
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

// Modèles réels et performants (Gemini 2.5 n'existe pas encore)
const MODELS = [
  "gemini-1.5-flash",
  "gemini-2.0-flash",
];

const callGeminiModel = async (model: string, payload: any): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) { 
    console.error("⛔ VITE_GEMINI_KEY manquante dans l'environnement."); 
    return null; 
  }
  
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
      console.error(`Erreur Gemini ${model} (${res.status}):`, body);
      return null;
    }
    
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error(`Erreur réseau Gemini ${model}:`, err);
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
  return null;
};

// Proxy CORS pour récupérer le contenu des pages (Amazon, Ikea, etc.)
const fetchHtmlViaProxy = async (url: string): Promise<string | null> => {
  const proxies = [
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ];

  for (const makeUrl of proxies) {
    try {
      const proxyUrl = makeUrl(url);
      const res = await fetch(proxyUrl);
      if (!res.ok) continue;
      
      // Certains proxies encapsulent le résultat dans un objet JSON
      const data = await res.json().catch(() => null);
      const html = data?.contents || (typeof data === 'string' ? data : await res.text());
      
      if (html && html.length > 500) return html;
    } catch { continue; }
  }
  return null;
};

// ============================================================================
// FONCTIONS EXPORTÉES
// ============================================================================

// 1. AGENT MAJORDOME (Chat + Actions)
export const askButlerAgent = async (
  history: { role: string; text: string }[],
  contextData: any
) => {
  const systemPrompt = `Tu es le Majordome d'une famille française. Expert en organisation domestique et cuisine.
Liste de courses actuelle : ${contextData?.shopItems || "vide"}.
Si l'utilisateur demande d'ajouter un article, réponds UNIQUEMENT avec ce JSON :
{"action": "ADD_HUB", "item": "Nom de l'article", "reply": "Très bien, j'ai ajouté [article] à la liste."}
Sinon, réponds en texte naturel.`;

  const contents = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Compris, je suis votre Majordome." }] },
    ...history.map(h => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.text }],
    })),
  ];

  const text = await callGemini({ contents });
  const json = cleanJSON(text);
  if (json && json.action) return { type: "action", data: json };
  return { type: "text", data: text || "Je n'ai pas pu traiter votre demande." };
};

// 2. CHAT SIMPLE
export const askAIChat = async (history: { role: string; text: string }[]) => {
  const res = await askButlerAgent(history, {});
  return res.type === "text" ? res.data : "Action effectuée.";
};

// 3. SCANNER CODE BARRE (Vision)
export const readBarcodeFromImage = async (file: File): Promise<string | null> => {
  try {
    const b64 = await fileToBase64(file);
    const text = await callGemini({
      contents: [{
        parts: [
          { text: "Lis UNIQUEMENT les chiffres du code barre sur cette image. Renvoie juste les chiffres ou NULL." },
          { inline_data: { mime_type: file.type || "image/jpeg", data: b64 } },
        ],
      }],
    });
    const digits = text ? text.replace(/\D/g, "") : null;
    return digits && digits.length > 5 ? digits : null;
  } catch { return null; }
};

// 4. CLASSIFICATION PRODUIT (Texte)
export const classifyFrigoItem = async (productName: string) => {
  const today = new Date().toISOString().split('T')[0];
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Classifie ce produit : "${productName}". Réponds UNIQUEMENT en JSON :
        {"category": "Boucherie/Poisson | Boulangerie | Plat préparé | Primeur | Frais & Crèmerie | Épicerie Salée | Épicerie Sucrée | Boissons | Surgelés | Divers", "expiryDate": "YYYY-MM-DD"}
        Base-toi sur la date du jour : ${today}.`
      }]
    }]
  });
  return cleanJSON(res);
};

// 5. SCAN PRODUIT (Vision)
export const scanProductImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    const today = new Date().toISOString().split('T')[0];
    const res = await callGemini({
      contents: [{
        parts: [
          { text: `Identifie ce produit. Réponds UNIQUEMENT en JSON : {"name":"Nom","category":"Catégorie","expiryDate":"YYYY-MM-DD"}. Date du jour : ${today}.` },
          { inline_data: { mime_type: file.type || "image/jpeg", data: b64 } },
        ],
      }],
    });
    return cleanJSON(res);
  } catch { return null; }
};

// 6. IMPORTATEUR DE RECETTES (URL)
export const extractRecipeFromUrl = async (url: string) => {
  const html = await fetchHtmlViaProxy(url);
  let prompt = `Extrait la recette de cette URL : ${url}. Réponds UNIQUEMENT en JSON : {"title":"Titre","chef":"","category":"plat","ingredients":"ingrédient 1\\ningrédient 2","steps":"Étape 1\\nÉtape 2"}`;
  
  if (html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, nav, footer").forEach(el => el.remove());
    const bodyText = doc.body.innerText.replace(/\s+/g, " ").trim().substring(0, 8000);
    prompt = `Extrait la recette depuis ce texte : ${bodyText}. Réponds UNIQUEMENT en JSON : {"title":"Titre","chef":"","category":"plat","ingredients":"ingrédient 1\\ningrédient 2","steps":"Étape 1\\nÉtape 2"}`;
  }

  const res = await callGemini({ contents: [{ parts: [{ text: prompt }] }] });
  return cleanJSON(res);
};

// 7. EXTRACTION PRODUIT (WishList) - VERSION CORRIGÉE
export const extractProductFromUrl = async (url: string): Promise<{name: string, imageUrl: string, price: string} | null> => {
  const html = await fetchHtmlViaProxy(url);
  
  let prompt = "";
  if (html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, nav, footer, header").forEach(el => el.remove());
    const bodyText = doc.body.innerText.replace(/\s+/g, " ").trim().substring(0, 10000);
    
    prompt = `Analyse ce contenu de page web et extrais les infos du produit :
    Contenu : ${bodyText}
    Réponds UNIQUEMENT avec ce JSON (sans markdown) :
    {"name":"Nom exact du produit","price":"XX,XX €","imageUrl":"URL de l'image principale"}`;
  } else {
    prompt = `Extrais les infos du produit (nom, prix, image) à cette URL : ${url}.
    Réponds UNIQUEMENT avec ce JSON : {"name":"Nom","price":"XX,XX €","imageUrl":"URL"}`;
  }

  const res = await callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0 }
  });

  const parsed = cleanJSON(res);
  if (parsed?.name) {
    // Nettoyage du nom pour retirer les suffixes de sites
    const name = parsed.name.split(/[|–—\-]/)[0].trim();
    return {
      name: name || parsed.name,
      price: parsed.price || "",
      imageUrl: parsed.imageUrl || ""
    };
  }
  return null;
};

// 8. ARCHITECTE UI
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Modifie cette config JSON selon : "${prompt}". Renvoie UNIQUEMENT le JSON modifié.
        Config : ${JSON.stringify(currentConfig)}`,
      }],
    }],
  });
  const json = cleanJSON(res);
  return json ? { ...currentConfig, ...json } : null;
};
