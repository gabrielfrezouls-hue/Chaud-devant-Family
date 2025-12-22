export interface JournalEntry {
  id: string;
  date: string;
  author: string;
  title: string;
  content: string;
  image?: string;
  timestamp?: any;
}

export interface Recipe {
  id: string;
  title: string;
  chef: string; // L'auteur
  ingredients: string; // Liste textuelle
  steps: string; // Étapes textuelles
  image?: string;
  category: 'entrée' | 'plat' | 'dessert' | 'autre';
}

export interface FamilyEvent {
  id: string;
  date: string;
  title: string;
  type: 'birthday' | 'party' | 'holiday' | 'other';
}

export type ViewType = 'home' | 'journal' | 'cooking' | 'recipes' | 'calendar' | 'edit';

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
    recipes: string;
    calendar: string;
    tasks?: string; // NOUVEAU
  };
  homeHtml: string;
  cookingHtml: string;
}

export interface SiteVersion {
  id: string;
  name: string;
  date: string;
  config: SiteConfig;
}
