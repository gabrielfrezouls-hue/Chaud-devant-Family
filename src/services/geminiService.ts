import { SiteConfig } from "../types";

const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// Fonction de base ultra-simplifiée et bavarde (pour le debug)
async function callGeminiAPI(payload: any, functionalityName: string) {
  // 1. Vérif clé
  if (!apiKey) {
    alert(`⛔ ${functionalityName}: Clé API absente de GitHub Secrets.`);
    return null;
  }

  console.log(`🚀 ${functionalityName}: Envoi de la demande à Google...`);

  try {
    // 2. Appel direct (sans recherche de modèle)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    // 3. Gestion des erreurs HTTP
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erreur Google:`, errorText);
      alert(`❌ ERREUR GOOGLE (${response.status}) :\n${errorText}\n\nSi 404: Clé ou Projet incorrect.\nSi 400: Requête mal formée.`);
      return null;
    }

    // 4. Traitement de la réponse
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      alert(`⚠️ ${functionalityName}: Google a répondu, mais sans texte !`);
      console.log("Réponse complète:", data);
      return null;
    }

    return text;

  } catch (error) {
    console.error(error);
    alert(`❌ ERREUR RÉSEAU sur ${functionalityName} : Vérifiez votre connexion.`);
    return null;
  }
}

// --- ARCHITECTE ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  if (!prompt.trim()) {
    alert("Veuillez écrire une demande pour l'architecte.");
    return null;
  }

  const fullPrompt = `
    Tu es un expert JSON. Modifie la config suivante selon la demande : "${prompt}".
    Config actuelle : ${JSON.stringify(currentConfig)}
    IMPORTANT : Renvoie UNIQUEMENT le code JSON brut. Pas de 'json', pas de balises markdown.
  `;

  const text = await callGeminiAPI(
    { contents: [{ parts: [{ text: fullPrompt }] }] }, 
    "ARCHITECTE"
  );

  if (!text) return null;

  try {
    // Nettoyage brutal pour enlever les ```json éventuels
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson) as SiteConfig;
  } catch (e) {
    console.error("Erreur de parsing JSON", e);
    console.log("Texte reçu:", text);
    alert("L'IA a répondu, mais le code n'est pas un JSON valide. Réessayez.");
    return null;
  }
};

// --- MAJORDOME (CHAT) ---
export const askAIChat = async (history: { role: string, text: string }[]) => {
  // Vérification si l'historique est vide ou si le dernier message est vide
  if (history.length === 0 || !history[history.length - 1].text.trim()) {
    // Si c'est vide, on ne fait rien (c'est pour ça que "rien ne se passait")
    return "Je n'ai pas entendu votre question ?";
  }

  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  const response = await callGeminiAPI(
    { contents }, 
    "MAJORDOME"
  );

  return response || "Désolé, je suis momentanément indisponible.";
};
