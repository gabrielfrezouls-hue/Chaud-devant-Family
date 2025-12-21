import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// 1. Fonction qui demande à Google : "Quels modèles as-tu pour moi ?"
async function getAvailableModel() {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    const data = await response.json();
    
    // On cherche un modèle qui s'appelle 'gemini' et qui sait générer du contenu
    const model = data.models?.find((m: any) => 
      m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent')
    );

    if (model) return model.name; // Ex: "models/gemini-1.5-flash-001"
    return "models/gemini-pro"; // Fallback au cas où

  } catch (e) {
    return "models/gemini-pro";
  }
}

// 2. Fonction principale d'appel
async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    alert("Clé API manquante.");
    return null;
  }

  // ÉTAPE MAGIQUE : On récupère le BON nom de modèle dynamiquement
  const modelName = await getAvailableModel();
  
  // On enlève le préfixe "models/" s'il est déjà là pour éviter les doublons
  const cleanModelName = modelName.replace("models/", "");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      alert(`ERREUR (${cleanModelName}) : ${errorText}`);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    alert("Erreur réseau.");
    return null;
  }
}

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const fullPrompt = `
    Tu es un expert JSON. Modifie la config selon : "${prompt}".
    Config actuelle : ${JSON.stringify(currentConfig)}
    RENVOIE UNIQUEMENT LE JSON. PAS DE MARKDOWN.
  `;

  const text = await callGeminiAPI({ contents: [{ parts: [{ text: fullPrompt }] }] });
  if (!text) return null;

  try {
    return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim()) as SiteConfig;
  } catch (e) {
    alert("L'IA a mal formaté la réponse.");
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));
  return await callGeminiAPI({ contents });
};
