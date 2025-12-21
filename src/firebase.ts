import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth"; // Ajoute ça
import { getFirestore } from "firebase/firestore"; // Ajoute ça

const firebaseConfig = {
  // On demande à l'application d'aller chercher la clé dans les secrets GitHub
  apiKey: import.meta.env.VITE_API_KEY, 
  authDomain: "chaud-devant-81afb.firebaseapp.com",
  projectId: "chaud-devant-81afb",
  storageBucket: "chaud-devant-81afb.firebasestorage.app",
  messagingSenderId: "336348032772",
  appId: "1:336348032772:web:0a92a5c11df89f8b2e6a51",
  measurementId: "G-J1GHZ52KP3"
};

// Initialisation
const app = initializeApp(firebaseConfig);

// EXPORTS (Très important pour que App.tsx puisse les utiliser)
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
