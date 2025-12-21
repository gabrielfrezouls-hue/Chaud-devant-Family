export interface JournalEntry {
  id: string;
  date: string;
  author: string;
  title: string;
  content: string;
  image?: string;
  timestamp?: any; // Pour le tri Firebase
}

export interface FamilyEvent {
  id: string;
  date: string;
  title: string;
  type: 'birthday' | 'party' | 'holiday' | 'other';
}

export type ViewType = 'home' | 'journal' | 'cooking' | 'calendar' | 'edit';

export interface SiteConfig {
  primaryColor: string;
  backgroundColor: string;
  fontFamily: string;
  welcomeTitle: string;
  welcomeText: string;
  welcomeImage: string;
  navigationLabels: {
    home: string;
    journal: string;
    cooking: string;
    calendar: string;
  };
  hiddenSections: string[];
  homeHtml: string;
  cookingHtml: string;
}

export interface SiteVersion {
  id: string;
  name: string;
  timestamp: number;
  config: SiteConfig;
}

export interface Star {
  id: number;
  top: string;
  left: string;
  size: string;
  duration: string;
}
