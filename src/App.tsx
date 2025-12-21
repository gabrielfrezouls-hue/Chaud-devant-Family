import React, { useState, useEffect, useRef } from 'react';
// IMPORTS FIREBASE (Le nouveau moteur)
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';

// IMPORTS DESIGN (La carrosserie)
import { 
  Lock, Menu, X, Home, BookHeart, UtensilsCrossed, 
  Calendar as CalIcon, Settings, Plus, Trash2, Sparkles, Send, 
  RotateCcw, Save, Image as ImageIcon, Code, MessageSquare, History,
  ChevronRight, Camera, LogIn, LogOut, Loader2
} from 'lucide-react';
import { JournalEntry, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat } from './services/geminiService';
import Background from './components/Background';

// --- CONFIGURATION ---
// Ajoute ici les adresses Gmail de ta famille
const FAMILY_EMAILS = [
  "axisman705@gmail.com",
  "valentin.frezouls@gmail.com",
  "eau.fraise.fille@gmail.com"
  // Ajoute les autres ici...
];

// CONFIG PAR DÉFAUT (Si la base de données est vide)
const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7',
  fontFamily: 'Inter',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille. Un lieu pour nos souvenirs et nos partages.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: {
    home: 'ACCUEIL',
    journal: 'JOURNAL',
    cooking: 'CUISINE',
    calendar: 'CALENDRIER'
  },
  hiddenSections: [],
  homeHtml: '',
  cookingHtml: ''
};

const App: React.FC = () => {
  // --- ÉTAT (STATE) ---
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true); // Pour le chargement initial
  
  // Données connectées à Firebase
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]); // Optionnel: versions locales ou DB

  // États d'interface
  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false); // Double sécurité pour l'Admin
  const [password, setPassword] = useState(''); // Pour le code Admin seulement

  // IA
  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // --- 1. GESTION DE LA CONNEXION (AUTH) ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Erreur connexion", error);
      alert("Erreur de connexion Google");
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setIsEditUnlocked(false);
    setCurrentView('home');
  };

  // --- 2. SYNCHRONISATION FIREBASE (DATA) ---
  
  // A. Charger la Configuration du site
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'site_config', 'main'), (doc) => {
      if (doc.exists()) {
        setConfig(doc.data() as SiteConfig);
      } else {
        // Si pas de config, on garde celle par défaut (et on pourrait la créer)
      }
    });
    return () => unsub();
  }, []);

  // B. Charger le Journal (Trié par date)
  useEffect(() => {
    const q = query(collection(db, 'family_journal'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JournalEntry));
      setJournal(docs);
    });
    return () => unsub();
  }, []);

  // C. Charger l'Agenda
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'family_events'), (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FamilyEvent));
      setEvents(docs);
    });
    return () => unsub();
  }, []);


  // --- ACTIONS (Sauvegarder dans Firebase) ---

  const saveConfigToFirebase = async (newConfig: SiteConfig) => {
    try {
      await setDoc(doc(db, 'site_config', 'main'), newConfig);
      setConfig(newConfig); // Mise à jour optimiste
    } catch (e) {
      alert("Erreur sauvegarde config");
    }
  };

  const addJournalEntry = async (entry: any) => {
    await addDoc(collection(db, 'family_journal'), {
      ...entry,
      timestamp: serverTimestamp() // Important pour le tri
    });
  };

  const deleteJournalEntry = async (id: string) => {
    if(confirm("Supprimer ce souvenir ?")) {
      await deleteDoc(doc(db, 'family_journal', id));
    }
  };

  const addEvent = async (event: any) => {
    await addDoc(collection(db, 'family_events'), event);
  };

  const removeEvent = async (id: string) => {
    await deleteDoc(doc(db, 'family_events', id));
  };


  // --- LOGIQUE ADMIN & IA ---

  const unlockEdit = () => {
    if (password === '16.07.gabi.11') {
      setIsEditUnlocked(true);
      setPassword('');
    } else alert("Code modification incorrect");
  };

  const handleArchitectRequest = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    const newConfig = await askAIArchitect(aiPrompt, config);
    if (newConfig) {
      // On sauvegarde la nouvelle config direct dans Firebase
      await saveConfigToFirebase({
        ...config,
        ...newConfig,
        navigationLabels: { ...config.navigationLabels, ...(newConfig.navigationLabels || {}) }
      });
      setAiPrompt('');
      alert("L'IA a relooké le site !");
    } else alert("L'IA n'a pas pu traiter cette demande.");
    setIsAiLoading(false);
  };

  const handleChat = async () => {
    if (!aiPrompt.trim()) return;
    const newHistory = [...chatHistory, { role: 'user', text: aiPrompt }];
    setChatHistory(newHistory);
    setAiPrompt('');
    setIsAiLoading(true);
    const response = await askAIChat(newHistory);
    setChatHistory(prev => [...prev, { role: 'model', text: response }]);
    setIsAiLoading(false);
  };


  // --- NAVIGATION ---
  const BottomNav = () => (
    <div 
      className="fixed bottom-0 left-0 right-0 h-20 border-t border-white/10 flex items-center justify-around md:hidden z-50 px-2 rounded-t-[2rem] shadow-2xl"
      style={{ backgroundColor: config.primaryColor }}
    >
      <NavIcon icon={<Home size={22}/>} label={config.navigationLabels?.home || 'ACCUEIL'} active={currentView === 'home'} onClick={() => setCurrentView('home')} />
      <NavIcon icon={<BookHeart size={22}/>} label={config.navigationLabels?.journal || 'JOURNAL'} active={currentView === 'journal'} onClick={() => setCurrentView('journal')} />
      <NavIcon icon={<UtensilsCrossed size={22}/>} label={config.navigationLabels?.cooking || 'CUISINE'} active={currentView === 'cooking'} onClick={() => setCurrentView('cooking')} />
      <NavIcon icon={<CalIcon size={22}/>} label={config.navigationLabels?.calendar || 'CAL'} active={currentView === 'calendar'} onClick={() => setCurrentView('calendar')} />
      <NavIcon icon={<Settings size={22}/>} label="ADMIN" active={currentView === 'edit'} onClick={() => setCurrentView('edit')} />
    </div>
  );

  const NavIcon = ({ icon, label, active, onClick }: any) => (
    <button onClick={onClick} className={`flex flex-col items-center gap-1.5 transition-all flex-1 py-2 ${active ? 'text-white scale-110' : 'text-white/50'}`}>
      <div className={`${active ? 'bg-white/20 p-2 rounded-xl shadow-inner' : ''} transition-all`}>
        {icon}
      </div>
      <span className="text-[7px] font-black uppercase tracking-widest text-white">{label}</span>
    </button>
  );

  const SideMenu = () => (
    <>
      <div className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] transition-opacity duration-300 ${isMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsMenuOpen(false)} />
      <div 
        className={`fixed top-0 right-0 bottom-0 w-80 z-[80] shadow-2xl transition-transform duration-300 border-l border-black/5 ${isMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ backgroundColor: config.backgroundColor }}
      >
        <div className="p-10 space-y-10 h-full overflow-y-auto">
          <div className="flex justify-between items-center border-b border-black/5 pb-6">
            <span className="font-cinzel font-black text-xl" style={{ color: config.primaryColor }}>MENU</span>
            <button onClick={() => setIsMenuOpen(false)} className="p-3 hover:bg-black/5 rounded-full transition-colors" style={{ color: config.primaryColor }}><X size={24} /></button>
          </div>
          <div className="flex flex-col gap-3">
            <MenuLink label={config.navigationLabels?.home || 'ACCUEIL'} active={currentView === 'home'} onClick={() => {setCurrentView('home'); setIsMenuOpen(false);}} />
            <MenuLink label={config.navigationLabels?.journal || 'JOURNAL'} active={currentView === 'journal'} onClick={() => {setCurrentView('journal'); setIsMenuOpen(false);}} />
            <MenuLink label={config.navigationLabels?.cooking || 'CUISINE'} active={currentView === 'cooking'} onClick={() => {setCurrentView('cooking'); setIsMenuOpen(false);}} />
            <MenuLink label={config.navigationLabels?.calendar || 'CALENDRIER'} active={currentView === 'calendar'} onClick={() => {setCurrentView('calendar'); setIsMenuOpen(false);}} />
            <div className="pt-6 mt-6 border-t border-black/5">
               <MenuLink label="ADMINISTRATION" active={currentView === 'edit'} onClick={() => {setCurrentView('edit'); setIsMenuOpen(false);}} />
               <button onClick={handleLogout} className="w-full text-left p-5 rounded-2xl text-xs font-black tracking-widest text-red-500 hover:bg-red-50">DÉCONNEXION</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  const MenuLink = ({ label, active, onClick }: any) => (
    <button 
      onClick={onClick} 
      className={`w-full text-left p-5 rounded-2xl text-xs font-black tracking-widest transition-all ${active ? 'text-white shadow-lg' : 'text-black/70 hover:bg-black/5'}`}
      style={{ backgroundColor: active ? config.primaryColor : 'transparent' }}
    >
      {label}
    </button>
  );

  // --- RENDU PRINCIPAL ---

  // 1. Écran de chargement (Le Sablier)
  if (isInitializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center" style={{ backgroundColor: ORIGINAL_CONFIG.backgroundColor }}>
        <Loader2 className="w-12 h-12 animate-spin mb-4" style={{ color: ORIGINAL_CONFIG.primaryColor }} />
        <p className="text-sm uppercase tracking-widest opacity-50">Chargement de la famille...</p>
      </div>
    );
  }

  // 2. Écran de Connexion (Remplace l'ancien "Lock Screen")
  if (!user) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center p-6 z-[100]" style={{ backgroundColor: ORIGINAL_CONFIG.backgroundColor }}>
        <Background color={ORIGINAL_CONFIG.primaryColor} />
        <div className="w-full max-w-md space-y-12 text-center relative z-10 animate-in fade-in zoom-in duration-700">
          <div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-2xl" style={{ backgroundColor: ORIGINAL_CONFIG.primaryColor }}>
            <Sparkles className="text-white" size={48} />
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-cinzel font-black tracking-widest" style={{ color: ORIGINAL_CONFIG.primaryColor }}>CHAUD DEVANT</h1>
            <p className="italic opacity-60">Espace privé de la famille</p>
          </div>
          <button 
            onClick={handleLogin} 
            className="w-full flex items-center justify-center gap-3 bg-white text-black font-black py-6 rounded-2xl shadow-xl hover:scale-105 transition-transform"
          >
            <LogIn size={24} /> Se connecter avec Google
          </button>
        </div>
      </div>
    );
  }

  // --- SÉCURITÉ : VÉRIFICATION DE LA LISTE ---
  // Si l'utilisateur est connecté MAIS n'est pas dans la liste
  if (user && user.email && !FAMILY_EMAILS.includes(user.email)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center bg-[#f5ede7]">
        <div className="bg-white p-10 rounded-3xl shadow-xl space-y-6 max-w-md border border-red-100">
          <div className="mx-auto w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
            <Lock className="text-red-500 w-10 h-10" />
          </div>
          <h1 className="text-2xl font-cinzel font-black text-red-800">Accès Réservé</h1>
          <p className="text-gray-600">
            Désolé <strong>{user.displayName}</strong>, cette application est privée et réservée à la famille.
          </p>
          <div className="p-4 bg-gray-50 rounded-xl text-sm font-mono text-gray-500 break-all">
            {user.email}
          </div>
          <button 
            onClick={handleLogout}
            className="w-full py-4 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  // 3. Application Complète (Une fois connecté)
  return (
    <div className="min-h-screen transition-all duration-1000 pb-24 md:pb-0" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      
      <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentView('home')}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        
        {/* User Info Mobile/Desktop */}
        <div className="flex items-center gap-3 bg-black/5 px-3 py-1.5 rounded-full md:mr-auto md:ml-6">
            {user.photoURL && <img src={user.photoURL} className="w-6 h-6 rounded-full" />}
            <span className="text-xs font-bold opacity-60 max-w-[100px] truncate">{user.displayName}</span>
        </div>

        <div className="hidden md:flex items-center gap-8 ml-auto">
          <NavHeaderLink label={config.navigationLabels?.home} active={currentView === 'home'} onClick={() => setCurrentView('home')} color={config.primaryColor} />
          <NavHeaderLink label={config.navigationLabels?.journal} active={currentView === 'journal'} onClick={() => setCurrentView('journal')} color={config.primaryColor} />
          <NavHeaderLink label={config.navigationLabels?.cooking} active={currentView === 'cooking'} onClick={() => setCurrentView('cooking')} color={config.primaryColor} />
          <NavHeaderLink label={config.navigationLabels?.calendar} active={currentView === 'calendar'} onClick={() => setCurrentView('calendar')} color={config.primaryColor} />
          <button onClick={() => setIsMenuOpen(true)} className="p-3 rounded-xl transition-all hover:bg-black/5" style={{ color: config.primaryColor }}><Menu size={20}/></button>
        </div>
        <button className="md:hidden p-2" onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={28} /></button>
      </nav>

      <SideMenu />
      <BottomNav />

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-32 relative z-10">
        {currentView === 'home' && (
          <div className="space-y-16 animate-in fade-in duration-1000">
            {/* Countdown supprimé, place au contenu ! */}

            <section className="relative h-[55vh] md:h-[65vh] rounded-[3rem] overflow-hidden group shadow-2xl">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[8000ms] group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute bottom-12 left-10 right-10 space-y-4">
                <h1 className="text-5xl md:text-8xl font-cinzel font-black tracking-tighter text-white uppercase leading-none">{config.welcomeTitle}</h1>
                <p className="text-xl md:text-2xl text-white/80 max-w-2xl leading-relaxed italic font-light">{config.welcomeText}</p>
              </div>
            </section>

            {config.homeHtml && (
              <section className="bg-white/50 backdrop-blur-md rounded-[3rem] border border-black/5 overflow-hidden shadow-xl">
                <iframe srcDoc={config.homeHtml} className="w-full min-h-[450px]" sandbox="allow-scripts allow-forms allow-popups" />
              </section>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <HomeCard icon={<BookHeart size={44}/>} title="Souvenirs" label="Explorer le journal" onClick={() => setCurrentView('journal')} color={config.primaryColor} />
              <HomeCard icon={<UtensilsCrossed size={44}/>} title="Recettes" label="Voir le semainier" onClick={() => setCurrentView('cooking')} color={config.primaryColor} />
            </div>
          </div>
        )}

        {currentView === 'journal' && <JournalView journal={journal} color={config.primaryColor} />}
        {currentView === 'cooking' && <CookingView html={config.cookingHtml} color={config.primaryColor} />}
        {currentView === 'calendar' && <CalendarView events={events} color={config.primaryColor} />}
        {currentView === 'edit' && (
          <div className="max-w-6xl mx-auto space-y-16 animate-in slide-in-from-bottom-12 duration-700">
            {!isEditUnlocked ? (
              <div className="max-w-md mx-auto py-24 text-center space-y-12 bg-white/60 backdrop-blur-xl p-14 rounded-[3.5rem] border border-black/5 shadow-2xl">
                <div className="w-24 h-24 bg-black/5 rounded-[2rem] flex items-center justify-center mx-auto">
                   <Settings className="animate-spin-slow" size={48} style={{ color: config.primaryColor }} />
                </div>
                <h2 className="text-4xl font-cinzel font-black tracking-widest" style={{ color: config.primaryColor }}>MODIFIER</h2>
                <div className="space-y-5">
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-white border border-black/10 rounded-2xl py-6 px-6 text-center text-xl outline-none" placeholder="Code Admin" onKeyDown={(e) => e.key === 'Enter' && unlockEdit()} />
                  <button onClick={unlockEdit} className="w-full text-white font-black py-6 rounded-2xl transition-all shadow-lg hover:brightness-90" style={{ backgroundColor: config.primaryColor }}>ACCÉDER</button>
                  <p className="text-xs opacity-50 italic">Code demandé par sécurité (enfants)</p>
                </div>
              </div>
            ) : (
              // On passe les fonctions Firebase au panneau Admin
              <AdminPanel 
                config={config} 
                saveConfig={saveConfigToFirebase}
                addEntry={addJournalEntry}
                deleteEntry={deleteJournalEntry}
                events={events}
                addEvent={addEvent}
                removeEvent={removeEvent}
                versions={versions} setVersions={setVersions} // Versions restent locales pour l'instant
                handleArchitect={handleArchitectRequest}
                handleChat={handleChat}
                aiPrompt={aiPrompt} setAiPrompt={setAiPrompt}
                isAiLoading={isAiLoading}
                chatHistory={chatHistory}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
};

// --- COMPOSANTS INTERNES ---

const NavHeaderLink = ({ label, active, onClick, color }: any) => (
  <button onClick={onClick} className={`text-xs font-black tracking-widest transition-all ${active ? '' : 'opacity-40 hover:opacity-100'}`} style={{ color: active ? color : 'inherit' }}>{label}</button>
);

const HomeCard = ({ icon, title, label, onClick, color }: any) => (
  <div onClick={onClick} className="p-12 bg-white/70 backdrop-blur-xl rounded-[3rem] border border-black/5 group hover:bg-black/5 transition-all cursor-pointer shadow-lg hover:shadow-2xl">
    <div className="mb-8 group-hover:scale-110 transition-transform" style={{ color }}>{icon}</div>
    <h3 className="text-4xl font-cinzel font-bold mb-5 leading-tight">{title}</h3>
    <button className="text-[11px] font-black tracking-widest uppercase flex items-center gap-2" style={{ color }}>{label} <ChevronRight size={16}/></button>
  </div>
);

const JournalView = ({ journal, color }: any) => (
  <div className="space-y-16 animate-in slide-in-from-bottom-12 duration-700">
    <h2 className="text-5xl md:text-7xl font-cinzel font-black text-center tracking-tighter">NOTRE <span style={{ color }}>JOURNAL</span></h2>
    <div className="columns-1 md:columns-2 gap-10 space-y-10">
      {journal.map((entry: JournalEntry) => (
        <article key={entry.id} className="break-inside-avoid bg-white/90 backdrop-blur-md rounded-[3rem] border border-black/5 overflow-hidden group hover:shadow-2xl transition-all">
          {entry.image && <img src={entry.image} className="w-full h-72 object-cover" />}
          <div className="p-12 space-y-6">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] opacity-40"><span>{entry.date}</span><span>PAR {entry.author}</span></div>
            <h3 className="text-3xl font-cinzel font-bold leading-tight">{entry.title}</h3>
            <p className="opacity-70 leading-relaxed italic text-lg">{entry.content}</p>
          </div>
        </article>
      ))}
      {journal.length === 0 && <p className="text-center opacity-30 py-40 italic col-span-2 text-xl">L'histoire reste à écrire...</p>}
    </div>
  </div>
);

const CookingView = ({ html, color }: any) => (
  <div className="space-y-16 animate-in slide-in-from-bottom-12 duration-700">
    <h2 className="text-5xl md:text-7xl font-cinzel font-black text-center tracking-tighter">CHAUD LES <span style={{ color }}>FOURNEAUX !</span></h2>
    <div className="bg-white/80 backdrop-blur-xl rounded-[3rem] border border-black/5 overflow-hidden shadow-2xl min-h-[850px]">
      {html ? <iframe srcDoc={html} className="w-full min-h-[850px]" sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-modals" /> : <div className="p-40 text-center opacity-20 italic text-2xl">Semainier à configurer dans l'admin.</div>}
    </div>
  </div>
);

const CalendarView = ({ events, color }: any) => (
  <div className="space-y-16 animate-in slide-in-from-bottom-12 duration-700">
    <h2 className="text-5xl md:text-7xl font-cinzel font-black text-center tracking-tighter">CALENDRIER <span style={{ color }}>FAMILIAL</span></h2>
    <div className="max-w-4xl mx-auto space-y-6">
      {events.length === 0 ? <p className="text-center opacity-30 py-32 italic text-2xl">Agenda libre pour le moment.</p> : 
      events.sort((a:any,b:any) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((ev: any) => (
        <div key={ev.id} className="flex items-center gap-10 p-10 bg-white/90 rounded-[2.5rem] border border-black/5 hover:bg-white transition-all shadow-md group">
          <div className="w-24 h-24 rounded-[1.8rem] flex flex-col items-center justify-center font-black transition-transform group-hover:rotate-6 text-white" style={{ backgroundColor: color }}>
            <span className="text-xs uppercase opacity-70">{new Date(ev.date).toLocaleDateString('fr-FR', { month: 'short' })}</span>
            <span className="text-4xl">{new Date(ev.date).getDate()}</span>
          </div>
          <div className="space-y-1">
            <h4 className="text-3xl font-cinzel font-bold">{ev.title}</h4>
            <span className="text-xs font-black uppercase tracking-[0.3em] opacity-30">{ev.type}</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const AdminPanel = ({ 
  config, saveConfig, addEntry, deleteEntry, events, addEvent, removeEvent,
  handleArchitect, handleChat, aiPrompt, setAiPrompt, isAiLoading, chatHistory
}: any) => {
  const [activeTab, setActiveTab] = useState('ia-architect');
  // États locaux pour les formulaires
  const [newEntry, setNewEntry] = useState({ title: '', author: '', content: '', image: '' });
  const [newEvent, setNewEvent] = useState({ title: '', date: '', type: 'other' });
  const [localConfig, setLocalConfig] = useState(config);

  // Sync local config si la config externe change
  useEffect(() => { setLocalConfig(config); }, [config]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const homeImageRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => callback(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-12 pb-20">
      <div className="flex flex-wrap gap-2 p-3 bg-white/70 backdrop-blur-xl rounded-[2rem] border border-black/5 shadow-xl overflow-x-auto">
        <TabBtn id="ia-architect" active={activeTab} set={setActiveTab} label="LOOK IA" icon={<Sparkles size={16}/>} color={config.primaryColor} />
        <TabBtn id="home" active={activeTab} set={setActiveTab} label="ACCUEIL" icon={<Home size={16}/>} color={config.primaryColor} />
        <TabBtn id="ia-chat" active={activeTab} set={setActiveTab} label="MAJORDOME" icon={<MessageSquare size={16}/>} color={config.primaryColor} />
        <TabBtn id="journal" active={activeTab} set={setActiveTab} label="JOURNAL" icon={<BookHeart size={16}/>} color={config.primaryColor} />
        <TabBtn id="events" active={activeTab} set={setActiveTab} label="AGENDA" icon={<CalIcon size={16}/>} color={config.primaryColor} />
        <TabBtn id="codes" active={activeTab} set={setActiveTab} label="CODES" icon={<Code size={16}/>} color={config.primaryColor} />
      </div>

      <div className="bg-white/90 backdrop-blur-xl rounded-[3.5rem] border border-black/5 p-12 min-h-[650px] shadow-2xl">
        
        {activeTab === 'ia-architect' && (
          <div className="space-y-10 max-w-4xl mx-auto">
            <h3 className="text-4xl font-cinzel font-bold" style={{ color: config.primaryColor }}>ARCHITECTE IA</h3>
            <textarea 
              value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
              className="w-full h-48 bg-white border border-black/10 rounded-[2rem] p-8 outline-none focus:ring-4 text-lg" 
              placeholder="Ex: 'Met un thème bleu nuit et or', 'Change les titres pour CHAUD FAMILIA'..."
            />
            <button onClick={handleArchitect} disabled={isAiLoading} className="w-full text-white font-black py-7 rounded-2xl flex items-center justify-center gap-4 shadow-xl transition-all text-xl hover:brightness-90" style={{ backgroundColor: config.primaryColor }}>
              {isAiLoading ? <Loader2 className="animate-spin" /> : <><Sparkles size={24}/> TRANSFORMER LE SITE</>}
            </button>
          </div>
        )}

        {activeTab === 'home' && (
          <div className="space-y-10 max-w-4xl mx-auto">
            <h3 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>MODIFIER L'ACCUEIL</h3>
            <div className="grid grid-cols-1 gap-6">
              <input className="w-full bg-white border border-black/10 rounded-2xl p-5" placeholder="Titre d'accueil" value={localConfig.welcomeTitle} onChange={e => setLocalConfig({...localConfig, welcomeTitle: e.target.value})} />
              <textarea className="w-full bg-white border border-black/10 rounded-2xl p-5 h-32" placeholder="Texte de bienvenue" value={localConfig.welcomeText} onChange={e => setLocalConfig({...localConfig, welcomeText: e.target.value})} />
              
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest opacity-40">Image d'accueil</label>
                <div 
                  className="w-full h-64 border-2 border-dashed border-black/10 rounded-[2rem] flex flex-col items-center justify-center overflow-hidden cursor-pointer group"
                  onClick={() => homeImageRef.current?.click()}
                >
                  {localConfig.welcomeImage ? (
                    <div className="relative w-full h-full">
                      <img src={localConfig.welcomeImage} className="w-full h-full object-cover group-hover:opacity-70 transition-opacity" />
                    </div>
                  ) : <ImageIcon className="opacity-20" size={40}/>}
                  <input ref={homeImageRef} type="file" className="hidden" accept="image/*" onChange={e => handleFileUpload(e, (b) => setLocalConfig({...localConfig, welcomeImage: b}))} />
                </div>
              </div>

              <button onClick={() => {saveConfig(localConfig); alert("Accueil mis à jour !");}} className="w-full text-white font-black py-6 rounded-2xl shadow-xl flex items-center justify-center gap-3" style={{ backgroundColor: config.primaryColor }}><Save size={20}/> ENREGISTRER L'ACCUEIL</button>
            </div>
          </div>
        )}

        {activeTab === 'journal' && (
          <div className="space-y-10">
            <h3 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>NOUVEAU SOUVENIR</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-5">
                <input className="w-full bg-white border border-black/10 rounded-2xl p-5" placeholder="Titre" value={newEntry.title} onChange={e => setNewEntry({...newEntry, title: e.target.value})} />
                <input className="w-full bg-white border border-black/10 rounded-2xl p-5" placeholder="Auteur" value={newEntry.author} onChange={e => setNewEntry({...newEntry, author: e.target.value})} />
                <textarea className="w-full bg-white border border-black/10 rounded-2xl p-5 h-48" placeholder="Contenu..." value={newEntry.content} onChange={e => setNewEntry({...newEntry, content: e.target.value})} />
              </div>
              <div 
                className="flex flex-col items-center justify-center border-2 border-dashed border-black/10 rounded-[3rem] p-10 hover:bg-black/5 transition-all cursor-pointer group relative overflow-hidden h-full min-h-[300px]"
                onClick={() => fileInputRef.current?.click()}
              >
                {newEntry.image ? (
                   <img src={newEntry.image} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <>
                    <ImageIcon size={64} className="opacity-10 mb-6 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-black uppercase tracking-widest opacity-20">Cliquer pour charger une photo</span>
                  </>
                )}
                <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={e => handleFileUpload(e, (b) => setNewEntry({...newEntry, image: b}))} />
              </div>
            </div>
            <button 
              onClick={() => {
                if (newEntry.title) {
                  addEntry({...newEntry, date: new Date().toLocaleDateString('fr-FR')});
                  setNewEntry({title:'', author:'', content:'', image:''});
                  alert("Souvenir enregistré !");
                }
              }} 
              className="w-full text-white font-black py-6 rounded-2xl shadow-xl text-xl transition-all hover:brightness-90"
              style={{ backgroundColor: config.primaryColor }}
            >
              PUBLIER DANS LE JOURNAL
            </button>
          </div>
        )}

        {activeTab === 'ia-chat' && (
          <div className="space-y-8 flex flex-col h-[550px]">
            <div className="flex-1 overflow-y-auto space-y-5 p-6 bg-white/60 rounded-[2.5rem] border border-black/5 shadow-inner">
              {chatHistory.map((msg: any, i: number) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-6 rounded-[2rem] shadow-sm ${msg.role === 'user' ? 'text-white' : 'bg-white text-black/80 border border-black/5'}`} style={{ backgroundColor: msg.role === 'user' ? config.primaryColor : 'white' }}>{msg.text}</div>
                </div>
              ))}
              {isAiLoading && <div className="text-sm italic animate-pulse px-4" style={{ color: config.primaryColor }}>Le majordome tape...</div>}
            </div>
            <div className="flex gap-3">
              <input type="text" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} className="flex-1 bg-white border border-black/10 rounded-2xl px-6 text-lg" placeholder="Votre message..." onKeyDown={e => e.key === 'Enter' && handleChat()} />
              <button onClick={handleChat} className="text-white p-6 rounded-2xl shadow-lg transition-all" style={{ backgroundColor: config.primaryColor }}><Send size={24}/></button>
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="space-y-10 max-w-4xl mx-auto">
            <h3 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>AGENDA FAMILIAL</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
               <input type="date" className="bg-white border border-black/10 rounded-2xl p-5" value={newEvent.date} onChange={e => setNewEvent({...newEvent, date: e.target.value})} />
               <input className="bg-white border border-black/10 rounded-2xl p-5" placeholder="Événement" value={newEvent.title} onChange={e => setNewEvent({...newEvent, title: e.target.value})} />
               <select className="bg-white border border-black/10 rounded-2xl p-5" value={newEvent.type} onChange={e => setNewEvent({...newEvent, type: e.target.value as any})}>
                 <option value="birthday">Anniversaire</option>
                 <option value="party">Fête / Sortie</option>
                 <option value="holiday">Vacances</option>
                 <option value="other">Autre</option>
               </select>
            </div>
            <button onClick={() => { if (newEvent.title && newEvent.date) { addEvent(newEvent); setNewEvent({title:'', date:'', type:'other'}); alert("Agenda mis à jour !"); } }} className="w-full text-white font-black py-6 rounded-2xl shadow-xl transition-all hover:brightness-90" style={{ backgroundColor: config.primaryColor }}>AJOUTER LA DATE</button>
            <div className="mt-8 space-y-3">
              {events.map((ev: any) => (
                <div key={ev.id} className="flex justify-between items-center p-5 bg-white rounded-2xl border border-black/5 shadow-sm">
                  <span className="font-bold opacity-70">{new Date(ev.date).toLocaleDateString()} — {ev.title}</span>
                  <button onClick={() => removeEvent(ev.id)} className="text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={18}/></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'codes' && (
          <div className="space-y-10">
            <h3 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>CODES HTML (CUISINE)</h3>
            <textarea className="w-full h-80 bg-black/5 border border-black/5 rounded-3xl p-6 font-mono text-[11px]" value={localConfig.cookingHtml} onChange={e => setLocalConfig({...localConfig, cookingHtml: e.target.value})} style={{ color: config.primaryColor }} />
            <button onClick={() => {saveConfig(localConfig); alert("Code sauvegardé !");}} className="w-full text-white font-black py-6 rounded-2xl shadow-xl flex items-center justify-center gap-3 transition-all hover:brightness-90" style={{ backgroundColor: config.primaryColor }}><Save size={20}/> SAUVEGARDER LE CODE</button>
          </div>
        )}

      </div>
    </div>
  );
};

const TabBtn = ({ id, active, set, label, icon, color }: any) => (
  <button 
    onClick={() => set(id)}
    className={`flex items-center gap-2.5 px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all whitespace-nowrap ${active === id ? 'text-white shadow-lg scale-105' : 'opacity-50 hover:opacity-100 hover:bg-black/5'}`}
    style={{ backgroundColor: active === id ? color : 'transparent' }}
  >
    {icon} {label}
  </button>
);

export default App;
