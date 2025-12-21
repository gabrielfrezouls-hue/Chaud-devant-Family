import React, { useState, useEffect } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { LogIn, LogOut, Send, Sparkles, Trash2, Loader2 } from 'lucide-react';

// Types pour TypeScript
interface Message {
  id: string;
  text: string;
  userName: string;
  userPhoto: string;
  userId: string;
  createdAt: any;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  
  // LA CLÉ EST ICI : On dit qu'on est en train de charger au démarrage
  const [isInitializing, setIsInitializing] = useState(true);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [newText, setNewText] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. Gérer le retour de Google
  useEffect(() => {
    getRedirectResult(auth).catch((error) => console.error("Erreur retour Google:", error));
  }, []);

  // 2. Écouter l'état de l'utilisateur
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      // UNE FOIS QU'ON SAIT (Connecté ou Pas), ON ARRÊTE LE CHARGEMENT
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  // 3. Lire les messages
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "family_messages"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message)));
    });
    return () => unsubscribe();
  }, [user]);

  // Actions
  const handleLogin = () => signInWithRedirect(auth, googleProvider);
  const handleLogout = () => signOut(auth);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim() || !user) return;
    setLoading(true);
    try {
      await addDoc(collection(db, "family_messages"), {
        text: newText,
        userName: user.displayName,
        userPhoto: user.photoURL,
        userId: user.uid,
        createdAt: serverTimestamp()
      });
      setNewText('');
    } catch (error) {
      alert("Erreur d'envoi.");
    } finally {
      setLoading(false);
    }
  };

  const deleteMessage = async (id: string) => {
    try { await deleteDoc(doc(db, "family_messages", id)); } catch (e) { alert("Impossible de supprimer."); }
  };

  // --- LE SABLIER (L'ÉCRAN D'ATTENTE) ---
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-amber-500">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <p className="text-slate-400 animate-pulse">Connexion en cours...</p>
      </div>
    );
  }

  // ÉCRAN DE CONNEXION (Visible seulement si on est sûr que tu n'es PAS connecté)
  if (!user) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-4 text-white font-sans">
        <div className="text-center space-y-6 max-w-sm">
          <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 mb-4">
            <Sparkles size={40} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Chaud Devant !</h1>
          <p className="text-slate-400">Espace privé de la famille.</p>
          <button onClick={handleLogin} className="w-full flex items-center justify-center gap-3 bg-white text-black font-bold py-4 rounded-xl hover:bg-slate-200 transition-all shadow-lg">
            <LogIn size={20} /> Se connecter avec Google
          </button>
        </div>
      </div>
    );
  }

  // ÉCRAN PRINCIPAL
  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans pb-20">
      <nav className="sticky top-0 z-50 bg-[#020617]/80 backdrop-blur-md border-b border-slate-800 p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img src={user.photoURL || ''} alt="Profil" className="w-10 h-10 rounded-full border-2 border-amber-500" />
          <span className="font-semibold">{user.displayName}</span>
        </div>
        <button onClick={handleLogout} className="text-slate-500 hover:text-red-400"><LogOut size={20} /></button>
      </nav>

      <main className="max-w-2xl mx-auto p-4 pt-8">
        <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-2xl mb-8">
          <form onSubmit={sendMessage} className="flex gap-2">
            <input value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Quoi de neuf ?" className="flex-1 bg-slate-800 border-none rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-amber-500" />
            <button type="submit" disabled={loading || !newText.trim()} className="bg-amber-500 text-black p-3 rounded-xl"><Send size={20} /></button>
          </form>
        </div>

        <div className="space-y-4">
          {messages.map((m) => (
            <div key={m.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex gap-3">
              <img src={m.userPhoto} alt={m.userName} className="w-8 h-8 rounded-full" />
              <div className="flex-1">
                <p className="text-amber-500 text-sm font-bold mb-1">{m.userName}</p>
                <p className="text-slate-300">{m.text}</p>
              </div>
              {user.uid === m.userId && <button onClick={() => deleteMessage(m.id)} className="text-slate-700 hover:text-red-500"><Trash2 size={16} /></button>}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
