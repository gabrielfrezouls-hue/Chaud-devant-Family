import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// Fonction universelle pour parler à l'API Google
async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    console.error("Clé API manquante");
    return null;
  }

  try {
    // CHANGEMENT ICI : On utilise "gemini-pro" qui est le modèle le plus stable
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.error("Erreur API Google:", await response.text());
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("Erreur réseau:", error);
    return null;
  }
}

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // On simplifie le prompt pour le modèle Pro
  const fullPrompt = `
    Tu es un expert JSON. Modifie cette configuration de site web selon la demande : "${prompt}".
    
    Données actuelles (JSON) :
    ${JSON.stringify(currentConfig)}
    
    Instructions strictes :
    1. Renvoie UNIQUEMENT le JSON valide mis à jour.
    2. Pas de texte avant, pas de texte après.
    3. Pas de balises markdown (\`\`\`json).
  `;

  const resultText = await callGeminiAPI({
    contents: [{ parts: [{ text: fullPrompt }] }]
  });

  if (!resultText) return null;

  try {
    // Nettoyage au cas où l'IA mettrait quand même des balises
    const cleanJson = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson) as SiteConfig;
  } catch (e) {
    console.error("Erreur lecture JSON:", e);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  // Conversion simple pour Gemini Pro
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  // On ajoute le contexte Majordome comme un premier message utilisateur
  const contextMessage = {
    role: "user",
    parts: [{ text: "Tu es le majordome de la famille Chaud devant. Sois serviable, poli et bref." }]
  };

  // On insère le contexte au début
  const finalContents = [contextMessage, ...contents];

  return await callGeminiAPI({ contents: finalContents });
};
