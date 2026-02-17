import { SiteConfig } from "../types";

// ============================================================================
// CONFIGURATION & API KEY
// ============================================================================

// ⚠️ Assurez-vous d'avoir un fichier .env à la racine avec : VITE_GEMINI_KEY=votre_cle_ici
const getApiKey = () => {
  return import.meta.env.VITE_GEMINI_KEY || "";
};

// On utilise le modèle Flash, rapide et capable de lire des images
const MODEL_NAME = "gemini-1.5-flash"; 

// Fonction utilitaire pour nettoyer le JSON renvoyé par l'IA
const cleanJSON = (text: string) => {
  if (!text) return null;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    return null;
  }
};

// Fonction générique pour appeler l'API Google en HTTP (Sans librairie npm)
const callGeminiAPI = async (payload: any) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("⛔ CLÉ API MANQUANTE (VITE_GEMINI_KEY)");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.error(`Erreur API Gemini (${response.status}): ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("Erreur Réseau Gemini:", error);
    return null;
  }
};

// Fonction pour convertir une image en Base64 (pour l'envoyer à l'IA)
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result as string;
        // On retire l'en-tête "data:image/jpeg;base64,"
        resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// ============================================================================
// 2. FONCTIONS EXPORTÉES (Celles demandées par App.tsx)
// ============================================================================

// --- A. CHAT MAJORDOME SIMPLE ---
export const askAIChat = async (history: { role: string, text: string }[]) => {
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  // Instruction système
  const systemMsg = {
    role: 'user',
    parts: [{ text: "Tu es le Majordome de la maison. Poli, efficace, un peu british. Tu aides pour l'organisation." }]
  };

  const response = await callGeminiAPI({
    contents: [systemMsg, ...contents]
  });

  return response || "Je suis navré, je n'ai pas pu joindre mes serveurs.";
};

// --- B. MAJORDOME AGENT (Capable d'ajouter des items) ---
export const askButlerAgent = async (history: { role: string, text: string }[], contextData: any) => {
  const contextPrompt = `
    Tu es le Majordome intelligent.
    Si l'utilisateur veut ajouter un item aux courses ou au frigo, réponds avec un JSON strict :
    { "action": "ADD_HUB", "item": "Nom de l'article", "reply": "C'est noté monsieur." }
    Sinon, réponds normalement en texte brut.
  `;

  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  const response = await callGeminiAPI({
    contents: [{ role: "user", parts: [{ text: contextPrompt }] }, ...contents]
  });

  const jsonAction = cleanJSON(response);
  if (jsonAction && jsonAction.action) {
    return { type: 'action', data: jsonAction };
  }
  return { type: 'text', data: response };
};

// --- C. SCANNER CODE BARRE PAR IMAGE (IA lit les chiffres) ---
export const readBarcodeFromImage = async (file: File) => {
  try {
    const base64Data = await fileToBase64(file);
    const prompt = `
      Regarde cette image. Cherche un code-barres (EAN-13 ou EAN-8).
      Lis les chiffres qui sont écrits en dessous ou le code lui-même.
      Renvoie UNIQUEMENT les chiffres (ex: 3017620422003). Pas de texte.
      Si illisible, renvoie "NULL".
    `;

    const text = await callGeminiAPI({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: file.type, data: base64Data } }
        ]
      }]
    });

    const cleanText = text?.trim();
    // Vérifie si le résultat ressemble à un code barre (chiffres uniquement)
    return (cleanText && cleanText !== "NULL" && /^\d+$/.test(cleanText)) ? cleanText : null;
  } catch (e) {
    return null;
  }
};

// --- D. SCANNER PRODUIT FRAIS (Reconnaissance visuelle) ---
export const scanProductImage = async (file: File) => {
  try {
    const base64Data = await fileToBase64(file);
    const prompt = `
      Analyse ce produit alimentaire.
      Renvoie un JSON strict :
      {
        "name": "Nom du produit (avec marque si visible)",
        "category": "Catégorie (Frais, Épicerie, etc.)",
        "expiryDate": "YYYY-MM-DD"
      }
      Si tu ne vois pas de date, estime-la logiquement (ex: Salade = J+3, Pâtes = J+365).
      Format date obligatoire: YYYY-MM-DD.
    `;
    
    const response = await callGeminiAPI({
      contents: [{
        parts: [
            { text: prompt }, 
            { inline_data: { mime_type: file.type, data: base64Data } }
        ]
      }]
    });
    return cleanJSON(response);
  } catch (e) { return null; }
};

// --- E. ARCHITECTE ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const protectedConfig = { ...currentConfig, welcomeImage: "PROTECTED", homeHtml: "PROTECTED", cookingHtml: "PROTECTED" };
  const finalPrompt = `Expert UI/UX. Modifie cette config JSON selon : "${prompt}". Renvoie JSON uniquement. Champs modifiables: primaryColor, backgroundColor, fontFamily, welcomeTitle, welcomeText.`;
  
  const response = await callGeminiAPI({
    contents: [{ parts: [{ text: finalPrompt + "\nConfig: " + JSON.stringify(protectedConfig) }] }]
  });
  
  const newConfig = cleanJSON(response);
  if (newConfig) {
      newConfig.welcomeImage = currentConfig.welcomeImage;
      newConfig.homeHtml = currentConfig.homeHtml;
      newConfig.cookingHtml = currentConfig.cookingHtml;
      newConfig.navigationLabels = currentConfig.navigationLabels;
      return { ...currentConfig, ...newConfig };
  }
  return null;
};

// --- F. RECETTE VIA URL ---
export const extractRecipeFromUrl = async (url: string) => {
    const prompt = `Extrais la recette de ce lien/texte: ${url}. JSON strict: {title, chef, category, ingredients, steps}`;
    const response = await callGeminiAPI({ contents: [{ parts: [{ text: prompt }] }] });
    return cleanJSON(response);
};
