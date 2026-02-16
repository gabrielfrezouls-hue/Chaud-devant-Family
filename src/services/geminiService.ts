import { SiteConfig } from "../types";

// ✅ CONFIGURATION API
const apiKey = import.meta.env.VITE_GEMINI_KEY || "";
const MODEL_NAME = "gemini-1.5-flash"; // On utilise 1.5 Flash qui est stable et gère les images

// Fonction générique pour appeler l'API Gemini en REST (Sans librairie)
const callGeminiAPI = async (payload: any) => {
  if (!apiKey) {
    console.error("Clé API Gemini manquante dans le fichier .env");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`Erreur API: ${response.statusText}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("Erreur Appel Gemini:", error);
    return null;
  }
};

// Fonction utilitaire pour nettoyer le JSON renvoyé par l'IA
const cleanAndParseJSON = (text: string) => {
  if (!text) return null;
  try {
    // Enlève les balises markdown ```json et ```
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Erreur parsing JSON:", e);
    return null;
  }
};

// --- 1. L'ARCHITECTE (Avec protection du HTML) ---
export const askAIArchitect = async (prompt: string, currentConfig: SiteConfig) => {
  // SÉCURITÉ : On masque les champs lourds ou sensibles pour l'IA
  const protectedConfig = { 
    ...currentConfig, 
    welcomeImage: "(Image ignorée)",
    homeHtml: "(Code HTML protégé - Ne pas modifier)",    
    cookingHtml: "(Code HTML protégé - Ne pas modifier)"  
  };

  const finalPrompt = `
    Tu es un architecte web expert en UI/UX.
    Configuration actuelle : ${JSON.stringify(protectedConfig)}
    Demande utilisateur : "${prompt}"
    
    Renvoie UNIQUEMENT un objet JSON valide (sans Markdown) avec les champs à modifier parmi: 
    { primaryColor, backgroundColor, fontFamily, welcomeTitle, welcomeText, welcomeImage }.
    Pour welcomeImage, si demandé, choisis une URL Unsplash haute qualité adaptée.
    NE TOUCHE PAS aux champs marqués "Code protégé".
  `;

  const responseText = await callGeminiAPI({
    contents: [{ parts: [{ text: finalPrompt }] }]
  });

  const newConfig = cleanAndParseJSON(responseText);

  if (newConfig) {
    // RESTAURATION : On remet impérativement les données originales
    // Si l'IA a mis un placeholder ou null, on remet l'original
    if (!newConfig.welcomeImage || newConfig.welcomeImage === "(Image ignorée)") {
        newConfig.welcomeImage = currentConfig.welcomeImage;
    }
    // Restauration forcée du HTML pour éviter toute perte
    newConfig.homeHtml = currentConfig.homeHtml;       
    newConfig.cookingHtml = currentConfig.cookingHtml; 
    
    // On garde le reste de la config actuelle si l'IA ne l'a pas renvoyé
    return { ...currentConfig, ...newConfig };
  }

  return null;
};

// --- 2. LE MAJORDOME ---
export const askAIChat = async (history: { role: string, text: string }[]) => {
  const contents = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }]
  }));

  // Ajout du contexte système en premier message user (astuce REST)
  const systemContext = {
    role: "user",
    parts: [{ text: "Système: Tu es le Majordome de la famille. Tu es serviable, poli, un peu british. Tu aides pour la cuisine, l'organisation et le ménage. Réponds de manière concise." }]
  };

  const response = await callGeminiAPI({
    contents: [systemContext, ...contents]
  });

  return response || "Désolé, je suis momentanément indisponible.";
};

// --- 3. EXTRACTION RECETTE (LIEN) ---
export const extractRecipeFromUrl = async (url: string) => {
  const prompt = `
    Analyse ce texte ou cette URL : ${url}
    Extrais les informations pour créer une fiche recette.
    Renvoie UNIQUEMENT un JSON valide :
    {
      "title": "Nom du plat",
      "chef": "Source ou Auteur",
      "category": "entrée/plat/dessert",
      "ingredients": "ingrédient 1\ningrédient 2\n...",
      "steps": "étape 1\nétape 2\n..."
    }
  `;

  const response = await callGeminiAPI({
    contents: [{ parts: [{ text: prompt }] }]
  });

  return cleanAndParseJSON(response);
};

// --- 4. SCANNER PRODUIT (PHOTO) ---
export const scanProductImage = async (file: File) => {
  try {
    // Conversion de l'image en Base64
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64Content = result.split(',')[1]; // Enlever le header data:image...
        resolve(base64Content);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const prompt = `
      Analyse cette image de produit alimentaire.
      Renvoie UNIQUEMENT un JSON valide :
      {
        "name": "Nom du produit (Marque incluse si visible)",
        "expiryDate": "YYYY-MM-DD"
      }
      Si tu ne vois pas de date de péremption, estime une date logique à partir d'aujourd'hui (ex: Lait = +30 jours, Viande = +4 jours, Pâtes = +1 an).
      Format de date strict : YYYY-MM-DD.
    `;

    const response = await callGeminiAPI({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: file.type, data: base64Data } }
        ]
      }]
    });

    return cleanAndParseJSON(response);

  } catch (error) {
    console.error("Erreur Vision:", error);
    return null;
  }
};
