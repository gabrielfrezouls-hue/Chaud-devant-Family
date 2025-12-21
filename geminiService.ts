import { GoogleGenAI, SchemaType } from "@google/genai";
import { SiteConfig } from "../types";

// CORRECTION : Utilisation de import.meta.env pour Vite/GitHub
const apiKey = import.meta.env.VITE_API_KEY || ""; 
const ai = new GoogleGenAI({ apiKey });

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  try {
    // Note: Adaptation pour la version stable du SDK ou utilisation générique
    // Si ce modèle précis n'existe pas, il faudra utiliser "gemini-1.5-flash"
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            primaryColor: { type: SchemaType.STRING },
            backgroundColor: { type: SchemaType.STRING },
            fontFamily: { type: SchemaType.STRING },
            welcomeTitle: { type: SchemaType.STRING },
            welcomeText: { type: SchemaType.STRING },
            welcomeImage: { type: SchemaType.STRING },
            navigationLabels: {
              type: SchemaType.OBJECT,
              properties: {
                home: { type: SchemaType.STRING },
                journal: { type: SchemaType.STRING },
                cooking: { type: SchemaType.STRING },
                calendar: { type: SchemaType.STRING }
              }
            },
            homeHtml: { type: SchemaType.STRING },
            cookingHtml: { type: SchemaType.STRING }
          }
        }
      }
    });

    const result = await model.generateContent(`
      Tu es l'Architecte Visuel de l'application 'Chaud devant'.
      Modifie l'apparence selon: "${prompt}".
      
      CONFIG ACTUELLE: ${JSON.stringify(currentConfig)}
      
      Renvoie l'objet JSON complet mis à jour.
    `);

    return JSON.parse(result.response.text()) as SiteConfig;
  } catch (error) {
    console.error("Erreur Architecte:", error);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  try {
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: "Tu es le majordome de la famille Chaud devant. Raffiné, serviable, un peu british."
    });

    const chat = model.startChat({
      history: history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }))
    });

    const result = await chat.sendMessage("Réponds à la dernière demande.");
    return result.response.text();
  } catch (error) {
    return "Désolé, mes circuits sont encombrés.";
  }
};
