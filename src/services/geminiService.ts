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

// Modèle fonctionnel sur free tier EU
const MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-06-17", // alias alternatif
];

const callGeminiModel = async (model: string, payload: any): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) { console.error("⛔ VITE_GEMINI_KEY manquante"); return null; }
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
      console.error(`Erreur Gemini ${model} ${res.status}:`, body);
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

// 5. IMPORTATEUR DE RECETTES depuis URL
// Cascade de proxies CORS + fallback IA Gemini
export const extractRecipeFromUrl = async (url: string) => {
  // Liste de proxies CORS gratuits à essayer dans l'ordre
  const proxies = [
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ];

  let html: string | null = null;

  // Essai de chaque proxy
  for (const makeUrl of proxies) {
    try {
      const proxyUrl = makeUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json().catch(async () => {
        // Certains proxies renvoient du HTML direct (pas JSON)
        return null;
      });
      if (data?.contents) { html = data.contents; break; }
      // Fallback si proxy renvoie texte brut
      const text = await res.text().catch(() => null);
      if (text && text.length > 500) { html = text; break; }
    } catch { continue; }
  }

  // Si on a du HTML → tente schema.org/Recipe
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
            const recipe = item["@type"] === "Recipe" ? item : null;
            if (!recipe) continue;
            const ingredients = (recipe.recipeIngredient || []).join("\n");
            const stepsRaw = recipe.recipeInstructions || [];
            const steps = stepsRaw.map((s: any) => typeof s === "string" ? s : s.text || "").filter(Boolean).join("\n");
            const chef = typeof recipe.author === "string" ? recipe.author : recipe.author?.name || "";
            const cat = (recipe.recipeCategory || "plat").toLowerCase();
            return {
              title: recipe.name || "Recette importée",
              chef,
              category: cat.includes("dessert") ? "dessert" : cat.includes("entr") ? "entrée" : "plat",
              ingredients,
              steps,
            };
          }
        } catch { continue; }
      }

      // Fallback meta
      const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content")
        || doc.querySelector("h1")?.textContent?.trim() || "Recette importée";
      return { title, chef: "", category: "plat",
        ingredients: "⚠️ Ingrédients non détectés — à saisir manuellement",
        steps: "⚠️ Étapes non détectées — à saisir manuellement" };
    } catch { /* continue to AI fallback */ }
  }

  // Fallback IA : demande à Gemini d'extraire depuis l'URL
  try {
    const res = await callGemini({
      contents: [{
        parts: [{
          text: `Extrait les informations de la recette à cette URL : ${url}
Si tu ne peux pas accéder à l'URL, génère une recette plausible basée sur le titre dans l'URL.
Réponds UNIQUEMENT avec ce JSON :
{"title":"Titre","chef":"","category":"plat","ingredients":"ingrédient 1\\ningrédient 2","steps":"Étape 1\\nÉtape 2"}`
        }]
      }]
    });
    const parsed = cleanJSON(res);
    if (parsed?.title) return parsed;
  } catch { /* ignore */ }

  console.error("Erreur import recette: tous les proxies ont échoué");
  return null;
};

// 7. EXTRACTION PRODUIT DEPUIS URL (pour WishList)
// Même approche que extractRecipeFromUrl : proxies CORS → schema.org/Product → meta OG → Gemini HTML → Gemini URL seule
export const extractProductFromUrl = async (url: string): Promise<{name: string, imageUrl: string, price: string} | null> => {

  const proxies = [
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  ];

  let html: string | null = null;

  // ─── Étape 1 : récupérer le HTML via proxies ───
  for (const makeUrl of proxies) {
    try {
      const proxyUrl = makeUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json().catch(async () => null);
      if (data?.contents) { html = data.contents; break; }
      const text = await res.text().catch(() => null);
      if (text && text.length > 500) { html = text; break; }
    } catch { continue; }
  }

  // ─── Étape 2 : parser le HTML ───
  if (html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 2a. schema.org/Product (JSON-LD) — la source la plus fiable
      const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent || '');
          const items = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];
          for (const item of items) {
            // Chercher un objet de type Product (ou un sous-type)
            const types: string[] = Array.isArray(item['@type']) ? item['@type'] : [item['@type'] || ''];
            if (!types.some(t => typeof t === 'string' && t.toLowerCase().includes('product'))) continue;

            const name: string = item.name || '';
            // Image : string ou tableau ou objet ImageObject
            let imageUrl = '';
            const img = item.image;
            if (typeof img === 'string') imageUrl = img;
            else if (Array.isArray(img)) imageUrl = typeof img[0] === 'string' ? img[0] : img[0]?.url || '';
            else if (img?.url) imageUrl = img.url;

            // Prix : dans offers (objet ou tableau)
            let price = '';
            const offers = item.offers;
            if (offers) {
              const offerArr = Array.isArray(offers) ? offers : [offers];
              const firstOffer = offerArr[0];
              if (firstOffer?.price !== undefined) {
                const currency = firstOffer.priceCurrency || '€';
                const sym = currency === 'EUR' ? '€' : currency;
                price = `${String(firstOffer.price).replace('.', ',')} ${sym}`;
              }
            }

            if (name.length > 2) return { name, imageUrl, price };
          }
        } catch { continue; }
      }

      // 2b. Meta OG + microdata pour nom, image, prix
      const ogName =
        doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
        doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
        doc.querySelector('h1')?.textContent?.trim() || '';

      const ogImage =
        doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
        doc.querySelector('meta[property="og:image:url"]')?.getAttribute('content') ||
        doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
        doc.querySelector('meta[name="twitter:image:src"]')?.getAttribute('content') || '';

      const priceRaw =
        doc.querySelector('[itemprop="price"]')?.getAttribute('content') ||
        doc.querySelector('[itemprop="price"]')?.textContent?.trim() ||
        doc.querySelector('meta[property="product:price:amount"]')?.getAttribute('content') ||
        doc.querySelector('meta[name="twitter:data1"]')?.getAttribute('content') ||
        doc.querySelector('.a-price-whole')?.textContent?.trim() || '';
      const priceMatch = priceRaw.match(/\d[\d\s]*[.,]\d{2}/);
      const ogPrice = priceMatch ? priceMatch[0].replace(/\s/g, '') + ' €' : '';

      const cleanName = ogName.replace(/\s*[|–\-]\s*(Amazon|Cdiscount|Fnac|Darty|Zalando|IKEA|Carrefour|Leclerc|Rakuten|La Redoute|Boulanger|Leroy Merlin).*$/i, '').trim();

      if (cleanName.length > 3) {
        // Si image ou prix manquants → Gemini lit le HTML
        if (!ogImage || !ogPrice) {
          const snippet = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .substring(0, 8000);
          const r = await callGemini({
            contents: [{
              parts: [{
                text: `Tu es un extracteur de données produit. Voici du HTML partiel d'une page boutique en ligne.
Nom trouvé : "${cleanName}" | Image : "${ogImage||'?'}" | Prix : "${ogPrice||'?'}"

HTML :
${snippet}

Extrait les informations manquantes. JSON strict (pas de markdown) :
{"imageUrl":"URL absolue de l'image principale ou vide","price":"XX,XX € ou vide"}

Règles :
- imageUrl : URL commençant par http depuis le HTML réel (balises <img src=, og:image, twitter:image, schema.org image). Ne génère RIEN d'inventé.
- price : cherche JSON-LD offers.price, itemprop=price, class *price*, *prix*, meta product:price:amount. Format "XX,XX €". Ne génère aucun prix inventé.`
              }]
            }]
          });
          const parsed = cleanJSON(r);
          return {
            name: cleanName,
            imageUrl: parsed?.imageUrl || ogImage,
            price: parsed?.price || ogPrice,
          };
        }
        return { name: cleanName, imageUrl: ogImage, price: ogPrice };
      }

      // 2c. Nom introuvable → Gemini analyse tout le HTML
      const snippet = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .substring(0, 8000);
      const r = await callGemini({
        contents: [{
          parts: [{
            text: `Tu es un extracteur de données produit. Voici du HTML partiel d'une page boutique.

HTML :
${snippet}

Extrait les informations du produit. JSON strict (pas de markdown) :
{"name":"Nom commercial du produit","imageUrl":"URL absolue image principale ou vide","price":"XX,XX € ou vide"}

Règles :
- name : nom du produit (pas le nom du site ni de la marque du site)
- imageUrl : URL absolue réelle du HTML. Ne génère RIEN d'inventé.
- price : prix numérique avec devise. Ne génère aucun prix inventé.`
          }]
        }]
      });
      const p = cleanJSON(r);
      if (p?.name?.length > 2) return { name: p.name, imageUrl: p.imageUrl || '', price: p.price || '' };

    } catch { /* continue vers fallback */ }
  }

  // ─── Étape 3 : Gemini analyse l'URL seule (nom uniquement) ───
  try {
    const res = await callGemini({
      contents: [{
        parts: [{
          text: `Déduis le nom commercial du produit depuis cette URL de boutique en ligne.
URL : ${url}
Utilise les segments du chemin (tirets → espaces, Title Case). Pour Amazon, prends la partie avant /dp/.
Réponds UNIQUEMENT avec ce JSON (pas de markdown) :
{"name":"Nom déduit","imageUrl":"","price":""}`
        }]
      }]
    });
    const parsed = cleanJSON(res);
    if (parsed?.name?.length > 2) return { name: parsed.name, imageUrl: '', price: '' };
  } catch { /* ignore */ }

  // ─── Étape 4 : extraction brute URL ───
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(s =>
      s.length > 3 && !/^(dp|ref|sr|B0[A-Z0-9]{6,}|p|s|product|item|detail|buy|catalog)$/i.test(s)
    );
    const raw = decodeURIComponent(segments[0] || '').replace(/[-_+]/g, ' ').replace(/\s+/g, ' ').trim();
    const titled = raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    if (titled.length > 3) return { name: titled, imageUrl: '', price: '' };
  } catch { /* ignore */ }

  return null;
};
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
