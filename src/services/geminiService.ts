import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    alert("Clé API manquante. Vérifiez vos Secrets GitHub.");
    return null;
  }

  try {
    // On utilise le modèle standard "gemini-1.5-flash" qui marche avec les nouvelles clés
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
      console.error("Erreur Google:", errorText);
      alert(`L'IA ne répond pas (Code ${response.status}).\nSi c'est 404 : La clé n'a pas les droits Gemini.\nSi c'est 400 : La clé est mal copiée.`);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    console.error(error);
    alert("Erreur de connexion Internet.");
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
    alert("L'IA a mal formaté le code.");
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
