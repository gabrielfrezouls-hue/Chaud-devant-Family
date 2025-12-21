import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// Fonction universelle pour parler à l'API Google sans librairie (via Fetch)
async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    console.error("Clé API manquante");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
  const fullPrompt = `
    Tu es l'Architecte Visuel de l'application 'Chaud devant'.
    Modifie l'apparence selon cette demande : "${prompt}".
    
    CONFIG ACTUELLE (JSON):
    ${JSON.stringify(currentConfig)}
    
    Règles :
    1. Renvoie UNIQUEMENT le code JSON mis à jour.
    2. Garde la même structure.
    3. Ne mets pas de commentaires, pas de markdown (pas de \`\`\`json).
  `;

  const resultText = await callGeminiAPI({
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    generationConfig: {
      response_mime_type: "application/json" // Force le format JSON
    }
  });

  if (!resultText) return null;

  try {
    return JSON.parse(resultText) as SiteConfig;
  } catch (e) {
    console.error("Erreur de lecture du JSON IA", e);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  // On convertit ton historique au format attendu par l'API REST de Google
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  // Ajout de l'instruction système dans le prompt initial si besoin, 
  // ou on l'ajoute comme contexte. Ici on reste simple.
  const systemContext = {
    role: "user",
    parts: [{ text: "Tu es le majordome de la famille Chaud devant. Raffiné, serviable, un peu british. Réponds de manière concise." }]
  };

  const resultText = await callGeminiAPI({
    contents: [systemContext, ...contents]
  });

  return resultText || "Désolé, je n'arrive pas à joindre mes serveurs.";
};
