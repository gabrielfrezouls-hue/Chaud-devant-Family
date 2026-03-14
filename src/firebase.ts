import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_KEY,
  authDomain: "chaud-devant-81afb.firebaseapp.com",
  projectId: "chaud-devant-81afb",
  storageBucket: "chaud-devant-81afb.firebasestorage.app",
  messagingSenderId: "336348032772",
  appId: "1:336348032772:web:0a92a5c11df89f8b2e6a51"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Provider Google standard (connexion au site)
export const googleProvider = new GoogleAuthProvider();

// Provider Google Calendar (scope calendar.events — pour lierAgenda)
export const googleCalendarProvider = new GoogleAuthProvider();
googleCalendarProvider.addScope('https://www.googleapis.com/auth/calendar.events');

// Web OAuth Client ID — nécessaire pour Google Identity Services (GIS)
// À récupérer : console.cloud.google.com → APIs & Services → Credentials
//               → OAuth 2.0 Client IDs → "Web client (auto created by Google Service)"
//               → Copier la valeur "Client ID"
// Format : 336348032772-XXXXXXXXXXXXXXXXXXXX.apps.googleusercontent.com
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
