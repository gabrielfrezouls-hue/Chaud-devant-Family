import { SiteConfig } from "../types";

// TEST 1 : MÉTHODE VITE STANDARD
const apiKey = import.meta.env.VITE_GEMINI_KEY || "";
const MODEL_NAME = "gemini-3-flash-preview"; // Ton modèle demandé

async function callGeminiAPI(payload: any) {
  console.log("--- TEST 1 (import.meta) ---");
  console.log("Clé présente ?", !!apiKey); // Affiche true si la clé est là
  console.log("Modèle visé :", MODEL_NAME);

  if (!apiKey) {
    console.error("⛔ ERREUR : VITE_GEMINI_KEY est introuvable.");
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
      console.error(`❌ ERREUR API (${response.status}) :`, await response.text());
      return null;
    }

    const data = await response.json();
    console.log("✅ SUCCÈS ! Réponse reçue.");
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    console.error("❌ ERREUR RÉSEAU :", error);
    return null;
  }
}

// --- FONCTIONS EXPORTÉES ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const lightConfig = { ...currentConfig, welcomeImage: "(Image ignorée)" };
  const requestBody = {
    contents: [{ parts: [{ text: `Tu es un Architecte. Rends ce JSON : ${prompt}. CONFIG: ${JSON.stringify(lightConfig)}` }] }]
  };
  
  const text = await callGeminiAPI(requestBody);
  if (!text) return null;
  try {
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const newConfig = JSON.parse(cleanJson);
    if (newConfig.welcomeImage === "(Image ignorée)") newConfig.welcomeImage = currentConfig.welcomeImage;
    return newConfig;
  } catch (e) { return null; }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  return await callGeminiAPI({
    contents: history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }))
  });
};
