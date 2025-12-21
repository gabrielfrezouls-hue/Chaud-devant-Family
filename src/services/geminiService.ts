import { SiteConfig } from "../types";

// 1. On nettoie la clé (enlève les espaces avant/après)
const apiKey = (import.meta.env.VITE_GEMINI_KEY || "").trim();

async function callGeminiAPI(payload: any) {
  if (!apiKey) {
    alert("⛔ Clé API absente de GitHub Secrets.");
    return null;
  }

  try {
    // On utilise le modèle standard
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
      alert(`ERREUR GOOGLE (${response.status})\n\nSi 404 : Vérifiez que votre ordinateur est à la bonne date (2024) et que la clé est active.\n\nDétail : ${errorText}`);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    console.error(error);
    alert("Erreur réseau. Vérifiez votre connexion et l'heure de votre PC.");
    return null;
  }
}

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // 2. OPTIMISATION : On crée une copie légère de la config
  // On remplace l'image lourde (Base64) par un texte court pour ne pas bloquer l'IA
  const lightConfig = { 
    ...currentConfig, 
    welcomeImage: "(Image ignorée pour l'IA)" 
  };

  const fullPrompt = `
    Tu es un expert JSON. Modifie la config selon : "${prompt}".
    
    Config actuelle (JSON) : 
    ${JSON.stringify(lightConfig)}
    
    RÈGLES :
    1. Renvoie UNIQUEMENT le JSON complet mis à jour.
    2. Si tu changes l'image, mets une URL Unsplash valide, pas du Base64.
    3. Garde la structure exacte.
    4. PAS de markdown, PAS de \`\`\`.
  `;

  const text = await callGeminiAPI({ contents: [{ parts: [{ text: fullPrompt }] }] });
  if (!text) return null;

  try {
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    // On récupère le résultat
    const newConfig = JSON.parse(cleanJson) as SiteConfig;
    
    // Si l'IA n'a pas touché à l'image (elle a renvoyé le texte placeholder), 
    // on remet l'image originale de l'utilisateur pour ne pas la perdre.
    if (newConfig.welcomeImage === "(Image ignorée pour l'IA)") {
      newConfig.welcomeImage = currentConfig.welcomeImage;
    }
    
    return newConfig;
  } catch (e) {
    alert("L'IA a répondu mais le code JSON est invalide.");
    console.error(e);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  // Petit nettoyage de l'historique
  const cleanHistory = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  return await callGeminiAPI({ contents: cleanHistory });
};
