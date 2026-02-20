import { SiteConfig } from "../types";

// --- CONFIGURATION ---
const getApiKey = () => import.meta.env.VITE_GEMINI_KEY || "";
const MODEL_NAME = "gemini-2.0-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

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

const callGemini = async (payload: any): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("⛔ VITE_GEMINI_KEY manquante dans .env");
    return null;
  }
  try {
    const res = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Erreur Gemini ${res.status}:`, body);
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error("Erreur réseau Gemini:", err);
    return null;
  }
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

// 2b. APPEL DIRECT GEMINI (pour usage interne avancé, ex: notifications IA)
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

// 4b. CLASSIFIER UN PRODUIT PAR NOM (texte → catégorie + date estimée)
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
Règles pour expiryDate à partir du ${today} :
- Boucherie/Poisson → +3 jours
- Boulangerie → +3 jours  
- Plat préparé → +4 jours
- Primeur (légumes, fruits) → +7 jours
- Frais & Crèmerie (lait, yaourt, fromage, œufs) → +10 jours
- Épicerie Salée / Épicerie Sucrée → +90 jours
- Boissons → +90 jours
- Surgelés → +180 jours
- Divers → +14 jours`
      }]
    }]
  });
  return cleanJSON(res);
};
export const scanProductImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    // Sur mobile, file.type peut être vide — fallback sur image/jpeg
    const mimeType = file.type || "image/jpeg";
    const today = new Date().toISOString().split('T')[0];
    const res = await callGemini({
      contents: [{
        parts: [
          {
            text: `Identifie ce produit alimentaire sur la photo. Réponds UNIQUEMENT avec ce JSON (sans markdown, sans texte avant ou après) :
{"name":"Nom en français","category":"Boucherie/Poisson ou Boulangerie ou Plat préparé ou Primeur ou Frais & Crèmerie ou Épicerie Salée ou Épicerie Sucrée ou Boissons ou Surgelés ou Divers","expiryDate":"YYYY-MM-DD"}
Calcule expiryDate à partir du ${today} : Boucherie/Poisson +3j, Boulangerie +3j, Plat préparé +4j, Primeur +7j, Frais & Crèmerie +10j, Épicerie/Boissons +90j, Surgelés +180j. Si une date limite est lisible sur l'emballage, utilise-la.`,
          },
          { inline_data: { mime_type: mimeType, data: b64 } },
        ],
      }],
    });
    console.log("[scanProductImage] raw:", res);
    const parsed = cleanJSON(res);
    console.log("[scanProductImage] parsed:", parsed);
    return parsed;
  } catch(err) {
    console.error("[scanProductImage] error:", err);
    return null;
  }
};

// 5. IMPORTATEUR DE RECETTES depuis URL (sans IA — lecture du schema.org/Recipe)
export const extractRecipeFromUrl = async (url: string) => {
  try {
    // allorigins.win est un proxy CORS gratuit qui permet de lire n'importe quelle page web
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error("Proxy inaccessible");
    const data = await res.json();
    const html: string = data.contents;

    // Parse le HTML pour extraire le JSON-LD (format schema.org/Recipe)
    // La quasi-totalité des sites de recettes (Marmiton, 750g, etc.) l'utilisent
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));

    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent || "");
        // Cherche le bon objet (peut être un tableau ou direct)
        const recipes = Array.isArray(json) ? json : [json];
        for (const item of recipes) {
          const recipe = item["@type"] === "Recipe" ? item
            : item["@graph"]?.find((g: any) => g["@type"] === "Recipe");
          if (!recipe) continue;

          // Extrait les ingrédients
          const ingredients = (recipe.recipeIngredient || []).join("\n");

          // Extrait les étapes
          const stepsRaw = recipe.recipeInstructions || [];
          const steps = stepsRaw
            .map((s: any) => typeof s === "string" ? s : s.text || "")
            .filter(Boolean)
            .join("\n");

          // Extrait l'auteur
          const chef = typeof recipe.author === "string"
            ? recipe.author
            : recipe.author?.name || "";

          // Catégorie
          const cat = (recipe.recipeCategory || "plat").toLowerCase();

          return {
            title: recipe.name || "Recette importée",
            chef,
            category: cat.includes("dessert") ? "dessert"
              : cat.includes("entr") ? "entrée" : "plat",
            ingredients,
            steps,
          };
        }
      } catch { continue; }
    }

    // Fallback : si pas de schema.org, tente de lire les balises meta
    const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content")
      || doc.querySelector("h1")?.textContent?.trim()
      || "Recette importée";

    return {
      title,
      chef: "",
      category: "plat",
      ingredients: "⚠️ Ingrédients non détectés automatiquement — à saisir manuellement",
      steps: "⚠️ Étapes non détectées automatiquement — à saisir manuellement",
    };

  } catch (err) {
    console.error("Erreur import recette:", err);
    return null;
  }
};

// 6. ARCHITECTE IA (modification du design/config)
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Tu es un expert UI/UX. Modifie la configuration JSON du site selon cette demande : "${prompt}".
Renvoie UNIQUEMENT le JSON modifié sans markdown ni explication.
Config actuelle : ${JSON.stringify(currentConfig)}`,
      }],
    }],
  });
  const json = cleanJSON(res);
  return json ? { ...currentConfig, ...json } : null;
};
