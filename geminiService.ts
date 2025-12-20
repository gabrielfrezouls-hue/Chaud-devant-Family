
import { GoogleGenAI, Type } from "@google/genai";
import { SiteConfig } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Tu es l'Architecte Visuel de l'application familiale 'Chaud devant'.
      Ta mission est de modifier l'apparence du site selon les désirs de l'utilisateur.
      
      CONSIGNES IMPORTANTES:
      1. Propose des couleurs (primaryColor, backgroundColor) harmonieuses.
      2. Si on te demande un thème (ex: 'luxueux', 'moderne', 'nature'), change RADICALEMENT les couleurs et polices.
      3. Utilise des codes hexadécimaux valides.
      4. navigationLabels doit rester lisible.
      
      CONFIG ACTUELLE: ${JSON.stringify(currentConfig)}
      DEMANDE DE L'UTILISATEUR: ${prompt}
      
      Réponds UNIQUEMENT par l'objet JSON complet mis à jour.`,
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
            },
            homeHtml: { type: Type.STRING },
            cookingHtml: { type: Type.STRING }
          }
        }
      }
    });
    return JSON.parse(response.text) as SiteConfig;
  } catch (error) {
    console.error("Erreur Architecte:", error);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] })),
      config: {
        systemInstruction: "Tu es le majordome de la famille Chaud devant. Tu es raffiné, dévoué et un peu pince-sans-rire. Tu aides la famille à s'organiser."
      }
    });
    return response.text;
  } catch (error) {
    return "Désolé, j'ai eu une petite absence...";
  }
};
