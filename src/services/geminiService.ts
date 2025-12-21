import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    alert("ERREUR CRITIQUE : La clé API est vide dans le code.");
    return null;
  }

  try {
    // URL officielle et standard
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ ERREUR GOOGLE DÉTAILLÉE :", errorText);
      alert(`Erreur Google (${response.status}). Regarde la console (F12) pour le détail.`);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    console.error(error);
    alert("Erreur réseau/internet.");
    return null;
  }
}

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // Format strict demandé par Google
  const requestBody = {
    contents: [{
      parts: [{
        text: `Tu es un expert JSON. Modifie cette config: ${JSON.stringify(currentConfig)} selon la demande: "${prompt}". RENVOIE JUSTE LE JSON.`
      }]
    }]
  };

  const text = await callGeminiAPI(requestBody);
  if (!text) return null;

  try {
    return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim()) as SiteConfig;
  } catch (e) {
    alert("L'IA a répondu mais le format est invalide.");
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  // Format strict demandé par Google
  const requestBody = {
    contents: history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    }))
  };
  return await callGeminiAPI(requestBody);
};
