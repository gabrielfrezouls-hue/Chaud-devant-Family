import React, { useState, useEffect } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { LogIn, LogOut, Send, Sparkles, Trash2, User as UserIcon } from 'lucide-react';

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [newText, setNewText] = useState('');
  const [loading, setLoading] = useState(false);

  // 1. Gérer la connexion Google
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // 2. Lire les messages Firebase en temps réel
  useEffect(() => {
    if (!user) return;
    
    const q = query(collection(db, "family_messages"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(docs);
    });

    return () => unsubscribe();
  }, [user]);

  // Actions
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Erreur de connexion", error);
    }
  };

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
      alert("Erreur d'envoi. Vérifie tes règles Firestore.");
    } finally {
      setLoading(false);
    }
  };

  const deleteMessage = async (id: string) => {
    try {
      await deleteDoc(doc(db, "family_messages", id));
    } catch (error) {
      alert("Tu n'as pas le droit de supprimer ce message.");
    }
  };

  // ÉCRAN DE CONNEXION
  if (!user) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-4 text-white font-sans">
        <div className="text-center space-y-6 max-w-sm">
          <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 mb-4">
            <Sparkles size={40} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Chaud Devant !</h1>
          <p className="text-slate-400">Espace privé de la famille. Connectez-vous pour accéder au mur.</p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white text-black font-bold py-4 rounded-xl hover:bg-slate-200 transition-all shadow-lg"
          >
            <LogIn size={20} /> Se connecter avec Google
          </button>
        </div>
      </div>
    );
  }

  // ÉCRAN PRINCIPAL (MUR DE LA FAMILLE)
  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans pb-20">
      {/* Barre du haut */}
      <nav className="sticky top-0 z-50 bg-[#020617]/80 backdrop-blur-md border-b border-slate-800 p-4">
        <div className="max-w-2xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src={user.photoURL || ''} alt="Profil" className="w-10 h-10 rounded-full border-2 border-amber-500" />
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Membre</p>
              <p className="font-semibold">{user.displayName}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="p-2 text-slate-500 hover:text-red-400 transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto p-4 pt-8">
        {/* Formulaire d'envoi */}
        <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-2xl mb-8">
          <form onSubmit={sendMessage} className="flex gap-2">
            <input 
              type="text" 
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Partager quelque chose..."
              className="flex-1 bg-slate-800 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none transition-all"
            />
            <button 
              type="submit" 
              disabled={loading || !newText.trim()}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black p-3 rounded-xl transition-all"
            >
              <Send size={20} />
            </button>
          </form>
        </div>

        {/* Liste des messages */}
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-20 text-slate-600">
              <p>Le mur est vide. Lancez la discussion !</p>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl group relative animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-start gap-3">
                  <img src={m.userPhoto} alt={m.userName} className="w-8 h-8 rounded-full" />
                  <div className="flex-1">
                    <p className="text-amber-500 text-sm font-bold mb-1">{m.userName}</p>
                    <p className="text-slate-300 leading-relaxed">{m.text}</p>
                  </div>
                  {/* Seul celui qui a posté (ou toi si tu es admin) peut voir le bouton supprimer */}
                  {user.uid === m.userId && (
                    <button 
                      onClick={() => deleteMessage(m.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-700 hover:text-red-500 transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
