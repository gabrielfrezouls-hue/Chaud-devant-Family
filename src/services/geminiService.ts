import { GoogleGenAI, SchemaType } from "@google/genai";
import { SiteConfig } from "../types";

// Utilisation de la clé API sécurisée via Vite
const apiKey = import.meta.env.VITE_API_KEY || ""; 
const ai = new GoogleGenAI({ apiKey });

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // Sécurité : si pas de clé, on ne fait rien
  if (!apiKey) return null;

  try {
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

    const text = result.response.text();
    if (!text) return null;

    return JSON.parse(text) as SiteConfig;
  } catch (error) {
    console.error("Erreur Architecte:", error);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  if (!apiKey) return "Je n'ai pas accès à ma clé API pour le moment.";

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
