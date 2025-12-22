
import { GoogleGenAI, Type } from "@google/genai";
import { SiteConfig } from "../types";

// Changement pour Vite : Utilisation de import.meta.env au lieu de process.env
const apiKey = import.meta.env.VITE_GEMINI_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  if (!ai) {
    console.error("Clé API manquante (VITE_GEMINI_KEY). Vérifiez votre fichier .env ou vos secrets GitHub.");
    return null;
  }

  try {
    // 1. NETTOYAGE DU CONTEXTE (CRITIQUE POUR LA PERFORMANCE)
    // Les images en Base64 et le HTML peuvent être très lourds.
    // On les remplace par des placeholders pour ne pas surcharger la requête (Erreur 413).
    const contextConfig = {
      ...currentConfig,
      welcomeImage: (currentConfig.welcomeImage && currentConfig.welcomeImage.length > 200) 
        ? "[IMAGE_LOURDE_CONSERVEE]" 
        : currentConfig.welcomeImage,
      homeHtml: "[HTML_CONSERVE]", 
      cookingHtml: "[HTML_CONSERVE]"
    };

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Tu es l'Architecte Visuel.
      Objectif: Modifier la configuration JSON du site pour répondre à : "${prompt}".
      
      Règles:
      1. Retourne l'objet JSON complet mis à jour.
      2. Ne modifie PAS les champs marqués "[...]" (placeholders).
      3. "primaryColor" est la couleur d'accent, "backgroundColor" le fond.
      
      Configuration Actuelle: ${JSON.stringify(contextConfig)}`,
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

    // 2. RESTAURATION DES DONNÉES
    // On réinjecte les données lourdes d'origine si l'IA a renvoyé les placeholders
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
