import { SiteConfig } from "../types";

// ✅ Configuration validée par tes tests
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

// --- 1. L'ARCHITECTE ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // Sécurité : on ignore l'image lourde
  const lightConfig = { ...currentConfig, welcomeImage: "(Image ignorée)" };

  const requestBody = {
    contents: [{
      parts: [{
        text: `
          Tu es l'Architecte Visuel de l'application 'Chaud devant'.
          Modifie la configuration JSON ci-dessous selon la demande : "${prompt}".
          RÈGLES : Renvoie UNIQUEMENT le JSON valide. Pas de markdown.
          CONFIG ACTUELLE : ${JSON.stringify(lightConfig)}
        `
      }]
    }]
  };

  const text = await callGeminiAPI(requestBody);
  if (!text) return null;

  try {
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const newConfig = JSON.parse(cleanJson) as SiteConfig;

    if (newConfig.welcomeImage === "(Image ignorée)") {
      newConfig.welcomeImage = currentConfig.welcomeImage;
    }
    return newConfig;
  } catch (e) {
    console.error("Erreur format JSON IA");
    return null;
  }
};

// --- 2. LE MAJORDOME ---
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
