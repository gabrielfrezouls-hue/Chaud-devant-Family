import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

async function callGeminiAPI(payload: any) {
  // ESPION : On vérifie quelle clé est utilisée
  if (!apiKey) {
    alert("⛔ ALERTE : Aucune clé trouvée dans le code.");
    return null;
  }
  
  // On affiche les 4 premières lettres pour voir si c'est la nouvelle
  const debutCle = apiKey.substring(0, 4) + "...";
  
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
      const errorText = await response.text();
      // On affiche l'erreur exacte
      alert(`❌ ERREUR GOOGLE (Code ${response.status}) :\nClé utilisée : ${debutCle}\nMessage : ${errorText}`);
      console.error("Détail:", errorText);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    alert("❌ Erreur de connexion Internet.");
    return null;
  }
}

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  const fullPrompt = `Modifie ce JSON : ${JSON.stringify(currentConfig)} selon : "${prompt}". Renvoie JSON uniquement.`;
  
  const text = await callGeminiAPI({ contents: [{ parts: [{ text: fullPrompt }] }] });
  if (!text) return null;

  try {
    return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim()) as SiteConfig;
  } catch (e) {
    alert("L'IA a répondu mais le format est mauvais.");
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
