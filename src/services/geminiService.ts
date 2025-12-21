import { SiteConfig } from "../types";

// On récupère la clé
const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// Fonction universelle pour parler à l'API Google
async function callGeminiAPI(payload: any) {
  // TEST 1 : Clé présente ?
  if (!apiKey || apiKey.length < 10) {
    alert("ERREUR CLÉ : La clé VITE_GEMINI_KEY est introuvable ou trop courte.");
    return null;
  }

  try {
    // CORRECTION ICI : On utilise "gemini-1.5-flash-latest" pour éviter l'erreur 404
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      alert(`ERREUR GOOGLE (${response.status}) :\n${errorText}`);
      console.error("Erreur API:", errorText);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
        alert("Google a répondu vide.");
        return null;
    }
    
    return text;

  } catch (error) {
    alert(`ERREUR RÉSEAU : ${error}`);
    return null;
  }
}

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const fullPrompt = `
    Tu es un expert JSON. Modifie cette configuration : "${prompt}".
    Données actuelles : ${JSON.stringify(currentConfig)}
    Renvoie UNIQUEMENT le JSON valide mis à jour. Pas de markdown.
  `;

  const resultText = await callGeminiAPI({
    contents: [{ parts: [{ text: fullPrompt }] }]
  });

  if (!resultText) return null;

  try {
    const cleanJson = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson) as SiteConfig;
  } catch (e) {
    alert("L'IA a répondu mais le format JSON est invalide.");
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));
  
  const systemMsg = { role: "user", parts: [{ text: "Tu es un majordome serviable." }] };

  return await callGeminiAPI({ contents: [systemMsg, ...contents] });
};
