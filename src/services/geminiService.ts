import { GoogleGenerativeAI } from "@google/generative-ai";
import { SiteConfig } from "../types";

// --- CONFIGURATION ---
// ⚠️ Remplace ceci par ta vraie clé API Gemini (Google AI Studio)
const API_KEY = "TA_CLE_API_ICI"; 

const genAI = new GoogleGenerativeAI(API_KEY);

// --- 1. CHAT MAJORDOME ---
export const askAIChat = async (history: { role: string, text: string }[]) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const chat = model.startChat({
      history: history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    });

    // Contexte système injecté discrètement
    const result = await chat.sendMessage("Tu es le Majordome de la famille. Tu es serviable, un peu british, et tu aides pour la cuisine, l'organisation et le ménage. Réponds court.");
    const response = result.response;
    return response.text();
  } catch (error) {
    console.error("Erreur Gemini Chat:", error);
    return "Désolé, je suis un peu fatigué (Erreur API).";
  }
};

// --- 2. ARCHITECTE (DESIGN) ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const finalPrompt = `
      Tu es un architecte web expert en UI/UX.
      Configuration actuelle : ${JSON.stringify(currentConfig)}
      Demande utilisateur : "${prompt}"
      
      Renvoie UNIQUEMENT un objet JSON valide (sans Markdown) avec les champs à modifier parmi: 
      { primaryColor, backgroundColor, fontFamily, welcomeTitle, welcomeText, welcomeImage }.
      Pour welcomeImage, choisis une URL Unsplash haute qualité adaptée.
    `;
    
    const result = await model.generateContent(finalPrompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (error) {
    console.error("Erreur Architecte:", error);
    return null;
  }
};

// --- 3. EXTRACTION RECETTE (LIEN) ---
export const extractRecipeFromUrl = async (url: string) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const prompt = `
      Analyse cette URL (ou ce texte qui décrit une recette) : ${url}
      Extrais les infos pour créer une fiche recette structurée.
      Renvoie UNIQUEMENT un objet JSON :
      {
        "title": "Nom du plat",
        "chef": "Nom du site ou Auteur",
        "category": "entrée/plat/dessert",
        "ingredients": "liste des ingrédients avec quantités, séparés par des sauts de ligne",
        "steps": "étapes de préparation numérotées"
      }
    `;
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (error) {
    console.error("Erreur Recette:", error);
    return null;
  }
};

// --- 4. SCANNER PRODUIT (PHOTO) ---
// C'est la fonction qui manquait !
export const scanProductImage = async (file: File) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Utilise un modèle Vision
    
    // Conversion File -> Base64
    const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
    });
    
    const imagePart = {
      inlineData: {
        data: base64Data.split(',')[1],
        mimeType: file.type
      },
    };

    const prompt = `
      Analyse cette image de produit alimentaire.
      Identifie le produit.
      Estime une date de péremption logique si tu ne la vois pas (ex: Lait = +1 mois, Jambon = +1 semaine, Pâtes = +1 an).
      Renvoie UNIQUEMENT un JSON :
      {
        "name": "Nom précis du produit",
        "expiryDate": "YYYY-MM-DD" (Format date strict)
      }
    `;

    const result = await model.generateContent([prompt, imagePart]);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (error) {
    console.error("Erreur Vision:", error);
    return null;
  }
};
