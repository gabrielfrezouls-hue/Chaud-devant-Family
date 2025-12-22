import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { 
  Lock, Menu, X, Home, BookHeart, UtensilsCrossed, ChefHat,
  Calendar as CalIcon, Settings, Code, Sparkles, Send, History,
  Image as ImageIcon, MessageSquare, ChevronRight, LogIn, Loader2, ShieldAlert, RotateCcw, ArrowLeft, Trash2, Pencil
} from 'lucide-react';
import { JournalEntry, Recipe, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat } from './services/geminiService';
import Background from './components/Background';
import RecipeCard from './components/RecipeCard';

// --- SÉCURITÉ : LISTE DES INVITÉS ---
const FAMILY_EMAILS = [
  "gabriel.frezouls@gmail.com",
  "exemple.maman@gmail.com",
  // Ajoute les autres emails ici
];

const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7',
  fontFamily: 'Inter',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: { home: 'ACCUEIL', journal: 'JOURNAL', cooking: 'SEMAINIER', recipes: 'RECETTES', calendar: 'CALENDRIER' },
  homeHtml: '', cookingHtml: ''
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Données
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);

  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [password, setPassword] = useState('');

  // IA State
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

  // 2. CHARGEMENT DES DONNÉES
  useEffect(() => {
    if (!isAuthorized) return;

    // Fonction silencieuse pour éviter le spam d'erreurs
    const ignoreError = (err: any) => { console.log("Info: ", err.code); };

    const unsubC = onSnapshot(doc(db, 'site_config', 'main'), (d) => { if (d.exists()) setConfig(d.data() as SiteConfig); }, ignoreError);
    const unsubJ = onSnapshot(query(collection(db, 'family_journal'), orderBy('timestamp', 'desc')), (s) => setJournal(s.docs.map(d => ({ id: d.id, ...d.data() } as JournalEntry))), ignoreError);
    const unsubR = onSnapshot(collection(db, 'family_recipes'), (s) => setRecipes(s.docs.map(d => ({ id: d.id, ...d.data() } as Recipe))), ignoreError);
    const unsubE = onSnapshot(collection(db, 'family_events'), (s) => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() } as FamilyEvent))), ignoreError);
    const unsubV = onSnapshot(query(collection(db, 'site_versions'), orderBy('date', 'desc')), (s) => setVersions(s.docs.map(d => ({ id: d.id, ...d.data() } as SiteVersion))), ignoreError);
    
    return () => { unsubC(); unsubJ(); unsubR(); unsubE(); unsubV(); };
  }, [user]);

  // ACTIONS FIREBASE
  const handleLogin = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Erreur Auth"); } };
  const handleLogout = () => { signOut(auth); setIsEditUnlocked(false); setCurrentView('home'); };
  
  const saveConfig = async (c: SiteConfig, saveHistory = false) => { 
    try {
      await setDoc(doc(db, 'site_config', 'main'), c); 
      setConfig(c);
      if(saveHistory) {
        await addDoc(collection(db, 'site_versions'), {
          name: `Sauvegarde du ${new Date().toLocaleDateString()}`,
          date: new Date().toISOString(),
          config: c
        });
      }
    } catch(e) { console.error("Erreur sauvegarde", e); alert("Erreur sauvegarde. Vérifie ta connexion."); }
  };

  const restoreVersion = (v: SiteVersion) => {
    if(confirm(`Restaurer la version "${v.name}" ?`)) saveConfig(v.config, false);
  };

  const addEntry = async (col: string, data: any) => { 
    try {
      await addDoc(collection(db, col), { ...data, timestamp: serverTimestamp() }); 
    } catch(e) { console.error("Erreur ajout", e); alert("Impossible d'ajouter. Vérifie tes droits."); }
  };

  // NOUVELLE FONCTION : UPDATE
  const updateEntry = async (col: string, id: string, data: any) => {
    try {
      const { id: _, ...cleanData } = data; 
      await setDoc(doc(db, col, id), { ...cleanData, timestamp: serverTimestamp() }, { merge: true });
      alert("Modifications enregistrées !");
    } catch (e) {
      console.error("Erreur update", e);
      alert("Erreur lors de la modification.");
    }
  };
  
  const deleteItem = async (col: string, id: string) => { 
    if(confirm("Supprimer définitivement ?")) await deleteDoc(doc(db, col, id)); 
  };

  const unlockEdit = () => { if (password === '16.07.gabi.11') { setIsEditUnlocked(true); setPassword(''); } else alert("Code faux"); };
  
  // IA
  const handleArchitect = async () => {
    if (!aiPrompt.trim()) return; setIsAiLoading(true);
    const newConfig = await askAIArchitect(aiPrompt, config);
    if (newConfig) await saveConfig({ ...config, ...newConfig }, true); 
    else alert("L'IA n'a pas pu répondre. Vérifie ta clé.");
    setIsAiLoading(false);
  };
  
  const handleChat = async () => {
    if (!aiPrompt.trim()) return;
    const newH = [...chatHistory, { role: 'user', text: aiPrompt }];
    setChatHistory(newH); setAiPrompt(''); setIsAiLoading(true);
    const rep = await askAIChat(newH);
    setChatHistory([...newH, { role: 'model', text: rep }]); setIsAiLoading(false);
  };

  // --- RENDU ---
  
  if (isInitializing) return <div className="min-h-screen flex items-center justify-center bg-[#f5ede7]"><Loader2 className="w-12 h-12 animate-spin text-[#a85c48]"/></div>;

  if (!user) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]">
      <Background color={ORIGINAL_CONFIG.primaryColor} />
      <div className="z-10 text-center space-y-8 animate-in fade-in zoom-in duration-700">
        <div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-xl bg-[#a85c48]">
          <Sparkles className="text-white" size={48} />
        </div>
        <h1 className="text-4xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1>
        <button onClick={handleLogin} className="bg-white text-black font-black py-4 px-8 rounded-2xl shadow-xl flex items-center gap-3 hover:scale-105 transition-transform">
          <LogIn size={24} /> CONNEXION GOOGLE
        </button>
      </div>
    </div>
  );

  if (!isAuthorized) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center space-y-8">
      <div className="relative">
        <div className="absolute inset-0 bg-red-200 rounded-full animate-ping opacity-20"></div>
        <ShieldAlert className="text-red-500 w-20 h-20 relative z-10" />
      </div>
      <div className="space-y-2">
        <h2 className="text-3xl font-bold text-red-800 font-cinzel">ACCÈS RESTREINT</h2>
        <p className="text-red-400 font-bold tracking-widest text-xs uppercase">Zone Familiale Privée</p>
      </div>
      <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-red-100 max-w-md w-full">
        <p className="text-gray-600 mb-4 text-lg">Bonjour <strong>{user.displayName}</strong>,</p>
        <p className="text-gray-500 leading-relaxed">
          Ton email <span className="bg-red-50 text-red-600 px-2 py-1 rounded-lg font-mono text-sm font-bold">{user.email}</span> n'est pas autorisé.
        </p>
      </div>
      <div className="flex gap-4 w-full max-w-md">
        <button onClick={handleLogout} className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-white border-2 border-red-100 text-red-800 font-bold rounded-2xl hover:bg-red-50 transition-all">
          <ArrowLeft size={20}/> Retour
        </button>
        <button onClick={handleLogout} className="flex-1 px-6 py-4 bg-red-500 text-white font-bold rounded-2xl hover:bg-red-600 transition-all shadow-md">
          Déconnexion
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pb-24 md:pb-0 transition-colors duration-700" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div onClick={() => setCurrentView('home')} className="flex items-center gap-3 cursor-pointer">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        <div className="hidden md:flex gap-6">
           {['home','journal','recipes','cooking','calendar'].map(v => (
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

        {currentView === 'recipes' && (
          <div className="space-y-10">
             <h2 className="text-5xl font-cinzel font-black text-center" style={{ color: config.primaryColor }}>RECETTES</h2>
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {recipes.length === 0 && <p className="text-center col-span-full opacity-50">Aucune recette pour le moment.</p>}
               {recipes.map((r: any) => (
                 <RecipeCard 
                    key={r.id} 
                    recipe={{
                      ...r,
                      ingredients: typeof r.ingredients === 'string' ? r.ingredients.split('\n').filter((i:string) => i.trim() !== '') : r.ingredients,
                      instructions: r.steps || r.instructions
                    }} 
                 />
               ))}
             </div>
          </div>
        )}

        {currentView === 'cooking' && (
           <div className="bg-white/90 rounded-[3rem] min-h-[800px] shadow-xl overflow-hidden border border-black/5">
             {config.cookingHtml ? <iframe srcDoc={config.cookingHtml} className="w-full min-h-[800px]" /> : <div className="p-20 text-center opacity-40">Semainier non configuré</div>}
           </div>
        )}

        {currentView === 'calendar' && (
           <div className="max-w-3xl mx-auto space-y-6">
             {events.map(ev => (
               <div key={ev.id} className="flex items-center gap-6 p-6 bg-white rounded-2xl shadow-sm border border-black/5">
                 <div className="text-center font-bold text-xl w-16" style={{color: config.primaryColor}}>{new Date(ev.date).getDate()}</div>
                 <div className="flex-1 font-bold text-lg font-cinzel">{ev.title}</div>
               </div>
             ))}
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
      <button onClick={close} className="mb-10"><X /></button>
      <div className="space-y-4">
        {['home','journal','recipes','cooking','calendar','edit'].map(v => (
          <button key={v} onClick={() => { setView(v); close(); }} className="block w-full text-left p-4 hover:bg-black/5 rounded-xl uppercase font-bold text-xs tracking-widest">
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
      {id:'home', i:<Home size={22}/>}, {id:'journal', i:<BookHeart size={22}/>},
      {id:'recipes', i:<ChefHat size={22}/>}, {id:'calendar', i:<CalIcon size={22}/>},
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
  
  // États des formulaires
  const [newJ, setNewJ] = useState({ id: '', title: '', author: '', content: '', image: '' });
  const [newR, setNewR] = useState<Recipe>({ id:'', title:'', chef:'', ingredients:'', steps:'', category:'plat', image:'' });
  const [newE, setNewE] = useState({ title: '', date: '', type: 'other' });
  
  const [localC, setLocalC] = useState(config);
  const fileRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => { setLocalC(config); }, [config]);
  
  const handleFile = (e: any, cb: any) => {
    const f = e.target.files[0];
    if(f) { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(f); }
  };

  const handleEdit = (item: any, type: 'recipe' | 'journal') => {
    if (type === 'recipe') setNewR({ ...item, steps: item.steps || item.instructions });
    if (type === 'journal') setNewJ(item);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="bg-white/90 backdrop-blur-xl p-8 rounded-[3.5rem] shadow-2xl min-h-[700px] border border-black/5">
      <div className="flex gap-2 overflow-x-auto mb-10 pb-4 no-scrollbar">
        {[
          {id:'arch', l:'ARCHITECTE', i:<Sparkles size={16}/>}, 
          {id:'chat', l:'MAJORDOME', i:<MessageSquare size={16}/>},
          {id:'home', l:'ACCUEIL', i:<Home size={16}/>},
          {id:'journal', l:'JOURNAL', i:<BookHeart size={16}/>},
          {id:'recipes', l:'RECETTES', i:<ChefHat size={16}/>},
          {id:'events', l:'AGENDA', i:<CalIcon size={16}/>},
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

      {tab === 'recipes' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>
             {newR.id ? 'MODIFIER RECETTE' : 'NOUVELLE RECETTE'}
           </h3>
           <input value={newR.title} onChange={e => setNewR({...newR, title: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200" placeholder="Nom du plat" />
           <div className="flex gap-4">
             <input value={newR.chef} onChange={e => setNewR({...newR, chef: e.target.value})} className="flex-1 p-5 rounded-2xl border border-gray-200" placeholder="Chef" />
             <select value={newR.category} onChange={e => setNewR({...newR, category: e.target.value as any})} className="flex-1 p-5 rounded-2xl border border-gray-200">
               <option value="entrée">Entrée</option><option value="plat">Plat</option><option value="dessert">Dessert</option><option value="autre">Autre</option>
             </select>
           </div>
           <textarea value={Array.isArray(newR.ingredients) ? newR.ingredients.join('\n') : newR.ingredients} onChange={e => setNewR({...newR, ingredients: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-24" placeholder="Ingrédients (un par ligne)" />
           <textarea value={newR.steps || newR.instructions || ''} onChange={e => setNewR({...newR, steps: e.target.value})} className="w-full p-5 rounded-2xl border border-gray-200 h-24" placeholder="Étapes de préparation" />
           <div onClick={() => fileRef.current?.click()} className="p-4 border-dashed border-2 rounded-2xl cursor-pointer text-center">{newR.image ? 'Photo OK' : 'Photo du plat'}</div>
           <input type="file" ref={fileRef} className="hidden" onChange={e => handleFile(e, (b: string) => setNewR({...newR, image: b}))} />
           
           <div className="flex gap-2">
             {newR.id && <button onClick={() => setNewR({id:'', title:'', chef:'', ingredients:'', steps:'', category:'plat', image:''})} className="px-6 py-5 bg-gray-100 rounded-2xl font-bold text-gray-500">Annuler</button>}
             <button onClick={() => { 
               if(newR.title){ 
                 const recipeData = {...newR};
                 if(newR.id) upd('family_recipes', newR.id, recipeData);
                 else add('family_recipes', recipeData);
                 setNewR({id:'', title:'', chef:'', ingredients:'', steps:'', category:'plat', image:''}); 
               } 
             }} className="flex-1 py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{ backgroundColor: config.primaryColor }}>
               {newR.id ? 'Enregistrer' : 'Ajouter la recette'}
             </button>
           </div>

           <div className="mt-8 pt-8 border-t border-gray-100">
             <h4 className="font-bold mb-4 opacity-50 text-xs uppercase tracking-widest">Modifier les recettes existantes</h4>
             <div className="space-y-2 max-h-60 overflow-y-auto">
               {recipes?.map((r: any) => (
                 <div key={r.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl hover:bg-white border border-transparent hover:border-gray-200 transition-all">
                   <div className="flex items-center gap-3 overflow-hidden">
                      {r.image && <img src={r.image} className="w-8 h-8 rounded-full object-cover"/>}
                      <span className="text-sm font-bold truncate">{r.title}</span>
                   </div>
                   <div className="flex gap-2">
                     <button onClick={() => handleEdit(r, 'recipe')} className="p-2 bg-blue-50 text-blue-500 rounded-lg hover:bg-blue-100" title="Modifier"><Pencil size={14}/></button>
                     <button onClick={() => del('family_recipes', r.id)} className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100" title="Supprimer"><Trash2 size={14}/></button>
                   </div>
                 </div>
               ))}
             </div>
           </div>
        </div>
      )}
      
      {tab === 'events' && (
        <div className="space-y-6 animate-in fade-in">
           <h3 className="text-3xl font-cinzel font-bold" style={{color:config.primaryColor}}>AGENDA</h3>
           <div className="flex gap-4">
             <input type="date" value={newE.date} onChange={e => setNewE({...newE, date: e.target.value})} className="w-1/3 p-5 rounded-2xl border border-gray-200" />
             <input value={newE.title} onChange={e => setNewE({...newE, title: e.target.value})} className="w-2/3 p-5 rounded-2xl border border-gray-200" placeholder="Événement" />
           </div>
           <button onClick={() => { if(newE.title && newE.date){ add('family_events', newE); setNewE({title:'',date:'',type:'other'}); alert('Ajouté'); } }} className="w-full py-5 text-white rounded-2xl font-black shadow-xl uppercase" style={{ backgroundColor: config.primaryColor }}>Ajouter</button>
           <div className="mt-8 space-y-2">
             {events.map((ev:any) => <div key={ev.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl"><span className="text-sm">{new Date(ev.date).toLocaleDateString()} - {ev.title}</span><button onClick={() => del('family_events', ev.id)} className="text-red-400"><Trash2 size={16}/></button></div>)}
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
           <p className="opacity-60 text-sm">Cliquez sur une version pour restaurer le design.</p>
           <div className="space-y-3 h-96 overflow-y-auto">
             {versions.map((v: SiteVersion) => (
               <div key={v.id} className="flex justify-between items-center p-5 bg-gray-50 rounded-2xl border border-gray-100">
                 <div>
                   <div className="font-bold">{v.name}</div>
                   <div className="text-xs opacity-50">{new Date(v.date).toLocaleString()}</div>
                 </div>
                 <button onClick={() => restore(v)} className="p-3 bg-white border border-gray-200 rounded-xl hover:bg-black hover:text-white transition-colors"><RotateCcw size={18}/></button>
               </div>
             ))}
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
