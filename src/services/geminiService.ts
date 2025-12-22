import { SiteConfig } from "../types";

// On récupère la clé proprement
const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// Fonction générique pour parler à Google sans librairie
async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    console.error("⛔ Clé API manquante dans .env");
    return null;
  }

  try {
    // On utilise l'API REST standard (pas besoin d'installation)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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

// --- L'ARCHITECTE ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // 1. SÉCURITÉ POIDS : On retire l'image lourde avant d'envoyer à l'IA
  const lightConfig = { ...currentConfig, welcomeImage: "(Image ignorée pour l'IA)" };

  // 2. On prépare le prompt strict JSON
  const requestBody = {
    contents: [{
      parts: [{
        text: `
          Tu es l'Architecte Visuel de l'application 'Chaud devant'.
          Modifie la configuration JSON ci-dessous selon la demande : "${prompt}".
          
          RÈGLES :
          1. Renvoie UNIQUEMENT le JSON valide. Pas de markdown, pas de \`\`\`.
          2. Si tu changes l'image, mets une URL Unsplash valide.
          
          CONFIG ACTUELLE : ${JSON.stringify(lightConfig)}
        `
      }]
    }]
  };

  const text = await callGeminiAPI(requestBody);
  if (!text) return null;

  try {
    // Nettoyage du texte reçu (au cas où l'IA mettrait quand même du markdown)
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const newConfig = JSON.parse(cleanJson) as SiteConfig;

    // Si l'IA n'a pas touché à l'image, on remet l'originale pour ne pas la perdre
    if (newConfig.welcomeImage === "(Image ignorée pour l'IA)") {
      newConfig.welcomeImage = currentConfig.welcomeImage;
    }

    return newConfig;
  } catch (e) {
    console.error("L'IA a répondu un format invalide.");
    return null;
  }
};

// --- LE MAJORDOME (CHAT) ---
export const askAIChat = async (history: { role: string, text: string }[]) => {
  const requestBody = {
    contents: history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    })),
    systemInstruction: {
      parts: [{ text: "Tu es le majordome de la famille Chaud devant. Raffiné, serviable et poli." }]
    }
  };

  return await callGeminiAPI(requestBody);
};
