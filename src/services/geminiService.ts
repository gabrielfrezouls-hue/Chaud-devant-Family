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

// MODÈLES DISPONIBLES SUR CETTE CLÉ API (EU)
// ✅ gemini-2.5-flash-lite : stable, disponible, scan/vision/JSON
// ✅ gemini-2.0-flash      : fallback, supporte url_context mais quota 429 fréquent
// ❌ gemini-1.5-flash      : 404 sur cette clé — ne pas utiliser
// ❌ gemini-1.5-flash-latest : 404 sur cette clé — ne pas utiliser
const MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

const callGeminiModel = async (model: string, payload: any): Promise<string | null> => {
  const apiKey = getApiKey();
  if (!apiKey) { console.error("VITE_GEMINI_KEY manquante"); return null; }

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
      console.warn(`Quota 429 sur ${model}, essai du suivant...`);
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

export const callGeminiDirect = async (history: { role: string; text: string }[]): Promise<string | null> => {
  const contents = history.map(h => ({
    role: h.role === "user" ? "user" : "model",
    parts: [{ text: h.text }],
  }));
  return callGemini({ contents });
};

export const readBarcodeFromImage = async (file: File): Promise<string | null> => {
  try {
    const b64 = await fileToBase64(file);
    const text = await callGemini({
      contents: [{
        parts: [
          { text: "Lis le code barre. Renvoie juste les chiffres, rien d'autre." },
          { inline_data: { mime_type: file.type || "image/jpeg", data: b64 } },
        ],
      }],
    });
    const digits = text ? text.replace(/\D/g, "") : null;
    return digits && digits.length > 5 ? digits : null;
  } catch { return null; }
};

export const classifyFrigoItem = async (productName: string) => {
  const today = new Date().toISOString().split("T")[0];
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Classifie ce produit pour un frigo/cellier familial : "${productName}".

RÈGLE CRITIQUE — Primeur (FRIGO, se conserve au froid) :
Tout fruit ou légume FRAIS va en "Primeur" : pomme, poire, banane, citron, orange, mangue, fraise, raisin, kiwi, tomate, carotte, courgette, poireau, oignon, ail, salade, épinard, brocoli, choufleur, chou, poivron, concombre, aubergine, radis, betterave, céleri, poireau, fenouil, asperge, artichaut, avocat, champignon, gingembre, curcuma frais, herbes fraîches (basilic, persil, coriandre, menthe, ciboulette), pomme de terre (si non stockée en cave).

DIFFÉRENCE épicerie vs primeur :
- Gingembre FRAIS → Primeur (frigo)
- Gingembre EN POUDRE → Épicerie Salée (cellier)
- Ail FRAIS → Primeur
- Ail EN POUDRE → Épicerie Salée
- Jus de fruit (bouteille) → Boissons (cellier)

Réponds UNIQUEMENT en JSON sans markdown :
{"category":"Boucherie/Poisson|Boulangerie|Plat préparé|Primeur|Frais & Crèmerie|Épicerie Salée|Épicerie Sucrée|Boissons|Surgelés|Divers","expiryDate":"YYYY-MM-DD"}

Calcule expiryDate depuis ${today} :
- Boucherie/Poisson : +3j
- Boulangerie : +3j
- Plat préparé : +4j
- Primeur (fruits/légumes) : +7j (fragiles comme fraise/salade : +4j)
- Frais & Crèmerie : +10j
- Épicerie Salée/Sucrée : +90j
- Boissons : +90j
- Surgelés : +180j
- Divers : +14j`
      }]
    }]
  });
  return cleanJSON(res);
};

export const scanProductImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    const today = new Date().toISOString().split("T")[0];
    const res = await callGemini({
      contents: [{
        parts: [
          {
            text: `Identifie ce produit alimentaire. Réponds UNIQUEMENT en JSON sans markdown :
{"name":"Nom en français","category":"Boucherie/Poisson|Boulangerie|Plat préparé|Primeur|Frais & Crèmerie|Épicerie Salée|Épicerie Sucrée|Boissons|Surgelés|Divers","expiryDate":"YYYY-MM-DD"}
Calcule expiryDate depuis ${today}. Si date lisible sur l'emballage, utilise-la.`
          },
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
        text: `Extrait la recette depuis cette URL : ${url}
Si inaccessible, génère une recette plausible à partir du titre dans l'URL.
Réponds UNIQUEMENT en JSON sans markdown :
{"title":"Titre","chef":"","category":"plat","ingredients":"ingrédient 1\ningrédient 2","steps":"Étape 1\nÉtape 2"}`
      }]
    }]
  });
  return cleanJSON(res);
};

// EXTRACTION PRODUIT DEPUIS URL (WishList)
// Utilise le tool "url_context" : Gemini fetch lui-même la page côté serveurs Google.
// Contourne Cloudflare/Amazon sans backend. Dispo sur gemini-2.5-flash-lite + gemini-2.0-flash.
// Normalise une URL e-commerce pour maximiser la compatibilité avec url_context
// Amazon : extrait l'ASIN et reconstruit une URL canonique /dp/ASIN
// Autres sites : supprime les paramètres tracking
const normalizeProductUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    // ── Amazon : URL canonique /dp/ASIN (sans query params) ──
    if (host.includes("amazon.")) {
      const asinMatch = path.match(/\/dp\/([A-Z0-9]{10})/);
      if (asinMatch) {
        const domain = host.includes("amazon.fr") ? "www.amazon.fr"
          : host.includes("amazon.co.uk") ? "www.amazon.co.uk"
          : host.includes("amazon.de") ? "www.amazon.de"
          : "www.amazon.com";
        return `https://${domain}/dp/${asinMatch[1]}`;
      }
    }

    // ── Sites courants : supprimer les query params tracking ──
    const cleanHosts = ["fnac.", "darty.", "ikea.", "boulanger.", "cdiscount.",
                        "zalando.", "decathlon.", "leroy", "manomano.", "cultura.",
                        "rakuten.", "ldlc.", "rue-du-commerce.", "materiel.net"];
    if (cleanHosts.some(s => host.includes(s))) {
      return `${parsed.protocol}//${parsed.host}${path}`.replace(/\/$/, "");
    }

    return url;
  } catch {
    return url;
  }
};

export const extractProductFromUrl = async (url: string): Promise<{ name: string; imageUrl: string; price: string } | null> => {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  // Normaliser l'URL (Amazon ASIN propre, supprimer tracking params)
  const cleanUrl = normalizeProductUrl(url);
  console.log(`[extractProduct] URL originale: ${url}`);
  console.log(`[extractProduct] URL normalisée: ${cleanUrl}`);

  // url_context fonctionne mieux avec gemini-2.0-flash — on le met en premier ici
  const urlContextModels = MODELS.includes("gemini-2.0-flash")
    ? ["gemini-2.0-flash", ...MODELS.filter(m => m !== "gemini-2.0-flash")]
    : MODELS;

  for (const model of urlContextModels) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tools: [{ url_context: {} }],
            contents: [{
              parts: [{
                text: `Accède à cette URL de produit : ${cleanUrl}

Lis la page et extrais :
1. Le NOM EXACT du produit (nom commercial complet, sans mention du site vendeur)
2. Le PRIX affiché (format "XX,XX €" — chaîne vide si introuvable)
3. L'URL directe de la PHOTO principale (commence par https://, extension .jpg/.jpeg/.png/.webp — chaîne vide si introuvable)

Réponds UNIQUEMENT en JSON sans markdown :
{"name":"Nom exact","price":"XX,XX €","imageUrl":"https://..."}

Règles : ne génère rien d'inventé, price="" si introuvable, imageUrl="" si incertaine.`
              }]
            }],
            generationConfig: { temperature: 0 },
          }),
        }
      );
      clearTimeout(timer);

      if (res.status === 429) { console.warn(`[extractProduct] 429 sur ${model}`); continue; }
      if (!res.ok) { console.warn(`[extractProduct] ${model} ${res.status}`); continue; }

      const data = await res.json();
      // url_context retourne plusieurs parts — on fusionne les textes
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("").trim();

      if (!text) continue;

      const parsed = cleanJSON(text);
      if (!parsed?.name || parsed.name.length < 2) continue;

      // Nettoyer le nom (retirer " - Amazon", " | Fnac", etc.)
      const name = parsed.name
        .replace(/\s*[|–—\-]\s*(Amazon|Fnac|Darty|Zalando|IKEA|Carrefour|Leclerc|Rakuten|Boulanger|Leroy Merlin|Cdiscount|La Redoute|Decathlon|Cultura|Manomano).*$/i, "")
        .trim();

      // Valider prix
      let price = parsed.price || "";
      if (price && !/\d/.test(price)) price = "";

      // Valider imageUrl
      let imageUrl = parsed.imageUrl || "";
      if (imageUrl && (!imageUrl.startsWith("https://") || !/\.(jpg|jpeg|png|webp|avif)/i.test(imageUrl))) {
        imageUrl = "";
      }

      if (name.length > 1) return { name, price, imageUrl };

    } catch (err) {
      console.warn(`[extractProduct] ${model}:`, err);
      continue;
    }
  }

  // Fallback : déduire le nom depuis l'URL
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split("/").filter(s =>
      s.length > 3 && !/^(dp|ref|sr|p|s|product|item|detail|buy|catalog|[A-Z0-9]{10})$/i.test(s)
    );
    const raw = decodeURIComponent(segments[0] || "").replace(/[-_+]/g, " ").trim();
    if (raw.length > 3) {
      const name = raw.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      return { name, imageUrl: "", price: "" };
    }
  } catch { /* ignore */ }

  return null;
};

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Tu es un expert UI/UX. Modifie la configuration JSON du site selon : "${prompt}".
Réponds UNIQUEMENT en JSON sans markdown.
Config actuelle : ${JSON.stringify(currentConfig)}`,
      }],
    }],
  });
  const json = cleanJSON(res);
  return json ? { ...currentConfig, ...json } : null;
};
