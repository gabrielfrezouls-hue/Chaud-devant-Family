// --- 1. L'ARCHITECTE ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // SÉCURITÉ & PROTECTION : 
  // 1. On ignore l'image (trop lourd)
  // 2. On ignore les codes HTML (pour éviter que l'IA ne les casse ou les supprime)
  const protectedConfig = { 
    ...currentConfig, 
    welcomeImage: "(Image ignorée)",
    homeHtml: "(Code protégé - Ne pas modifier)",    // <--- PROTECTION AJOUTÉE
    cookingHtml: "(Code protégé - Ne pas modifier)" // <--- PROTECTION AJOUTÉE
  };

  const requestBody = {
    contents: [{
      parts: [{
        text: `
          Tu es l'Architecte Visuel de l'application 'Chaud devant'.
          Modifie la configuration JSON ci-dessous selon la demande : "${prompt}".
          
          RÈGLES IMPORTANTES :
          1. Renvoie UNIQUEMENT le JSON valide.
          2. Ne touche PAS aux champs marqués "(Code protégé)".
          3. Modifie les couleurs, les polices, les titres pour correspondre à l'ambiance demandée.
          
          CONFIG ACTUELLE : ${JSON.stringify(protectedConfig)}
        `
      }]
    }]
  };

  const text = await callGeminiAPI(requestBody);
  if (!text) return null;

  try {
    const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const newConfig = JSON.parse(cleanJson) as SiteConfig;

    // RESTAURATION DES DONNÉES PROTÉGÉES
    // On remet les vraies valeurs originales à la place des placeholders
    newConfig.welcomeImage = currentConfig.welcomeImage;
    newConfig.homeHtml = currentConfig.homeHtml;       // <--- ON RESTAURE ICI
    newConfig.cookingHtml = currentConfig.cookingHtml; // <--- ON RESTAURE ICI

    return newConfig;
  } catch (e) {
    console.error("Erreur format JSON IA", e);
    return null;
  }
};
