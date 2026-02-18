import { SiteConfig } from "../types";

// --- CONFIGURATION ---
const getApiKey = () => import.meta.env.VITE_GEMINI_KEY || "";
const MODEL_NAME = "gemini-1.5-flash-latest";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

// --- UTILITAIRES ---
const cleanJSON = (text: string | null) => {
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
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

// 3. SCANNER CODE BARRE via image (Vision)
export const readBarcodeFromImage = async (file: File): Promise<string | null> => {
  try {
    const b64 = await fileToBase64(file);
    const text = await callGemini({
      contents: [{
        parts: [
          { text: "Lis UNIQUEMENT les chiffres du code barre visible sur cette image. Renvoie seulement la suite de chiffres, rien d'autre. Si illisible, renvoie NULL." },
          { inline_data: { mime_type: file.type, data: b64 } },
        ],
      }],
    });
    const digits = text ? text.replace(/\D/g, "") : null;
    return digits && digits.length > 5 ? digits : null;
  } catch {
    return null;
  }
};

// 4. SCANNER PRODUIT FRAIS par photo (Vision)
export const scanProductImage = async (file: File) => {
  try {
    const b64 = await fileToBase64(file);
    const res = await callGemini({
      contents: [{
        parts: [
          {
            text: `Identifie ce produit alimentaire sur la photo.
Renvoie UNIQUEMENT un JSON strict sans markdown :
{"name": "Nom du produit en français", "category": "Frais/Épicerie/Légume/Viande/etc.", "expiryDate": "YYYY-MM-DD"}
Pour expiryDate, estime une date logique à partir d'aujourd'hui si non visible (lait = +7j, pommes = +14j, yaourt = +21j, fromage = +14j).`,
          },
          { inline_data: { mime_type: file.type, data: b64 } },
        ],
      }],
    });
    return cleanJSON(res);
  } catch {
    return null;
  }
};

// 5. IMPORTATEUR DE RECETTES depuis URL
export const extractRecipeFromUrl = async (url: string) => {
  const res = await callGemini({
    contents: [{
      parts: [{
        text: `Analyse cette URL de recette et extrais toutes les informations disponibles : "${url}".
Renvoie UNIQUEMENT un JSON strict sans markdown :
{"title": "Titre de la recette", "chef": "Auteur si disponible sinon vide", "category": "plat ou dessert ou entrée ou autre", "ingredients": "ingrédient 1\\ningrédient 2\\ningrédient 3", "steps": "Étape 1 : ...\\nÉtape 2 : ..."}
Les ingrédients et étapes sont séparés par des \\n.`,
      }],
    }],
  });
  return cleanJSON(res);
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
