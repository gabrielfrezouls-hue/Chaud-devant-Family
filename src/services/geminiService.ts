import { GoogleGenAI, Type, SchemaType } from "@google/genai";
import { SiteConfig } from "../types";

// Utilisation de la clé API sécurisée via Vite
const apiKey = import.meta.env.VITE_GEMINI_KEY || "";

// Initialisation de la librairie
const ai = new GoogleGenAI({ apiKey });

export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // Sécurité : si pas de clé, on ne fait rien
  if (!apiKey) {
    console.error("Clé API Gemini manquante");
    return null;
  }

  try {
    // Configuration du modèle avec le format JSON strict
    const model = ai.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
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
                calendar: { type: Type.STRING },
                recipes: { type: Type.STRING } // Ajouté comme demandé
              }
            },
            homeHtml: { type: Type.STRING },
            cookingHtml: { type: Type.STRING }
          }
        }
      }
    });

    // PETITE SÉCURITÉ : On retire l'image lourde pour ne pas bloquer l'envoi
    const lightConfig = { ...currentConfig, welcomeImage: "(Image ignorée)" };

    const result = await model.generateContent(`
      Tu es l'Architecte Visuel de l'application 'Chaud devant'.
      Modifie l'apparence selon: "${prompt}".
      
      CONFIG ACTUELLE: ${JSON.stringify(lightConfig)}
      
      Renvoie l'objet JSON complet mis à jour.
    `);

    const text = result.response.text();
    if (!text) return null;

    // On parse le résultat
    const newConfig = JSON.parse(text) as SiteConfig;
    
    // On remet l'image originale si l'IA ne l'a pas changée
    if (newConfig.welcomeImage === "(Image ignorée)") {
      newConfig.welcomeImage = currentConfig.welcomeImage;
    }

    return newConfig;

  } catch (error) {
    console.error("Erreur Architecte:", error);
    return null;
  }
};

export const askAIChat = async (history: { role: string, text: string }[]) => {
  if (!apiKey) return "Je n'ai pas ma clé API...";

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
    console.error(error);
    return "Désolé, mes circuits sont encombrés.";
  }
};
