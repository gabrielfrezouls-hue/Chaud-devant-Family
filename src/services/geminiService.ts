import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// LISTE DES MODÈLES À TESTER (Dans l'ordre)
const MODELS_TO_TRY = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-001",
  "gemini-pro"
];

async function callGeminiAPI(payload: any) {
  if (!apiKey || apiKey.length < 10) {
    alert("ERREUR CLÉ : Clé API absente ou invalide.");
    return null;
  }

  // On essaie les modèles un par un
  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`Tentative avec le modèle : ${modelName}...`);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      // Si c'est une 404 (Introuvable), on continue à la prochaine boucle
      if (response.status === 404) {
        console.warn(`Modèle ${modelName} introuvable, essai suivant...`);
        continue; 
      }

      // Si c'est une autre erreur, on arrête et on affiche
      if (!response.ok) {
        const err = await response.text();
        alert(`ERREUR GOOGLE (${modelName}) : ${err}`);
        return null;
      }

      // Si ça marche, on renvoie le résultat !
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    } catch (e) {
      console.error("Erreur réseau", e);
    }
  }

  // Si on arrive ici, c'est qu'aucun modèle n'a marché
  alert("ÉCHEC TOTAL : Aucun modèle d'IA n'a répondu (404).");
  return null;
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
    alert("L'IA a répondu mais le format est mauvais.");
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
