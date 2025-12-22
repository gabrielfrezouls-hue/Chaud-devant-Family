
import { GoogleGenAI, Type } from "@google/genai";
import { SiteConfig } from "../types";

// CORRECTION : Votre vite.config.ts contient un "define" pour process.env.API_KEY.
// C'est donc la méthode correcte à utiliser ici. import.meta.env serait vide car GitHub injecte "API_KEY".
const apiKey = process.env.API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  if (!ai) {
    console.error("Clé API manquante. Vérifiez le secret 'API_KEY' dans les réglages GitHub (Secrets).");
    return null;
  }

  try {
    // 1. OPTIMISATION DU PAYLOAD (Anti-crash)
    // On retire les images Base64 et le HTML lourd pour éviter l'erreur 413 ou 400.
    const contextConfig = {
      ...currentConfig,
      welcomeImage: (currentConfig.welcomeImage && currentConfig.welcomeImage.length > 200) 
        ? "[IMAGE_CONSERVEE_NE_PAS_TOUCHER]" 
        : currentConfig.welcomeImage,
      homeHtml: "[HTML_CONSERVE]", 
      cookingHtml: "[HTML_CONSERVE]"
    };

    // 2. APPEL API
    // Changement du modèle pour corriger l'erreur 404 sur gemini-1.5-flash
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Tu es l'Architecte Visuel.
      Objectif: Modifier la configuration JSON du site pour répondre à : "${prompt}".
      
      Règles:
      1. Retourne UNIQUEMENT l'objet JSON complet mis à jour.
      2. Ne modifie PAS les champs marqués "[...]" (placeholders).
      3. "primaryColor" = accent, "backgroundColor" = fond.
      
      Config Actuelle: ${JSON.stringify(contextConfig)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            primaryColor: { type: Type.STRING },
            backgroundColor: { type: Type.STRING },
            fontFamily: { type: Type.STRING },
            welcomeTitle: { type: Type.STRING },
            welcomeText: { type: Type.STRING },
            welcomeImage: { type: Type.STRING },
            navigationLabels: {
              type: Type.OBJECT,
              properties: {
                home: { type: Type.STRING },
                journal: { type: Type.STRING },
                cooking: { type: Type.STRING },
                calendar: { type: Type.STRING }
              }
            }
          }
        }
      }
    });
    
    const text = response.text;
    if (!text) return null;
    
    const newConfig = JSON.parse(text);

    // 3. FUSION INTELLIGENTE
    // On remet les données lourdes originales si l'IA a renvoyé les placeholders
    return {
      ...newConfig,
      welcomeImage: (!newConfig.welcomeImage || newConfig.welcomeImage.includes("[")) 
        ? currentConfig.welcomeImage 
        : newConfig.welcomeImage,
      homeHtml: currentConfig.homeHtml,
      cookingHtml: currentConfig.cookingHtml,
      hiddenSections: currentConfig.hiddenSections || [],
      fontFamily: newConfig.fontFamily || currentConfig.fontFamily || 'Inter'
    } as SiteConfig;

  } catch (error) {
    console.error("Erreur Architecte Gemini:", error);
    return null;
  }
};
