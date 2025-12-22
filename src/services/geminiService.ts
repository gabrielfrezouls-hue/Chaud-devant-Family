import { SiteConfig } from "../types";

// ✅ Configuration validée : On utilise Gemini 3 et la méthode import.meta
const apiKey = import.meta.env.VITE_GEMINI_KEY || "";
const MODEL_NAME = "gemini-3-flash-preview"; 

// Fonction générique pour parler à Google
async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    console.error("⛔ Clé API manquante (VITE_GEMINI_KEY introuvable)");
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
      const errorText = await response.text();
      console.error(`Erreur Google (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    console.error("Erreur réseau:", error);
    return null;
  }
}

// --- 1. L'ARCHITECTE (Avec protection du HTML) ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // SÉCURITÉ & PROTECTION : 
  // 1. On ignore l'image (trop lourd)
  // 2. On ignore les codes HTML (pour éviter que l'IA ne les casse ou les supprime)
  const protectedConfig = { 
    ...currentConfig, 
    welcomeImage: "(Image ignorée)",
    homeHtml: "(Code protégé - Ne pas modifier)",    // <--- PROTECTION
    cookingHtml: "(Code protégé - Ne pas modifier)" // <--- PROTECTION
  };

  const requestBody = {
    contents: [{
      parts: [{
        text: `
          Tu es l'Architecte Visuel de l'application 'Chaud devant'.
          Modifie la configuration JSON ci-dessous selon la demande : "${prompt}".
          
          RÈGLES IMPORTANTES :
          1. Renvoie UNIQUEMENT le JSON valide. Pas de markdown.
          2. Ne touche PAS aux champs marqués "(Code protégé)".
          3. Modifie les couleurs, les polices, les titres pour correspondre à l'ambiance demandée.
          
          CONFIG ACTUELLE : ${JSON.stringify(protectedConfig)}
        `
      }]
    }]
  };

  const text = await callGeminiAPI(requestBody);
  if (!text) return null;

  try {
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const newConfig = JSON.parse(cleanJson) as SiteConfig;

    // RESTAURATION DES DONNÉES PROTÉGÉES
    // On remet les vraies valeurs originales à la place des placeholders
    if (newConfig.welcomeImage === "(Image ignorée)") {
        newConfig.welcomeImage = currentConfig.welcomeImage;
    }
    newConfig.homeHtml = currentConfig.homeHtml;       // <--- RESTAURATION
    newConfig.cookingHtml = currentConfig.cookingHtml; // <--- RESTAURATION

    return newConfig;
  } catch (e) {
    console.error("Erreur format JSON IA", e);
    return null;
  }
};

// --- 2. LE MAJORDOME (Indispensable pour corriger ton erreur) ---
export const askAIChat = async (history: { role: string, text: string }[]) => {
  return await callGeminiAPI({
    contents: history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    })),
    systemInstruction: {
      parts: [{ text: "Tu es le majordome de la famille Chaud devant. Raffiné, serviable et poli." }]
    }
  });
};
