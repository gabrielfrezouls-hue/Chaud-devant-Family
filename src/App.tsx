import React, { useState, useEffect, useRef } from 'react';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { 
  Lock, Menu, X, Home, BookHeart, UtensilsCrossed, 
  Calendar as CalIcon, Settings, Plus, Trash2, Sparkles, Send, 
  Image as ImageIcon, Code, MessageSquare, History,
  ChevronRight, Camera, LogIn, LogOut, Loader2, ShieldAlert
} from 'lucide-react';
import { JournalEntry, FamilyEvent, ViewType, SiteConfig, SiteVersion } from './types';
import { askAIArchitect, askAIChat } from './services/geminiService';
import Background from './components/Background';

// --- SÉCURITÉ : LISTE DES INVITÉS ---
// Mets ici TOUTES les adresses Gmail autorisées
const FAMILY_EMAILS = [
  "gabriel.frezouls@gmail.com", // Ton email
  "exemple.maman@gmail.com",
  "exemple.papa@gmail.com"
];

const ORIGINAL_CONFIG: SiteConfig = {
  primaryColor: '#a85c48',
  backgroundColor: '#f5ede7',
  fontFamily: 'Inter',
  welcomeTitle: 'CHAUD DEVANT',
  welcomeText: "Bienvenue dans l'espace sacré de notre famille.",
  welcomeImage: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=2070&auto=format&fit=crop',
  navigationLabels: { home: 'ACCUEIL', journal: 'JOURNAL', cooking: 'CUISINE', calendar: 'CALENDRIER' },
  hiddenSections: [], homeHtml: '', cookingHtml: ''
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Données
  const [config, setConfig] = useState<SiteConfig>(ORIGINAL_CONFIG);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);

  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [password, setPassword] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string, text: string }[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // 1. AUTHENTIFICATION
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  const isAuthorized = user && user.email && FAMILY_EMAILS.includes(user.email);

  // 2. CHARGEMENT DES DONNÉES (Seulement si autorisé !)
  useEffect(() => {
    if (!isAuthorized) return; // Stop si pas la famille (évite l'erreur rouge)

    const unsubConfig = onSnapshot(doc(db, 'site_config', 'main'), (doc) => {
      if (doc.exists()) setConfig(doc.data() as SiteConfig);
    });

    const qJournal = query(collection(db, 'family_journal'), orderBy('timestamp', 'desc'));
    const unsubJournal = onSnapshot(qJournal, (snapshot) => {
      setJournal(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JournalEntry)));
    });

    const unsubEvents = onSnapshot(collection(db, 'family_events'), (snapshot) => {
      setEvents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FamilyEvent)));
    });

    return () => { unsubConfig(); unsubJournal(); unsubEvents(); };
  }, [user]); // Se relance quand l'user change

  // Actions
  const handleLogin = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { alert("Erreur Auth"); } };
  const handleLogout = () => { signOut(auth); setIsEditUnlocked(false); setCurrentView('home'); };
  
  // ... (Fonctions de sauvegarde Firebase identiques à avant) ...
  const saveConfigToFirebase = async (newConfig: SiteConfig) => { await setDoc(doc(db, 'site_config', 'main'), newConfig); setConfig(newConfig); };
  const addJournalEntry = async (entry: any) => { await addDoc(collection(db, 'family_journal'), { ...entry, timestamp: serverTimestamp() }); };
  const deleteJournalEntry = async (id: string) => { if(confirm("Supprimer ?")) await deleteDoc(doc(db, 'family_journal', id)); };
  const addEvent = async (event: any) => { await addDoc(collection(db, 'family_events'), event); };
  const removeEvent = async (id: string) => { await deleteDoc(doc(db, 'family_events', id)); };

  // Admin & IA
  const unlockEdit = () => { if (password === '16.07.gabi.11') { setIsEditUnlocked(true); setPassword(''); } else alert("Code incorrect"); };
  const handleArchitectRequest = async () => {
    if (!aiPrompt.trim()) return; setIsAiLoading(true);
    const newConfig = await askAIArchitect(aiPrompt, config);
    if (newConfig) await saveConfigToFirebase({ ...config, ...newConfig });
    setIsAiLoading(false);
  };
  const handleChat = async () => {
    if (!aiPrompt.trim()) return;
    const newHistory = [...chatHistory, { role: 'user', text: aiPrompt }];
    setChatHistory(newHistory); setAiPrompt(''); setIsAiLoading(true);
    const response = await askAIChat(newHistory);
    setChatHistory(prev => [...prev, { role: 'model', text: response }]); setIsAiLoading(false);
  };

  // --- RENDU ---

  if (isInitializing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5ede7]">
        <Loader2 className="w-12 h-12 animate-spin text-[#a85c48] mb-4" />
        <p className="text-sm uppercase tracking-widest opacity-50">Vérification...</p>
      </div>
    );
  }

  // ÉCRAN 1 : CONNEXION
  if (!user) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center p-6 bg-[#f5ede7]">
        <Background color="#a85c48" />
        <div className="w-full max-w-md space-y-12 text-center relative z-10 animate-in fade-in zoom-in duration-700">
          <div className="mx-auto w-24 h-24 rounded-[2.5rem] flex items-center justify-center shadow-2xl bg-[#a85c48]">
            <Sparkles className="text-white" size={48} />
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-cinzel font-black tracking-widest text-[#a85c48]">CHAUD DEVANT</h1>
            <p className="italic opacity-60">Espace privé de la famille</p>
          </div>
          <button onClick={handleLogin} className="w-full flex items-center justify-center gap-3 bg-white text-black font-black py-6 rounded-2xl shadow-xl hover:scale-105 transition-transform">
            <LogIn size={24} /> Se connecter avec Google
          </button>
        </div>
      </div>
    );
  }

  // ÉCRAN 2 : ACCÈS REFUSÉ (Le Videur)
  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center">
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl space-y-6 max-w-md border border-red-100">
          <div className="mx-auto w-24 h-24 bg-red-100 rounded-full flex items-center justify-center animate-pulse">
            <ShieldAlert className="text-red-500 w-12 h-12" />
          </div>
          <h2 className="text-3xl font-cinzel font-black text-red-800">ACCÈS RESTREINT</h2>
          <p className="text-gray-600 leading-relaxed">
            Bonjour <strong>{user.displayName}</strong>.<br/>
            Cette application est privée. Ton email n'est pas sur la liste des invités.
          </p>
          <div className="p-3 bg-gray-100 rounded-lg text-xs font-mono text-gray-500">{user.email}</div>
          <button onClick={handleLogout} className="w-full py-4 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg">Se déconnecter</button>
        </div>
      </div>
    );
  }

  // ÉCRAN 3 : L'APPLICATION (Seulement si autorisé)
  return (
    <div className="min-h-screen transition-all duration-1000 pb-24 md:pb-0" style={{ backgroundColor: config.backgroundColor, fontFamily: config.fontFamily }}>
      <Background color={config.primaryColor} />
      
      <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-b border-black/5 z-50 h-20 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentView('home')}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: config.primaryColor }}><Home className="text-white" size={20} /></div>
          <span className="font-cinzel font-black text-xl hidden md:block" style={{ color: config.primaryColor }}>CHAUD.DEVANT</span>
        </div>
        <div className="flex items-center gap-3 bg-black/5 px-3 py-1.5 rounded-full md:mr-auto md:ml-6">
            {user.photoURL && <img src={user.photoURL} className="w-6 h-6 rounded-full" />}
            <span className="text-xs font-bold opacity-60 max-w-[100px] truncate">{user.displayName}</span>
        </div>
        {/* Navigation Desktop */}
        <div className="hidden md:flex items-center gap-8 ml-auto">
           {/* ... liens nav ... */}
           <button onClick={() => setCurrentView('home')} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100">ACCUEIL</button>
           <button onClick={() => setCurrentView('journal')} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100">JOURNAL</button>
           <button onClick={() => setCurrentView('cooking')} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100">CUISINE</button>
           <button onClick={() => setCurrentView('calendar')} className="text-xs font-black tracking-widest opacity-40 hover:opacity-100">CALENDRIER</button>
           <button onClick={() => setIsMenuOpen(true)} className="p-3 rounded-xl transition-all hover:bg-black/5" style={{ color: config.primaryColor }}><Menu size={20}/></button>
        </div>
        <button className="md:hidden p-2" onClick={() => setIsMenuOpen(true)} style={{ color: config.primaryColor }}><Menu size={28} /></button>
      </nav>

      <SideMenu 
        config={config} 
        isMenuOpen={isMenuOpen} 
        setIsMenuOpen={setIsMenuOpen} 
        currentView={currentView} 
        setCurrentView={setCurrentView} 
        handleLogout={handleLogout} 
      />
      <BottomNav config={config} currentView={currentView} setCurrentView={setCurrentView} />

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-32 relative z-10">
        {currentView === 'home' && (
          <div className="space-y-16 animate-in fade-in duration-1000">
            <section className="relative h-[55vh] md:h-[65vh] rounded-[3rem] overflow-hidden group shadow-2xl">
              <img src={config.welcomeImage} className="w-full h-full object-cover transition-transform duration-[8000ms] group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute bottom-12 left-10 right-10 space-y-4">
                <h1 className="text-5xl md:text-8xl font-cinzel font-black tracking-tighter text-white uppercase leading-none">{config.welcomeTitle}</h1>
                <p className="text-xl md:text-2xl text-white/80 max-w-2xl leading-relaxed italic font-light">{config.welcomeText}</p>
              </div>
            </section>
            {config.homeHtml && <section className="bg-white/50 backdrop-blur-md rounded-[3rem] border border-black/5 overflow-hidden shadow-xl"><iframe srcDoc={config.homeHtml} className="w-full min-h-[450px]" sandbox="allow-scripts allow-forms allow-popups" /></section>}
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
                </div>
              </div>
            ) : (
              <AdminPanel 
                config={config} saveConfig={saveConfigToFirebase}
                addEntry={addJournalEntry} deleteEntry={deleteJournalEntry}
                events={events} addEvent={addEvent} removeEvent={removeEvent}
                versions={versions} setVersions={setVersions}
                handleArchitect={handleArchitectRequest}
                handleChat={handleChat} aiPrompt={aiPrompt} setAiPrompt={setAiPrompt} isAiLoading={isAiLoading} chatHistory={chatHistory}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
};

// --- SOUS-COMPOSANTS ---

const SideMenu = ({ config, isMenuOpen, setIsMenuOpen, currentView, setCurrentView, handleLogout }: any) => (
  <>
    <div className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] transition-opacity duration-300 ${isMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsMenuOpen(false)} />
    <div className={`fixed top-0 right-0 bottom-0 w-80 z-[80] shadow-2xl transition-transform duration-300 border-l border-black/5 ${isMenuOpen ? 'translate-x-0' : 'translate-x-full'}`} style={{ backgroundColor: config.backgroundColor }}>
      <div className="p-10 space-y-10 h-full overflow-y-auto">
        <div className="flex justify-between items-center border-b border-black/5 pb-6">
          <span className="font-cinzel font-black text-xl" style={{ color: config.primaryColor }}>MENU</span>
          <button onClick={() => setIsMenuOpen(false)} className="p-3 hover:bg-black/5 rounded-full transition-colors" style={{ color: config.primaryColor }}><X size={24} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <MenuLink label={config.navigationLabels?.home} active={currentView === 'home'} onClick={() => {setCurrentView('home'); setIsMenuOpen(false);}} config={config} />
          <MenuLink label={config.navigationLabels?.journal} active={currentView === 'journal'} onClick={() => {setCurrentView('journal'); setIsMenuOpen(false);}} config={config} />
          <MenuLink label={config.navigationLabels?.cooking} active={currentView === 'cooking'} onClick={() => {setCurrentView('cooking'); setIsMenuOpen(false);}} config={config} />
          <MenuLink label={config.navigationLabels?.calendar} active={currentView === 'calendar'} onClick={() => {setCurrentView('calendar'); setIsMenuOpen(false);}} config={config} />
          <div className="pt-6 mt-6 border-t border-black/5">
             <MenuLink label="ADMINISTRATION" active={currentView === 'edit'} onClick={() => {setCurrentView('edit'); setIsMenuOpen(false);}} config={config} />
             <button onClick={handleLogout} className="w-full text-left p-5 rounded-2xl text-xs font-black tracking-widest text-red-500 hover:bg-red-50">DÉCONNEXION</button>
          </div>
        </div>
      </div>
    </div>
  </>
);

const BottomNav = ({ config, currentView, setCurrentView }: any) => (
  <div className="fixed bottom-0 left-0 right-0 h-20 border-t border-white/10 flex items-center justify-around md:hidden z-50 px-2 rounded-t-[2rem] shadow-2xl" style={{ backgroundColor: config.primaryColor }}>
    <NavIcon icon={<Home size={22}/>} label={config.navigationLabels?.home} active={currentView === 'home'} onClick={() => setCurrentView('home')} />
    <NavIcon icon={<BookHeart size={22}/>} label={config.navigationLabels?.journal} active={currentView === 'journal'} onClick={() => setCurrentView('journal')} />
    <NavIcon icon={<UtensilsCrossed size={22}/>} label={config.navigationLabels?.cooking} active={currentView === 'cooking'} onClick={() => setCurrentView('cooking')} />
    <NavIcon icon={<CalIcon size={22}/>} label={config.navigationLabels?.calendar} active={currentView === 'calendar'} onClick={() => setCurrentView('calendar')} />
    <NavIcon icon={<Settings size={22}/>} label="ADMIN" active={currentView === 'edit'} onClick={() => setCurrentView('edit')} />
  </div>
);

const NavIcon = ({ icon, label, active, onClick }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center gap-1.5 transition-all flex-1 py-2 ${active ? 'text-white scale-110' : 'text-white/50'}`}>
    <div className={`${active ? 'bg-white/20 p-2 rounded-xl shadow-inner' : ''} transition-all`}>{icon}</div>
    <span className="text-[7px] font-black uppercase tracking-widest text-white">{label}</span>
  </button>
);

const MenuLink = ({ label, active, onClick, config }: any) => (
  <button onClick={onClick} className={`w-full text-left p-5 rounded-2xl text-xs font-black tracking-widest transition-all ${active ? 'text-white shadow-lg' : 'text-black/70 hover:bg-black/5'}`} style={{ backgroundColor: active ? config.primaryColor : 'transparent' }}>{label}</button>
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

// Pour l'admin panel, je simplifie les imports pour tenir dans le fichier, assure-toi d'avoir les même props
const AdminPanel = ({ 
  config, saveConfig, addEntry, events, addEvent, removeEvent,
  handleArchitect, handleChat, aiPrompt, setAiPrompt, isAiLoading, chatHistory
}: any) => {
  const [activeTab, setActiveTab] = useState('ia-architect');
  const [newEntry, setNewEntry] = useState({ title: '', author: '', content: '', image: '' });
  const [newEvent, setNewEvent] = useState({ title: '', date: '', type: 'other' });
  const [localConfig, setLocalConfig] = useState(config);
  useEffect(() => { setLocalConfig(config); }, [config]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const homeImageRef = useRef<HTMLInputElement>(null);
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void) => {
    const file = e.target.files?.[0];
    if (file) { const reader = new FileReader(); reader.onloadend = () => callback(reader.result as string); reader.readAsDataURL(file); }
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
            <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} className="w-full h-48 bg-white border border-black/10 rounded-[2rem] p-8 outline-none focus:ring-4 text-lg" placeholder="Ex: 'Met un thème bleu nuit et or'..." />
            <button onClick={handleArchitect} disabled={isAiLoading} className="w-full text-white font-black py-7 rounded-2xl flex items-center justify-center gap-4 shadow-xl transition-all text-xl hover:brightness-90" style={{ backgroundColor: config.primaryColor }}>{isAiLoading ? <Loader2 className="animate-spin" /> : <><Sparkles size={24}/> TRANSFORMER LE SITE</>}</button>
          </div>
        )}
        {activeTab === 'home' && (
          <div className="space-y-10 max-w-4xl mx-auto">
            <h3 className="text-3xl font-cinzel font-bold" style={{ color: config.primaryColor }}>MODIFIER L'ACCUEIL</h3>
            <div className="grid grid-cols-1 gap-6">
              <input className="w-full bg-white border border-black/10 rounded-2xl p-5" placeholder="Titre d'accueil" value={localConfig.welcomeTitle} onChange={e =>
