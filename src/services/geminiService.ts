import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { SiteConfig } from "../types";

// 1. CORRECTION : On utilise la bonne variable d'environnement Vite
const apiKey = import.meta.env.VITE_GEMINI_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  if (!apiKey) {
    console.error("Clé API manquante");
    return null;
  }

  try {
    // 2. CORRECTION : On utilise le vrai modèle existant (1.5 Flash)
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            primaryColor: { type: SchemaType.STRING },
            backgroundColor: { type: SchemaType.STRING },
            fontFamily: { type: SchemaType.STRING }, // Ajout important
            welcomeTitle: { type: SchemaType.STRING },
            welcomeText: { type: SchemaType.STRING },
            welcomeImage: { type: SchemaType.STRING },
            navigationLabels: {
              type: SchemaType.OBJECT,
              properties: {
                home: { type: SchemaType.STRING },
                journal: { type: SchemaType.STRING },
                cooking: { type: SchemaType.STRING },
                calendar: { type: SchemaType.STRING },
                recipes: { type: SchemaType.STRING }
              }
            },
            homeHtml: { type: SchemaType.STRING },
            cookingHtml: { type: SchemaType.STRING }
          }
        }
      }
    });

    // 3. CORRECTION CRITIQUE : On enlève l'image lourde de la config envoyée à l'IA
    const lightConfig = { ...currentConfig, welcomeImage: "(Image ignorée pour l'IA)" };

    const result = await model.generateContent(`
      Tu es l'Architecte Visuel de la maison 'Chaud devant'.
      Adapte la configuration visuelle selon : "${prompt}".
      
      CONSIGNES:
      1. Propose des couleurs harmonieuses.
      2. Si tu changes l'image, utilise une URL Unsplash valide.
      3. Ne change pas 'welcomeImage' si l'utilisateur ne le demande pas explicitement.

      CONFIG ACTUELLE: ${JSON.stringify(lightConfig)}
    `);

    const text = result.response.text();
    if (!text) return null;
    
    const newConfig = JSON.parse(text) as SiteConfig;

    // Si l'IA n'a pas touché à l'image, on remet l'originale
    if (newConfig.welcomeImage === "(Image ignorée pour l'IA)") {
      newConfig.welcomeImage = currentConfig.welcomeImage;
    }

    return newConfig;

  } catch (error) {
    console.error("Erreur Architecte Gemini:", error);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  if (!apiKey) return "Je n'ai pas accès à ma clé API.";

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: "Tu es le majordome de la famille. Raffiné et serviable."
    });

    const chat = model.startChat({
      history: history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }))
    });

    const result = await chat.sendMessage("Réponds.");
    return result.response.text();
  } catch (error) {
    console.error(error);
    return "Désolé, je suis indisponible pour le moment.";
  }
};
