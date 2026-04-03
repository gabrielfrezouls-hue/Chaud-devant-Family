import React, { useState } from 'react';
import { ChefHat, ChevronDown, ChevronUp, Clock, Users } from 'lucide-react';

const RecipeCard = ({ recipe }: { recipe: any }) => {
  // C'est ici que la magie opère : chaque carte a sa propre mémoire "Ouvert/Fermé"
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="glass-panel rounded-[48px] shadow-md overflow-hidden hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1">
      
      {/* IMAGE */}
      <div className="h-48 overflow-hidden relative group">
        <img 
          src={recipe.image || "https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&q=80"} 
          alt={recipe.title} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute top-3 right-3 glass-element px-3 py-1.5 rounded-full text-xs font-bold text-black shadow-sm uppercase">
          {recipe.category || "Plat"}
        </div>
      </div>

      {/* CONTENU */}
      <div className="p-5 relative">
        
        {/* Titre et Chef */}
        <div className="mb-4">
          <h3 className="text-xl text-black leading-tight mb-1">{recipe.title}</h3>
          <p className="text-stone-500 text-sm flex items-center">
            <ChefHat size={14} className="mr-1" />
            Chef : {recipe.chef || "La famille"}
          </p>
        </div>

        {/* Ingrédients (Coupes si fermé) */}
        <div className="mb-6">
          <p className="meta-label text-black/50 mb-2">Ingrédients</p>
          <ul className="text-stone-600 text-sm space-y-1">
            {(isOpen ? recipe.ingredients : recipe.ingredients.slice(0, 3)).map((ing: string, i: number) => (
              <li key={i} className="flex items-start">
                <span className="mr-2 text-orange-300">•</span> {ing}
              </li>
            ))}
            {!isOpen && recipe.ingredients.length > 3 && (
              <li className="text-stone-400 italic text-xs pl-3">... et la suite</li>
            )}
          </ul>
        </div>

        {/* PRÉPARATION (Cachée par défaut) */}
        {isOpen && (
          <div className="mt-4 pt-4 border-t border-orange-100 animate-fadeIn">
            <p className="meta-label text-black/50 mb-2">Préparation</p>
            <p className="text-stone-600 text-sm whitespace-pre-line leading-relaxed">
              {recipe.instructions || "Pas d'étapes détaillées."}
            </p>
          </div>
        )}

        {/* Le fameux BOUTON ROND avec la flèche */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="absolute bottom-4 right-4 p-3 bg-black text-white hover:bg-black/90 transition-colors shadow-sm z-10 rounded-full"
          title={isOpen ? "Fermer" : "Voir la recette"}
        >
          {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>

      </div>
    </div>
  );
};

export default RecipeCard;
