import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { 
  Lock, Menu, X, Home, BookHeart, ChefHat,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil, ClipboardList,
  CheckSquare, Square, CheckCircle2, Plus, Clock, Save, ToggleLeft, ToggleRight, Upload, Image as ImageIcon, Book
} from 'lucide-react';
import { JournalEntry, Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// --- SÉCURITÉ : LISTE DES INVITÉS ---
const FAMILY_EMAILS = [
  "gabriel.frezouls@gmail.com",
  "o.frezouls@gmail.com",
  "eau.fraise.fils@gmail.com",
  "valentin.frezouls@gmail.com", 
  "frezouls.pauline@gmail.com",
  "eau.fraise.fille@gmail.com"
];

const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7',
  fontFamily: 'Inter',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: { home: 'ACCUEIL', journal: 'JOURNAL', cooking: 'SEMAINIER', recipes: 'RECETTES', calendar: 'CALENDRIER', tasks: 'TÂCHES' },
  homeHtml: '', cookingHtml: ''
};

// --- LOGIQUE DES TÂCHES ---
const ROTATION = ['G', 'P', 'V'];
const REF_DATE = new Date('2025-12-20T12:00:00'); 

const USER_MAPPING: Record<string, string> = {
  "gabriel.frezouls@gmail.com": "G",
  "frezouls.pauline@gmail.com": "P",
  "valentin.frezouls@gmail.com": "V"
};

const getChores = (date: Date) => {
  const saturday = new Date(date);
  saturday.setDate(date.getDate() - (date.getDay() + 1) % 7);
  saturday.setHours(12, 0, 0, 0);

  const weekId = `${saturday.getDate()}-${saturday.getMonth()+1}-${saturday.getFullYear()}`;
  const diffTime = saturday.getTime() - REF_DATE.getTime();
  const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
  const mod = (n: number, m: number) => ((n % m) + m) % m;

  return {
    id: weekId,
    fullDate: saturday, 
    dateStr: `${saturday.getDate()}/${saturday.getMonth()+1}`,
    haut: ROTATION[mod(diffWeeks, 3)],       
    bas: ROTATION[mod(diffWeeks + 2, 3)],    
    douche: ROTATION[mod(diffWeeks + 1, 3)]  
  };
};

const getMonthWeekends = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const weekends = [];
  const date = new Date(year, month, 1);
  while (date.getDay() !== 6) { date.setDate(date.getDate() + 1); }
  while (date.getMonth() === month) {
    weekends.push(getChores(new Date(date)));
    date.setDate(date.getDate() + 7);
  }
  return weekends;
};

// --- COMPOSANTS EXTRAITS (POUR STABILITÉ ET PERFORMANCE) ---

const TaskCell = ({ weekId, letter, label, isLocked, choreStatus, toggleChore, myLetter }: any) => {
  const isDone = choreStatus[weekId]?.[letter] || false;
  const canCheck = !isLocked && myLetter === letter; 
  return (
    <td className="p-4 text-center align-middle">
      <div className="flex flex-col items-center gap-2">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm ${
          isDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}> {letter} </span>
        <button onClick={() => canCheck && toggleChore(weekId, letter)} disabled={!canCheck} className={`transition-transform active:scale-95 ${!canCheck && !isDone ? 'opacity-20 cursor-not-allowed' : ''}`} title={isLocked ? "Trop tôt pour cocher !" : ""}>
          {isDone ? <CheckSquare className="text-green-500" size={24} /> : (canCheck ? <Square className="text-green-500 hover:fill-green-50" size={24} /> : <Square className="text-gray-200" size={24} />)}
        </button>
      </div>
    </td>
  );
};

const EventModal = ({ isOpen, onClose, config, addEntry, newEvent, setNewEvent }: any) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300">
        <button onClick={() => onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-black mb-4"><CalIcon size={32} style={{ color: config.primaryColor }} /></div>
          <h3 className="text-2xl font-cinzel font-bold">Nouvel Événement</h3>
        </div>
        <div className="space-y-4">
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quoi ?</label><input value={newEvent.title} onChange={e => setNewEvent({...newEvent, title: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-lg font-bold outline-none focus:ring-2" placeholder="Anniversaire..." autoFocus style={{ '--tw-ring-color': config.primaryColor } as any} /></div>
          <div><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">Quand ?</label><input type="date" value={newEvent.date} onChange={e => setNewEvent({...newEvent, date: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none cursor-pointer" /></div>
          <div onClick={() => setNewEvent({...newEvent, isAllDay: !newEvent.isAllDay})} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3"><Clock size={20} className={newEvent.isAllDay ? "text-gray-300" : "text-black"} /><span className="font-bold text-sm">Toute la journée</span></div>
            {newEvent.isAllDay ? <ToggleRight size={32} className="text-green-500"/> : <ToggleLeft size={32} className="text-gray-300"/>}
          </div>
          {!newEvent.isAllDay && (
            <div className="animate-in slide-in-from-top-2"><label className="text-xs font-bold uppercase tracking-widest text-gray-400 ml-2">À quelle heure ?</label><input type="text" value={newEvent.time} onChange={e => setNewEvent({...newEvent, time: e.target.value})} placeholder="Ex: 20h00, Midi..." className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none font-bold text-lg" /></div>
          )}
        </div>
        <button 
            disabled={isSubmitting}
            onClick={async () => { 
                if (newEvent.title && newEvent.date) { 
                    setIsSubmitting(true);
                    await addEntry('family_events', { title: newEvent.title, date: newEvent.date, time: newEvent.isAllDay ? null : (newEvent.time || '') }); 
                    setNewEvent({ title: '', date: new Date().toISOString().split('T')[0], time: '', isAllDay: true }); 
                    setIsSubmitting(false);
                    onClose(false); 
                } else { alert("Titre et date requis !"); } 
            }} 
            className={`w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all ${isSubmitting ? 'opacity-50' : ''}`} 
            style={{ backgroundColor: config.primaryColor }}
        >
            {isSubmitting ? "Ajout..." : "Ajouter au calendrier"}
        </button>
      </div>
    </div>
  );
};

const RecipeModal = ({ isOpen, onClose, config, currentRecipe, setCurrentRecipe, updateEntry, addEntry }: any) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  
  const handleFile = (e: any, callback: any) => {
    const f = e.target.files[0];
    if(f) { const r = new FileReader(); r.onload = () => callback(r.result); r.readAsDataURL(f); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl space-y-6 relative animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
        <button onClick={() => onClose(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><X size={24}/></button>
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-black mb-4"><ChefHat size={32} style={{ color: config.primaryColor }} /></div>
          <h3 className="text-2xl font-cinzel font-bold">{currentRecipe.id ? 'Modifier la Recette' : 'Nouvelle Recette'}</h3>
        </div>
        
        <div className="space-y-4">
          <input value={currentRecipe.title} onChange={e => setCurrentRecipe({...currentRecipe, title: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 text-xl font-bold outline-none focus:ring-2" placeholder="Nom du plat (ex: Gratin Dauphinois)" autoFocus style={{ '--tw-ring-color': config.primaryColor } as any} />
          
          <div className="flex gap-4">
             <input value={currentRecipe.chef} onChange={e => setCurrentRecipe({...currentRecipe, chef: e.target.value})} className="flex-1 p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none" placeholder="Chef (ex: Papa)" />
             <select value={currentRecipe.category} onChange={e => setCurrentRecipe({...currentRecipe, category: e.target.value})} className="flex-1 p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none">
               <option value="entrée">Entrée</option><option value="plat">Plat</option><option value="dessert">Dessert</option><option value="autre">Autre</option>
             </select>
          </div>

          <div onClick={() => fileRef.current?.click()} className="p-6 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 flex flex-col items-center justify-center text-gray-400 gap-2">
            {currentRecipe.image ? <div className="flex items-center gap-2 text-green-600 font-bold"><CheckCircle2/> Photo ajoutée !</div> : <><Upload size={24}/><span>Ajouter une photo</span></>}
          </div>
          <input type="file" ref={fileRef} className="hidden" onChange={e => handleFile(e, (b:string) => setCurrentRecipe({...currentRecipe, image: b}))} />

          {/* BOUTON ENREGISTRER - CORRIGÉ (Anti double-clic + Position haute) */}
          <button 
            disabled={isSubmitting}
            onClick={async () => { 
              if(currentRecipe.title) {
                  setIsSubmitting(true);
                  const recipeToSave = { ...currentRecipe };
                  try {
                    if (recipeToSave.id) { await updateEntry('family_recipes', recipeToSave.id, recipeToSave); } 
                    else { await addEntry('family_recipes', recipeToSave); }
                    onClose(false);
                  } catch (e) {
                    alert("Erreur technique lors de l'enregistrement.");
                    setIsSubmitting(false);
                  }
              } else { alert("Il faut au moins un titre !"); }
            }} 
            className={`w-full py-4 rounded-xl font-black text-white uppercase tracking-widest shadow-lg transform active:scale-95 transition-all ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`} 
            style={{ backgroundColor: config.primaryColor }}
          >
              {isSubmitting ? "Enregistrement..." : "Enregistrer la recette"}
          </button>

          <div className="grid md:grid-cols-2 gap-4">
            <textarea value={currentRecipe.ingredients} onChange={e => setCurrentRecipe({...currentRecipe, ingredients: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-40" placeholder="Ingrédients (un par ligne)..." />
            <textarea value={currentRecipe.steps} onChange={e => setCurrentRecipe({...currentRecipe, steps: e.target.value})} className="w-full p-4 rounded-xl border border-gray-200 bg-gray-50 outline-none h-40" placeholder="Étapes de préparation..." />
          </div>
        </div>
        
        {/* Espace pour le scroll mobile */}
        <div className="h-10"></div>
      </div>
    </div>
  );
};

// --- APP COMPONENT ---

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Données
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [choreStatus, setChoreStatus] = useState<Record<string, any>>({});

  // États Modales
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false); 

  // Formulaires
  const [newEvent, setNewEvent] = useState({ title: '', date: new Date().toISOString().split('T')[0], time: '', isAllDay: true });
  
  const defaultRecipeState = { id: '', title: '', chef: '', ingredients: '', steps: '', category: 'plat', image: '' };
  const [currentRecipe, setCurrentRecipe] = useState<any>(defaultRecipeState);

  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [password, setPassword] = useState('');

  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // 1. AUTHENTIFICATION
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => { 
      setUser(u); 
      setIsInitializing(false); 
    });
    return () => unsubscribe();
  }, []);

  const isAuthorized = user && user.email && FAMILY_EMAILS.includes(user.email);
  const myLetter = user && user.email ? USER_MAPPING[user.email] : null;

  // 2. CHARGEMENT
  useEffect(() => {
    if (!isAuthorized) return;
    const ignoreError = (err: any) => { console.log("Info: ", err.code); };

    const unsubC = onSnapshot(doc(db, 'site_config', 'main'), (d) => { if (d.exists()) setConfig(d.data() as SiteConfig); }, ignoreError);
    const unsubJ = onSnapshot(query(collection(db, 'family_journal'), orderBy('timestamp', 'desc')), (s) => setJournal(s.docs.map(d => ({ ...d.data(), id: d.id } as JournalEntry))), ignoreError);
    const unsubR = onSnapshot(collection(db, 'family_recipes'), (s) => setRecipes(s.docs.map(d => ({ ...d.data(), id: d.id } as Recipe))), ignoreError);
    
    // Calendrier (Tri chronologique)
    const unsubE = onSnapshot(collection(db, 'family_events'), (s) => {
      const rawEvents = s.docs.map(d => ({ ...d.data(), id: d.id } as FamilyEvent));
      rawEvents.sort((a, b) => a.date.localeCompare(b.date));
      setEvents(rawEvents);
    }, ignoreError);

    const unsubV = onSnapshot(query(collection(db, 'site_versions'), orderBy('date', 'desc')), (s) => setVersions(s.docs.map(d => ({ ...d.data(), id: d.id } as SiteVersion))), ignoreError);
    const unsubT = onSnapshot(collection(db, 'chores_status'), (s) => {
      const status: Record<string, any> = {};
      s.docs.forEach(doc => { status[doc.id] = doc.data(); });
      setChoreStatus(status);
    }, ignoreError);

    return () => { unsubC(); unsubJ(); unsubR(); unsubE(); unsubV(); unsubT(); };
  }, [user]);

  // ACTIONS
  const handleLogin = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Erreur Auth"); } };
  const handleLogout = () => { signOut(auth); setIsEditUnlocked(false); setCurrentView('home'); };
  
  const saveConfig = async (c: SiteConfig, saveHistory = false) => { 
    try {
      await setDoc(doc(db, 'site_config', 'main'), c); 
      setConfig(c);
      if(saveHistory) await addDoc(collection(db, 'site_versions'), { name: `Sauvegarde`, date: new Date().toISOString(), config: c });
    } catch(e) { console.error(e); }
  };
  const restoreVersion = (v: SiteVersion) => { if(confirm(`Restaurer la version "${v.name}" ?`)) saveConfig(v.config, false); };
  
  const addEntry = async (col: string, data: any) => { 
    try { 
      const { id, ...cleanData } = data; 
      await addDoc(collection(db, col), { ...cleanData, timestamp: serverTimestamp() }); 
    } catch(e) { 
      console.error(e);
      alert("Erreur lors de l'ajout. Vérifiez votre connexion."); 
      throw e; // Propage l'erreur pour arrêter le chargement du bouton
    } 
  };

  const updateEntry = async (col: string, id: string, data: any) => { 
    try { 
      const { id: _, ...c } = data; 
      await setDoc(doc(db, col, id), { ...c, timestamp: serverTimestamp() }, { merge: true }); 
    } catch (e) { 
      console.error(e); 
      alert("Erreur lors de la modification."); 
      throw e;
    } 
  };
  
  const deleteItem = async (col: string, id: string) => { 
    if(!id) { alert("Erreur: ID introuvable. Rafraîchissez la page."); return; }
    if(confirm("Supprimer définitivement ?")) {
        try { await deleteDoc(doc(db, col, id)); } catch(e) { console.error(e); alert("Erreur suppression"); }
    }
  };

  const unlockEdit = () => { if (password === '16.07.gabi.11') { setIsEditUnlocked(true); setPassword(''); } else alert("Code faux"); };
  
  const toggleChore = async (weekId: string, letter: string) => {
    try {
      const currentStatus = choreStatus[weekId]?.[letter] || false;
      await setDoc(doc(db, 'chores_status', weekId), { [letter]: !currentStatus }, { merge: true });
    } catch (e) { console.error("Erreur coche", e); }
  };

  const openEditRecipe = (recipe: any) => {
    const ingredientsStr = Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : recipe.ingredients;
    const stepsStr = recipe.steps || recipe.instructions || '';
    setCurrentRecipe({ ...recipe, ingredients: ingredientsStr, steps: stepsStr });
    setIsRecipeModalOpen(true);
  };

  const handleArchitect = async () => { if (!aiPrompt.trim()) return; setIsAiLoading(true); const n = await askAIArchitect(aiPrompt, config); if (n) await saveConfig({...config, ...n}, true); setIsAiLoading(false); };
  const handleChat = async () => { if (!aiPrompt.trim()) return; const h = [...chatHistory, {role:'user',text:aiPrompt}]; setChatHistory(h); setAiPrompt(''); setIsAiLoading(true); const r = await askAIChat(h); setChatHistory([...h, {role:'model',text:r}]); setIsAiLoading(false); };

  if (isInitializing) return <div className="min-h-screen flex items-center justify-center bg-[#f5ede7]"><Loader2 className="w-12 h-12 animate-spin text-[#a85c48]"/></div>;
  if (!user) return <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]"><Background color={ORIGINAL_CONFIG.primaryColor} /><div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700"><div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl bg-[#a85c48]"><Sparkles className="text-white" size={48} /></div><h1 className="text-4xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1><button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3 hover:scale-105 transition-transform"><LogIn size={24} /> CONNEXION GOOGLE</button></div></div>;
  if (!isAuthorized) return <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center space-y-8"><ShieldAlert className="text-red-500 w-20 h-20" /><h2 className="text-3xl font-bold text-red-800 font-cinzel">ACCÈS RESTREINT</h2><button onClick={handleLogout} className="px-6 py-4 bg-red-500 text-white font-bold rounded-2xl">Déconnexion</button></div>;

  return (
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={() => setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        <div className="hidden md:flex gap-6">
           {['home','journal','recipes','cooking','calendar', 'tasks'].map(v => (
             <button key={v} onClick={() => setCurrentView(v as ViewType)} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100 uppercase" style={{ color: currentView === v ? config.primaryColor : 'inherit' }}>{config.navigationLabels[v as keyof typeof config.navigationLabels] || v}</button>
           ))}
           <button onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={20}/></button>
        </div>
        <button className="md:hidden" onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={28} /></button>
      </nav>

      <SideMenu config={config} isOpen={isMenuOpen} close={() => setIsMenuOpen(false)} setView={setCurrentView} logout={handleLogout} />
      <BottomNav config={config} view={currentView} setView={setCurrentView} />

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-32 relative z-10">
        
        {currentView === 'home' && (
          <div className="space-y-16 animate-in fade-in duration-1000">
            <section className="relative h-[60vh] rounded-[3rem] overflow-hidden shadow-2xl group">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110" />
              <div className="absolute inset-0 bg-black/40 flex flex-col justify-end p-10">
                <h1 className="text-5xl md:text-8xl font-cinzel font-black text-white leading-none">{config.welcomeTitle}</h1>
                <p className="text-xl text-white/90 italic mt-4">{config.welcomeText}</p>
              </div>
            </section>
            {config.homeHtml && <section className="bg-white/50 rounded-[3rem] overflow-hidden shadow-xl"><iframe srcDoc={config.homeHtml} className="w-full h-[500px]" sandbox="allow-scripts" /></section>}
            <div className="grid md:grid-cols-2 gap-8">
              <HomeCard icon={<BookHeart size={40}/>} title="Souvenirs" label="Explorer le journal" onClick={() => setCurrentView('journal')} color={config.primaryColor} />
              <HomeCard icon={<ChefHat size={40}/>} title="Recettes" label="Nos petits plats" onClick={() => setCurrentView('recipes')} color={config.primaryColor} />
            </div>
          </div>
        )}

        {/* --- TÂCHES --- */}
        {currentView === 'tasks' && (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-8">
            <div className="text-center space-y-4">
              <h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>TÂCHES MÉNAGÈRES</h2>
              <p className="text-gray-500 font-serif italic">
                {myLetter ? `Salut ${myLetter === 'G' ? 'Gabriel' : myLetter === 'P' ? 'Pauline' : 'Valentin'}, à l'attaque !` : "Connecte-toi avec ton compte perso pour participer."}
              </p>
            </div>
            <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/50">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left" style={{ backgroundColor: config.primaryColor + '15' }}>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-gray-500 w-24">Weekend</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Aspi Haut</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Aspi Bas</th>
                      <th className="p-4 font-black uppercase text-xs tracking-widest text-center" style={{ color: config.primaryColor }}>Lav/Douche</th>
                      <th className="p-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {getMonthWeekends().map((week, i) => {
                      const rowStatus = choreStatus[week.id] || {};
                      const isRowComplete = rowStatus.G && rowStatus.P && rowStatus.V;
                      const now = new Date();
                      const isLocked = week.fullDate.getTime() > (now.getTime() + 86400000 * 6); 
                      return (
                        <tr key={i} className={`transition-colors ${isRowComplete ? 'bg-green-50/50' : 'hover:bg-white/50'}`}>
                          <td className="p-4 font-mono font-bold text-gray-700 whitespace-nowrap text-sm">{week.dateStr}{isLocked && <span className="ml-2 text-xs text-gray-300">🔒</span>}</td>
                          <TaskCell weekId={week.id} letter={week.haut} label="Aspi Haut" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                          <TaskCell weekId={week.id} letter={week.bas} label="Aspi Bas" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                          <TaskCell weekId={week.id} letter={week.douche} label="Lavabo" isLocked={isLocked} choreStatus={choreStatus} toggleChore={toggleChore} myLetter={myLetter} />
                          <td className="p-4 text-center">{isRowComplete && <CheckCircle2 className="text-green-500 mx-auto animate-bounce" />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-6 bg-gray-50 text-center text-xs text-gray-400 uppercase tracking-widest border-t border-gray-100">
                G = Gabriel • P = Pauline • V = Valentin
              </div>
            </div>
          </div>
        )}

        {/* --- CALENDRIER --- */}
        {currentView === 'calendar' && (
           <div className="max-w-3xl mx-auto space-y-10">
             <div className="flex flex-col items-center gap-6">
                <h2 className="text-5xl font-cinzel font-black" style={{ color: config.primaryColor }}>CALENDRIER</h2>
                <button onClick={() => setIsEventModalOpen(true)} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}>
                  <Plus size={20}/> Ajouter un événement
                </button>
             </div>
             <EventModal isOpen={isEventModalOpen} onClose={setIsEventModalOpen} config={config} addEntry={addEntry} newEvent={newEvent} setNewEvent={setNewEvent} />
             <div className="space-y-4">
               {events.map(ev => {
                 const cleanDate = ev.date.split('T')[0];
                 const dateObj = new Date(cleanDate);
                 return (
                   <div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm border border-black/5 hover:shadow-md transition-shadow group">
                     <div className="text-center w-16">
                       <div className="font-bold text-xl leading-none" style={{color: config.primaryColor}}>{dateObj.getDate()}</div>
                       <div className="text-[10px] uppercase font-bold text-gray-400">{dateObj.toLocaleString('fr-FR', { month: 'short' })}</div>
                     </div>
                     <div className="flex-1 border-l pl-6 border-gray-100">
                       <div className="font-bold text-lg font-cinzel text-gray-800">{ev.title}</div>
                       {ev.time && <div className="text-xs text-gray-400 flex items-center mt-1"><Clock size={10} className="mr-1"/> {ev.time}</div>}
                     </div>
                     <button onClick={() => deleteItem('family_events', ev.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all" title="Supprimer"><Trash2 size={16} /></button>
                   </div>
                 );
               })}
               {events.length === 0 && <div className="text-center text-gray-400 py-10 italic">Rien de prévu pour le moment...</div>}
             </div>
           </div>
        )}

        {currentView === 'journal' && (
          <div className="space-y-10">
             <h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>JOURNAL</h2>
             <div className="columns-1 md:columns-2 gap-8 space-y-8">
               {journal.map(j => (
                 <div key={j.id} className="break-inside-avoid bg-white/90 rounded-[2rem] p-8 space-y-4 border border-black/5 shadow-lg">
                   {j.image && <img src={j.image} className="w-full h-64 object-cover rounded-xl" />}
                   <div><h3 className="text-2xl font-bold font-cinzel">{j.title}</h3><p className="text-[10px] uppercase">{j.date} - {j.author}</p></div>
                   <p className="opacity-80 leading-relaxed">{j.content}</p>
                 </div>
               ))}
             </div>
          </div>
        )}

        {/* --- RECETTES --- */}
        {currentView === 'recipes' && (
          <div className="space-y-10">
             <div className="flex flex-col items-center gap-6">
               <h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>RECETTES</h2>
               <button onClick={() => { setCurrentRecipe(defaultRecipeState); setIsRecipeModalOpen(true); }} className="bg-black text-white px-8 py-4 rounded-2xl font-bold text-sm uppercase hover:scale-105 transition-transform flex items-center gap-3 shadow-xl" style={{ backgroundColor: config.primaryColor }}>
                  <Plus size={20}/> Ajouter une recette
               </button>
             </div>

             <RecipeModal isOpen={isRecipeModalOpen} onClose={setIsRecipeModalOpen} config={config} currentRecipe={currentRecipe} setCurrentRecipe={setCurrentRecipe} updateEntry={updateEntry} addEntry={addEntry} />

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {recipes.length === 0 && <p className="text-center col-span-full opacity-50">Aucune recette pour le moment.</p>}
               {recipes.map((r: any) => (
                 <div key={r.id} className="relative group">
                   <div className="absolute top-4 right-4 z-20 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditRecipe(r)} className="p-2 bg-white/90 rounded-full shadow-md text-blue-500 hover:scale-110 transition-transform"><Pencil size={16}/></button>
                      <button onClick={() => deleteItem('family_recipes', r.id)} className="p-2 bg-white/90 rounded-full shadow-md text-red-500 hover:scale-110 transition-transform"><Trash2 size={16}/></button>
                   </div>
                   
                   <RecipeCard 
                      recipe={{
                        ...r,
                        ingredients: typeof r.ingredients === 'string' ? r.ingredients.split('\n').filter((i:string) => i.trim() !== '') : r.ingredients,
                        instructions: r.steps || r.instructions
                      }} 
                   />
                 </div>
               ))}
             </div>
          </div>
        )}

        {currentView === 'cooking' && (
           <div className="bg-white/90 rounded-[3rem] min-h-[800px] shadow-xl overflow-hidden border border-black/5">
             {config.cookingHtml ? <iframe srcDoc={config.cookingHtml} className="w-full min-h-[800px]" /> : <div className="p-20 text-center opacity-40">Semainier non configuré</div>}
           </div>
        )}

        {currentView === 'edit' && (
          !isEditUnlocked ? (
            <div className="max-w-md mx-auto bg-white/80 p-10 rounded-[3rem] text-center space-y-8 shadow-xl mt-20">
              <Settings className="mx-auto animate-spin-slow" size={48} style={{ color: config.primaryColor }} />
              <h2 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>ADMINISTRATION</h2>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 rounded-xl border text-center outline-none" placeholder="Code secret" />
              <button onClick={unlockEdit} className="w-full py-4 text-white font-bold rounded-xl" style={{ backgroundColor: config.primaryColor }}>ENTRER</button>
            </div>
          ) : (
            <AdminPanel 
              config={config} save={saveConfig} 
              add={addEntry} 
              del={deleteItem} 
              upd={updateEntry}
              events={events} versions={versions} restore={restoreVersion}
              recipes={recipes}
              journal={journal}
              arch={handleArchitect} chat={handleChat} 
              prompt={aiPrompt} setP={setAiPrompt} load={isAiLoading} hist={chatHistory} 
            />
          )
        )}
      </main>
    </div>
  );
};

// --- SOUS-COMPOSANTS ---

const SideMenu = ({ config, isOpen, close, setView, logout }: any) => (
  <div className={`fixed inset-0 z-[60] ${isOpen ? '' : 'pointer-events-none'}`}>
    <div className={`absolute inset-0 bg-black/40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`} onClick={close} />
    <div className={`absolute right-0 top-0 bottom-0 w-80 bg-[#f5ede7] p-10 transition-transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ backgroundColor: config.backgroundColor }}>
      <button onClick={() => close(false)} className="mb-10"><X /></button>
      <div className="space-y-4">
        {['home','journal','recipes','cooking','calendar', 'tasks', 'edit'].map(v => (
          <button key={v} onClick={() => { setView(v); close(false); }} className="block w-full text-left p-4 hover:bg-black/5 rounded-xl uppercase font-bold text-xs tracking-widest">
            {v === 'edit' ? 'ADMINISTRATION' : config.navigationLabels[v] || v}
          </button>
        ))}
        <button onClick={logout} className="block w-full text-left p-4 text-red-500 font-bold text-xs tracking-widest mt-8">DÉCONNEXION</button>
      </div>
    </div>
  </div>
);

const BottomNav = ({ config, view, setView }: any) => (
  <div className="md:hidden fixed bottom-0 w-full h-24 flex justify-around items-center rounded-t-[2.5rem] z-40 text-white/50 px-4 pb-4 shadow-xl" style={{ backgroundColor: config.primaryColor }}>
    {[
      {id:'home', i:<Home size={22}/>}, 
      {id:'journal', i:<BookHeart size={22}/>},
      {id:'tasks', i:<ClipboardList size={22}/>},
      {id:'recipes', i:<ChefHat size={22}/>}, 
      {id:'edit', i:<Settings size={22}/>}
    ].map(b => <button key={b.id} onClick={() => setView(b.id)} className={`p-2 ${view === b.id ? 'text-white -translate-y-2 bg-white/20 rounded-xl' : ''}`}>{b.i}</button>)}
  </div>
);

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="bg-white/70 backdrop-blur-md p-10 rounded-[3rem] cursor-pointer hover:scale-105 transition-transform shadow-lg border border-white/50 group">
    <div style={{ color }} className="mb-6 group-hover:scale-110 transition-transform">{icon}</div>
    <h3 className="text-3xl font-cinzel font-bold mb-2">{title}</h3>
    <p className="text-[10px] font-bold tracking-widest opacity-50 uppercase flex items-center gap-2">{label} <ChevronRight size={14}/></p>
  </div>
);

const AdminPanel = ({ config, save, add, del, upd, events, recipes, journal, versions, restore, arch, chat, prompt, setP, load, hist }: any) => {
  const [tab, setTab] = useState('arch');
  const [newJ, setNewJ] = useState({ id: '', title: '', author: '', content: '', image: '' });
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [tempVersionName, setTempVersionName] = useState('');
  
  const [goldenTab, setGoldenTab] = useState<'journal' | 'recipes'>('journal');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedRecipes, setSelectedRecipes] = useState<string[]>([]);
  const [goldenOutput, setGoldenOutput] = useState('');
  
  const [localC, setLocalC] = useState(config);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setLocalC(config); }, [config]);
  const handleFile = (e: any, cb: any) => { const f = e.target.files[0]; if(f) { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(f); }};
  const handleEdit = (item: any, type: 'recipe' | 'journal') => { if (type === 'journal') setNewJ(item); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const startEditVersion = (v: any) => { setEditingVersionId(v.id); setTempVersionName(v.name); };
  const saveVersionName = (id: string) => { upd('site_versions', id, { name: tempVersionName }); setEditingVersionId(null); };

  const generateGolden = async () => {
    if (goldenTab === 'journal') {
        if (!dateRange.start || !dateRange.end) return alert("Sélectionnez les dates !");
        const entries = journal.filter((j: any) => true); 
        const context = entries.map((j:any) => `- ${j.date} (${j.author}): ${j.title} - ${j.content}`).join('\n');
        const prompt = `Rédige une chronique familiale...`;
        setGoldenOutput("Fonctionnalité IA non connectée dans cette version."); 
    } else {
        if (selectedRecipes.length === 0) return alert("Sélectionnez des recettes !");
        setGoldenOutput("Génération du livre de cuisine... (IA non connectée)");
    }
  };

  return (
    <div className="bg-white/90 backdrop-blur-xl p-8 rounded-[3.5rem] shadow-2xl min-h-[700px] border border-black/5">
      <div className="flex gap-2 overflow-x-auto mb-10 pb-4 no-scrollbar">
        {[
          {id:'arch', l:'ARCHITECTE', i:<Sparkles size={16}/>}, 
          {id:'gold', l:"JOURNAL D'OR", i:<Book size={16}/>},
          {id:'chat', l:'MAJORDOME', i:<MessageSquare size={16}/>},
          {id:'home', l:'ACCUEIL', i:<Home size={16}/>},
          {id:'journal', l:'JOURNAL', i:<BookHeart size={16}/>},
          {id:'code', l:'CODE', i:<Code size={16}/>},
          {id:'history', l:'HISTORIQUE', i:<History size={16}/>}
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest whitespace-nowrap transition-all ${tab===t.id ? 'text-white scale-105 shadow-lg' : 'bg-gray-100 text-gray-400'}`} style={{ backgroundColor: tab===t.id ? config.primaryColor : '' }}>{t.i} {t.l}</button>
        ))}
      </div>

      {tab === 'arch' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>ARCHITECTE IA</h3>
           <textarea value={prompt} onChange={e => setP(e.target.value)} className="w-full p-6 rounded-3xl border border-gray-200 h-32 focus:ring-4 outline-none" placeholder="Ex: 'Met un thème sombre et doré'..." />
           <button onClick={arch} disabled={load} className="w-full py-5 text-white rounded-2xl font-black uppercase shadow-xl" style={{ backgroundColor: config.primaryColor }}>{load ? <Loader2 className="animate-spin mx-auto"/> : "Transformer le design"}</button>
        </div>
      )}

      {/* --- NOUVEAU TAB JOURNAL D'OR --- */}
      {tab === 'gold' && (
        <div className="space-y-6 animate-in fade-in">
            <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>JOURNAL D'OR</h3>
            
            <div className="flex bg-gray-100 p-1 rounded-xl w-fit mx-auto mb-6">
                <button onClick={() => setGoldenTab('journal')} className={`px-6 py-2 rounded-lg text-xs font-bold uppercase transition-all ${goldenTab === 'journal' ? 'bg-white shadow-sm text-black' : 'text-gray-400'}`}>Chronique</button>
                <button onClick={() => setGoldenTab('recipes')} className={`px-6 py-2 rounded-lg text-xs font-bold uppercase transition-all ${goldenTab === 'recipes' ? 'bg-white shadow-sm text-black' : 'text-gray-400'}`}>Livre de Cuisine</button>
            </div>

            {goldenTab === 'journal' ? (
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs font-bold text-gray-400 ml-2">Début</label>
                            <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="w-full p-4 rounded-2xl border border-gray-200" />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs font-bold text-gray-400 ml-2">Fin</label>
                            <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="w-full p-4 rounded-2xl border border-gray-200" />
                        </div>
                    </div>
                    <button onClick={generateGolden} className="w-full py-4 text-white font-bold rounded-2xl uppercase shadow-lg hover:scale-[1.02] transition-transform" style={{ backgroundColor: config.primaryColor }}>
                        <Sparkles size={18} className="inline mr-2"/> Générer la Chronique
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="h-48 overflow-y-auto border border-gray-100 rounded-2xl p-2 space-y-1">
                        {recipes.map((r: any) => (
                            <div key={r.id} onClick={() => {
                                if (selectedRecipes.includes(r.id)) setSelectedRecipes(selectedRecipes.filter(id => id !== r.id));
                                else setSelectedRecipes([...selectedRecipes, r.id]);
                            }} className={`p-3 rounded-xl cursor-pointer flex items-center gap-3 transition-colors ${selectedRecipes.includes(r.id) ? 'bg-amber-50 border-amber-200' : 'hover:bg-gray-50'}`}>
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedRecipes.includes(r.id) ? 'bg-amber-500 border-amber-500' : 'border-gray-300'}`}>
                                    {selectedRecipes.includes(r.id) && <CheckSquare size={12} className="text-white"/>}
                                </div>
                                <span className="text-sm font-bold">{r.title}</span>
                            </div>
                        ))}
                    </div>
                    <button onClick={generateGolden} className="w-full py-4 text-white font-bold rounded-2xl uppercase shadow-lg hover:scale-[1.02] transition-transform" style={{ backgroundColor: config.primaryColor }}>
                        <Sparkles size={18} className="inline mr-2"/> Créer le Livre
                    </button>
                </div>
            )}

            {goldenOutput && (
                <div className="animate-in slide-in-from-bottom-4">
                    <label className="text-xs font-bold text-gray-400 ml-2 uppercase tracking-widest">Résultat</label>
                    <textarea value={goldenOutput} readOnly className="w-full h-64 p-6 rounded-3xl border border-gray-200 bg-gray-50 font-serif leading-relaxed mt-2 focus:outline-none" />
                </div>
            )}
        </div>
      )}

      {tab === 'chat' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>MAJORDOME IA</h3>
           <div className="bg-gray-50 p-6 rounded-[2rem] h-64 overflow-y-auto space-y-4 border border-gray-100">
             {hist.map((h: any, i: number) => <div key={i} className={`p-4 rounded-2xl text-sm max-w-[85%] ${h.role === 'user' ? 'bg-gray-800 text-white ml-auto' : 'bg-white border text-gray-600'}`}>{h.text}</div>)}
           </div>
           <div className="flex gap-2">
             <input value={prompt} onChange={e => setP(e.target.value)} className="flex-1 p-4 rounded-2xl border" placeholder="Message..." />
             <button onClick={chat} disabled={load} className="p-4 bg-black text-white rounded-2xl"><Send size={20}/></button>
           </div>
        </div>
      )}

      {tab === 'home' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>ACCUEIL</h3>
           <input value={localC.welcomeTitle} onChange={e => setLocalC({...localC, welcomeTitle: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Titre principal" />
           <textarea value={localC.welcomeText} onChange={e => setLocalC({...localC, welcomeText: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-24" placeholder="Texte de bienvenue" />
           <div onClick={() => fileRef.current?.click()} className="p-4 border-2 border-dashed rounded-2xl text-center cursor-pointer text-xs uppercase font-bold text-gray-400">Changer la photo d'accueil</div>
           <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => handleFile(e, (b: string) => setLocalC({...localC, welcomeImage: b}))} />
           <textarea value={localC.homeHtml} onChange={e => setLocalC({...localC, homeHtml: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-32 font-mono text-xs" placeholder="Code HTML/Widget pour l'accueil (Optionnel)" />
           <button onClick={() => { save(localC, true); alert("Accueil sauvegardé !"); }} className="w-full py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{ backgroundColor: config.primaryColor }}>Sauvegarder</button>
        </div>
      )}

      {tab === 'journal' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>
             {newJ.id ? 'MODIFIER SOUVENIR' : 'NOUVEAU SOUVENIR'}
           </h3>
           <input value={newJ.title} onChange={e => setNewJ({...newJ, title: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Titre" />
           <input value={newJ.author} onChange={e => setNewJ({...newJ, author: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Auteur" />
           <textarea value={newJ.content} onChange={e => setNewJ({...newJ, content: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-24" placeholder="Histoire..." />
           <div onClick={() => fileRef.current?.click()} className="p-4 border-dashed border-2 rounded-2xl cursor-pointer text-center">{newJ.image ? 'Image OK' : 'Ajouter Photo'}</div>
           <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={e => handleFile(e, (b: string) => setNewJ({...newJ, image: b}))} />
           
           <div className="flex gap-2">
             {newJ.id && <button onClick={() => setNewJ({id:'', title:'', author:'', content:'', image:''})} className="px-6 py-5 bg-gray-100 rounded-2xl font-bold text-gray-500">Annuler</button>}
             <button onClick={() => { 
                if(newJ.title) { 
                  if(newJ.id) upd('family_journal', newJ.id, newJ); 
                  else add('family_journal', {...newJ, date: new Date().toLocaleDateString()}); 
                  setNewJ({id:'', title:'',author:'',content:'',image:''}); 
                } 
              }} className="flex-1 py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{ backgroundColor: config.primaryColor }}>
               {newJ.id ? 'Mettre à jour' : 'Publier'}
             </button>
           </div>

           <div className="mt-8 pt-8 border-t border-gray-100">
             <h4 className="font-bold mb-4 opacity-50 text-xs uppercase tracking-widest">Modifier les souvenirs existants</h4>
             <div className="space-y-2 max-h-60 overflow-y-auto">
               {journal?.map((j: any) => (
                 <div key={j.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl hover:bg-white border border-transparent hover:border-gray-200 transition-all">
                   <span className="text-sm font-bold truncate w-2/3">{j.title}</span>
                   <div className="flex gap-2">
                     <button onClick={() => handleEdit(j, 'journal')} className="p-2 bg-blue-50 text-blue-500 rounded-lg hover:bg-blue-100"><Pencil size={14}/></button>
                     <button onClick={() => del('family_journal', j.id)} className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"><Trash2 size={14}/></button>
                   </div>
                 </div>
               ))}
             </div>
           </div>
        </div>
      )}

      {tab === 'code' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>CODE SEMAINIER</h3>
           <textarea value={localC.cookingHtml} onChange={e => setLocalC({...localC, cookingHtml: e.target.value})} className="w-full p-6 rounded-3xl border border-gray-200 h-64 font-mono text-xs text-gray-600" placeholder="Code HTML iframe..." />
           <button onClick={() => save(localC, true)} className="w-full py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{ backgroundColor: config.primaryColor }}>Sauvegarder le code</button>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>RESTAURATION</h3>
           <p className="opacity-60 text-sm">Gérez vos sauvegardes de design.</p>
           <div className="space-y-3 h-96 overflow-y-auto">
             {versions.map((v: SiteVersion) => (
               <div key={v.id} className="flex justify-between items-center p-5 bg-gray-50 rounded-2xl border border-gray-100 group">
                 <div className="flex-1">
                   {editingVersionId === v.id ? (
                     <div className="flex gap-2 mr-4">
                       <input value={tempVersionName} onChange={e => setTempVersionName(e.target.value)} className="flex-1 p-2 rounded-lg border border-gray-300 text-sm" autoFocus />
                       <button onClick={() => saveVersionName(v.id)} className="p-2 bg-green-100 text-green-600 rounded-lg"><Save size={16}/></button>
                       <button onClick={() => setEditingVersionId(null)} className="p-2 bg-red-100 text-red-600 rounded-lg"><X size={16}/></button>
                     </div>
                   ) : (
                     <div>
                       <div className="font-bold flex items-center gap-2">
                         {v.name}
                         <button onClick={() => startEditVersion(v)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity"><Pencil size={12}/></button>
                       </div>
                       <div className="text-xs opacity-50">{new Date(v.date).toLocaleString()}</div>
                     </div>
                   )}
                 </div>
                 <div className="flex gap-2">
                   <button onClick={() => del('site_versions', v.id)} className="p-3 bg-white border border-red-100 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-colors" title="Supprimer"><Trash2 size={18}/></button>
                   <button onClick={() => restore(v)} className="p-3 bg-white border border-gray-200 rounded-xl hover:bg-black hover:text-white transition-colors" title="Restaurer"><RotateCcw size={18}/></button>
                 </div>
               </div>
             ))}
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
