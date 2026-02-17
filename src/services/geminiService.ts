import { SiteConfig } from "../types";

// ✅ SÉCURITÉ CLÉ API
const getApiKey = () => {
  // Tente de récupérer la clé, sinon retourne une chaine vide pour éviter le crash immédiat
  return import.meta.env.VITE_GEMINI_KEY || "";
};

const MODEL_NAME = "gemini-1.5-flash"; 

// Fonction générique API
const callGeminiAPI = async (payload: any) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("⛔ CLÉ API MANQUANTE DANS LE FICHIER .ENV");
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
      // Gestion spécifique des erreurs 404 ou 400
      console.error(`Erreur HTTP Gemini: ${response.status} - ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("Erreur Réseau Gemini:", error);
    return null;
  }
};

const cleanJSON = (text: string) => {
  if (!text) return null;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    return null; // Si ce n'est pas du JSON, on retourne null
  }
};

// --- 1. SCANNER CODE BARRE PAR IA (Lecture des chiffres sur photo) ---
export const readBarcodeFromImage = async (file: File) => {
  try {
    const base64Data = await fileToBase64(file);
    const prompt = `
      Regarde cette image. Il y a un code-barres.
      Lis les chiffres sous ou dans le code-barres.
      Renvoie UNIQUEMENT les chiffres, sans espace, sans texte. 
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
    return (cleanText && cleanText !== "NULL" && /^\d+$/.test(cleanText)) ? cleanText : null;
  } catch (e) {
    return null;
  }
};

// --- 2. MAJORDOME AGENT (Capable d'agir) ---
export const askButlerAgent = async (history: { role: string, text: string }[], contextData: any) => {
  // On donne au Majordome le contexte actuel (ce qu'il y a dans le frigo, les tâches, etc.)
  const contextPrompt = `
    CONTEXTE ACTUEL DE LA MAISON :
    - Courses actuelles : ${JSON.stringify(contextData.hubItems || [])}
    - Frigo : ${JSON.stringify(contextData.fridgeItems || [])}

    Tu es le Majordome. Tu dois répondre à l'utilisateur.
    SI l'utilisateur te demande d'ajouter quelque chose aux courses ou au frigo, tu dois répondre en JSON strict.
    
    Format JSON pour une action :
    {
      "action": "ADD_HUB",
      "item": "Nom de l'article",
      "reply": "Bien monsieur, j'ai ajouté l'article."
    }
    
    Sinon, réponds simplement avec du texte (pas de JSON) pour la conversation normale.
  `;

  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  const response = await callGeminiAPI({
    contents: [{ role: "user", parts: [{ text: contextPrompt }] }, ...contents]
  });

  // On tente de voir si c'est une action (JSON) ou du blabla
  const jsonAction = cleanJSON(response);
  if (jsonAction && jsonAction.action) {
    return { type: 'action', data: jsonAction };
  }
  return { type: 'text', data: response };
};

// --- 3. SCANNER PRODUIT (Vision) ---
export const scanProductImage = async (file: File) => {
  try {
    const base64Data = await fileToBase64(file);
    const prompt = `
      Analyse ce produit alimentaire.
      Renvoie un JSON strict :
      {
        "name": "Nom du produit",
        "category": "Categorie (Frais, Épicerie, etc.)",
        "expiryDate": "YYYY-MM-DD" (Estime une date logique si non visible: Frais +5j, Sec +6mois)
      }
    `;
    const response = await callGeminiAPI({
      contents: [{
        parts: [{ text: prompt }, { inline_data: { mime_type: file.type, data: base64Data } }]
      }]
    });
    return cleanJSON(response);
  } catch (e) { return null; }
};

// --- 4. ARCHITECTE ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // Protection des données
  const protectedConfig = { ...currentConfig, welcomeImage: "PROTECTED", homeHtml: "PROTECTED", cookingHtml: "PROTECTED" };
  const finalPrompt = `Expert UI/UX. Modifie cette config JSON selon : "${prompt}". Renvoie JSON uniquement. Champs modifiables: primaryColor, backgroundColor, fontFamily, welcomeTitle, welcomeText.`;
  
  const response = await callGeminiAPI({
    contents: [{ parts: [{ text: finalPrompt + "\nConfig: " + JSON.stringify(protectedConfig) }] }]
  });
  
  const newConfig = cleanJSON(response);
  if (newConfig) {
      // Restauration des champs protégés
      newConfig.welcomeImage = currentConfig.welcomeImage;
      newConfig.homeHtml = currentConfig.homeHtml;
      newConfig.cookingHtml = currentConfig.cookingHtml;
      // Protection des NOMS DE NAVIGATION (Interdiction de modifier)
      newConfig.navigationLabels = currentConfig.navigationLabels;
      return { ...currentConfig, ...newConfig };
  }
  return null;
};

// --- 5. RECETTE VIA URL ---
export const extractRecipeFromUrl = async (url: string) => {
    const prompt = `Extrais la recette de ce texte/lien: ${url}. JSON strict: {title, chef, category, ingredients, steps}`;
    const response = await callGeminiAPI({ contents: [{ parts: [{ text: prompt }] }] });
    return cleanJSON(response);
};

// Utilitaire Base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
